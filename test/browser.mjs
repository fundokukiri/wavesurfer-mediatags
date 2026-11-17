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

// The waveform is a scrolling window on purpose; the only thing that matters
// here is that it really moves while playing (it was made static once and the
// owner asked for the old behaviour back).
const readScroll = () =>
  page.evaluate(() => {
    const scroll = document
      .querySelector("#waveform")
      .firstElementChild?.shadowRoot?.querySelector(".scroll");
    return scroll
      ? {
          left: Math.round(scroll.scrollLeft),
          width: scroll.scrollWidth,
          client: scroll.clientWidth,
        }
      : null;
  });
await page.evaluate(() => {
  if (document.querySelector(".play-pause span").textContent === "play_arrow")
    document.querySelector(".play-pause").click();
});
await page.waitForTimeout(400);
const scrollA = await readScroll();
await page.waitForTimeout(1500);
const scrollB = await readScroll();
const waveformMoves = Boolean(
  scrollA && scrollB && scrollA.width > scrollA.client * 2 && scrollB.left !== scrollA.left
);

console.log(`${switched ? "PASS" : "FAIL"}  clicked track actually switches (${start} -> ${after.name})`);
console.log(`${seekKept ? "PASS" : "FAIL"}  seek during load kept: ${after.seconds}s of ${after.duration}s (wanted ${TARGET}s)`);
console.log(
  `${waveformMoves ? "PASS" : "FAIL"}  waveform scrolls while playing: ${scrollA?.left}px -> ${scrollB?.left}px of ${scrollA?.width}px`
);
console.log(`${errors.length === 0 ? "PASS" : "FAIL"}  no page errors${errors.length ? `: ${errors.join(" | ")}` : ""}`);

await browser.close();
server.close();
process.exit(switched && seekKept && waveformMoves && errors.length === 0 ? 0 : 1);
