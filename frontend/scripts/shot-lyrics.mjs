/**
 * Screenshots the now-playing / lyrics view and the visualizer settings.
 *
 *   VAULT_SITE=https://… node frontend/scripts/shot-lyrics.mjs
 */
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = join(ROOT, "screenshots");
const SITE = process.env.VAULT_SITE ?? "http://localhost:5173";

const CHROME = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
].find((p) => existsSync(p));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const DESKTOP = { width: 1440, height: 900, deviceScaleFactor: 2 };
const PHONE = { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true };

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"],
  });

  const page = await browser.newPage();
  await page.setViewport(DESKTOP);
  await page.goto(SITE, { waitUntil: "networkidle2" });

  const status = await page.evaluate(async () => {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ email: "demo@vault.fm", password: "vaultdemo123" }),
    });
    return res.status;
  });
  if (status !== 200) throw new Error(`login failed (${status})`);

  const tracks = await page.evaluate(async () => {
    const res = await fetch("/api/tracks", { credentials: "include" });
    return res.json();
  });
  const withLyrics = tracks.find((t) => (t.lyrics ?? "").includes("["));
  if (!withLyrics) throw new Error("no track with timed lyrics to shoot");

  /** Open the track, start it, let it run into the lyrics, open full screen. */
  async function openNowPlaying(seconds) {
    await page.goto(`${SITE}/track/${withLyrics.id}`, { waitUntil: "networkidle2" });
    await wait(1200);
    const play = await page.$('button[aria-label="Play"]');
    if (play) await play.click();
    await wait(seconds * 1000);
    const [follow] = await page.$$('button ::-p-text(Follow along)');
    if (follow) await follow.click();
    else {
      const viz = await page.$('button[aria-label="Lyrics and visualizer"]');
      if (viz) await viz.click();
    }
    await wait(1600);
  }

  await openNowPlaying(7);
  await page.screenshot({ path: join(OUT, "11-lyrics.png") });
  console.log("  11-lyrics.png");

  await page.setViewport(PHONE);
  await wait(1500);
  await page.screenshot({ path: join(OUT, "12-lyrics-mobile.png") });
  console.log("  12-lyrics-mobile.png");

  // Settings, with the track still playing so the previews are moving.
  await page.setViewport(DESKTOP);
  await page.goto(`${SITE}/appearance`, { waitUntil: "networkidle2" });
  await wait(1800);
  await page.screenshot({ path: join(OUT, "13-visualizer-settings.png") });
  console.log("  13-visualizer-settings.png");

  await browser.close();
  console.log(`\nSaved to ${OUT}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
