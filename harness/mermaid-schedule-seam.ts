/**
 * Mermaid schedule seam: a scheduled diagram render survives the plugin view
 * being destroyed and recreated, and dies with the editor.
 *
 * Why this seam exists: `editor.registerPlugin()` reconfigures the state, and
 * ProseMirror then destroys EVERY plugin view and creates them again. The drag
 * handle registers its plugin lazily, on the first pointer entry into the
 * editor, so this happens at document open whenever the pointer is already
 * over the editor. The mermaid plugin's first render is scheduled at that
 * moment, behind a 500ms debounce, and it used to be cancelled by the plugin
 * view's `destroy()`. The recreated view then skipped the widget, because
 * `data-mermaid-src` had been written when the render was SCHEDULED, not
 * when it landed, so the diagram sat at "Rendering…" until the next edit.
 *
 * What is observed: the widget's DOM state after the debounce has elapsed.
 * jsdom has no `__tuiMermaidBootstrap`, so a render attempt rejects in the
 * bridge and the widget ends in the ERROR state. Here "error" is the GOOD
 * reading: it proves a render was attempted. "loading" after the deadline
 * is the bug: nothing fired.
 *
 * Three cases:
 *   1. control: no late plugin, the render is attempted;
 *   2. race: a plugin registered after the scan and before the debounce
 *      elapses, the render must still be attempted;
 *   3. editor destroyed before the debounce elapses: the render must NOT be
 *      attempted (a timer that outlives the plugin view must not outlive the
 *      editor and fetch an 8.5 MB artifact for a dead page).
 *
 * Async because the plugin uses real timers: the scan runs on
 * rAF-or-50ms and the render 500ms later.
 */
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { createHarnessEditor } from "./editor";
import { MermaidDiagram } from "../src/webview/mermaid-plugin";

const DOC = "# Doc\n\nIntro.\n\n```mermaid\nflowchart TD\n  A[Start] --> B[End]\n```\n\nAfter.\n";
/** Past the scan's 50ms floor, well short of the 500ms render debounce. */
const AFTER_SCAN_MS = 150;
/** Past the render debounce, measured from the scan. */
const AFTER_DEBOUNCE_MS = 900;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function describe(widget: HTMLElement | null): string {
  if (!widget) return "widget=absent";
  const scheduled = widget.hasAttribute("data-mermaid-src");
  const loading = widget.querySelectorAll(".mermaid-loading").length;
  const error = widget.classList.contains("mermaid-error");
  const rendered = widget.getAttribute("data-rendered") === "true";
  return `scheduled=${scheduled} loading=${loading} error=${error} rendered=${rendered}`;
}

export async function runMermaidScheduleSeam(): Promise<string> {
  const lines: string[] = [];
  lines.push("# mermaid schedule seam: a scheduled render survives a plugin view reset, and dies with the editor");
  lines.push("");
  lines.push("jsdom has no mermaid bootstrap, so an ATTEMPTED render ends in error=true.");
  lines.push("loading=1 after the debounce means nothing fired: that is the bug.");
  lines.push("");

  // Case 1: control.
  {
    const { editor, host, dispose } = createHarnessEditor({
      content: DOC,
      extraExtensions: [MermaidDiagram],
    });
    try {
      await sleep(AFTER_SCAN_MS);
      const afterScan = describe(host.querySelector(".mermaid-preview"));
      await sleep(AFTER_DEBOUNCE_MS);
      lines.push("[control] no late plugin registration");
      lines.push(`  after scan:     ${afterScan}`);
      lines.push(`  after debounce: ${describe(host.querySelector(".mermaid-preview"))}`);
      lines.push("");
      void editor;
    } finally {
      dispose();
    }
  }

  // Case 2: a plugin registered between the scan and the render.
  {
    const { editor, host, dispose } = createHarnessEditor({
      content: DOC,
      extraExtensions: [MermaidDiagram],
    });
    try {
      await sleep(AFTER_SCAN_MS);
      const afterScan = describe(host.querySelector(".mermaid-preview"));
      // What the drag handle does on first pointer entry: reconfigure the
      // state, which destroys and recreates every plugin view.
      editor.registerPlugin(new Plugin({ key: new PluginKey("seamLateRegistered") }));
      await sleep(AFTER_DEBOUNCE_MS);
      lines.push("[race] editor.registerPlugin() after the scan, before the debounce elapses");
      lines.push(`  after scan:     ${afterScan}`);
      lines.push(`  after debounce: ${describe(host.querySelector(".mermaid-preview"))}`);
      lines.push("");
    } finally {
      dispose();
    }
  }

  // Case 3: the editor is destroyed before the render fires.
  {
    const { host, dispose } = createHarnessEditor({
      content: DOC,
      extraExtensions: [MermaidDiagram],
    });
    await sleep(AFTER_SCAN_MS);
    const widget = host.querySelector<HTMLElement>(".mermaid-preview");
    const afterScan = describe(widget);
    dispose();
    await sleep(AFTER_DEBOUNCE_MS);
    lines.push("[destroyed] editor destroyed after the scan, before the debounce elapses");
    lines.push(`  after scan:     ${afterScan}`);
    lines.push(`  after debounce: ${describe(widget)} connected=${widget?.isConnected ?? false}`);
    lines.push("");
  }

  return lines.join("\n");
}
