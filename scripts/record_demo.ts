import { spawnSync } from 'node:child_process';

console.log('Starting BrowseGent demo. Start your screen recorder before continuing.');
console.log('Task: flipkart_pagination - multi-step product price extraction with pagination.');

const result = spawnSync(
  process.platform === 'win32' ? 'npm.cmd' : 'npm',
  ['run', 'eval', '--', '--task', 'flipkart_pagination'],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      EVAL_HEADLESS: 'false',
      PHASE6_HEADLESS: 'false',
    },
  },
);

process.exit(result.status ?? 1);
