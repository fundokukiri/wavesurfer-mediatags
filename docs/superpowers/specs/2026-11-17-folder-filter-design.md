# Folder filter — design (short)

**Intent:** with several linked folders, show only one folder's songs without
unlinking it. Today the chips identify folders but do nothing when clicked.

**Approved by the user on 2026-11-17** ("làm đi").

## Approaches

1. **Filter the existing rows (picked).** One `folderFilter` id, checked in
   `applySearchFilter` next to search and favorites. Cheapest; reuses the
   filter that already hides rows, keeps playlist order and playback untouched.
2. Rebuild `shuffledArray` from the folder's tracks. Rejected: playback
   position, shuffle order and the loaded track would all need re-mapping.
3. A separate "folder view" page. Rejected: a second list to keep in sync.

## What it does

- Clicking a folder chip shows only that folder's songs; the chip looks
  pressed. Clicking it again shows everything.
- Search and ♥ keep filtering on top of the folder.
- The subtitle (song count, total time) counts the folder-filtered list.
- The filter is session-only, like the ♥-only toggle: a reload shows all.
- Unlinking the filtered folder clears the filter.
- Server tracks have no folder, so they are hidden while a folder is filtered.

## Not in scope

Persisting the filter across reloads; filtering by the "added files" chip;
multi-folder selection; per-folder playback ("play this folder").

## Constraints

No new state outside one variable. No new dependency. Rows are hidden with the
existing `hidden` attribute; nothing in the playback path changes.
