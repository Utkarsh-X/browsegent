import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

test('BROWSEGENT_STEALTH launches the hardened persistent context (UA, profile, webdriver surface)', { timeout: 30_000 }, async () => {
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
});

test('legacy launch (env unset) keeps the plain headless context', { timeout: 30_000 }, async () => {
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
});

test('BROWSEGENT_STEALTH reuse path: second open() on the same session yields a live page', { timeout: 45_000 }, async () => {
  // Regression: the committed T1 reuse path used this.page! after setting it to
  // undefined, so any second open() (in-task navigate) crashed and mid-task
  // navigations could not work under stealth.
  const { BrowserSession } = await import('../../../src/v2/substrate/BrowserSession');
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bg-stealth-reuse-'));
  process.env.BROWSEGENT_STEALTH = '1';
  process.env.BROWSEGENT_STEALTH_PROFILE = profileDir;
  try {
    const session = new BrowserSession({ headed: false, viewport: { width: 1280, height: 720 } });
    await session.open('about:blank');
    const firstPage = session.currentPage();
    await session.open('about:blank#second');
    const secondPage = session.currentPage();
    assert.notEqual(secondPage, firstPage, 'reuse path must acquire a fresh page');
    assert.ok(!secondPage.isClosed(), 'reuse path must produce a live page');
    const url = secondPage.url();
    assert.ok(url.startsWith('about:blank'), `second open navigated, got ${url}`);
    await session.close();
  } finally {
    delete process.env.BROWSEGENT_STEALTH;
    delete process.env.BROWSEGENT_STEALTH_PROFILE;
    fs.rmSync(profileDir, { recursive: true, force: true });
  }
});
