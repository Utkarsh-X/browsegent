/**
 * Stealth probe: measures bot-wall outcomes per launch variant against the
 * locked benchmark roots (Allrecipes, Cambridge Dictionary, Google Search).
 *
 * Variants:
 *   baseline   — the current benchmark launch (headless, no args)
 *   headed     — same, headed
 *   hardened   — persistent profile + --headless=new + AutomationControlled
 *                disabled + consistent client hints (V1 launchStealth lineage)
 *   hardened-headed — persistent profile, headed, extension
 *
 * Usage: npx tsx scripts/stealth_probe.ts --variant hardened [--rounds 1]
 */
import { chromium, type Browser, type BrowserContext } from 'playwright';
import path from 'path';
import fs from 'fs';

const PROBE_URLS = [
  'https://www.allrecipes.com/',
  'https://dictionary.cambridge.org/',
  'https://www.google.com/',
];

const CHALLENGE_MARKERS = [
  'challenges.cloudflare.com',
  'cf-chl',
  'turnstile',
  'Just a moment',
  'unusual traffic',
  '/sorry/',
  'enable JavaScript and cookies',
  'Attention Required',
];

const PROFILE_DIR = path.resolve('logs/stealth-probe-profile');

function readFlag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function installSampler(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const store = window as unknown as { __bgSettle?: { lastMutationTs: number } };
    store.__bgSettle = { lastMutationTs: Date.now() };
    const mark = () => {
      if (store.__bgSettle) store.__bgSettle.lastMutationTs = Date.now();
    };
    const install = () => {
      try {
        new MutationObserver(mark).observe(document.documentElement || document, { childList: true, subtree: true, attributes: true, characterData: true });
      } catch { /* noop */ }
    };
    if (document.documentElement) install();
    else document.addEventListener('DOMContentLoaded', install, { once: true });
  });
}

async function probeUrl(context: BrowserContext, url: string): Promise<{ outcome: string; detail: string; ms: number }> {
  const startedAt = Date.now();
  const page = await context.newPage();
  let outcome = 'UNKNOWN';
  let detail = '';
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    // Up to 20s for the wall to clear (Turnstile auto-solves in headed real profiles).
    for (let second = 0; second < 10; second += 1) {
      await page.waitForTimeout(2_000);
      const state = await page.evaluate(() => {
        const bodyText = String(document.body?.innerText || '').slice(0, 4_000);
        const markers = [
          'challenges.cloudflare.com',
          'cf-chl',
          'turnstile',
          'Just a moment',
          'unusual traffic',
          'enable JavaScript and cookies',
          'Attention Required',
        ];
        const hit = markers.find(marker => bodyText.includes(marker) || Array.from(document.querySelectorAll('iframe')).some(iframe => (iframe.src || '').includes(marker)));
        const interactive = document.querySelectorAll('a, button, input, select, textarea, [role], [onclick], [tabindex]').length;
        return { url: location.href, hit, interactive };
      }).catch(error => ({ url: String(error), hit: 'EVAL_ERROR', interactive: 0 }));

      if (typeof state.hit === 'string' && state.hit !== 'EVAL_ERROR') {
        outcome = 'BLOCKED';
        detail = `marker=${state.hit}`;
        break;
      }
      if (state.hit === 'EVAL_ERROR') {
        outcome = 'ERROR';
        detail = String(state.url).slice(0, 120);
        break;
      }
      if (state.interactive >= 40 && !String(state.url).includes('/sorry/')) {
        outcome = 'CLEARED';
        detail = `interactive=${state.interactive}`;
        break;
      }
      if (second === 9) {
        outcome = String(state.url).includes('/sorry/') ? 'BLOCKED' : 'UNKNOWN';
        detail = `interactive=${state.interactive} url=${state.url.slice(0, 90)}`;
      }
    }
  } catch (error) {
    outcome = 'ERROR';
    detail = String(error instanceof Error ? error.message : error).slice(0, 120);
  } finally {
    await page.close().catch(() => undefined);
  }
  return { outcome, detail, ms: Date.now() - startedAt };
}

async function makeContext(variant: string, browser: Browser): Promise<BrowserContext> {
  if (variant === 'baseline') {
    return browser.newContext({ viewport: { width: 1280, height: 720 } });
  }
  if (variant === 'headed') {
    return browser.newContext({ viewport: { width: 1366, height: 768 } });
  }
  const headless = variant !== 'hardened-headed';
  fs.mkdirSync(PROFILE_DIR, { recursive: true });
  return chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    args: [
      ...(headless ? ['--headless=new'] : []),
      '--disable-blink-features=AutomationControlled',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-default-apps',
      `--window-size=1366,768`,
    ],
    viewport: { width: 1366, height: 768 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
    locale: 'en-US',
    extraHTTPHeaders: {
      'Accept-Language': 'en-US,en;q=0.9',
      'sec-ch-ua': '"Chromium";v="134", "Google Chrome";v="134", "Not-A.Brand";v="99"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
    },
  });
}

async function main(): Promise<void> {
  const variant = readFlag('--variant') ?? 'baseline';
  const rounds = Number(readFlag('--rounds') ?? 1);
  const headed = variant === 'headed' || variant === 'hardened-headed';
  console.log(`=== stealth probe: variant=${variant} headed=${headed} rounds=${rounds} ===`);

  const browser = await chromium.launch({ headless: !headed });
  const results: Array<{ url: string; outcome: string; detail: string; ms: number }> = [];
  try {
    for (let round = 1; round <= rounds; round += 1) {
      const context = await makeContext(variant, browser);
      await installSampler(context);
      for (const url of PROBE_URLS) {
        const result = await probeUrl(context, url);
        results.push({ url, ...result });
        console.log(`[${round}] ${outcomePad(result.outcome)} ${url}  (${result.ms}ms) ${result.detail}`);
      }
      await context.close().catch(() => undefined);
    }
  } finally {
    await browser.close().catch(() => undefined);
  }

  const cleared = results.filter(r => r.outcome === 'CLEARED').length;
  console.log(`=== summary: ${cleared}/${results.length} cleared | ` +
    results.map(r => `${new URL(r.url).host}: ${r.outcome}`).join(' | '));
}

function outcomePad(outcome: string): string {
  return outcome.padEnd(8);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
