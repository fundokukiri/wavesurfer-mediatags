# Wavesurfer MediaTags Music Player

A lightweight music player web app built with plain HTML/CSS/JavaScript — no build step, no framework. It renders audio waveforms with [WaveSurfer.js v7](https://github.com/katspaugh/wavesurfer.js) and reads ID3 metadata (title, artist, album, cover art) directly from the MP3 files with [jsmediatags](https://github.com/aadsm/jsmediatags).

## Features

- Waveform rendering with progress coloring
- Playlist sidebar with track metadata and cover-art thumbnails
- Play / pause, next / previous, seek bar, volume control + mute
- Repeat (all / one) and shuffle modes
- Album art with blurred background behind the player
- OS media key support via the [Media Session API](https://developer.mozilla.org/en-US/docs/Web/API/Media_Session_API)
- On-screen error message when a track fails to load

## Running locally

Serve the folder over HTTP (jsmediatags needs HTTP to fetch the files — opening `index.html` via `file://` will not work):

```bash
python3 -m http.server 8080
# or
npx serve .
```

Then open <http://localhost:8080>.

## Project structure

```
├── index.html              # Player UI
├── css/style.css           # Styling
├── js/
│   ├── script.js           # Player logic (scans audio/, all features)
│   ├── wavesurfer-7.min.js # Vendored WaveSurfer.js v7 build
│   └── jsmediatags.js      # Vendored jsmediatags build
├── assets/images/          # Default cover + favicon
└── audio/                  # MP3 files — scanned automatically at runtime
```

To add tracks: drop MP3 files into `audio/` and refresh — the playlist is built by scanning the folder, so there is no list to maintain. File names should follow the `Artist - Title.mp3` pattern — that name is used as fallback when a file has no ID3 tags.

**Note:** the folder scan relies on the server providing a directory listing (`python3 -m http.server`, `npx serve` and most dev servers do). Servers without directory indexes (e.g. GitHub Pages) can't be scanned — the player will show an error instead.

## Credits

- [WaveSurfer.js](https://github.com/katspaugh/wavesurfer.js) (vendored at `js/wavesurfer-7.min.js`)
- [jsmediatags](https://github.com/aadsm/jsmediatags) (vendored at `js/jsmediatags.js`)

## License

The code is released under the [MIT License](LICENSE).

**Note on audio files:** the tracks in `audio/` are copyrighted by **MTP Entertainment** and are included for personal demo purposes only — please do not redistribute them.
