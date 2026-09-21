/**
 * Content sync seam: which edits the rich text view posts to the host, and which it does not.
 *
 * Exercises the ContentSync module (src/webview/content-sync.ts) against real Tiptap
 * editors built via createHarnessEditor, recording through an injected post adapter.
 *
 * Covers the five required cases:
 * 1. a character typed and undone inside one debounce window posts nothing;
 * 2. a document ending in an alert (StarterKit's trailingNode) posts nothing at load;
 * 3. after a real post, the baseline is re-anchored to what was posted;
 * 4. two rapid edits post once, with the last content;
 * 5. a flush with a pending debounce posts immediately.
 */

import { createHarnessEditor } from "./editor";
import { ContentSync, TimerScheduler } from "../src/webview/content-sync";

/**
 * Manual scheduler enabling synchronous, deterministic control over debounce timers.
 */
class ManualClock implements TimerScheduler {
  private nextId = 1;
  private timers = new Map<number, { fn: () => void; time: number }>();
  private currentTime = 0;

  public setTimeout = (fn: () => void, ms?: number): number => {
    const id = this.nextId++;
    this.timers.set(id, { fn, time: this.currentTime + (ms ?? 0) });
    return id;
  };

  public clearTimeout = (id: any): void => {
    this.timers.delete(id);
  };

  public advance(ms: number): void {
    this.currentTime += ms;
    while (true) {
      let earliestId: number | null = null;
      let earliestTime = Infinity;
      for (const [id, t] of this.timers.entries()) {
        if (t.time <= this.currentTime && t.time < earliestTime) {
          earliestId = id;
          earliestTime = t.time;
        }
      }
      if (earliestId === null) break;
      const timer = this.timers.get(earliestId)!;
      this.timers.delete(earliestId);
      timer.fn();
    }
  }

  public hasPending(): boolean {
    return this.timers.size > 0;
  }
}

export function runContentSyncSeam(): string {
  const lines: string[] = [];
  lines.push("# content sync seam: which edits the rich text view posts to the host, and which it does not");
  lines.push("");

  // Case 1: a character typed and undone inside one debounce window posts nothing
  {
    const clock = new ManualClock();
    const posted: string[] = [];
    const { editor, dispose } = createHarnessEditor({
      content: "Hello world",
      contentType: "markdown",
    });
    try {
      const sync = new ContentSync({
        postMessage: (msg) => posted.push(msg.content),
        getEditorBody: () => editor.getMarkdown(),
        scheduler: clock,
      });
      sync.resetContentBaseline();

      // Type character
      editor.commands.insertContent("!");
      sync.debouncedPostEdit();

      // Undo within debounce window
      clock.advance(100);
      editor.commands.undo();
      sync.debouncedPostEdit();

      // Debounce window elapses
      clock.advance(300);

      lines.push(`[type-undo-in-debounce] posts=${posted.length}`);
    } finally {
      dispose();
    }
  }

  // Case 2: a document ending in an alert (StarterKit's trailingNode) posts nothing at load
  {
    const clock = new ManualClock();
    const posted: string[] = [];
    const alertDoc = "> [!NOTE]\n> Note text";
    const { editor, dispose } = createHarnessEditor({
      content: alertDoc,
      contentType: "markdown",
    });
    try {
      const sync = new ContentSync({
        postMessage: (msg) => posted.push(msg.content),
        getEditorBody: () => editor.getMarkdown(),
        scheduler: clock,
      });

      // Host sends update: parse content and settle trailingNode
      sync.applyHostUpdate(alertDoc);
      editor.view.dispatch(editor.state.tr.setMeta("addToHistory", false));
      sync.resetContentBaseline();

      // Verify post-load state does not fire an edit
      sync.debouncedPostEdit();
      clock.advance(300);

      lines.push(`[alert-trailing-node-load] posts=${posted.length}`);
    } finally {
      dispose();
    }
  }

  // Case 3: after a real post, the baseline is re-anchored to what was posted
  {
    const clock = new ManualClock();
    const posted: string[] = [];
    const { editor, dispose } = createHarnessEditor({
      content: "# Hello",
      contentType: "markdown",
    });
    try {
      const sync = new ContentSync({
        postMessage: (msg) => posted.push(msg.content),
        getEditorBody: () => editor.getMarkdown(),
        scheduler: clock,
      });
      // Settle document so baseline matches post-transaction normalization
      editor.view.dispatch(editor.state.tr.setMeta("addToHistory", false));
      sync.resetContentBaseline();

      // Edit 1: type exclamation mark
      editor.commands.insertContent("!");
      sync.debouncedPostEdit();
      clock.advance(300);

      // Edit 2: undo back to initial content
      editor.commands.undo();
      sync.debouncedPostEdit();
      clock.advance(300);

      lines.push(`[baseline-reanchors-after-post] posts=${posted.length}`);
    } finally {
      dispose();
    }
  }

  // Case 4: two rapid edits post once, with the last content
  {
    const clock = new ManualClock();
    const posted: string[] = [];
    const { editor, dispose } = createHarnessEditor({
      content: "Alpha",
      contentType: "markdown",
    });
    try {
      const sync = new ContentSync({
        postMessage: (msg) => posted.push(msg.content),
        getEditorBody: () => editor.getMarkdown(),
        scheduler: clock,
      });
      sync.resetContentBaseline();

      // Rapid edit 1
      editor.commands.insertContentAt(editor.state.doc.content.size - 1, " Beta");
      sync.debouncedPostEdit();
      clock.advance(100);

      // Rapid edit 2 before debounce expires
      editor.commands.insertContentAt(editor.state.doc.content.size - 1, " Gamma");
      sync.debouncedPostEdit();

      clock.advance(300);

      const lastContent = posted[0]?.trim() ?? "";
      lines.push(`[rapid-edits-single-post] posts=${posted.length} content="${lastContent}"`);
    } finally {
      dispose();
    }
  }

  // Case 5: a flush with a pending debounce posts immediately
  {
    const clock = new ManualClock();
    const posted: string[] = [];
    const { editor, dispose } = createHarnessEditor({
      content: "First",
      contentType: "markdown",
    });
    try {
      const sync = new ContentSync({
        postMessage: (msg) => posted.push(msg.content),
        getEditorBody: () => editor.getMarkdown(),
        scheduler: clock,
      });
      sync.resetContentBaseline();

      editor.commands.insertContentAt(editor.state.doc.content.size - 1, " Second");
      sync.debouncedPostEdit();

      const flushed = sync.flushPendingEdit();
      const flushedContent = posted[0]?.trim() ?? "";

      // Advance clock: old timer must not fire a second edit
      clock.advance(300);

      lines.push(`[flush-pending-debounce-posts-immediately] posts=${posted.length} flushed=${flushed} content="${flushedContent}"`);
    } finally {
      dispose();
    }
  }

  return lines.join("\n") + "\n";
}
