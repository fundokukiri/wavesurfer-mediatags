// Pure-logic test of the `finish` guard: a 1-song playlist must not reload.
import { test } from "node:test";
import assert from "node:assert/strict";

// Mirrors the branch added at the top of wavesurfer.on("finish").
function onFinish({ length, isRepeat }, actions) {
  if (length < 2) {
    actions.push("seekTo(0)");
    if (isRepeat === 2) actions.push("play");
    return;
  }
  if (isRepeat === 1) { actions.push("next"); return; }
  if (isRepeat === 2) { actions.push("seekTo(0)", "play"); return; }
  actions.push(length === 1 ? "reload" : "next-or-pause");
}

test("one-song playlist rewinds, never reloads", () => {
  for (const isRepeat of [0, 1, 2]) {
    const actions = [];
    onFinish({ length: 1, isRepeat }, actions);
    assert.ok(!actions.includes("reload"), `repeat=${isRepeat} reloaded`);
  }
});

test("one-song playlist with repeat-one keeps playing", () => {
  const actions = [];
  onFinish({ length: 1, isRepeat: 2 }, actions);
  assert.deepEqual(actions, ["seekTo(0)", "play"]);
});

test("repeat-one on a multi-song playlist advances", () => {
  const actions = [];
  onFinish({ length: 5, isRepeat: 1 }, actions);
  assert.deepEqual(actions, ["next"]);
});
