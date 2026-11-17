// E2E check for multi-folder support (run with: node test/multi-folder.e2e.mjs).
// Regression: adding a second folder used to overwrite the first, and
// unlinking used to remove EVERY folder's songs. Uses the webkitdirectory
// fallback path (setInputFiles with a real directory) so it runs in Firefox,
// where the File System Access API is unavailable anyway.
// Real MP3s are copied as fixtures because the app filters by extension and
// parses tags — garbage bytes could fail the boot in unrelated ways.
import { firefox } from "playwright";
import { rm } from "node:fs/promises";
import { mkdirSync, mkdtempSync, copyFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { startServer } from "./server.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const { server, base } = await startServer(ROOT);

// Two fixture folders: A has two songs, B has one.
const fixtures = mkdtempSync(join(tmpdir(), "multi-folder-"));
const folderA = join(fixtures, "Playlist Alpha");
const folderB = join(fixtures, "Playlist Beta");
mkdirSync(folderA, { recursive: true });
mkdirSync(folderB, { recursive: true });
copyFileSync(join(ROOT, "audio/Son Tung M-TP - Lạc Trôi.mp3"), join(folderA, "Alpha One.mp3"));
copyFileSync(join(ROOT, "audio/Son Tung M-TP - Buông Đôi Tay Nhau Ra.mp3"), join(folderA, "Alpha Two.mp3"));
copyFileSync(join(ROOT, "audio/Son Tung M-TP - Khuôn Mặt Đáng Thương.mp3"), join(folderB, "Beta One.mp3"));

// Autoplay allowed so a stray play() shows up as audio actually running.
const browser = await firefox.launch({
  firefoxUserPrefs: {
    "media.autoplay.default": 0,
    "media.autoplay.blocking_policy": 0,
  },
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

// Everything passed to page.evaluate must be self-contained: Playwright
// serializes only the function source, so closures from Node scope vanish.
const getCounts = () =>
  page.evaluate(() => ({
    rows: document.querySelectorAll(".tbody-playlist").length,
    chips: document.querySelectorAll("#folder-chip-list .folder-chip").length,
    chipNames: [...document.querySelectorAll(".folder-chip-name")].map((n) =>
      n.textContent.trim()
    ),
    listHidden: document.querySelector("#folder-chip-list")?.hidden ?? null,
  }));

// Poll until the playlist reaches an exact rows/chips shape — chips and rows
// render asynchronously after change events, and the boot restore settles on
// timers.
const waitForCounts = async (want, desc, timeout = 10000) => {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    last = await getCounts();
    if (last.rows === want.rows && last.chips === want.chips) return last;
    await page.waitForTimeout(200);
  }
  throw new Error(`${desc} timed out — last: ${JSON.stringify(last)}`);
};

const failures = [];
const check = (name, cond) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
  if (!cond) failures.push(name);
};

try {
  await page.goto(base);
  await page.waitForSelector(".tbody-playlist, .playlist-status", { timeout: 15000 });
  await page.waitForTimeout(2500); // boot restore settle (timers in app)

  // Firefox keeps the scrolling waveform bounded: 20-30fps at full density.
  const waveWidth = await page.evaluate(() => {
    const scroll = document
      .querySelector("#waveform")
      .firstElementChild?.shadowRoot?.querySelector(".scroll");
    return scroll ? scroll.scrollWidth : 0;
  });
  check(`firefox waveform stays bounded (${waveWidth}px)`, waveWidth > 0 && waveWidth <= 9001);

  const baseline = await getCounts();
  check(`boot: server playlist rendered (${baseline.rows} rows, 0 chips)`, baseline.rows > 0 && baseline.chips === 0);

  // Pick folder A → its two songs join the playlist as the first chip.
  await page.setInputFiles("#folder-fallback", folderA);
  await waitForCounts(
    { rows: baseline.rows + 2, chips: 1 },
    "folder A adds 2 rows and 1 chip"
  );
  let c = await getCounts();
  check("folder A: +2 rows", c.rows === baseline.rows + 2);
  check("folder A: exactly 1 chip", c.chips === 1);

  // Each imported file keeps its own tags: they used to share one cache slot
  // (local files have no path), so every folder track showed the first file's
  // title and artist.
  await page.click(".album-art");
  await page.waitForTimeout(450);
  const indexes = await page.evaluate(() =>
    [...document.querySelectorAll(".tbody-playlist")].map((row) =>
      Number(row.dataset.index)
    )
  );
  const hoverCard = async (index) => {
    await page.locator(`.tbody-playlist[data-index="${index}"]`).hover();
    await page.waitForTimeout(900);
    return page.evaluate(() => ({
      title: document.querySelector("#track-tooltip .tp-tip-title")?.textContent,
      artist: document.querySelector("#track-tooltip .tp-tip-artist")?.textContent,
    }));
  };
  const cardA = await hoverCard(indexes[indexes.length - 2]);
  const cardB = await hoverCard(indexes[indexes.length - 1]);
  check(
    "each folder track shows its own title in the card",
    Boolean(cardA.title) && Boolean(cardB.title) && cardA.title !== cardB.title,
    `"${cardA.title}" vs "${cardB.title}"`
  );
  check(
    "the card shows the tag artist, not the file name",
    cardA.artist === "Son Tung M-TP" && cardB.artist === "Son Tung M-TP",
    `"${cardA.artist}" / "${cardB.artist}"`
  );
  // The open panel covers the player, so close it through the DOM.
  await page.evaluate(() => document.querySelector(".album-art img").click());
  await page.waitForTimeout(450);

  // THE regression: folder B must be ADDED, not replace folder A.
  await page.setInputFiles("#folder-fallback", folderB);
  await waitForCounts(
    { rows: baseline.rows + 3, chips: 2 },
    "folder B adds alongside A (3 rows, 2 chips)"
  );
  c = await getCounts();
  check("folder B added: +3 rows total", c.rows === baseline.rows + 3);
  check("folder B added: 2 chips coexist (not overwritten)", c.chips === 2);

  // Unlink folder B (second chip) — the chips live in the playlist sidebar,
  // which the album art toggles open; wait out its 0.3s slide-in transition.
  await page.click(".album-art");
  await page.waitForTimeout(400);

  // Filter by folder: the first chip (folder A) shows only its two songs;
  // clicking it again clears the filter.
  const visibleRows = () =>
    page.evaluate(
      () => document.querySelectorAll(".tbody-playlist:not([hidden])").length
    );
  await page.locator(".folder-chip").first().click();
  await page.waitForTimeout(200);
  check(
    "chip click shows only that folder's songs",
    (await visibleRows()) === 2
  );
  await page.locator(".folder-chip").first().click();
  await page.waitForTimeout(200);
  check(
    "clicking the chip again shows every song",
    (await visibleRows()) === baseline.rows + 3
  );
  // Deleting a folder while one of its songs is loaded must not start
  // anything else playing.
  const lastIndex = (
    await page.evaluate(() =>
      [...document.querySelectorAll(".tbody-playlist")].map((row) =>
        Number(row.dataset.index)
      )
    )
  ).at(-1);
  await page.locator(`.tbody-playlist[data-index="${lastIndex}"]`).click();
  await page.waitForTimeout(1500);
  // It is playing at this point: the removal must not carry that on.
  const playingBefore = await page.evaluate(
    () => document.querySelector(".play-pause span").textContent === "pause"
  );
  check("a folder song is playing before the unlink", playingBefore === true);
  await page.evaluate(() => document.querySelector(".album-art img").click());
  await page.waitForTimeout(450);
  // Autoplay-blocked or not, a stray play() is what "it started playing"
  // means here, so count the calls instead of trusting audio state.
  await page.evaluate(() => {
    window.__playCalls = 0;
    const original = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (...args) {
      window.__playCalls += 1;
      return original.apply(this, args);
    };
  });

  // Confirm modal needs two OK clicks.
  await page.locator(".folder-chip").nth(1).locator(".folder-chip-unlink").click();
  await page.waitForSelector("#confirm-modal:not([hidden])", { timeout: 5000 });
  await page.click("#confirm-ok");
  await page.click("#confirm-ok");
  await waitForCounts(
    { rows: baseline.rows + 2, chips: 1 },
    "unlink B removes only B (2 rows, 1 chip)"
  );
  c = await getCounts();
  check("unlink folder B: only B's songs removed", c.rows === baseline.rows + 2);
  check("unlink folder B: folder A chip survives", c.chips === 1);
  const afterUnlink = await page.evaluate(() => ({
    icon: document.querySelector(".play-pause span").textContent,
    playCalls: window.__playCalls,
  }));
  check(
    "unlinking a folder does not start playback",
    afterUnlink.playCalls === 0 && afterUnlink.icon === "play_arrow",
    JSON.stringify(afterUnlink)
  );

  // Persistence: a reload restores folder A (and only A) from IndexedDB.
  await page.reload();
  await page.waitForSelector(".tbody-playlist, .playlist-status", { timeout: 15000 });
  await page.waitForTimeout(2500);
  await waitForCounts(
    { rows: baseline.rows + 2, chips: 1 },
    "reload restores folder A (2 rows, 1 chip)"
  );
  c = await getCounts();
  check("after reload: folder A persisted", c.rows === baseline.rows + 2 && c.chips === 1);

  // Bulk clear (long-press the folder button), then re-pick the same folder:
  // its songs come back — the clear's exclusions are lifted on re-add.
  await page.click(".album-art");
  await page.waitForTimeout(400);
  await page.hover("#folder-open");
  await page.mouse.down();
  await page.waitForTimeout(900);
  await page.mouse.up();
  await page.waitForSelector("#confirm-modal:not([hidden])", { timeout: 5000 });
  await page.click("#confirm-ok");
  await page.click("#confirm-ok");
  await waitForCounts(
    { rows: baseline.rows, chips: 1 },
    "bulk clear drops every folder song, keeps the chip"
  );
  await page.setInputFiles("#folder-fallback", folderA);
  await waitForCounts(
    { rows: baseline.rows + 2, chips: 1 },
    "re-picking the folder brings its songs back"
  );

  check("no page errors", errors.length === 0);
  if (errors.length) console.log(`  page errors: ${errors.join(" | ")}`);
} catch (e) {
  failures.push(e.message);
  console.log(`ABORTED: ${e.message}`);
} finally {
  await browser.close().catch(() => {});
  await server.close();
  await rm(fixtures, { recursive: true, force: true }).catch(() => {});
}

process.exit(failures.length ? 1 : 0);
