# Wavesurfer MediaTags Music Player

Single-page music player. No build step: open `index.html` over HTTP.

## Tests

```sh
node --test test/playlist.test.mjs test/finish.test.mjs   # no dependencies
npm i && node test/browser.mjs && node test/resume.mjs     # needs playwright
```

The browser tests drive the real page in Chromium: `browser.mjs` checks that a
seek made while the next track is loading survives into that track;
`resume.mjs` checks that next/prev start the new track at 0:00 and that a
reload continues only the track that was playing.

## Adding tracks

On a server with directory indexes (`python3 -m http.server`, `npx serve`) the
`audio/` folder is scanned live. On static hosts (Vercel, GitHub Pages) run
`node scripts/generate-playlist.mjs` after adding files, since those hosts do
not serve directory listings.
