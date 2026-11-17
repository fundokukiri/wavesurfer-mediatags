// Browser check for the seek-during-load fix (finding #3).
// Run: node test/browser.mjs   (playwright must be installed, see package.json)
// On this sandbox Chrome needs host libs: prefix with LD_LIBRARY_PATH=/run/host/usr/lib
import { chromium } from "playwright";
import { resolve } from "node:path";
import { startServer } from "./server.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const { server, base } = await startServer(ROOT);

const browser = await chromium.launch({
  args: ["--autoplay-policy=no-user-gesture-required", "--no-sandbox"],
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto(base);
await page.waitForSelector(".tbody-playlist", { timeout: 15000 });
await page.waitForTimeout(2500);

const start = await page.evaluate(() => document.querySelector("#name").textContent.trim());

// Click another track, then immediately seek to 120s while it is still loading.
const TARGET = 120;
await page.evaluate((target) => {
  document.querySelectorAll(".tbody-playlist")[2].dispatchEvent(
    new MouseEvent("click", { bubbles: true })
  );
  const s = document.querySelector("#track-seek-bar");
  s.value = String(target);
  s.dispatchEvent(new Event("input"));
}, TARGET);
await page.waitForTimeout(4500);

const after = await page.evaluate(() => {
  const s = document.querySelector("#track-seek-bar");
  return {
    name: document.querySelector("#name").textContent.trim(),
    seconds: Number(s.value),
    duration: Number(s.max),
  };
});

const switched = after.name !== start;
const seekKept = Math.abs(after.seconds - TARGET) <= 8;

// The waveform shows the whole track, so a click at 75% of its width must land
// at 75% of the song — the old 100px/s setting turned it into a 3-second window.
const box = await page.locator("#waveform").boundingBox();
await page.mouse.click(box.x + box.width * 0.75, box.y + box.height / 2);
await page.waitForTimeout(600);
const wave = await page.evaluate(() => ({
  seconds: Number(document.querySelector("#track-seek-bar").value),
  duration: Number(document.querySelector("#track-seek-bar").max),
}));
const wholeTrack = Math.abs(wave.seconds - wave.duration * 0.75) <= wave.duration * 0.05;

console.log(`${switched ? "PASS" : "FAIL"}  clicked track actually switches (${start} -> ${after.name})`);
console.log(`${seekKept ? "PASS" : "FAIL"}  seek during load kept: ${after.seconds}s of ${after.duration}s (wanted ${TARGET}s)`);
console.log(
  `${wholeTrack ? "PASS" : "FAIL"}  waveform click at 75% seeks to 75%: ${Math.round(wave.seconds)}s of ${Math.round(wave.duration)}s`
);
console.log(`${errors.length === 0 ? "PASS" : "FAIL"}  no page errors${errors.length ? `: ${errors.join(" | ")}` : ""}`);

await browser.close();
server.close();
process.exit(switched && seekKept && wholeTrack && errors.length === 0 ? 0 : 1);
