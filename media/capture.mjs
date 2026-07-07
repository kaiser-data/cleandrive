// Capture screenshots + a demo video of the CleanDrive dashboard.
// Requires a running server (node bin/cleandrive.js serve) and Playwright.
//   node media/capture.mjs
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const OUT = path.dirname(fileURLToPath(import.meta.url));
const URL = process.env.CD_URL || 'http://localhost:4499';
const VP = { width: 1280, height: 860 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function shot(colorScheme, file) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: VP, colorScheme, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForSelector('#catbars .catrow', { timeout: 10000 });
  await sleep(800);
  await page.screenshot({ path: path.join(OUT, file), fullPage: true });
  await browser.close();
  console.log('wrote', file);
}

async function demo() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: VP,
    recordVideo: { dir: OUT, size: VP },
  });
  const page = await ctx.newPage();
  const move = async (sel, opts) => { const el = page.locator(sel).first(); await el.scrollIntoViewIfNeeded(); await el.hover(opts).catch(() => {}); };

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForSelector('#catbars .catrow');
  await sleep(1600);

  // Hover the capacity bar segments to pop tooltips
  const segs = page.locator('#capbar .seg');
  const n = await segs.count();
  for (let i = 0; i < n; i++) { await segs.nth(i).hover(); await sleep(700); }
  await sleep(600);

  // Category breakdown
  await move('#catbars');
  const bars = page.locator('.catrow .track');
  for (let i = 0; i < Math.min(3, await bars.count()); i++) { await bars.nth(i).hover(); await sleep(650); }

  // Filter to package caches
  await page.getByRole('button', { name: 'Package caches' }).click();
  await sleep(1100);

  // Approve the top item
  const firstApprove = page.locator('#rows tr button:has-text("Approve")').first();
  await firstApprove.scrollIntoViewIfNeeded();
  await firstApprove.click();
  await sleep(1300);

  // Show a protected row: filter to App data (Claude history is locked)
  const appBtn = page.getByRole('button', { name: 'App data' });
  if (await appBtn.count()) { await appBtn.click(); await sleep(1500); }

  // Back to all, scroll to plan + remote panels
  await page.getByRole('button', { name: 'All' }).click();
  await sleep(800);
  await move('#planSummary');
  await sleep(1000);

  // Open the execute confirmation modal, type FREE, then cancel (no deletion in the demo)
  const exec = page.locator('#execBtn');
  if (!(await exec.isDisabled())) {
    await exec.click();
    await sleep(1200);
    await page.locator('#confirmWord').type('FREE', { delay: 120 });
    await sleep(1100);
    await page.locator('#modalCancel').click();
    await sleep(700);
  }

  // Remote panel focus
  await move('.remote');
  await sleep(1500);

  await ctx.close(); // finalizes the video
  await browser.close();
  console.log('video written to', OUT);
}

await shot('light', 'dashboard-light.png');
await shot('dark', 'dashboard-dark.png');
await demo();
