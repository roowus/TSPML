// Throwaway visual check: screenshots the launcher, the boot overlay, the
// opened Add-a-mod form, and the sidebar. Not a smoke — no assertions. Not
// committed to CI.
import { chromium } from 'playwright';

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader-webgl', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(600);
await page.screenshot({ path: '/tmp/tspml-launcher.png' });
await page.goto('http://localhost:3000/play', { waitUntil: 'domcontentloaded' });
await page.screenshot({ path: '/tmp/tspml-boot.png' });
await page.waitForSelector('.boot-overlay', { state: 'detached', timeout: 90000 }).catch(() => {});
// The Mods menu is an overlay closed by default; open it before the shots.
await page.click('.mods-btn').catch(() => {});
await page.waitForTimeout(400);
await page.click('aside[aria-label="Mods"] .add-opener');
await page.waitForTimeout(400);
await page.locator('.mods-menu').screenshot({ path: '/tmp/tspml-sidebar.png' });
await page.screenshot({ path: '/tmp/tspml-form.png' });
await browser.close();
