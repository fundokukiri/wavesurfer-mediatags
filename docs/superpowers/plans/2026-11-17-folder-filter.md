# Folder Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** clicking a linked folder's chip filters the playlist to that folder.

**Architecture:** one session variable `folderFilter`, checked in the existing
row filter (`applySearchFilter`) and in the subtitle count. Chips are rebuilt by
`renderFolderChips`, which also marks the active one.

**Tech Stack:** plain browser JS, CSS, Playwright for the browser test.

**Spec:** `docs/superpowers/specs/2026-11-17-folder-filter-design.md`

## Global Constraints

- Session-only: no localStorage/IndexedDB key for the filter.
- No new dependency; no change to `loadTrack`, `wavesurfer` handlers or IndexedDB.
- Version query in `index.html` bumped so cached JS/CSS is not reused.

## Review Focus

- A drag on the chip strip must not toggle the filter (the strip already
  swallows the click after a drag — the test below drags once).
- Unlinking the filtered folder must leave no stale filter hiding new tracks.
- A folder whose songs were all removed shows the empty hint, not a blank list.

---

### Task 1: Filter by folder chip

**Files:**
- Modify: `js/script.js` (state near `favOnly`, `applySearchFilter`,
  `updatePlaylistSubtitle`, `renderFolderChips`, `unlinkFolderFlow`)
- Modify: `css/style.css` (`.folder-chip.active`)
- Test: `test/multi-folder.e2e.mjs`

**Interfaces:**
- Consumes: `allTracks[].folderId`, `renderFolderChips()`,
  `applySearchFilter()`, `updatePlaylistSubtitle()`, `unlinkFolderFlow(id)`.
- Produces: `let folderFilter` (string folder id or `null`); CSS class
  `folder-chip active`.

- [ ] **Step 1: Add the browser test**

In `test/multi-folder.e2e.mjs`, after the "folder B added" checks and before
the unlink block:

```js
const visibleRows = () =>
  page.evaluate(() => document.querySelectorAll(".tbody-playlist:not([hidden])").length);
await page.click(".album-art");
await page.waitForTimeout(400);
await page.locator(".folder-chip").first().click();
await page.waitForTimeout(200);
check("chip click shows only that folder's songs", (await visibleRows()) === 2);
await page.locator(".folder-chip").first().click();
await page.waitForTimeout(200);
check("clicking the chip again shows every song", (await visibleRows()) === baseline.rows + 3);
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node test/multi-folder.e2e.mjs`
Expected: FAIL on "chip click shows only that folder's songs" (9 visible, wanted 2).

- [ ] **Step 3: Implement**

`js/script.js`, next to `let favOnly = false;`:

```js
let folderFilter = null; // session-only folder chip filter
```

`applySearchFilter`, beside `matchesFavorites`:

```js
const matchesFolder = !folderFilter || track?.folderId === folderFilter;
row.hidden = !matchesQuery || !matchesFavorites || !matchesFolder;
```

`updatePlaylistSubtitle`, inside the `filter` callback: also require
`!folderFilter || track.folderId === folderFilter`.

`renderFolderChips`, per chip: `chip.classList.toggle("active", folderFilter === id);`
and an `onclick` that toggles `folderFilter`, then calls `renderFolderChips()`,
`applySearchFilter()`, `updatePlaylistSubtitle()`. The unlink button's handler
takes the event and calls `e.stopPropagation()` first so it does not toggle.

`unlinkFolderFlow`: `if (folderFilter === folderId) folderFilter = null;`

`css/style.css`, after `.folder-chip`:

```css
.folder-chip.active {
  background: rgba(70, 118, 249, 0.22);
  box-shadow: inset 0 0 0 1px rgba(70, 118, 249, 0.45);
}
```

- [ ] **Step 4: Run the tests**

Run: `node --test test/` → 5/5 pass.
Run: `node test/multi-folder.e2e.mjs` → all checks pass, no page errors.

- [ ] **Step 5: Changelog**

Add one bullet to `CHANGELOG.md` under the current date: clicking a folder
chip filters the playlist to that folder, clicking again shows everything.
