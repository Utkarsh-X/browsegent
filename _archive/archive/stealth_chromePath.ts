import fs from 'fs';

const CHROME_PATHS: Record<string, string[]> = {
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    (process.env['LOCALAPPDATA'] ?? '') + '\\Google\\Chrome\\Application\\chrome.exe',
  ],
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ],
  linux: [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/snap/bin/chromium',
  ],
};

export function findChromePath(): string {
  const paths = CHROME_PATHS[process.platform] ?? [];
  for (const p of paths) {
    try {
      if (p && fs.existsSync(p)) return p;
    } catch { /* skip */ }
  }
  throw new Error(
    `System Chrome not found. Install Chrome or set CHROME_PATH in .env.\n` +
    `Tried: ${paths.join(', ')}`
  );
}

export function getChromePath(): string {
  return process.env['CHROME_PATH'] || findChromePath();
}
