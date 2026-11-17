// Browser check for the seek-during-load fix (finding #3).
// Run: node test/browser.mjs   (playwright must be installed, see package.json)
// On this sandbox Chrome needs host libs: prefix with LD_LIBRARY_PATH=/run/host/usr/lib
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, resolve } from "node:path";

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

const browser = await chromium.launch({
  args: ["--autoplay-policy=no-user-gesture-required", "--no-sandbox"],
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto(`http://127.0.0.1:${server.address().port}`);
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

console.log(`${switched ? "PASS" : "FAIL"}  clicked track actually switches (${start} -> ${after.name})`);
console.log(`${seekKept ? "PASS" : "FAIL"}  seek during load kept: ${after.seconds}s of ${after.duration}s (wanted ${TARGET}s)`);
console.log(`${errors.length === 0 ? "PASS" : "FAIL"}  no page errors${errors.length ? `: ${errors.join(" | ")}` : ""}`);

await browser.close();
server.close();
process.exit(switched && seekKept && errors.length === 0 ? 0 : 1);
