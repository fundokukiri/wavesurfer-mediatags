import { chromium, devices } from "playwright";
import { startServer } from "./server.mjs";
const { server, base } = await startServer("/workspace");
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required","--no-sandbox"] });
const ctx = await browser.newContext({ ...devices["Pixel 7"], hasTouch: true, isMobile: true });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("ERR", e.message));
page.on("console", (m) => { if (m.text().startsWith("DBG")) console.log(m.text()); });
await page.goto(base);
await page.waitForSelector(".tbody-playlist", { timeout: 15000 });
await page.waitForTimeout(2500);
await page.evaluate(() => document.querySelector(".album-art img").click());
await page.waitForTimeout(500);
const state = () => page.evaluate(() => {
  const audio = document.querySelector("#waveform").firstElementChild.shadowRoot.querySelector("audio");
  const active = document.querySelector(".tbody-playlist.active");
  return {
    activeCls: active ? active.className : null,
    activeIdx: active ? active.dataset.index : null,
    paused: audio.paused,
    icon: document.querySelector(".play-pause span").textContent,
    playingClassCount: document.querySelectorAll(".tbody-playlist.playing").length,
  };
});
await page.evaluate(() => {
  const icon = document.querySelector(".play-pause span").textContent;
  if (icon === "play_arrow") document.querySelector(".play-pause").click();
});
await page.waitForTimeout(2000);
console.log("playing:", JSON.stringify(await state()));
const idx = await page.evaluate(() => document.querySelector(".tbody-playlist.active")?.dataset.index ?? "0");
const box = await page.locator(`.tbody-playlist[data-index="${idx}"] .p-heart`).boundingBox();
const cdp = await ctx.newCDPSession(page);
const x = Math.round(box.x + box.width / 2), y = Math.round(box.y + box.height / 2);
await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
await page.waitForTimeout(1000);
console.log("after heart:", JSON.stringify(await state()));
await browser.close(); server.close();
