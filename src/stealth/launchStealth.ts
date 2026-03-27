import { chromium, type BrowserContext } from 'playwright';
import path from 'path';
import fs from 'fs';

const EXTENSION_PATH = path.resolve('extension');
const PHASE6_PROFILE_DIR = path.resolve('extension/.chrome_profile_phase6');

// NEVER clear PHASE6_PROFILE_DIR between runs
// It accumulates cookies, history, and behavioral signals

export interface StealthLaunchOptions {
  headless?: boolean;
  profileDir?: string;
  windowSize?: { width: number; height: number };
}

export async function launchStealth(opts: StealthLaunchOptions = {}): Promise<BrowserContext> {
  const headless = opts.headless ?? (process.env['PHASE6_HEADLESS'] !== 'false');
  const profileDir = opts.profileDir ?? PHASE6_PROFILE_DIR;
  const { width, height } = opts.windowSize ?? { width: 1366, height: 768 };

  // Ensure profile dir exists — do NOT clear it
  fs.mkdirSync(profileDir, { recursive: true });
  fs.mkdirSync('logs', { recursive: true });

  // Use Playwright's bundled Chromium by default (supports --load-extension properly)
  // System Chrome can be set via CHROME_PATH if developer mode is enabled manually
  const chromePath = process.env['CHROME_PATH'] || undefined;
  console.log(`  Chrome: ${chromePath ?? 'Playwright bundled Chromium'}`);
  console.log(`  Mode:   ${headless ? 'headless (--headless=new)' : 'headful'}`);
  console.log(`  Profile: ${profileDir}`);

  // Ensure extension is built
  if (!fs.existsSync(path.join(EXTENSION_PATH, 'stealth.js'))) {
    throw new Error('extension/stealth.js not found. Run: npm run extension:build');
  }
  if (!fs.existsSync(path.join(EXTENSION_PATH, 'content.js'))) {
    throw new Error('extension/content.js not found. Run: npm run extension:build');
  }

  const context = await chromium.launchPersistentContext(profileDir, {
    ...(chromePath ? { executablePath: chromePath } : {}),
    headless: false,    // We pass --headless=new via args if needed
    args: [
      ...(headless ? ['--headless=new'] : []),
      `--load-extension=${EXTENSION_PATH}`,
      `--disable-extensions-except=${EXTENSION_PATH}`,
      '--disable-blink-features=AutomationControlled',
      '--disable-features=VizDisplayCompositor',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-default-apps',
      '--no-sandbox',
      `--window-size=${width},${height}`,
    ],
    viewport: { width, height },
    userAgent: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36`,
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata',
    extraHTTPHeaders: {
      'Accept-Language': 'en-IN,en;q=0.9,hi;q=0.8',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'sec-ch-ua': '"Chromium";v="134", "Google Chrome";v="134", "Not-A.Brand";v="99"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
    },
    ignoreHTTPSErrors: false,
  });

  return context;
}

// ── Profile warm-up ───────────────────────────────────────────────────────────
// Visits 4 normal sites before the target to build cookies + history
// Google must be last — its cookies are trusted by Amazon/Reddit bot scoring

const WARMUP_SITES = [
  { url: 'https://www.bbc.com/news', waitMs: 2000, label: 'BBC News' },
  { url: 'https://en.wikipedia.org/wiki/Main_Page', waitMs: 1500, label: 'Wikipedia' },
  { url: 'https://www.youtube.com', waitMs: 2000, label: 'YouTube' },
  { url: 'https://www.google.com', waitMs: 2000, label: 'Google' },   // LAST — trust signal
];

export async function warmupProfile(context: BrowserContext): Promise<void> {
  const page = context.pages()[0] ?? await context.newPage();

  console.log('\n  Profile warm-up (builds cookies + history):');
  for (const site of WARMUP_SITES) {
    try {
      console.log(`    → ${site.label}`);
      await page.goto(site.url, {
        waitUntil: 'domcontentloaded',
        timeout: 15_000,
      });
      await page.waitForTimeout(site.waitMs);
    } catch {
      console.log(`      ⚠ ${site.label} skipped (timeout/error)`);
    }
  }

  console.log('  Warm-up complete\n');
}

// ── Stealth gate check ────────────────────────────────────────────────────────
const STEALTH_CHECK_LOG = path.resolve('logs/stealth_check.json');
const STEALTH_GATE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

export function stealthGatePassed(): boolean {
  if (process.env['PHASE6_DEBUG'] === 'true') return true;
  try {
    const data = JSON.parse(fs.readFileSync(STEALTH_CHECK_LOG, 'utf-8'));
    return Date.now() - data.timestamp < STEALTH_GATE_TTL_MS && data.passed === true;
  } catch {
    return false;
  }
}

export function recordStealthGateResult(passed: boolean, redFlags: number): void {
  fs.writeFileSync(STEALTH_CHECK_LOG, JSON.stringify({
    timestamp: Date.now(),
    passed,
    redFlags,
  }));
}
