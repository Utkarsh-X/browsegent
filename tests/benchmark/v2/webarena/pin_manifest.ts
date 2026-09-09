import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { WebArenaTaskConfig } from './webarenaTypes';

/**
 * Pins WebArena task manifests from the OFFICIAL dataset — never hand-edited.
 *
 * Selection is deterministic: stable sort by task_id within strata, fixed per-site
 * quotas, recorded source provenance. Variants (pilot5/smoke20/core50/scaffold100)
 * are nested subsets of one ordering so numbers stay comparable across stages.
 *
 * Usage:
 *   npx tsx tests/benchmark/v2/webarena/pin_manifest.ts --source <path-to-test.raw.json> \
 *     [--site shopping=12 --site reddit=10 ... ] --out <manifest-path>
 */

interface PinOptions {
  sourcePath: string;
  outPath: string;
  /** Per-site quotas applied in order; sites absent from the dataset are reported. */
  quotas: Array<{ site: string; count: number }>;
}

const SITE_QUOTA_PRESETS: Record<string, Array<{ site: string; count: number }>> = {
  pilot5: [{ site: 'shopping', count: 5 }],
  smoke20: [
    { site: 'shopping', count: 5 },
    { site: 'reddit', count: 4 },
    { site: 'gitlab', count: 4 },
    { site: 'shopping_admin', count: 3 },
    { site: 'map', count: 2 },
    { site: 'wikipedia', count: 2 },
  ],
  // Headline benchmark subset (~design-doc commitment). Weighted toward sites
  // with rich interaction/state-mutation surfaces.
  core50: [
    { site: 'shopping', count: 12 },
    { site: 'reddit', count: 10 },
    { site: 'gitlab', count: 10 },
    { site: 'shopping_admin', count: 6 },
    { site: 'map', count: 6 },
    { site: 'wikipedia', count: 6 },
  ],
  scaffold100: [
    { site: 'shopping', count: 22 },
    { site: 'reddit', count: 18 },
    { site: 'gitlab', count: 18 },
    { site: 'shopping_admin', count: 14 },
    { site: 'map', count: 14 },
    { site: 'wikipedia', count: 14 },
  ],
};

function readFlag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const presetName = readFlag('preset') ?? 'core50';
  const preset = SITE_QUOTA_PRESETS[presetName];
  if (!preset) throw new Error(`unknown_preset:${presetName}`);
  const options: PinOptions = {
    sourcePath: readFlag('source') ?? 'test.raw.json',
    outPath: readFlag('out') ?? `tests/benchmark/v2/webarena/manifests/webarena_${presetName}.json`,
    quotas: preset,
  };

  const sourceBytes = await readFile(options.sourcePath);
  const all = JSON.parse(sourceBytes.toString('utf8')) as WebArenaTaskConfig[];
  const picked: WebArenaTaskConfig[] = [];
  const shortfalls: string[] = [];

  for (const { site, count } of options.quotas) {
    // Deterministic in-stratum ordering with template diversity: prefer distinct
    // intent_template_id values before falling back to repeats, then by task_id.
    const pool = all.filter(config => config.sites.includes(site));
    const seenTemplates = new Set<number>();
    const primary: typeof pool = [];
    const secondary: typeof pool = [];
    for (const config of pool.sort((left, right) => left.task_id - right.task_id)) {
      if (!seenTemplates.has(config.intent_template_id)) {
        seenTemplates.add(config.intent_template_id);
        primary.push(config);
      } else {
        secondary.push(config);
      }
    }
    const selection = [...primary, ...secondary].slice(0, count);
    if (selection.length < count) {
      shortfalls.push(`${site}:${selection.length}/${count}`);
    }
    picked.push(...selection);
  }

  const manifest = {
    version: 1,
    preset: presetName,
    pinnedAt: new Date().toISOString(),
    source: {
      file: options.sourcePath,
      sha256: createHash('sha256').update(sourceBytes).digest('hex'),
      totalTasks: all.length,
    },
    counts: Object.fromEntries(options.quotas.map(({ site }) => [site, picked.filter(c => c.sites.includes(site)).length])),
    shortfalls,
    tasks: picked,
  };
  await mkdir(dirname(options.outPath), { recursive: true });
  await writeFile(options.outPath, JSON.stringify(manifest, null, 2));
  console.log(`Pinned ${picked.length} tasks (${presetName}) -> ${options.outPath}`);
  if (shortfalls.length > 0) console.warn(`Shortfall warning: ${shortfalls.join(', ')}`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
