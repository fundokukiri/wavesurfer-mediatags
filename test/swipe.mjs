// Touch-only swipe for the playlist panel: swipe right from the left edge to
// open it, swipe left to close it. Desktop (no coarse pointer) must not react.
// Run: node test/swipe.mjs
import { chromium } from "playwright";
import { startServer } from "./server.mjs";

const { server, base } = await startServer("/workspace");
const browser = await chromium.launch({ args: ["--no-sandbox"] });

const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok, detail });

// page.touchscreen can only tap, so build the two TouchEvents by hand.
const swipe = (page, fromX, fromY, toX, toY) =>
  page.evaluate(
    ([fromX, fromY, toX, toY]) => {
      const target =
        document.elementFromPoint(fromX, fromY) || document.body;
      const mk = (x, y) =>
        new Touch({ identifier: 1, target, clientX: x, clientY: y });
      const start = mk(fromX, fromY);
      target.dispatchEvent(
        new TouchEvent("touchstart", {
          bubbles: true,
          touches: [start],
          changedTouches: [start],
        })
      );
      const end = mk(toX, toY);
      target.dispatchEvent(
        new TouchEvent("touchend", {
          bubbles: true,
          touches: [],
          changedTouches: [end],
        })
      );
    },
    [fromX, fromY, toX, toY]
  );

const isOpen = (page) =>
  page.evaluate(() =>
    document.querySelector(".sidebar").classList.contains("active")
  );

const boot = async (context) => {
  const page = await context.newPage();
  await page.goto(base);
  await page.waitForSelector(".tbody-playlist", { timeout: 15000 });
  await page.waitForTimeout(1500);
  return page;
};

try {
  // --- phone: coarse pointer, gestures active ----------------------------
  const phone = await browser.newContext({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 390, height: 844 },
  });
  const page = await boot(phone);
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  check(
    "phone emulation reports a coarse pointer",
    await page.evaluate(() => matchMedia("(pointer: coarse)").matches)
  );
  check("playlist starts closed", !(await isOpen(page)));

  await swipe(page, 10, 400, 220, 410);
  await page.waitForTimeout(350);
  check("swipe right from the left edge opens it", await isOpen(page));

  await swipe(page, 300, 400, 120, 405);
  await page.waitForTimeout(350);
  check("swipe left closes it", !(await isOpen(page)));

  await swipe(page, 200, 400, 320, 405);
  await page.waitForTimeout(350);
  check("a swipe that starts away from the edge leaves it closed", !(await isOpen(page)));

  await swipe(page, 10, 250, 18, 520);
  await page.waitForTimeout(350);
  check("a vertical scroll from the edge is not a swipe", !(await isOpen(page)));

  await swipe(page, 10, 400, 60, 405);
  await page.waitForTimeout(350);
  check("a 50px drag is too short to open", !(await isOpen(page)));

  check("no page errors", errors.length === 0);
  if (errors.length) console.log(`  page errors: ${errors.join(" | ")}`);
  await phone.close();

  // --- desktop: fine pointer, gestures must be inert ----------------------
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const deskPage = await boot(desktop);
  check(
    "desktop reports a fine pointer",
    await deskPage.evaluate(() => !matchMedia("(pointer: coarse)").matches)
  );
  await swipe(deskPage, 10, 400, 320, 405);
  await deskPage.waitForTimeout(350);
  check("desktop swipe does nothing", !(await isOpen(deskPage)));
  await deskPage.click(".album-art");
  await deskPage.waitForTimeout(400);
  check("desktop still opens the playlist by clicking the art", await isOpen(deskPage));
  await desktop.close();
} catch (e) {
  results.push({ name: `ABORTED: ${e.message}`, ok: false });
} finally {
  await browser.close().catch(() => {});
  await server.close();
}

let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.detail ? `  — ${r.detail}` : ""}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
