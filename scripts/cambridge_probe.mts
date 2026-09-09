import { chromium } from 'playwright';
import fs from 'fs';

const PROFILE = 'logs/stealth-probe-cam-fresh';
fs.mkdirSync(PROFILE, { recursive: true });

const browser = await chromium.launch({ headless: false });
const context = await chromium.launchPersistentContext(PROFILE, {
  headless: false,
  args: ['--disable-blink-features=AutomationControlled', '--window-size=1366,768'],
  viewport: { width: 1366, height: 768 },
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
  locale: 'en-GB',
});
const page = await context.newPage();
await page.goto('https://dictionary.cambridge.org/', { waitUntil: 'domcontentloaded', timeout: 30_000 });
await page.waitForTimeout(10_000);

const info = await page.evaluate(() => ({
  title: document.title,
  interactive: document.querySelectorAll('a, button, input, select, textarea, [role], [tabindex]').length,
  frames: Array.from(document.querySelectorAll('iframe')).map(f => f.src).slice(0, 5),
  htmlHead: document.documentElement.outerHTML.replace(/\s+/g, ' ').slice(0, 900),
}));
console.log('TITLE:', info.title);
console.log('INTERACTIVE:', info.interactive);
console.log('FRAMES:', JSON.stringify(info.frames));
console.log('HTML:', info.htmlHead);

await browser.close();
await context.close();
