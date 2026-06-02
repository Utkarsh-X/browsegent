import { BrowserUseLocalAdapter } from './adapters/BrowserUseLocalAdapter';
import { BrowseGentBenchmarkAdapter } from './adapters/BrowseGentAdapter';
import type { BenchmarkAdapter } from './types';

export type BenchmarkAdapterId = 'browsegent' | 'browser-use-local';

export interface CreateBenchmarkAdapterOptions {
  env?: NodeJS.ProcessEnv;
}

export function createBenchmarkAdapter(
  adapterId: BenchmarkAdapterId = 'browsegent',
  options: CreateBenchmarkAdapterOptions = {},
): BenchmarkAdapter {
  switch (adapterId) {
    case 'browsegent':
      return new BrowseGentBenchmarkAdapter();
    case 'browser-use-local':
      return new BrowserUseLocalAdapter({ env: options.env });
  }
}

export function readBenchmarkAdapterId(value: string | undefined): BenchmarkAdapterId {
  if (value === undefined || value === 'browsegent' || value === 'browser-use-local') {
    return value ?? 'browsegent';
  }
  throw new Error(`Unsupported benchmark adapter "${value}". Use browsegent or browser-use-local.`);
}
