// Loads the real end-of-track decision (js/finish.js) and checks it — no copy
// of the branches lives here, so editing the player breaks this test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const ctx = { window: {} };
runInNewContext(readFileSync(new URL("../js/finish.js", import.meta.url), "utf8"), ctx);
const finishAction = ctx.window.finishAction;

test("one-song playlist rewinds, never advances", () => {
  for (const isRepeat of [0, 1, 2]) {
    const actions = finishAction(1, isRepeat, 0);
    assert.ok(actions.includes("rewind"), `repeat=${isRepeat}: ${actions}`);
    assert.ok(
      !actions.includes("next") && !actions.includes("next-paused"),
      `repeat=${isRepeat} advanced: ${actions}`
    );
  }
});

test("one-song playlist with repeat-one keeps playing", () => {
  assert.deepEqual([...finishAction(1, 2, 0)], ["rewind", "play"]);
});

test("repeat-all on a multi-song playlist advances", () => {
  assert.deepEqual([...finishAction(5, 1, 4)], ["next"]);
});

test("end of playlist with repeat off loads and holds the first track", () => {
  assert.deepEqual([...finishAction(5, 0, 4)], ["next-paused"]);
  assert.deepEqual([...finishAction(5, 0, 1)], ["next"]);
});
