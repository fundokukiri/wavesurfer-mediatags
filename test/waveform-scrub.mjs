// Dragging the waveform scrubs: the playhead line at the centre follows the
// finger, so a right drag goes forward in time and a left drag goes back.
// Run: node test/waveform-scrub.mjs
import { chromium, devices } from "playwright";
import { startServer } from "./server.mjs";

const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok, detail });
const browser = await chromium.launch({
  args: ["--autoplay-policy=no-user-gesture-required", "--no-sandbox"],
});

const timeOf = (page) =>
  page.evaluate(
    () =>
      document
        .querySelector("#waveform")
        .firstElementChild.shadowRoot.querySelector("audio").currentTime
  );

const pxPerSecOf = (page) =>
  page.evaluate(() => {
    const shadow = document.querySelector("#waveform").firstElementChild.shadowRoot;
    const wrapper = shadow.querySelector(".wrapper");
    return wrapper.clientWidth / Number(document.querySelector("#track-seek-bar").max);
  });

{
  const { server, base } = await startServer("/workspace");
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  try {
    await page.goto(base);
    await page.waitForSelector(".tbody-playlist", { timeout: 15000 });
    await page.waitForTimeout(2500);
    await page.evaluate(() => {
      if (document.querySelector(".play-pause span").textContent === "pause")
        document.querySelector(".play-pause").click();
    });
    await page.waitForTimeout(400);

    const box = await page.locator("#waveform").boundingBox();
    const y = box.y + box.height / 2;
    const pxPerSec = await pxPerSecOf(page);

    // Drag right: time moves forward, roughly by the dragged distance.
    const t0 = await timeOf(page);
    await page.mouse.move(box.x + 100, y);
    await page.mouse.down();
    for (let i = 1; i <= 5; i++) {
      await page.mouse.move(box.x + 100 + i * 20, y);
      await page.waitForTimeout(30);
    }
    await page.mouse.up();
    await page.waitForTimeout(600);
    const t1 = await timeOf(page);
    const forward = t1 - t0;
    check(
      "dragging right moves forward in time",
      forward > 0.5,
      `${t0.toFixed(2)}s -> ${t1.toFixed(2)}s, ${forward.toFixed(2)}s for 100px (${(100 / pxPerSec).toFixed(2)}s expected)`
    );

    // Drag left from where it is: time goes back.
    await page.mouse.move(box.x + 200, y);
    await page.mouse.down();
    for (let i = 1; i <= 5; i++) {
      await page.mouse.move(box.x + 200 - i * 20, y);
      await page.waitForTimeout(30);
    }
    await page.mouse.up();
    await page.waitForTimeout(600);
    const t2 = await timeOf(page);
    check(
      "dragging left moves back in time",
      t2 < t1 - 0.5,
      `${t1.toFixed(2)}s -> ${t2.toFixed(2)}s`
    );

    // A tap with no travel still seeks to where it landed.
    const beforeTap = await page.evaluate(() => {
      const shadow = document.querySelector("#waveform").firstElementChild.shadowRoot;
      const wrapper = shadow.querySelector(".wrapper");
      return {
        scrollLeft: wrapper.parentElement.scrollLeft,
        pxPerSec: wrapper.clientWidth / Number(document.querySelector("#track-seek-bar").max),
      };
    });
    await page.mouse.click(box.x + 60, y);
    await page.waitForTimeout(500);
    const tapped = await timeOf(page);
    const wanted = (beforeTap.scrollLeft + 60) / beforeTap.pxPerSec;
    check(
      "a tap seeks where it landed",
      Math.abs(tapped - wanted) <= 3,
      `${tapped.toFixed(1)}s, wanted ~${Math.round(wanted)}s`
    );

    check("no page errors", errors.length === 0);
    if (errors.length) console.log(`  page errors: ${errors.join(" | ")}`);
  } catch (e) {
    results.push({ name: `ABORTED: ${e.message}`, ok: false });
  } finally {
    await page.close().catch(() => {});
    await server.close();
  }
}

// Same gesture with a real finger.
{
  const { server, base } = await startServer("/workspace");
  const ctx = await browser.newContext({
    ...devices["Pixel 7"],
    hasTouch: true,
    isMobile: true,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  try {
    await page.goto(base);
    await page.waitForSelector(".tbody-playlist", { timeout: 15000 });
    await page.waitForTimeout(2500);
    await page.evaluate(() => {
      if (document.querySelector(".play-pause span").textContent === "pause")
        document.querySelector(".play-pause").click();
    });
    await page.waitForTimeout(400);

    const box = await page.locator("#waveform").boundingBox();
    const y = Math.round(box.y + box.height / 2);
    const cdp = await ctx.newCDPSession(page);
    const send = (type, points) =>
      cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points });

    const t0 = await timeOf(page);
    await send("touchStart", [{ x: Math.round(box.x + 40), y }]);
    for (let i = 1; i <= 5; i++) {
      await send("touchMove", [{ x: Math.round(box.x + 40 + i * 16), y }]);
      await page.waitForTimeout(30);
    }
    await send("touchEnd", []);
    await page.waitForTimeout(700);
    const t1 = await timeOf(page);
    check(
      "a touch drag scrubs forward",
      t1 > t0 + 0.4,
      `${t0.toFixed(2)}s -> ${t1.toFixed(2)}s`
    );
    check(
      "the touch drag does not open the playlist",
      await page.evaluate(() => !document.querySelector(".sidebar.active"))
    );
    check("no page errors on touch", errors.length === 0);
    if (errors.length) console.log(`  touch errors: ${errors.join(" | ")}`);
  } catch (e) {
    results.push({ name: `MOBILE ABORTED: ${e.message}`, ok: false });
  } finally {
    await ctx.close().catch(() => {});
    await server.close();
  }
}

await browser.close().catch(() => {});

let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.detail ? `  — ${r.detail}` : ""}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
