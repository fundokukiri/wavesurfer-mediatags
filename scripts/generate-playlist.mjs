#!/usr/bin/env node
// Regenerates audio/playlist.json from the MP3 files currently in audio/.
//
// Static hosts (Vercel, GitHub Pages, ...) don't serve directory listings, so
// the player falls back to this manifest. Run this after adding or removing
// tracks when deploying to such a host:
//
//   node scripts/generate-playlist.mjs
//
// On a local dev server with directory indexes the manifest is ignored — the
// folder is scanned live, so nothing to re-run there.
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const audioDir = join(root, "audio");

// Must match AUDIO_EXT in js/script.js — the player filters the manifest with
// the same set, so a format missing here is invisible in the playlist.
const AUDIO_EXT = /\.(mp3|m4a|aac|ogg|wav|flac)$/i;

// Files named in audio/.local-only stay out of the manifest: they are on disk
// for local listening but not ours to publish, so a static deploy must not
// list them (a listed track that 404s is a dead row in the player).
const localOnly = new Set(
  existsSync(join(audioDir, ".local-only"))
    ? readFileSync(join(audioDir, ".local-only"), "utf8")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
    : []
);

const fileNames = readdirSync(audioDir, { withFileTypes: true })
  .filter((e) => e.isFile() && AUDIO_EXT.test(e.name) && !localOnly.has(e.name))
  .map((e) => e.name)
  .sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
  );

writeFileSync(
  join(audioDir, "playlist.json"),
  `${JSON.stringify(fileNames, null, 2)}\n`
);

console.log(`Wrote audio/playlist.json with ${fileNames.length} track(s).`);
