import type { WebVoyagerBenchmarkSlice, WebVoyagerTaskRegistryEntry, WebVoyagerTaskStatus } from './types';

export const BROWSER_USE_IMPOSSIBLE_TASK_IDS = new Set([
  'Allrecipes--16', 'Allrecipes--19', 'Allrecipes--23', 'Allrecipes--3', 'Allrecipes--30', 'Allrecipes--7',
  'Amazon--16', 'Amazon--19', 'Amazon--4',
  'Apple--1', 'Apple--14', 'Apple--16', 'Apple--2', 'Apple--20', 'Apple--37', 'Apple--41', 'Apple--42', 'Apple--7', 'Apple--9',
  'ArXiv--11',
  'BBC News--14', 'BBC News--16', 'BBC News--18', 'BBC News--2', 'BBC News--21', 'BBC News--33', 'BBC News--37',
  'Booking--11', 'Booking--13', 'Booking--14', 'Booking--6',
  'Coursera--17', 'Coursera--28',
  'ESPN--19', 'ESPN--2', 'ESPN--21', 'ESPN--26',
  'GitHub--22',
  'Google Flights--0', 'Google Flights--20', 'Google Flights--7',
  'Google Map--13', 'Google Map--18', 'Google Map--26',
  'Google Search--15', 'Google Search--16', 'Google Search--22',
  'Huggingface--1', 'Huggingface--10', 'Huggingface--20', 'Huggingface--21', 'Huggingface--22', 'Huggingface--23', 'Huggingface--32', 'Huggingface--6',
]);

export const WEBVOYAGER_TASK_REGISTRY_OVERRIDES: Record<string, WebVoyagerTaskRegistryEntry> = {
  'Allrecipes--3': {
    id: 'Allrecipes--3',
    status: 'impossible',
    source: 'browser_use_eval',
    reason: 'Listed as impossible in browser-use/eval and repeatedly reaches Cloudflare/captcha in local runs.',
  },
  'Google Flights--0': {
    id: 'Google Flights--0',
    status: 'impossible',
    source: 'browser_use_eval',
    reason: 'Listed as impossible in browser-use/eval; date-sensitive travel task is unsuitable for stable smoke slice.',
  },
};

export const WEBVOYAGER_STABLE_SLICES: Record<WebVoyagerBenchmarkSlice, readonly string[]> = {
  mvr5: ['Allrecipes--3', 'ArXiv--0', 'GitHub--0', 'Google Map--10', 'Wolfram Alpha--0'],
  'mvr5-stable': ['Cambridge Dictionary--0', 'ArXiv--0', 'GitHub--0', 'Google Map--10', 'Wolfram Alpha--0'],
  balanced30: [
    'Allrecipes--3', 'Allrecipes--10', 'Amazon--0', 'Amazon--10', 'Apple--0', 'Apple--10',
    'ArXiv--0', 'ArXiv--10', 'BBC News--0', 'BBC News--10', 'Booking--0', 'Booking--10',
    'Cambridge Dictionary--0', 'Cambridge Dictionary--10', 'Coursera--0', 'Coursera--10',
    'ESPN--0', 'ESPN--10', 'GitHub--0', 'GitHub--10', 'Google Flights--0', 'Google Flights--10',
    'Google Map--0', 'Google Map--10', 'Google Search--0', 'Google Search--10',
    'Huggingface--0', 'Huggingface--10', 'Wolfram Alpha--0', 'Wolfram Alpha--10',
  ],
};

export function getWebVoyagerTaskStatus(taskId: string): WebVoyagerTaskStatus {
  const override = WEBVOYAGER_TASK_REGISTRY_OVERRIDES[taskId];
  if (override) return override.status;
  if (BROWSER_USE_IMPOSSIBLE_TASK_IDS.has(taskId)) return 'impossible';
  return 'valid';
}

export function assertStableSliceContainsNoImpossibleTasks(slice: WebVoyagerBenchmarkSlice): void {
  const taskIds = WEBVOYAGER_STABLE_SLICES[slice];
  const impossible = taskIds.filter(taskId => getWebVoyagerTaskStatus(taskId) === 'impossible');
  if (impossible.length > 0 && slice.endsWith('stable')) {
    throw new Error(`Stable WebVoyager slice ${slice} contains impossible tasks: ${impossible.join(', ')}`);
  }
}
