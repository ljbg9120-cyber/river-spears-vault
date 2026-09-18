/**
 * Capture screenshots of a running Vault.
 *
 *   node frontend/scripts/shots.mjs            # everything
 *   node frontend/scripts/shots.mjs appearance # just the pages whose name matches
 *
 * Needs the API on :8000 and Vite on :5173, plus a seeded demo account
 * (backend/scripts/seed_demo.py).
 */
import { mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = join(ROOT, "screenshots");
// Point these elsewhere to shoot a deployed instance:
//   VAULT_SITE=https://your-url node frontend/scripts/shots.mjs
const SITE = process.env.VAULT_SITE ?? "http://localhost:5173";
const API = process.env.VAULT_API ?? SITE;

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const DESKTOP = { width: 1440, height: 900, deviceScaleFactor: 2 };
const PHONE = { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true };

const filter = process.argv[2]?.toLowerCase();

/** Wait for the background canvas/animations to settle before shooting. */
const settle = (ms = 1400) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (!CHROME) throw new Error("No Chrome or Edge found to drive.");
  mkdirSync(OUT, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"],
  });

  const page = await browser.newPage();
  await page.setViewport(DESKTOP);

  // Sign in once; the cookie carries through every later navigation.
  await page.goto(SITE, { waitUntil: "networkidle2" });
  const status = await page.evaluate(async (api) => {
    const res = await fetch(`${api}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ email: "demo@vault.fm", password: "vaultdemo123" }),
    });
    return res.status;
  }, SITE);
  if (status !== 200) throw new Error(`Demo login failed (${status}). Seed it first.`);

  const shots = [
    { name: "01-landing", path: "/", viewport: DESKTOP, anon: true },
    { name: "02-signup", path: "/signup", viewport: DESKTOP, anon: true },
    { name: "03-library", path: "/library", viewport: DESKTOP },
    { name: "04-track", path: "TRACK", viewport: DESKTOP, play: true },
    { name: "05-appearance", path: "/appearance", viewport: DESKTOP },
    { name: "06-share", path: "SHARE", viewport: DESKTOP, anon: true },
    { name: "07-links", path: "/shares", viewport: DESKTOP },
    { name: "08-profile", path: "/u/novareyes", viewport: DESKTOP },
    { name: "09-library-mobile", path: "/library", viewport: PHONE },
    { name: "10-track-mobile", path: "TRACK", viewport: PHONE, play: true },
  ].filter((s) => !filter || s.name.includes(filter));

  // Resolve the ids the demo data happens to have.
  const tracks = await page.evaluate(async (api) => {
    const res = await fetch(`${api}/api/tracks`, { credentials: "include" });
    return res.json();
  }, SITE);
  const shares = await page.evaluate(async (api) => {
    const res = await fetch(`${api}/api/shares`, { credentials: "include" });
    return res.json();
  }, SITE);

  const featured =
    tracks.find((t) => t.comment_count > 0) ?? tracks[0];
  const trackPath = featured ? `/track/${featured.id}` : "/library";
  const sharePath = shares[0] ? `/s/${shares[0].token}` : "/library";

  for (const shot of shots) {
    const target =
      shot.path === "TRACK" ? trackPath : shot.path === "SHARE" ? sharePath : shot.path;

    await page.setViewport(shot.viewport);
    await page.goto(`${SITE}${target}`, { waitUntil: "networkidle2" });
    await settle();

    if (shot.play) {
      // Start playback so waveforms show progress and reactive art moves.
      const button = await page.$('button[aria-label^="Play"]');
      if (button) {
        await button.click();
        await settle(2600);
      }
    }

    const file = join(OUT, `${shot.name}.png`);
    await page.screenshot({ path: file });
    console.log(`  ${shot.name}.png`);
  }

  await browser.close();
  console.log(`\nSaved to ${OUT}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
