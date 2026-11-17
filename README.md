# Wavesurfer MediaTags Music Player

Single-page music player. No build step: open `index.html` over HTTP.

## Tests

```sh
node --test test/playlist.test.mjs test/finish.test.mjs   # no dependencies
npm i && node test/browser.mjs && node test/resume.mjs     # needs playwright
node test/multi-folder.e2e.mjs                             # needs playwright (Firefox)
```

The browser tests drive the real page: `browser.mjs` (Chromium) checks that a
seek made while the next track is loading survives into that track;
`resume.mjs` checks that next/prev start the new track at 0:00 and that a
reload continues only the track that was playing; `multi-folder.e2e.mjs`
(Firefox, via the webkitdirectory fallback path) checks that several music
folders can be linked at once, that unlinking one folder removes only its own
songs, and that linked folders survive a reload.

## Folders

Several music folders can be linked at once — each gets its own chip in the
sidebar showing its name, and adding another folder never replaces the
previous ones. The ✕ on a chip unlinks just that folder: its songs go, the
other folders stay. Long-press the sidebar folder button to clear every
folder's songs at once — the folders stay linked, and re-adding one brings
its songs back.

## Adding tracks

On a server with directory indexes (`python3 -m http.server`, `npx serve`) the
`audio/` folder is scanned live. On static hosts (Vercel, GitHub Pages) run
`node scripts/generate-playlist.mjs` after adding files, since those hosts do
not serve directory listings.
