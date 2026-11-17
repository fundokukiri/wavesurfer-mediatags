// E2E check for multi-folder support (run with: node test/multi-folder.e2e.mjs).
// Regression: adding a second folder used to overwrite the first, and
// unlinking used to remove EVERY folder's songs. Uses the webkitdirectory
// fallback path (setInputFiles with a real directory) so it runs in Firefox,
// where the File System Access API is unavailable anyway.
// Real MP3s are copied as fixtures because the app filters by extension and
// parses tags — garbage bytes could fail the boot in unrelated ways.
import { firefox } from "playwright";
import { createServer } from "node:http";
import { readFile, rm } from "node:fs/promises";
import { existsSync, mkdirSync, mkdtempSync, copyFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { tmpdir } from "node:os";

const ROOT = resolve(import.meta.dirname, "..");
const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".mp3": "audio/mpeg",
  ".jpg": "image/jpeg", ".png": "image/png",
};

const server = createServer(async (req, res) => {
  const u = decodeURIComponent(req.url.split("?")[0]);
  const f = join(ROOT, u.endsWith("/") ? `${u}index.html` : u);
  if (!existsSync(f)) {
    res.statusCode = 404;
    return res.end("not found");
  }
  res.setHeader("Content-Type", MIME[extname(f)] || "application/octet-stream");
  res.end(await readFile(f));
});
await new Promise((r) => server.listen(0, r));

// Two fixture folders: A has two songs, B has one.
const fixtures = mkdtempSync(join(tmpdir(), "multi-folder-"));
const folderA = join(fixtures, "Playlist Alpha");
const folderB = join(fixtures, "Playlist Beta");
mkdirSync(folderA, { recursive: true });
mkdirSync(folderB, { recursive: true });
copyFileSync(join(ROOT, "audio/Son Tung M-TP - Lạc Trôi.mp3"), join(folderA, "Alpha One.mp3"));
copyFileSync(join(ROOT, "audio/Son Tung M-TP - Buông Đôi Tay Nhau Ra.mp3"), join(folderA, "Alpha Two.mp3"));
copyFileSync(join(ROOT, "audio/Son Tung M-TP - Khuôn Mặt Đáng Thương.mp3"), join(folderB, "Beta One.mp3"));

const browser = await firefox.launch();
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
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForSelector(".tbody-playlist, .playlist-status", { timeout: 15000 });
  await page.waitForTimeout(2500); // boot restore settle (timers in app)

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
