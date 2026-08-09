// Throwaway visual check: screenshots the boot overlay, the opened Add-a-mod
// form, and the sidebar. Not a smoke — no assertions. Not committed to CI.
import { chromium } from 'playwright';

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader-webgl', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });
await page.screenshot({ path: '/tmp/tspml-boot.png' });
await page.waitForSelector('.boot-overlay', { state: 'detached', timeout: 90000 }).catch(() => {});
await page.click('aside[aria-label="Mods"] summary');
await page.waitForTimeout(400);
await page.locator('.sidebar').screenshot({ path: '/tmp/tspml-sidebar.png' });
await page.screenshot({ path: '/tmp/tspml-form.png' });
await browser.close();
