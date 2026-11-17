# Changelog

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
