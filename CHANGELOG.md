# Changelog

## 2026-11-17 (fixes)

- On a touch device, swipe right from the left edge to open the playlist and
  swipe left to close it. Desktop keeps the album-art and backdrop clicks;
  sliders, text fields and the folder chip strip keep their own drags.

- Clicking a linked folder's chip filters the playlist to that folder;
  clicking it again shows everything. Search and ♥ keep filtering on top, the
  subtitle counts the filtered songs, and unlinking the folder clears it.

- Removing the loaded song no longer starts playback when the player was
  paused.
- Bulk-clearing a linked folder's songs (long-press the folder button) can be
  undone by picking the folder again: both picker paths now lift that clear's
  exclusions.
- An empty or unreadable `audio/` folder no longer stops startup, so saved
  local music still loads.
- `.flac` tracks keep their whole name (the old four-character truncation is
  gone).
- Durations are probed one track at a time instead of one media element per
  song.
- The end-of-track decision lives in `js/finish.js`, so its test runs the real
  code; `npm test` now runs every test file.
- Browser tests share one static server (`test/server.mjs`).
- Smaller changes: heart hover colour works, dead `data-track-id` write
  removed, folders deeper than two levels are scanned, the startup-error alarm
  waits 20s, each track's tags are parsed once, the Montserrat font request is
  gone.

## 2026-11-17

- Multiple music folders can be linked at once. Adding a second folder no
  longer overwrites the first one — every linked folder shows its own chip in
  the sidebar.
- Unlinking a folder (the ✕ on its chip) now removes only that folder's songs
  and saved handle; other folders and their songs are untouched.
- Each folder's songs keep working after a reload, including per-folder
  restore permission prompts.
- Note: favorites/exclusions saved for folder songs under the old id format
  are not migrated (favorites for individually added files are unaffected).
- Folder chips sit in a single horizontal strip that slides left–right
  (mouse drag, wheel, or touch swipe) instead of stacking vertically, so
  many linked folders cost one row of height, never more. Wheel notches
  ease toward their target and a fling coasts with momentum after release.
- New test: `test/multi-folder.e2e.mjs` covers add-coexist, per-folder unlink
  and reload persistence.
