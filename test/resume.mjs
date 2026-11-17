// Verifies the resume-point behaviour:
//   1. next/prev start the new track at 0:00 (no resume)
//   2. a reload continues the track that was playing
// Run: node test/resume.mjs
import { chromium } from "playwright";
import { join, resolve } from "node:path";
import { startServer } from "./server.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const { server, base } = await startServer(ROOT);

const browser = await chromium.launch({
  args: ["--autoplay-policy=no-user-gesture-required", "--no-sandbox"],
});
const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok, detail });

async function boot(page) {
  await page.goto(base);
  await page.waitForSelector(".tbody-playlist", { timeout: 15000 });
  await page.waitForTimeout(2500);
}

const page = await browser.newPage();

// --- 1. next/prev must start the new track at 0:00 ------------------------
await boot(page);
const first = await page.evaluate(() => document.querySelector("#name").textContent.trim());

// Play track 1 a while, then persist a resume point by pausing.
await page.evaluate(() => {
  const s = document.querySelector("#track-seek-bar");
  s.value = "60";
  s.dispatchEvent(new Event("input"));
});
await page.waitForTimeout(1200);
// A pause writes the resume point for the current track.
await page.evaluate(() => document.querySelector(".play-pause").click());
await page.waitForTimeout(500);
const saved = await page.evaluate(() =>
  localStorage.getItem("musicPlayer.position")
);
check("resume point is stored after pause", !!saved, saved || "");

// Now press next: the incoming track must start at 0, not at a stale spot.
// Pause first so playback time cannot inflate the reading.
await page.evaluate(() => document.querySelector("#next").click());
await page.waitForTimeout(3500);
await page.evaluate(() => document.querySelector(".play-pause").click());
await page.waitForTimeout(400);
const afterNext = await page.evaluate(() => ({
  name: document.querySelector("#name").textContent.trim(),
  value: Number(document.querySelector("#track-seek-bar").value),
}));
check("next switches track", afterNext.name !== first, `${first} -> ${afterNext.name}`);
check("next starts the new track at 0s", afterNext.value <= 2, `${afterNext.value}s`);

// --- 2. a reload resumes the track that was playing ----------------------
const playing = afterNext.name;
const wanted = 90;
await page.evaluate((t) => {
  const s = document.querySelector("#track-seek-bar");
  s.value = String(t);
  s.dispatchEvent(new Event("input"));
}, wanted);
await page.waitForTimeout(800);
await page.evaluate(() => document.querySelector(".play-pause").click());
await page.waitForTimeout(500);

await boot(page);
const afterReload = await page.evaluate(() => {
  const s = document.querySelector("#track-seek-bar");
  return {
    name: document.querySelector("#name").textContent.trim(),
    value: Number(s.value),
    duration: Number(s.max),
  };
});
check("reload returns to the same track", afterReload.name === playing,
  `${playing} -> ${afterReload.name}`);
check("reload resumes near the saved spot", Math.abs(afterReload.value - wanted) <= 12,
  `${afterReload.value}s of ${afterReload.duration}s (wanted ${wanted}s)`);

// --- 3. after the resume is consumed, the same track starts over ---------
await page.evaluate(() => document.querySelector("#next").click());
await page.waitForTimeout(3500);
await page.evaluate(() => document.querySelector("#prev").click());
await page.waitForTimeout(3500);
const afterBack = await page.evaluate(() =>
  Number(document.querySelector("#track-seek-bar").value)
);
check("returning to the resumed track starts at 0s", afterBack <= 2, `${afterBack}s`);

// --- 4. removing the loaded track while paused stays paused --------------
await page.setInputFiles(
  "#local-files",
  join(ROOT, "audio/Son Tung M-TP - Lạc Trôi.mp3")
);
await page.waitForTimeout(1500);
// The playlist lives in the closed sidebar, behind #bg-layer until opened.
await page.click(".album-art");
await page.waitForTimeout(400);
await page.locator(".tbody-playlist").last().click();
await page.waitForTimeout(2500);
// Pause, then remove exactly the track that is loaded.
await page.evaluate(() => {
  const icon = document.querySelector(".play-pause span");
  if (icon.textContent === "pause") document.querySelector(".play-pause").click();
});
await page.waitForTimeout(500);
// Picking a song closes the sidebar, so reopen it to reach .p-remove.
await page.click(".album-art");
await page.waitForTimeout(400);
await page.locator(".tbody-playlist").last().locator(".p-remove").click();
await page.waitForTimeout(3000);
const afterRemove = await page.evaluate(() => ({
  playing: Boolean(document.querySelector(".tbody-playlist.active.playing")),
  icon: document.querySelector(".play-pause span").textContent,
}));
check(
  "removing the paused track does not start playback",
  !afterRemove.playing && afterRemove.icon === "play_arrow",
  JSON.stringify(afterRemove)
);

await browser.close();
server.close();

let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.detail ? `  — ${r.detail}` : ""}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
