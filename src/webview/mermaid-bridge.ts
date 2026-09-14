/**
 * Lazy-loading bridge between the webview main bundle and the mermaid
 * artifact (out/webview/mermaid-loader.js, a separate esbuild entry).
 *
 * Why: mermaid is by far the heaviest dependency in the webview bundle
 * (several MB minified) and most documents contain no diagram at all.
 * Loading it eagerly made every .md open pay for it. The webview bundle
 * is built with esbuild `format: 'iife'`, so a dynamic `import()` cannot
 * produce a split chunk — instead mermaid is built as its own IIFE entry
 * and injected here as a classic <script> at render time.
 *
 * CSP: the webview runs under `script-src 'nonce-…'`. Browsers hide the
 * nonce attribute from the DOM, so the extension host exposes the nonce
 * and the artifact URI to the page via a nonce-bearing inline bootstrap
 * script (see markdownEditorProvider.ts) that sets
 * `window.__tuiMermaidBootstrap` BEFORE main.js runs. The injected script
 * element reuses that nonce, so the CSP stays exactly as strict as it is.
 * What IS given up is nonce hiding: an XSS inside the webview could read
 * `__tuiMermaidBootstrap.nonce` and run further scripts. Weigh this
 * together with mermaid's `securityLevel: "loose"` (mermaid-plugin.ts).
 *
 * Race safety: concurrent callers (two diagrams rendering at once) share
 * one in-flight promise and one <script> element; exactly one network
 * load and one global registration happen. After success the bundle is
 * cached synchronously.
 *
 * Failure semantics (issue #75): a <script> element fires `load`/`error`
 * at most once, so a settled element can never be waited on again. A
 * network failure removes the element and stays retryable (the next call
 * performs a fresh injection). An artifact that executes WITHOUT
 * registering the global latches the failure for the rest of the page
 * lifetime: later calls reject promptly instead of re-downloading the
 * same broken bytes, and the webview reload is what picks up a fixed
 * build. Neither path can leave a pending promise.
 */
import type ElkLayouts from "@mermaid-js/layout-elk";
import type Mermaid from "mermaid";

export type MermaidBundle = {
    mermaid: typeof Mermaid;
    elkLayouts: typeof ElkLayouts;
};

declare global {
    interface Window {
        /** Injected by the extension host's nonce-bearing inline bootstrap script. */
        __tuiMermaidBootstrap?: { scriptUri: string; nonce: string };
        /** Set by the lazy mermaid artifact once it has executed. */
        __tuiMermaidBundle?: MermaidBundle;
    }
}

const LOADER_SCRIPT_ID = "tui-mermaid-loader";

let cached: MermaidBundle | null = null;
let inflight: Promise<MermaidBundle> | null = null;
/**
 * Latched when the artifact executed but did not register the global.
 * Non-null means the page is stuck with a broken artifact until reload:
 * retrying would re-download the same bytes, so fail fast instead.
 * Network failures never set this — they stay retryable.
 */
let brokenArtifactError: Error | null = null;

/** The already-loaded bundle, or null if mermaid has not been loaded yet. */
export function getCachedMermaidBundle(): MermaidBundle | null {
    if (cached) return cached;
    const fromGlobal = typeof window !== "undefined" ? window.__tuiMermaidBundle : undefined;
    if (fromGlobal) cached = fromGlobal;
    return cached;
}

/**
 * Load the mermaid artifact on demand. Idempotent and race-safe: the first
 * call injects the <script> element; every concurrent or later call reuses
 * the same promise/result. A network failure clears the in-flight promise
 * so the next call retries with a fresh injection; a broken artifact (ran
 * but never registered the global) latches a prompt rejection for the
 * page lifetime (see the header comment), so no call can hang.
 */
export function loadMermaidBundle(): Promise<MermaidBundle> {
    const already = getCachedMermaidBundle();
    if (already) return Promise.resolve(already);
    if (inflight) return inflight;
    if (brokenArtifactError) return Promise.reject(brokenArtifactError);

    inflight = injectLoaderScript().then((bundle) => {
        cached = bundle;
        return bundle;
    });
    // On failure, allow the next call to retry instead of caching rejection.
    inflight.catch(() => {
        inflight = null;
    });
    return inflight;
}

function injectLoaderScript(): Promise<MermaidBundle> {
    return new Promise<MermaidBundle>((resolve, reject) => {
        const registered = typeof window !== "undefined" ? window.__tuiMermaidBundle : undefined;
        if (registered) {
            resolve(registered);
            return;
        }

        const bootstrap = typeof window !== "undefined" ? window.__tuiMermaidBootstrap : undefined;
        if (!bootstrap || !bootstrap.scriptUri || !bootstrap.nonce) {
            reject(new Error("Mermaid bootstrap config missing; cannot lazy-load the diagram renderer"));
            return;
        }

        // Never reuse an existing element with this id: once its `load` or
        // `error` has fired, listeners attached now can never fire and the
        // promise would hang forever (issue #75). Both failure paths below
        // remove the element after settling, so this is a defensive sweep.
        document.getElementById(LOADER_SCRIPT_ID)?.remove();

        const script = document.createElement("script");
        script.id = LOADER_SCRIPT_ID;
        script.src = bootstrap.scriptUri;
        // Nonce-bearing script element: allowed by the page's nonce-only
        // script-src CSP without any CSP relaxation.
        script.nonce = bootstrap.nonce;
        document.head.appendChild(script);

        script.addEventListener("load", () => {
            const bundle = window.__tuiMermaidBundle;
            if (bundle) {
                resolve(bundle);
                return;
            }
            // The artifact finished executing without registering the global
            // (broken or truncated build). The element is spent — `load`
            // never fires again — so remove it and latch the failure: a
            // genuine re-injection would fetch the same broken bytes, so
            // later calls reject promptly instead (issue #75).
            script.remove();
            brokenArtifactError = new Error(
                "Mermaid artifact executed but did not register window.__tuiMermaidBundle",
            );
            reject(brokenArtifactError);
        });
        script.addEventListener("error", () => {
            // Network-level failure: transient, so stay retryable rather
            // than latching — the next call injects a fresh element.
            script.remove();
            reject(new Error(`Failed to load mermaid artifact: ${bootstrap.scriptUri}`));
        });
    });
}
