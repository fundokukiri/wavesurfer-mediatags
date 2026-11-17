#!/usr/bin/env node
// Draws a square cover for each song in audio/ and embeds it as the track's
// front-cover picture.
//
// The point is that the covers are made here, not lifted from anywhere: a
// colour pair, a small motif and the real title/artist, rendered by Chromium
// into a 500x500 JPEG and written into the MP3's ID3 tag. Add a row to SONGS
// and re-run; nothing else in the player changes.
//
//   npm i -D playwright node-id3   (already in devDependencies)
//   node scripts/generate-covers.mjs
import { chromium } from "playwright";
import NodeID3 from "node-id3";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const audioDir = join(root, "audio");

// a/b = gradient ends, accent = darkest corner, motif = the small line drawing.
const SONGS = [
  { file: "Đừng Lo Anh Đợi Mà.mp3", title: "Đừng Lo Anh Đợi Mà", artist: "Tịch Dương", a: "#f7b267", b: "#6d3b47", accent: "#2b1620", motif: "chair" },
  { file: "Em Chỉ Yêu Anh Ta.mp3", title: "Em Chỉ Yêu Anh Ta", artist: "Vy Lâm x Giấu Mặt", a: "#7b2d5e", b: "#f0945b", accent: "#1a1030", motif: "circles" },
  { file: "Giấu Mặt - Giá Như Chưa Từng Quen.mp3", title: "Giá Như Chưa Từng Quen", artist: "Giấu Mặt", a: "#3c6e71", b: "#d9e2dc", accent: "#12262b", motif: "line" },
  { file: "Khắc Việt - Như Vậy Nhé (Piano).mp3", title: "Như Vậy Nhé", artist: "Khắc Việt · Piano", a: "#e8d9c5", b: "#8a6a52", accent: "#3a2a20", motif: "keys" },
  { file: "Khắc Việt - Yêu Lại Từ Đầu.mp3", title: "Yêu Lại Từ Đầu", artist: "Khắc Việt", a: "#f6c7b6", b: "#b8455f", accent: "#40131f", motif: "sun" },
  { file: "Lời Yêu Đó.mp3", title: "Lời Yêu Đó", artist: "Tịch Dương", a: "#9fb8d1", b: "#22374a", accent: "#0f1d28", motif: "waves" },
  { file: "Minh Vương - Nỗi Đau Xót Xa.mp3", title: "Nỗi Đau Xót Xa", artist: "Minh Vương", a: "#b23a48", b: "#2a1418", accent: "#0f0708", motif: "rings" },
  // Listed in audio/.local-only: on disk for local listening, never published.
  { file: "Son Tung M-TP - Em Dau Du Tu Cach.mp3", title: "Em Dau Du Tu Cach", artist: "Son Tung M-TP", a: "#4a6fa5", b: "#131b2b", accent: "#070a12", motif: "line" },
  { file: "fundokulinux - Fixing Everything.mp3", title: "Fixing Everything", artist: "fundokulinux", a: "#63b3a0", b: "#123a3a", accent: "#04100f", motif: "waves" },
];

const STROKE = `fill="none" stroke="#ffffff"`;

const motif = (kind) => {
  switch (kind) {
    case "chair":
      return `<g ${STROKE} stroke-width="9" opacity=".5"><rect x="140" y="70" width="120" height="150" rx="18"/>
        <path d="M140 220h120M160 220v90M240 220v90"/></g>`;
    case "circles":
      return `<g ${STROKE} stroke-width="10"><circle cx="170" cy="200" r="105" opacity=".45"/>
        <circle cx="245" cy="200" r="105" opacity=".25"/></g>`;
    case "line":
      return `<path ${STROKE} stroke-width="8" opacity=".45" d="M60 300C140 300 150 120 240 120s90 180 100 180"/>`;
    case "keys":
      return `<g ${STROKE} stroke-width="7" opacity=".45"><path d="M80 250h240M120 250v-45M180 250v-45M240 250v-45M300 250v-45"/>
        <path d="M150 250v-28M210 250v-28M270 250v-28"/></g>`;
    case "sun":
      return `<circle cx="200" cy="210" r="92" fill="#ffffff" opacity=".3"/>
        <path d="M108 285h184" ${STROKE} stroke-width="9" opacity=".5"/>`;
    case "waves":
      return `<g ${STROKE} stroke-width="8" opacity=".4">
        <path d="M40 170c40 0 40 60 80 60s40-60 80-60 40 60 80 60 40-60 80-60"/>
        <path d="M40 250c40 0 40 60 80 60s40-60 80-60 40 60 80 60 40-60 80-60" opacity=".6"/></g>`;
    default:
      return `<g ${STROKE} stroke-width="7" opacity=".4"><circle cx="200" cy="200" r="120"/>
        <circle cx="200" cy="200" r="86" opacity=".7"/><circle cx="200" cy="200" r="52" opacity=".5"/></g>`;
  }
};

const pageFor = (s) => `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;padding:0}
  .card{width:500px;height:500px;position:relative;overflow:hidden;
    background:radial-gradient(120% 100% at 20% 10%, ${s.a} 0%, ${s.b} 70%, ${s.accent} 130%)}
  svg{position:absolute;right:70px;top:70px;width:360px;height:360px;opacity:.55}
  .txt{position:absolute;left:40px;right:40px;bottom:44px;color:#fff;
    font-family:"DejaVu Serif","Georgia",serif;text-shadow:0 2px 18px rgba(0,0,0,.45)}
  .t{font-size:38px;line-height:1.1;font-weight:700;letter-spacing:-.5px}
  .rule{width:56px;height:3px;background:#fff;opacity:.7;margin-top:16px}
  .a{margin-top:12px;font-family:"DejaVu Sans","Helvetica",sans-serif;font-size:15px;
    letter-spacing:2.4px;text-transform:uppercase;opacity:.95}
  .grain{position:absolute;inset:0;opacity:.13;mix-blend-mode:overlay;
    background-image:radial-gradient(rgba(255,255,255,.9) .5px, transparent .5px);
    background-size:3px 3px}
</style></head><body><div class="card">
  <svg viewBox="0 0 400 400">${motif(s.motif)}</svg>
  <div class="txt"><div class="t">${s.title}</div><div class="rule"></div><div class="a">${s.artist}</div></div>
  <div class="grain"></div>
</div></body></html>`;

const scratch = mkdtempSync(join(tmpdir(), "covers-"));
const browser = await chromium.launch({ args: ["--no-sandbox"] });
// 2x so the 500x500 cover stays crisp on retina screens.
const page = await browser.newPage({
  viewport: { width: 500, height: 500 },
  deviceScaleFactor: 2,
});

for (const song of SONGS) {
  await page.setContent(pageFor(song));
  await page.waitForTimeout(120);
  const coverPath = join(scratch, "cover.jpg");
  await page.screenshot({
    path: coverPath,
    type: "jpeg",
    quality: 86,
    clip: { x: 0, y: 0, width: 500, height: 500 },
  });
  NodeID3.write(
    {
      title: song.title,
      artist: song.artist,
      album: song.title,
      image: {
        mime: "image/jpeg",
        type: { id: 3, name: "front cover" },
        description: "Cover",
        imageBuffer: readFileSync(coverPath),
      },
    },
    join(audioDir, song.file)
  );
  console.log("cover written:", song.file);
}

await browser.close();
rmSync(scratch, { recursive: true, force: true });
