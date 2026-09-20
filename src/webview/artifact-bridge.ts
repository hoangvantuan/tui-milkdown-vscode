/**
 * Generic lazy-artifact loader for the 3.0 renderers (KaTeX, the drag handle,
 * the emoji dataset).
 *
 * It is the mermaid bridge's load semantics, made reusable rather than copied
 * three more times: one in-flight promise per artifact, a spent `<script>`
 * element is never waited on twice, a network failure stays retryable, and an
 * artifact that executes WITHOUT registering its global latches a prompt
 * rejection for the page lifetime instead of re-downloading the same broken
 * bytes. Those rules come from #75, where a re-listened `load` event left every
 * diagram at "Rendering..." forever.
 *
 * `mermaid-bridge.ts` deliberately still owns its own copy: it carries the
 * #112 render-scheduling history and rewriting it under a new abstraction
 * during the 3.0 wave would put that at risk for no gain.
 *
 * The URIs and the CSP nonce come from the host's inline bootstrap script
 * (see markdownEditorProvider.ts), because only the extension host can mint
 * webview resource URIs and browsers hide the nonce attribute from the DOM.
 */

/** Artifacts the host publishes a URI for. Keys match `__tuiArtifacts.uris`. */
export type ArtifactKey = "katex" | "dragHandle" | "emoji";

declare global {
  interface Window {
    /** Injected by the host's nonce-bearing inline bootstrap script. */
    __tuiArtifacts?: {
      nonce: string;
      uris: Record<ArtifactKey, string>;
      /** Directory holding katex.min.css and fonts/, as a webview URI. */
      katexAssetsUri: string;
    };
  }
}

type Entry = {
  cached: unknown | null;
  inflight: Promise<unknown> | null;
  /** Non-null once the artifact ran without registering its global. */
  broken: Error | null;
};

const entries = new Map<ArtifactKey, Entry>();

function entryFor(key: ArtifactKey): Entry {
  let e = entries.get(key);
  if (!e) {
    e = { cached: null, inflight: null, broken: null };
    entries.set(key, e);
  }
  return e;
}

/** The global each artifact registers itself on. */
const GLOBAL_NAMES: Record<ArtifactKey, string> = {
  katex: "__tuiKatexBundle",
  dragHandle: "__tuiDragHandleBundle",
  emoji: "__tuiEmojiBundle",
};

function readGlobal<T>(key: ArtifactKey): T | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as Record<string, T | undefined>)[GLOBAL_NAMES[key]];
}

/** The already-loaded artifact, or null when it has not been loaded yet. */
export function getCachedArtifact<T>(key: ArtifactKey): T | null {
  const entry = entryFor(key);
  if (entry.cached) return entry.cached as T;
  const fromGlobal = readGlobal<T>(key);
  if (fromGlobal) entry.cached = fromGlobal;
  return (entry.cached as T) ?? null;
}

/**
 * The webview URI of the directory holding katex.min.css and fonts/.
 * Empty string when the bootstrap is missing, which the caller must treat as
 * "cannot render" rather than as a relative path.
 */
export function getKatexAssetsUri(): string {
  return (typeof window !== "undefined" && window.__tuiArtifacts?.katexAssetsUri) || "";
}

/**
 * Load one artifact on demand. Idempotent and race-safe: concurrent callers
 * share a single injection. Never leaves a pending promise.
 */
export function loadArtifact<T>(key: ArtifactKey): Promise<T> {
  const entry = entryFor(key);
  const already = getCachedArtifact<T>(key);
  if (already) return Promise.resolve(already);
  if (entry.inflight) return entry.inflight as Promise<T>;
  if (entry.broken) return Promise.reject(entry.broken);

  const inflight = inject<T>(key, entry).then((bundle) => {
    entry.cached = bundle;
    return bundle;
  });
  entry.inflight = inflight;
  // A failed load must not cache its rejection: the next call retries.
  inflight.catch(() => {
    entry.inflight = null;
  });
  return inflight;
}

function inject<T>(key: ArtifactKey, entry: Entry): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const registered = readGlobal<T>(key);
    if (registered) {
      resolve(registered);
      return;
    }

    const bootstrap = typeof window !== "undefined" ? window.__tuiArtifacts : undefined;
    const uri = bootstrap?.uris?.[key];
    if (!bootstrap || !uri || !bootstrap.nonce) {
      reject(new Error(`Artifact bootstrap config missing; cannot lazy-load "${key}"`));
      return;
    }

    const elementId = `tui-artifact-${key}`;
    // A settled <script> never fires load/error again, so a stale element with
    // this id could only produce a promise that hangs (#75). Sweep it.
    document.getElementById(elementId)?.remove();

    const script = document.createElement("script");
    script.id = elementId;
    script.src = uri;
    // Nonce-bearing element: allowed by the page's nonce-only script-src
    // without relaxing the CSP.
    script.nonce = bootstrap.nonce;
    document.head.appendChild(script);

    script.addEventListener("load", () => {
      const bundle = readGlobal<T>(key);
      if (bundle) {
        resolve(bundle);
        return;
      }
      script.remove();
      entry.broken = new Error(
        `Artifact "${key}" executed but did not register window.${GLOBAL_NAMES[key]}`,
      );
      reject(entry.broken);
    });
    script.addEventListener("error", () => {
      // Network-level failure: transient, so stay retryable.
      script.remove();
      reject(new Error(`Failed to load artifact "${key}": ${uri}`));
    });
  });
}
