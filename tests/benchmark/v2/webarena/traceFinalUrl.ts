import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Reads one run's trace observations and returns the URL of the latest one —
 * the episode's final page, which official url_match / program_html checks are
 * defined against. Unreadable or missing traces yield undefined so scoring can
 * still proceed for answer-only eval types.
 */
export async function extractFinalUrl(traceDir: string, runId: string): Promise<string | undefined> {
  const observationsDir = join(traceDir, runId, 'observations');
  let entries: string[];
  try {
    entries = await readdir(observationsDir);
  } catch {
    return undefined;
  }
  let best: { timestamp: number; url: string } | undefined;
  for (const name of entries.filter(file => file.endsWith('.json'))) {
    try {
      const observation = JSON.parse(await readFile(join(observationsDir, name), 'utf8')) as {
        url?: string;
        timestamp?: number;
      };
      if (typeof observation.url !== 'string' || !observation.url) continue;
      const timestamp = typeof observation.timestamp === 'number' ? observation.timestamp : 0;
      if (!best || timestamp >= best.timestamp) best = { timestamp, url: observation.url };
    } catch {
      // Unreadable observation files never contribute a final URL.
    }
  }
  return best?.url;
}
