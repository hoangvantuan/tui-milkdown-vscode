/**
 * Content sync seam: which edits the rich text view posts to the host, and which it does not.
 *
 * Exercises the ContentSync module (src/webview/content-sync.ts) against real Tiptap
 * editors built via createHarnessEditor, recording through an injected post adapter.
 *
 * Covers seven cases:
 * 1. a character typed and undone inside one debounce window posts nothing;
 * 2. a document ending in an alert (StarterKit's trailingNode) posts nothing at load;
 * 3. after a real post, the baseline is re-anchored to what was posted;
 * 4. two rapid edits post once, with the last content;
 * 5. a flush with a pending debounce posts immediately;
 * 6. the debounce COALESCES: the first timer is cleared, so nothing is
 *    serialized or posted at its deadline (#150);
 * 7. the extension-update latch is raised for the call and released one
 *    microtask later, never synchronously (#150).
 *
 * Cases 6 and 7 close gaps the wave 10 close of #148 recorded. Neither is
 * measurable through `posted.length` alone: the baseline gate in `postEdit`
 * absorbs the extra post an uncoalesced debounce makes, and the latch is not
 * observable from the outside at all except by reading it. So case 6 counts
 * serializations and samples at the first deadline, and case 7 reads the flag.
 *
 * Async because of case 7: releasing the latch on a microtask is the property
 * under test, and a microtask cannot be drained from synchronous code.
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

export async function runContentSyncSeam(): Promise<string> {
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

  // Case 6: the debounce coalesces two rapid edits into ONE timer
  //
  // `rapid-edits-single-post` above cannot see this. Serialization happens
  // inside the debounce callback, so an uncoalesced first timer serializes the
  // document as it stands at ITS deadline, which is already the final text;
  // the second post is then swallowed by the baseline gate and the count still
  // reads 1. What moves is when the work happens and how often: sampling at
  // the first timer's deadline and counting serializations both flip when
  // `clearTimeout` is removed from `debouncedPostEdit`.
  {
    const clock = new ManualClock();
    const posted: string[] = [];
    let serializations = 0;
    const { editor, dispose } = createHarnessEditor({
      content: "Alpha",
      contentType: "markdown",
    });
    try {
      const sync = new ContentSync({
        postMessage: (msg) => posted.push(msg.content),
        getEditorBody: () => {
          serializations++;
          return editor.getMarkdown();
        },
        scheduler: clock,
      });
      sync.resetContentBaseline();
      serializations = 0; // the baseline anchor is not a debounce serialization

      // Edit 1 at t=0, so its timer would fire at t=300.
      editor.commands.insertContentAt(editor.state.doc.content.size - 1, " Beta");
      sync.debouncedPostEdit();

      // Edit 2 at t=100 restarts the window: the only timer now fires at t=400.
      clock.advance(100);
      editor.commands.insertContentAt(editor.state.doc.content.size - 1, " Gamma");
      sync.debouncedPostEdit();

      clock.advance(200); // t=300, the deadline the first timer would have had
      const atFirstDeadline = posted.length;

      clock.advance(100); // t=400
      lines.push(
        `[debounce-coalesces-into-one-timer] postsAtFirstDeadline=${atFirstDeadline} posts=${posted.length} serializations=${serializations}`,
      );
    } finally {
      dispose();
    }
  }

  // Case 7: the extension-update latch, read at all three moments
  //
  // `guardExtensionUpdate` is the only way to raise the flag since #150. The
  // reading that matters is `afterReturn`: a `finally` that cleared the flag
  // synchronously would make it false there, and the transactions a host update
  // dispatches after the call returns would then post the host's own text back
  // as a user edit. `settled` catches the opposite break, a latch never
  // released, which would swallow every edit from then on.
  {
    const posted: string[] = [];
    const sync = new ContentSync({
      postMessage: (msg) => posted.push(msg.content),
      getEditorBody: () => null,
    });

    const before = sync.isUpdating();
    let inside = false;
    const returned = sync.guardExtensionUpdate(() => {
      inside = sync.isUpdating();
      return 42;
    });
    const afterReturn = sync.isUpdating();
    // Queued after the guard's own clear microtask, so this resumes behind it.
    await Promise.resolve();
    const settled = sync.isUpdating();

    lines.push(
      `[extension-update-latch] before=${before} inside=${inside} afterReturn=${afterReturn} settled=${settled} returns=${returned} posts=${posted.length}`,
    );
  }

  return lines.join("\n") + "\n";
}
