/**
 * One-time WebArena session bootstrap: logs into a locally deployed site with the
 * OFFICIAL benchmark account and saves a Playwright storage state that pilot runs
 * load via BROWSEGENT_STORAGE_STATE. Mirrors upstream browser_env/auto_login.py.
 *
 * Usage:
 *   npx tsx tests/benchmark/v2/webarena/bootstrapAuth.ts --site shopping \
 *     [--out tests/benchmark/v2/webarena/auth/shopping_state.json]
 */
import { mkdir, writeFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';
import { WEBARENA_SITE_ENV_VARS, type WebArenaSitePlaceholder } from './webarenaTypes';

/** Official accounts from upstream webarena/browser_env/env_config.py — not secrets of ours. */
const OFFICIAL_ACCOUNTS: Record<string, { username: string; password: string }> = {
  shopping: { username: 'emma.lopez@gmail.com', password: 'Password.123' },
  shopping_admin: { username: 'admin', password: 'admin1234' },
};

function readFlag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function siteBaseUrl(site: WebArenaSitePlaceholder): string {
  const envVar = WEBARENA_SITE_ENV_VARS[site];
  const value = process.env[envVar]?.trim();
  if (!value) throw new Error(`missing_site_url:${envVar}`);
  return value.replace(/\/$/, '');
}

async function main(): Promise<void> {
  const site = readFlag('site') ?? 'shopping';
  if (!(site in OFFICIAL_ACCOUNTS)) throw new Error(`unsupported_site:${site}`);
  const placeholder = `__${site.toUpperCase()}__` as WebArenaSitePlaceholder;
  const baseUrl = siteBaseUrl(placeholder);
  const account = OFFICIAL_ACCOUNTS[site];
  const outPath = readFlag('out') ?? join('tests', 'benchmark', 'v2', 'webarena', 'auth', `${site}_state.json`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  if (site === 'shopping') {
    await page.goto(`${baseUrl}/customer/account/login/`, { waitUntil: 'domcontentloaded' });
    await page.getByLabel('Email', { exact: true }).fill(account.username);
    await page.getByLabel('Password', { exact: true }).fill(account.password);
    await page.getByRole('button', { name: 'Sign In' }).click();
    // Magento redirects to the account page on success; wait for it to settle.
    await page.waitForLoadState('domcontentloaded');
  } else {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.getByPlaceholder('user name').fill(account.username);
    await page.getByPlaceholder('password').fill(account.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForLoadState('domcontentloaded');
  }

  await page.waitForTimeout(2000);
  const storageState = await context.storageState();
  await browser.close();

  // Sanity gate: an unauthenticated save would silently fail every require_login task.
  const hostname = new URL(baseUrl).hostname;
  const capturedSessionCookie = storageState.cookies.some(cookie =>
    hostname.endsWith(cookie.domain.replace(/^\./, '')),
  );
  if (!capturedSessionCookie) {
    console.warn(`Warning: no cookies captured for ${baseUrl} — verify the login actually succeeded.`);
  }

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(storageState, null, 2), 'utf8');
  try {
    await access(outPath);
  } catch {
    throw new Error(`storage_state_write_failed:${outPath}`);
  }
  console.log(`Storage state saved: ${outPath}`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
