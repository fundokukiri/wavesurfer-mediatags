// Waveform gestures: a swipe scrolls the canvas and keeps gliding, a tap seeks.
// Run: node test/waveform-swipe.mjs
import { chromium, devices } from "playwright";
import { startServer } from "./server.mjs";

const { server, base } = await startServer("/workspace");
const browser = await chromium.launch({
  args: ["--autoplay-policy=no-user-gesture-required", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok, detail });

const state = () =>
  page.evaluate(() => {
    const wrapper = document.querySelector("#waveform").firstElementChild
      ?.shadowRoot?.querySelector(".wrapper");
    const scroll = wrapper?.parentElement;
    const seek = document.querySelector("#track-seek-bar");
    return {
      scrollLeft: scroll ? Math.round(scroll.scrollLeft) : -1,
      client: scroll ? scroll.clientWidth : 0,
      width: wrapper ? Math.round(wrapper.clientWidth) : 0,
      duration: Number(seek.max),
      // The seek bar is floored to whole seconds; the media element is not.
      seconds: Number(
        document
          .querySelector("#waveform")
          .firstElementChild.shadowRoot.querySelector("audio")?.currentTime ?? seek.value
      ),
    };
  });

try {
  await page.goto(base);
  await page.waitForSelector(".tbody-playlist", { timeout: 15000 });
  await page.waitForTimeout(2500);
  // Pause first: playback re-centres the canvas every frame.
  await page.evaluate(() => {
    if (document.querySelector(".play-pause span").textContent === "pause")
      document.querySelector(".play-pause").click();
  });
  await page.waitForTimeout(400);

  const box = await page.locator("#waveform").boundingBox();
  const midY = box.y + box.height / 2;

  // Swipe right-to-left: the canvas travels left, so scrollLeft grows.
  const before = await state();
  await page.mouse.move(box.x + box.width - 20, midY);
  await page.mouse.down();
  for (let step = 1; step <= 8; step++) {
    await page.mouse.move(box.x + box.width - 20 - step * 22, midY);
    await page.waitForTimeout(16);
  }
  const atRelease = await state();
  await page.mouse.up();
  await page.waitForTimeout(350);
  const afterGlide = await state();

  check(
    "swiping scrolls the waveform",
    atRelease.scrollLeft - before.scrollLeft >= 120,
    `${before.scrollLeft} -> ${atRelease.scrollLeft}`
  );
  check(
    "the canvas keeps gliding after the release",
    afterGlide.scrollLeft > atRelease.scrollLeft + 5,
    `${atRelease.scrollLeft} -> ${afterGlide.scrollLeft}`
  );

  // A tap seeks to the point under the finger.
  await page.waitForTimeout(500);
  const tapped = await page.evaluate(async () => {
    const wrapper = document.querySelector("#waveform").firstElementChild
      ?.shadowRoot?.querySelector(".wrapper");
    const scroll = wrapper.parentElement;
    return { scrollLeft: scroll.scrollLeft, pxPerSec: wrapper.clientWidth / Number(document.querySelector("#track-seek-bar").max) };
  });
  const tapX = box.x + 60;
  await page.mouse.click(tapX, midY);
  await page.waitForTimeout(500);
  const afterTap = await state();
  const wanted = (tapped.scrollLeft + 60) / tapped.pxPerSec;
  check(
    "a tap seeks where it landed",
    Math.abs(afterTap.seconds - wanted) <= 3,
    `${afterTap.seconds}s of ${afterTap.duration}s, wanted ~${Math.round(wanted)}s`
  );

  // Paused: once the glide dies out the canvas stays put, no snap back.
  await page.waitForTimeout(1400);
  const settled = await state();
  await page.waitForTimeout(900);
  const stillThere = await state();
  check(
    "the paused canvas stays where it was swiped",
    Math.abs(stillThere.scrollLeft - settled.scrollLeft) <= 20,
    `${settled.scrollLeft} -> ${stillThere.scrollLeft}`
  );

  // Playing: the playhead follow takes over again.
  const beforePlay = await state();
  await page.evaluate(() => document.querySelector(".play-pause").click());
  await page.waitForTimeout(1600);
  const whilePlaying = await state();
  await page.evaluate(() => document.querySelector(".play-pause").click());
  // The playhead is what the canvas should be centred on now.
  const centred =
    (whilePlaying.seconds / whilePlaying.duration) * whilePlaying.width -
    whilePlaying.client / 2;
  check(
    "playback re-centres the canvas on the playhead",
    whilePlaying.scrollLeft > beforePlay.scrollLeft + 40 &&
      Math.abs(whilePlaying.scrollLeft - centred) <= 20,
    `scroll ${whilePlaying.scrollLeft}, playhead centred at ${Math.round(centred)}`
  );

  check("no page errors", errors.length === 0);
  if (errors.length) console.log(`  page errors: ${errors.join(" | ")}`);
} catch (e) {
  results.push({ name: `ABORTED: ${e.message}`, ok: false });
} finally {
  await browser.close().catch(() => {});
  await server.close();
}

// Real touch: the swipe must move the canvas and must not open the sidebar.
{
  // The desktop server is already closed by now, so this block gets its own.
  const local = await startServer("/workspace");
  const touchBrowser = await chromium.launch({ args: ["--no-sandbox"] });
  const ctx = await touchBrowser.newContext({
    ...devices["Pixel 7"],
    hasTouch: true,
    isMobile: true,
  });
  const touchPage = await ctx.newPage();
  const touchErrors = [];
  touchPage.on("pageerror", (e) => touchErrors.push(String(e)));
  try {
    await touchPage.goto(local.base);
    await touchPage.waitForSelector(".tbody-playlist", { timeout: 15000 });
    await touchPage.waitForTimeout(2500);
    await touchPage.evaluate(() => {
      if (document.querySelector(".play-pause span").textContent === "pause")
        document.querySelector(".play-pause").click();
    });
    await touchPage.waitForTimeout(300);

    const box = await touchPage.locator("#waveform").boundingBox();
    const y = Math.round(box.y + box.height / 2);
    const cdp = await ctx.newCDPSession(touchPage);
    const send = (type, points) =>
      cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points });
    const snapshot = () =>
      touchPage.evaluate(() => {
        const shadow = document.querySelector("#waveform").firstElementChild
          .shadowRoot;
        return {
          left: Math.round(shadow.querySelector(".wrapper").parentElement.scrollLeft),
          sidebar: Boolean(document.querySelector(".sidebar.active")),
        };
      });

    const startLeft = (await snapshot()).left;
    await send("touchStart", [{ x: Math.round(box.x + box.width - 20), y }]);
    for (let i = 1; i <= 5; i++) {
      await send("touchMove", [
        { x: Math.round(box.x + box.width - 20 - i * 20), y },
      ]);
      await touchPage.waitForTimeout(30);
    }
    await send("touchEnd", []);
    await touchPage.waitForTimeout(400);
    const swiped = await snapshot();
    check(
      "a touch swipe scrolls the waveform",
      swiped.left - startLeft >= 80,
      `${startLeft} -> ${swiped.left}`
    );
    check("the swipe does not open the playlist", swiped.sidebar === false);

    // A touch tap still seeks where it lands.
    const before = await touchPage.evaluate(() => {
      const shadow = document.querySelector("#waveform").firstElementChild
        .shadowRoot;
      const wrapper = shadow.querySelector(".wrapper");
      return {
        scrollLeft: wrapper.parentElement.scrollLeft,
        pxPerSec:
          wrapper.clientWidth / Number(document.querySelector("#track-seek-bar").max),
      };
    });
    await send("touchStart", [{ x: Math.round(box.x + 40), y }]);
    await send("touchEnd", []);
    await touchPage.waitForTimeout(600);
    const tapped = await touchPage.evaluate(() =>
      document
        .querySelector("#waveform")
        .firstElementChild.shadowRoot.querySelector("audio").currentTime
    );
    const wanted = (before.scrollLeft + 40) / before.pxPerSec;
    check(
      "a touch tap seeks",
      Math.abs(tapped - wanted) <= 3,
      `${tapped.toFixed(1)}s, wanted ~${Math.round(wanted)}s`
    );

    check("no page errors on touch", touchErrors.length === 0);
    if (touchErrors.length) console.log(`  touch errors: ${touchErrors.join(" | ")}`);
  } catch (e) {
    results.push({ name: `MOBILE ABORTED: ${e.message}`, ok: false });
  } finally {
    await touchBrowser.close().catch(() => {});
    await local.server.close();
  }
}

let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.detail ? `  — ${r.detail}` : ""}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
