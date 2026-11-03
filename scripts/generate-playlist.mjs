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
import { readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const audioDir = join(root, "audio");

const fileNames = readdirSync(audioDir, { withFileTypes: true })
  .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".mp3"))
  .map((e) => e.name)
  .sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
  );

writeFileSync(
  join(audioDir, "playlist.json"),
  `${JSON.stringify(fileNames, null, 2)}\n`
);

console.log(`Wrote audio/playlist.json with ${fileNames.length} track(s).`);
