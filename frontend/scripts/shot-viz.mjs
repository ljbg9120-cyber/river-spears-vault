/**
 * Shoots the lyrics screen once per visualizer style, plus the settings grid.
 *
 *   VAULT_SITE=https://… node frontend/scripts/shot-viz.mjs starburst tunnel ring
 */
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = join(ROOT, "screenshots");
const SITE = process.env.VAULT_SITE ?? "http://localhost:5173";
const STYLES = process.argv.slice(2);

const CHROME = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
].find((p) => existsSync(p));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const DESKTOP = { width: 1440, height: 900, deviceScaleFactor: 2 };

async function main() {
  if (!STYLES.length) throw new Error("name at least one visualizer style");
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
    const r = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ email: "demo@vault.fm", password: "vaultdemo123" }),
    });
    return r.status;
  });
  if (status !== 200) throw new Error(`login failed (${status})`);

  const tracks = await page.evaluate(async () => {
    const r = await fetch("/api/tracks", { credentials: "include" });
    return r.json();
  });
  const track = tracks.find((t) => (t.lyrics ?? "").includes("["));
  if (!track) throw new Error("no track with timed lyrics");

  for (const style of STYLES) {
    await page.evaluate(
      async (viz) => {
        await fetch("/api/me/theme", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ visualizer: viz, visualizer_size: 0.95 }),
        });
      },
      style,
    );

    await page.goto(`${SITE}/track/${track.id}`, { waitUntil: "networkidle2" });
    await wait(1200);
    const play = await page.$('button[aria-label="Play"]');
    if (play) await play.click();
    await wait(7000);            // land mid-lyric
    const [follow] = await page.$$("button ::-p-text(Follow along)");
    if (follow) await follow.click();
    await wait(2200);            // let the art build up

    const file = join(OUT, `viz-${style}.png`);
    await page.screenshot({ path: file });
    console.log(`  viz-${style}.png`);
  }

  await page.goto(`${SITE}/appearance`, { waitUntil: "networkidle2" });
  await wait(2200);
  await page.screenshot({ path: join(OUT, "14-visualizer-grid.png") });
  console.log("  14-visualizer-grid.png");

  await browser.close();
  console.log(`\nSaved to ${OUT}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
