// Hovering a playlist row shows the information the row truncates.
// Run: node test/tooltip.mjs
import { chromium } from "playwright";
import { startServer } from "./server.mjs";

const { server, base } = await startServer("/workspace");
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok, detail });

const tip = () =>
  page.evaluate(() => {
    const el = document.querySelector("#track-tooltip");
    const box = el.getBoundingClientRect();
    return {
      hidden: el.hidden,
      text: el.textContent.replace(/\s+/g, " ").trim(),
      box: { x: box.x, y: box.y, right: box.right, bottom: box.bottom },
      rows: el.querySelectorAll(".tp-tip-row").length,
    };
  });

const rowInfo = (index) =>
  page.evaluate((i) => {
    const row = document.querySelectorAll(".tbody-playlist")[i];
    const title = row.querySelector(".tp-title");
    return {
      title: title.textContent.trim(),
      truncated: title.scrollWidth > title.clientWidth + 1,
    };
  }, index);

try {
  await page.goto(base);
  await page.waitForSelector(".tbody-playlist", { timeout: 15000 });
  await page.waitForTimeout(2500);
  await page.click(".album-art"); // the playlist lives in the sidebar
  await page.waitForTimeout(400);

  check("tooltip starts hidden", (await tip()).hidden);

  // Longest title on the list is the clearest proof it shows more than the row.
  const count = await page.locator(".tbody-playlist").count();
  let index = 0;
  for (let i = 0; i < count; i++) {
    const info = await rowInfo(i);
    if (info.truncated) {
      index = i;
      break;
    }
  }
  const row = await rowInfo(index);
  await page.locator(".tbody-playlist").nth(index).hover();
  // The card waits 2s of stillness so a click-to-pick never flashes it.
  await page.waitForTimeout(1600);
  const shown = await tip();

  check("hovering a row opens the card", !shown.hidden);
  check(
    `card carries the full title (${JSON.stringify(row.title)})`,
    shown.text.includes(row.title),
    shown.text
  );
  check("card has every field", shown.rows === 4, `${shown.rows} fields`);
  for (const label of ["Album", "Thời lượng", "Nguồn", "Tệp"]) {
    check(`field ${label}`, shown.text.includes(label));
  }
  check(
    "card header carries the cover and the artist",
    (await page.evaluate(() => {
      const card = document.querySelector("#track-tooltip");
      const art = card.querySelector(".tp-tip-art");
      const artist = card.querySelector(".tp-tip-artist");
      return Boolean(art && art.getAttribute("src") && artist?.textContent.trim());
    }))
  );
  check(
    "card stays inside the window",
    shown.box.x >= 0 &&
      shown.box.y >= 0 &&
      shown.box.right <= 1280 &&
      shown.box.bottom <= 800,
    JSON.stringify(shown.box)
  );

  await page.mouse.move(5, 5);
  await page.waitForTimeout(250);
  check("leaving the row hides the card", (await tip()).hidden);

  // Clicking a different row loads it and closes the panel; the card must not
  // survive that (clicking the loaded row only toggles play, panel stays).
  const activeIndex = await page.evaluate(() =>
    [...document.querySelectorAll(".tbody-playlist")].findIndex((el) =>
      el.classList.contains("active")
    )
  );
  const clickIndex = activeIndex === index ? (index + 1) % count : index;
  await page.locator(".tbody-playlist").nth(clickIndex).hover();
  await page.waitForTimeout(1600);
  check("hovering that row shows the card again", !(await tip()).hidden);
  await page.locator(".tbody-playlist").nth(clickIndex).click();
  await page.waitForTimeout(600);
  check("closing the playlist hides the card", (await tip()).hidden);

  check("no page errors", errors.length === 0);
  if (errors.length) console.log(`  page errors: ${errors.join(" | ")}`);
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
