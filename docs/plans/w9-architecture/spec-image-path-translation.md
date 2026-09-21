# Spec: Image Path Translation (Candidate 3, refactor)

_Blocked by: Image Path Translation Bug Fix (C3 prerequisite)._

## Problem Statement

The webview's image path mapping state is split across two modules:

- The main webview module holds `currentImageMap`, `imageMapVersion`,
  `cachedReverseImageMap`, `replaceImagePaths`, `transformForDisplay`,
  `transformForSave`, and the `currentImageMap = ...; imageMapVersion++;
  setImageMap(...)` triple repeated at four sites.

- The image edit plugin holds its own `currentImageMap` reference, `setImageMap`,
  and direct map mutation in `handleImageRenameResponse`.

The plugin comments say "update map BEFORE so transformForSave is correct", but
`transformForSave` reads a cached reverse map gated by `imageMapVersion`, and the
plugin cannot touch that counter. Two modules disagree about who owns cache
invalidation.

`replaceImagePaths` does exact string comparison while `sameResource` exists precisely
because two spellings of the same URL can differ.

Evidence: see `docs/plans/w9-architecture/00-verification.md`, Candidate 3.

## Solution

A single Image Path Translation module that owns the map, version, cache, and all
path transformations. The module exports:
- `setMap(map)`: replaces the map, bumps version, invalidates cache
- `mutateMap(fn)`: calls `fn(map)`, bumps version, invalidates cache
- `transformForDisplay(body)`: forward direction (relative path to webview URI)
- `transformForSave(body)`: reverse direction (uses `sameResource` for matching)
- `getMap()`: read-only access for callers that need the map

Both the main webview module and the image edit plugin become callers. Neither holds
map state.

## User Stories

1. As a user who renames an image, I want the rename to be reflected immediately in
   the save, without relying on a subsequent host update to rebuild the cache
2. As a maintainer, I want one place that owns the image map, so that adding a new
   mutation site does not require remembering to bump a version counter in a different
   module
3. As a maintainer, I want `transformForSave` to use `sameResource` for matching, so
   that percent-encoded and non-encoded URLs are handled correctly

## Implementation Decisions

- The module is browser-side only (like the current code).
- `imageMapVersion` becomes internal to the module. No external code increments it.
- The "triple pattern" (`currentImageMap = ...; imageMapVersion++; setImageMap(...)`)
  becomes a single call to the module.
- `sameResource` is imported for reverse lookups, replacing exact string comparison.
- The host-side `buildImageMap` is NOT part of this module. It lives in a different
  process. The module only handles the webview's copy.

## Testing Decisions

- **Harness seam**: `image-path-seam.ts` (created by the bug fix prerequisite).
  Extended with cases:
  1. `setMap` then `transformForSave`: correct reverse mapping
  2. `mutateMap` then `transformForSave`: cache invalidated, correct result
  3. Two rapid `setMap` calls: version is latest, cache is invalidated
- **Teeth test**: remove the version bump from `setMap`. The seam must go red.
- Existing roundtrip fixtures must remain green.

## Out of Scope

- The host-side image path handling (candidate 4).
- The `sameResource` utility itself (already correct, just needs to be used).

## Further Notes

- `INLINE_IMAGE_REGEX` is related to inline image processing
  (`processInlineImages`), not to map management. It stays in the main webview module.
- `IMAGE_NODE_TYPES` is exported from the main module and imported by the plugin.
  It can stay where it is or move to the translation module; this is a convenience
  decision, not architectural.
