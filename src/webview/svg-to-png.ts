/**
 * Convert an SVG markup string into a PNG Blob at an arbitrary scale,
 * and write the PNG to the system clipboard. CSP-safe (no eval, no inline
 * script). Uses a Blob URL + HTMLImageElement + canvas rasterization so the
 * resulting PNG is crisp at the requested pixel dimensions.
 */

const LOAD_IMAGE_TIMEOUT_MS = 5000;
const TO_BLOB_TIMEOUT_MS = 5000;

/**
 * Convert SVG markup to a PNG Blob.
 *
 * @param svgString  SVG markup.
 * @param scale      Pixel scale multiplier (2 = retina).
 * @param background CSS color for the canvas behind the SVG. Defaults to
 *                   white so exported/copied mermaid diagrams are readable
 *                   on any target (Word, Slack, PDF, email). Pass `null`
 *                   to keep the canvas transparent.
 */
export async function svgToPngBlob(
    svgString: string,
    scale: number = 2,
    background: string | null = "#ffffff",
): Promise<Blob> {
    // Mermaid with securityLevel:"loose" emits foreignObject containing HTML
    // (e.g. unclosed <br>, <div>) which breaks strict XML parsing.
    // Try XML first; fall back to HTML parsing if it fails.
    let svg: SVGSVGElement | null = null;

    try {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(svgString, "image/svg+xml");
        const parseError = xmlDoc.querySelector("parsererror");
        if (!parseError && xmlDoc.documentElement.tagName.toLowerCase() === "svg") {
            svg = xmlDoc.documentElement as unknown as SVGSVGElement;
        } else {
            // Fallback: parse as HTML and extract the SVG element
            const htmlDoc = parser.parseFromString(svgString, "text/html");
            svg = htmlDoc.querySelector("svg") as unknown as SVGSVGElement | null;
        }
    } catch (err) {
        throw new Error(`Invalid SVG markup: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (!svg) {
        throw new Error("Invalid SVG markup");
    }

    let { width, height } = resolveSvgSize(svg);
    if (width <= 0 || height <= 0) {
        // Fallback for SVGs without width/height/viewBox so the mermaid block
        // still produces a copy/export image instead of failing silently.
        console.warn("[svgToPng] SVG dimensions missing, using fallback 800x600");
        width = 800;
        height = 600;
    }

    // Ensure explicit width/height so <img> can rasterize; lightbox strips these.
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", String(height));
    if (!svg.getAttribute("xmlns")) {
        svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    }

    let serialized: string;
    try {
        serialized = new XMLSerializer().serializeToString(svg);
    } catch (err) {
        throw new Error(`Failed to serialize SVG: ${err instanceof Error ? err.message : String(err)}`);
    }
    // data: URL stays same-origin with the document so the resulting canvas
    // is not tainted (blob: URLs inside the VS Code webview sandbox can cross
    // the origin boundary and block canvas.toBlob export).
    const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(serialized)}`;

    const img = await loadImage(url);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context unavailable");
    if (background) {
        ctx.fillStyle = background;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => {
        const timeoutId = window.setTimeout(
            () => reject(new Error("canvas.toBlob timed out")),
            TO_BLOB_TIMEOUT_MS,
        );
        canvas.toBlob((b) => {
            window.clearTimeout(timeoutId);
            if (b) resolve(b);
            else reject(new Error("canvas.toBlob returned null"));
        }, "image/png");
    });
}

export async function copyPngBlobToClipboard(blob: Blob): Promise<void> {
    const w = window as unknown as {
        ClipboardItem?: typeof ClipboardItem;
    };
    if (typeof w.ClipboardItem === "undefined" || !navigator.clipboard?.write) {
        throw new Error("Clipboard image write API unavailable");
    }
    await navigator.clipboard.write([
        new ClipboardItem({ "image/png": blob }),
    ]);
}

/**
 * Emit a CustomEvent that the main webview listener forwards to the extension
 * as a showWarning message. Keeps this module decoupled from vscode API handle.
 */
export function reportCopyError(message: string): void {
    document.dispatchEvent(
        new CustomEvent("mermaid-copy-error", { detail: { message } }),
    );
}

function resolveSvgSize(svg: SVGSVGElement): {
    width: number;
    height: number;
} {
    const w = parseFloat(svg.getAttribute("width") || "");
    const h = parseFloat(svg.getAttribute("height") || "");
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
        return { width: w, height: h };
    }
    const viewBox = svg.getAttribute("viewBox");
    if (viewBox) {
        const parts = viewBox.trim().split(/[\s,]+/).map(parseFloat);
        if (
            parts.length === 4 &&
            Number.isFinite(parts[2]) &&
            Number.isFinite(parts[3]) &&
            parts[2] > 0 &&
            parts[3] > 0
        ) {
            return { width: parts[2], height: parts[3] };
        }
    }
    return { width: 0, height: 0 };
}

function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const timeoutId = window.setTimeout(() => {
            reject(new Error("Image load timed out"));
        }, LOAD_IMAGE_TIMEOUT_MS);
        img.onload = () => {
            window.clearTimeout(timeoutId);
            resolve(img);
        };
        img.onerror = () => {
            window.clearTimeout(timeoutId);
            reject(new Error("Failed to load SVG as image"));
        };
        img.src = src;
    });
}
