// Decision taken when a track ends, kept free of the player so
// test/finish.test.mjs can load and check it. Plain script: index.html loads
// it before script.js, and the test runs it in a vm with a fake window.
window.finishAction = function (length, isRepeat, index) {
  // A one-song playlist reloading itself would re-decode the same file
  // forever — just rewind in place instead.
  if (length < 2) return isRepeat === 2 ? ["rewind", "play"] : ["rewind"];
  if (isRepeat === 1) return ["next"];
  if (isRepeat === 2) return ["rewind", "play"];
  // End of playlist: load the first track but keep it paused.
  return (index + 1) % length === 0 ? ["next-paused"] : ["next"];
};
