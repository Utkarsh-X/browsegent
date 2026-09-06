import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

test('BROWSEGENT_STEALTH launches the hardened persistent context (UA, profile, webdriver surface)', async () => {
  const { BrowserSession } = await import('../../../src/v2/substrate/BrowserSession');
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bg-stealth-'));
  process.env.BROWSEGENT_STEALTH = '1';
  process.env.BROWSEGENT_STEALTH_PROFILE = profileDir;
  try {
    const session = new BrowserSession({ headed: false, viewport: { width: 1280, height: 720 } });
    await session.open('about:blank');
    const page = session.currentPage();
    const ua = await page.evaluate(() => navigator.userAgent);
    const webdriver = await page.evaluate(() => navigator.webdriver);
    assert.ok(!ua.includes('Headless'), `headless marker leaked into UA: ${ua}`);
    assert.equal(webdriver, false, 'navigator.webdriver must read false under stealth');
    assert.ok(fs.existsSync(profileDir), 'persistent profile directory created');
    await session.close();
  } finally {
    delete process.env.BROWSEGENT_STEALTH;
    delete process.env.BROWSEGENT_STEALTH_PROFILE;
    fs.rmSync(profileDir, { recursive: true, force: true });
  }
}, 30_000);

test('legacy launch (env unset) keeps the plain headless context', async () => {
  const { BrowserSession } = await import('../../../src/v2/substrate/BrowserSession');
  const previous = process.env.BROWSEGENT_STEALTH;
  delete process.env.BROWSEGENT_STEALTH;
  try {
    const session = new BrowserSession({ headed: false, viewport: { width: 1280, height: 720 } });
    await session.open('about:blank');
    const ua = await session.currentPage().evaluate(() => navigator.userAgent);
    assert.ok(ua.includes('Headless'), 'legacy path keeps stock headless UA');
    await session.close();
  } finally {
    if (previous !== undefined) process.env.BROWSEGENT_STEALTH = previous;
  }
}, 30_000);
