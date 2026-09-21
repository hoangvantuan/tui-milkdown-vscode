# Defer request/response correlation and suggestion source dedup

The architecture review identified two Speculative candidates for deepening in the
webview messaging layer: a unified request/response correlation replacing the four
hand-rolled patterns (candidate 5), and deduplicating the suggestion source fetch
shared by @-mention and wiki-link plugins (candidate 6). Both are deferred.

**Candidate 5 (message correlation):** the eight request/response pairs use four
different identification schemes (`editId`, `renameId`, `blobUrl` as implicit key,
and CustomEvent bus with last-wins semantics). Two overlapping popups can receive
each other's results. The benefit is correctness of a race that has never been
reported as a bug, and the cost is touching all 33 message kinds plus the handler
table, the CustomEvent bus, and the pending-maps in two files. The risk-to-benefit
ratio does not justify the change now.

**Candidate 6 (suggestion source dedup):** ~40 lines of fetch-from-host conversation
are duplicated between `file-mention-plugin.ts` and `wiki-link-plugin.ts` (two of
four suggestion consumers; slash and emoji have different `allow()` logic). If
candidate 5 were done first, the CustomEvent bus that carries these results would be
replaced, and the duplication would shrink further or disappear.

**Conditions for reopening:**
- A real bug caused by two popups overlapping and receiving each other's results
  (the race candidate 5 would fix).
- The message protocol being rewritten for another reason, making candidate 5 a
  marginal addition.
- A third suggestion consumer needing the same fetch pattern, making candidate 6's
  duplication 3-of-N instead of 2-of-4.
