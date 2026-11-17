// Removing songs must never start a new one. When the loaded track is deleted,
// the replacement is loaded paused — it used to autoplay (the playlist jumped
// to the last row and played it). Chromium with autoplay allowed, because
// Firefox blocks autoplay here and would hide the bug.
// Run: node test/unlink-pause.mjs
import { chromium } from "playwright";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startServer } from "./server.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const fixtures = mkdtempSync(join(tmpdir(), "unlink-pause-"));
const folder = join(fixtures, "Playlist Gamma");
mkdirSync(folder);
copyFileSync(
  join(ROOT, "audio/Son Tung M-TP - Lạc Trôi.mp3"),
  join(folder, "Gamma One.mp3")
);
copyFileSync(
  join(ROOT, "audio/Son Tung M-TP - Buông Đôi Tay Nhau Ra.mp3"),
  join(folder, "Gamma Two.mp3")
);

const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok, detail });

const { server, base } = await startServer("/workspace");
const browser = await chromium.launch({
  args: ["--autoplay-policy=no-user-gesture-required", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

const ui = () =>
  page.evaluate(() => ({
    icon: document.querySelector(".play-pause span").textContent,
    playCalls: window.__playCalls,
    rows: document.querySelectorAll(".tbody-playlist").length,
  }));

try {
  await page.goto(base);
  await page.waitForSelector(".tbody-playlist", { timeout: 15000 });
  await page.waitForTimeout(2500);
  const rowsBefore = (await ui()).rows;

  await page.setInputFiles("#folder-fallback", folder);
  await page.waitForTimeout(1500);
  check(
    "the folder's two songs joined the playlist",
    (await ui()).rows === rowsBefore + 2
  );

  // Play one of them, so the removal happens while audio is running.
  await page.click(".album-art");
  await page.waitForTimeout(450);
  const lastIndex = await page.evaluate(() =>
    [...document.querySelectorAll(".tbody-playlist")]
      .map((row) => Number(row.dataset.index))
      .at(-1)
  );
  await page.locator(`.tbody-playlist[data-index="${lastIndex}"]`).click();
  await page.waitForTimeout(1500);
  check("a folder song is playing", (await ui()).icon === "pause");

  // Count every play() the page asks for from here on.
  await page.evaluate(() => {
    window.__playCalls = 0;
    const original = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (...args) {
      window.__playCalls += 1;
      return original.apply(this, args);
    };
  });

  await page.evaluate(() => document.querySelector(".album-art img").click());
  await page.waitForTimeout(450);
  await page.locator(".folder-chip .folder-chip-unlink").first().click();
  await page.waitForSelector("#confirm-modal:not([hidden])", { timeout: 5000 });
  await page.click("#confirm-ok");
  await page.click("#confirm-ok");
  await page.waitForTimeout(2500);

  const after = await ui();
  check(
    "the unlink removed both of its songs",
    after.rows === rowsBefore,
    `${after.rows} rows, expected ${rowsBefore}`
  );
  check(
    "nothing is started after the removal",
    after.playCalls === 0,
    `play() called ${after.playCalls} time(s)`
  );
  check("the player is left paused", after.icon === "play_arrow");
  check("no page errors", errors.length === 0);
  if (errors.length) console.log(`  page errors: ${errors.join(" | ")}`);
} catch (e) {
  results.push({ name: `ABORTED: ${e.message}`, ok: false });
} finally {
  await browser.close().catch(() => {});
  await server.close();
  rmSync(fixtures, { recursive: true, force: true });
}

let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(
    `${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.detail ? `  — ${r.detail}` : ""}`
  );
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
