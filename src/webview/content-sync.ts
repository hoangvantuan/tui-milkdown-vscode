/**
 * Content sync: what the host holds versus what the rich text view has promised.
 *
 * Owns the document synchronization state between the webview and the host:
 * baseline tracking, debounced edit scheduling, flush, echo suppression, and
 * the gate that prevents an unedited or reverted document from dirtying the
 * file on disk (#111).
 *
 * Node-safe: no DOM, window, or extension host APIs. Injected with postMessage.
 */

import {
  parseContent,
  reconstructContent,
  FrontmatterFormat,
  ParseResult,
} from "./frontmatter";

import type { EditMessage } from "../shared/messages";

export const DEBOUNCE_MS = 300;
export const MAX_BLOB_RETRIES = 5;

export interface TimerScheduler {
  setTimeout: (fn: () => void, ms?: number) => any;
  clearTimeout: (id: any) => void;
}

const defaultScheduler: TimerScheduler = {
  setTimeout: (fn: () => void, ms?: number) => setTimeout(fn, ms),
  clearTimeout: (id: any) => clearTimeout(id),
};

export interface ContentSyncOptions {
  /** Injected postMessage adapter. In production: vscode.postMessage; in harness: recording poster. */
  postMessage: (msg: EditMessage) => void;
  /** Function to serialize the editor body, applying reverse image mappings. */
  getEditorBody?: () => string | null;
  /** Optional hook to check if inline images are pending asynchronous upload. */
  checkPendingBlobs?: (content: string) => Promise<boolean>;
  /** Debounce delay in milliseconds (default: 300). */
  debounceMs?: number;
  /** Optional custom scheduler for timers (e.g. mock clock in test harness). */
  scheduler?: TimerScheduler;
  /** Optional callback to query the current image map version for echo serialization. */
  getImageMapVersion?: () => number;
}

export class ContentSync {
  private currentBody: string = "";
  private currentFrontmatter: string | null = null;
  private currentFormat: FrontmatterFormat = "none";
  private currentRawBlock: string | null = null;
  private contentBaseline: string | null = null;
  private lastSentState: string | null = null;
  private isUpdatingFromExtension: boolean = false;
  private debounceTimer: any = null;
  private blobRetryCount: number = 0;

  constructor(private readonly options: ContentSyncOptions) {}

  private get scheduler(): TimerScheduler {
    return this.options.scheduler ?? defaultScheduler;
  }

  /** The body as this webview would write it, without touching currentBody. */
  public serializeEditorBody(): string | null {
    if (this.options.getEditorBody) {
      return this.options.getEditorBody();
    }
    return null;
  }

  /** The full document (frontmatter + body) as it would be written out. */
  public buildContent(body?: string): string {
    const targetBody = body !== undefined ? body : this.currentBody;
    return reconstructContent(
      this.currentFrontmatter,
      targetBody,
      this.currentFormat,
      this.currentRawBlock,
    );
  }

  /**
   * Serialize state for echo suppression.
   * Cheaper than JSON stringification: appends image map version to content.
   */
  public serializeStateForEcho(
    content: string,
    imageMapOrVersion?: Record<string, string> | number,
  ): string {
    let version = 0;
    if (typeof imageMapOrVersion === "number") {
      version = imageMapOrVersion;
    } else if (this.options.getImageMapVersion) {
      version = this.options.getImageMapVersion();
    }
    return content + "\0" + version;
  }

  /**
   * Check whether an incoming update from the host is an echo of the last edit.
   * If it is, clears lastSentState and returns true. Otherwise clears lastSentState and returns false.
   */
  public consumeEcho(
    content: string,
    imageMapOrVersion?: Record<string, string> | number,
  ): boolean {
    const incomingState = this.serializeStateForEcho(content, imageMapOrVersion);
    if (incomingState === this.lastSentState) {
      this.lastSentState = null;
      return true;
    }
    this.lastSentState = null;
    return false;
  }

  /**
   * The ONE place an edit leaves the webview (#111).
   *
   * Every caller used to repeat the lastSentState assignment next to its own
   * postMessage, so a new call site was one forgotten line away from an echo
   * loop, and there was nowhere to put the baseline check that stops a
   * round-tripped document from being written back as a user edit.
   *
   * Returns whether anything was sent.
   */
  public postEdit(content: string): boolean {
    if (content === this.contentBaseline) return false;
    this.contentBaseline = content;
    this.lastSentState = this.serializeStateForEcho(content);
    this.options.postMessage({ type: "edit", content });
    return true;
  }

  /** Re-anchor the baseline to what the editor currently holds or an explicit body. */
  public resetContentBaseline(explicitBody?: string): void {
    const body = explicitBody !== undefined ? explicitBody : this.serializeEditorBody();
    this.contentBaseline = body === null ? null : this.buildContent(body);
  }

  /**
   * Schedule a debounced edit post.
   * Serialization happens inside the debounce callback, not on every keystroke.
   */
  public debouncedPostEdit(): void {
    const scheduler = this.scheduler;
    if (this.debounceTimer !== null) {
      scheduler.clearTimeout(this.debounceTimer);
    }
    const delay = this.options.debounceMs ?? DEBOUNCE_MS;
    this.debounceTimer = scheduler.setTimeout(async () => {
      const body = this.serializeEditorBody();
      if (body === null) {
        this.debounceTimer = null;
        return;
      }
      const content = this.buildContent(body);

      const hasPendingBlobs = this.options.checkPendingBlobs
        ? await this.options.checkPendingBlobs(content)
        : false;

      if (hasPendingBlobs && content !== this.contentBaseline) {
        if (this.blobRetryCount < MAX_BLOB_RETRIES) {
          const backoff = delay * Math.pow(2, this.blobRetryCount);
          this.blobRetryCount++;
          this.debounceTimer = scheduler.setTimeout(() => {
            this.debounceTimer = null;
            this.debouncedPostEdit();
          }, backoff);
        } else {
          this.blobRetryCount = 0;
          if (this.postEdit(content)) this.currentBody = body;
          this.debounceTimer = null;
        }
        return;
      }

      this.blobRetryCount = 0;
      if (this.postEdit(content)) this.currentBody = body;
      this.debounceTimer = null;
    }, delay);
  }

  /** Alias for debouncedPostEdit matching the spec interface. */
  public scheduleEdit(): void {
    this.debouncedPostEdit();
  }

  /**
   * Flush any pending edit immediately.
   * If force is true, flushes even if no debounce was scheduled.
   * Returns whether an edit was posted.
   */
  public flushPendingEdit(force: boolean = false): boolean {
    const scheduler = this.scheduler;
    const hadPending = this.debounceTimer !== null;
    if (!hadPending && !force) return false;

    if (this.debounceTimer !== null) {
      scheduler.clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.blobRetryCount = 0;

    const body = this.serializeEditorBody();
    if (body === null) return false;

    const content = this.buildContent(body);
    if (this.postEdit(content)) {
      this.currentBody = body;
      return true;
    }
    return false;
  }

  /** Alias for flushPendingEdit matching the spec interface. */
  public flushEdit(force: boolean = false): boolean {
    return this.flushPendingEdit(force);
  }

  /** Cancel any pending debounced edit timer without posting. */
  public cancelDebounce(): void {
    const scheduler = this.scheduler;
    if (this.debounceTimer !== null) {
      scheduler.clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.blobRetryCount = 0;
  }

  /** Check if a debounce timer is currently running. */
  public hasPendingDebounce(): boolean {
    return this.debounceTimer !== null;
  }

  /**
   * Apply an incoming content update from the host.
   * Parses frontmatter and body, storing them in state.
   */
  public applyHostUpdate(content: string): ParseResult {
    const parsed = parseContent(content);
    this.currentFrontmatter = parsed.frontmatter;
    this.currentBody = parsed.body;
    this.currentFormat = parsed.format;
    this.currentRawBlock = parsed.rawBlock ?? null;
    return parsed;
  }

  /**
   * Run a callback under the isUpdatingFromExtension flag, clearing it on the
   * next microtask. The ONLY way to raise that flag (#150): there is no setter,
   * so a caller cannot set it and forget to clear it, nor clear it early.
   *
   * The microtask is the point, not an implementation detail. Setting the
   * content of a ProseMirror view dispatches transactions whose `onUpdate`
   * handlers run after `fn` returns but before the microtask checkpoint drains;
   * clearing synchronously in the `finally` would let those transactions post
   * an `edit` for text the host just sent us. `harness/content-sync-seam.ts`
   * measures the flag at all three moments: inside, after the call returns, and
   * after one microtask.
   */
  public guardExtensionUpdate<T>(fn: () => T): T {
    this.isUpdatingFromExtension = true;
    try {
      return fn();
    } finally {
      queueMicrotask(() => {
        this.isUpdatingFromExtension = false;
      });
    }
  }

  // Getters and setters for callers that need them (image save, metadata edit)
  public getBody(): string {
    return this.currentBody;
  }

  public setBody(body: string): void {
    this.currentBody = body;
  }

  public getFrontmatter(): string | null {
    return this.currentFrontmatter;
  }

  public setFrontmatter(frontmatter: string | null): void {
    this.currentFrontmatter = frontmatter;
  }

  public getFormat(): FrontmatterFormat {
    return this.currentFormat;
  }

  public setFormat(format: FrontmatterFormat): void {
    this.currentFormat = format;
  }

  public getRawBlock(): string | null {
    return this.currentRawBlock;
  }

  public setRawBlock(rawBlock: string | null): void {
    this.currentRawBlock = rawBlock;
  }

  public getContentBaseline(): string | null {
    return this.contentBaseline;
  }

  public setContentBaseline(baseline: string | null): void {
    this.contentBaseline = baseline;
  }

  public getLastSentState(): string | null {
    return this.lastSentState;
  }

  public setLastSentState(state: string | null): void {
    this.lastSentState = state;
  }

  /**
   * Whether an update driven by the host (or by this webview rewriting image
   * nodes on its behalf) is in progress. Reads ONE field: until #150 it also
   * consulted an `isExternalUpdating` callback that `main.ts` answered from a
   * module-scope flag of its own, so two places held one truth and either could
   * be the one a new caller set.
   */
  public isUpdating(): boolean {
    return this.isUpdatingFromExtension;
  }

  public getBlobRetryCount(): number {
    return this.blobRetryCount;
  }
}
