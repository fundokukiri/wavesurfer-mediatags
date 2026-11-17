// Run with: node --test test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(
  new URL("../scripts/generate-playlist.mjs", import.meta.url)
);

test("generate-playlist sorts naturally and lists only audio files", () => {
  const root = mkdtempSync(join(tmpdir(), "playlist-"));
  const audio = join(root, "audio");
  mkdirSync(audio);
  mkdirSync(join(root, "scripts"));
  writeFileSync(join(audio, "Track 10.mp3"), "");
  writeFileSync(join(audio, "Track 2.mp3"), "");
  writeFileSync(join(audio, "Song.m4a"), "");
  writeFileSync(join(audio, "notes.txt"), "");

  // The generator resolves audio/ relative to its own location, so run a
  // copy of it from inside the temp root's scripts/ folder.
  writeFileSync(join(root, "scripts", "gen.mjs"), readFileSync(script, "utf8"));
  execFileSync(process.execPath, [join(root, "scripts", "gen.mjs")]);

  assert.deepEqual(JSON.parse(readFileSync(join(audio, "playlist.json"), "utf8")), [
    "Song.m4a",
    "Track 2.mp3",
    "Track 10.mp3",
  ]);
});
