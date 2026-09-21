# Spec: Image Path Translation (Candidate 3, refactor)

_Blocked by: Image Path Translation Bug Fix (C3 prerequisite)._

## Problem Statement

The webview's image path mapping state is split across two files:

- `main.ts`: `currentImageMap` (line 366), `imageMapVersion` (370),
  `cachedReverseImageMap` (373), `cachedReverseImageMapVersion` (374),
  `replaceImagePaths` (380), `transformForDisplay` (381), `transformForSave` (417),
  `INLINE_IMAGE_REGEX` (432), and the `currentImageMap = ...; imageMapVersion++;
  setImageMap(...)` triple repeated at lines 660, 2089, 2096, 2287.

- `image-edit-plugin.ts`: its own `currentImageMap` (line 32), `setImageMap` (495),
  and direct map mutation in `handleImageRenameResponse` (572-588).

The plugin comments say "update map BEFORE so transformForSave is correct", but
`transformForSave` reads a cached reverse map gated by `imageMapVersion`, and the
plugin cannot touch that counter. Two files disagree about who owns cache invalidation.

`replaceImagePaths` does exact string comparison while `sameResource` exists precisely
because two spellings of the same URL can differ.

## Solution

A single Image Registry module that owns the map, version, cache, and all
transformations. The module exports:
- `setMap(map)`: replaces the map, bumps version, invalidates cache
- `mutateMap(fn)`: calls `fn(map)`, bumps version, invalidates cache
- `transformForDisplay(body)`: forward direction
- `transformForSave(body)`: reverse direction (uses `sameResource` for matching)
- `getMap()`: read-only access for callers that need the map (e.g., reverse lookup
  in the plugin's UI)

`image-edit-plugin.ts` and `main.ts` both become callers. Neither holds map state.

## User Stories

1. As a user who renames an image, I want the rename to be reflected immediately in
   the save, without relying on a subsequent host update to rebuild the cache
2. As a maintainer, I want one place that owns the image map, so that adding a new
   mutation site does not require remembering to bump a version counter in a different
   file
3. As a maintainer, I want `transformForSave` to use `sameResource` for matching, so
   that percent-encoded and non-encoded URLs are handled correctly

## Implementation Decisions

- The registry module lives under `src/webview/` (browser-side only, like the current
  code).
- `imageMapVersion` becomes internal to the registry. No external code increments it.
- The "triple pattern" (`currentImageMap = ...; imageMapVersion++; setImageMap(...)`)
  becomes a single `registry.setMap(newMap)` call.
- `sameResource` (from `src/utils/vscode-resource.ts`) is imported by the registry
  for reverse lookups, replacing exact string comparison.
- The host-side `buildImageMap` (`src/host/imagePaths.ts`) is NOT part of this module.
  It lives in a different process. The registry only handles the webview's copy.

## Testing Decisions

- **Harness seam**: `image-map-seam.ts` (created by the bug fix prerequisite).
  Extended with cases:
  1. `setMap` then `transformForSave`: correct reverse mapping
  2. `mutateMap` then `transformForSave`: cache invalidated, correct result
  3. Two rapid `setMap` calls: version is latest, cache is invalidated
- **Teeth test**: remove the version bump from `setMap`. The seam must go red.
- Existing roundtrip fixtures must remain green.

## Out of Scope

- The host-side image path handling (candidate 4).
- The `sameResource` utility itself (already correct, just needs to be used).
- Adding new floor check probes for image handling.

## Further Notes

- The `INLINE_IMAGE_REGEX` at line 432 of main.ts is related to inline image
  processing (`processInlineImages`), not to map management. It stays in main.ts.
- `IMAGE_NODE_TYPES` is exported from main.ts and imported by the plugin. It can
  stay where it is or move to the registry; this is a convenience decision, not
  architectural.
