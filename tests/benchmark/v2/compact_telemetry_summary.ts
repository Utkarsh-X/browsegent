import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';

interface CompactArtifact {
  episodeId?: string;
  stats?: {
    originalBytes?: number;
    compactBytes?: number;
    baselineBytes?: number;
    reductionRatio?: number;
    baselineRatio?: number;
  };
  coverage?: {
    actionRefCoverage?: number;
    missingPlannedActionRefs?: string[];
  };
}

async function findTraceFiles(root: string): Promise<string[]> {
  const output: string[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(path);
      } else if (entry.isFile() && entry.name === 'trace.json') {
        output.push(path);
      }
    }
  }
  await walk(root);
  return output;
}

async function main(): Promise<void> {
  const root = resolve(process.argv[2] ?? 'logs');
  const traceFiles = await findTraceFiles(root);
  const artifacts: CompactArtifact[] = [];

  for (const traceFile of traceFiles) {
    const trace = JSON.parse(await readFile(traceFile, 'utf8')) as {
      artifacts?: {
        trace?: { path: string };
        compactPlannerViews?: Array<{ path: string }>;
      };
    };
    for (const artifact of trace.artifacts?.compactPlannerViews ?? []) {
      let artifactPath = artifact.path;
      const originalTracePath = trace.artifacts?.trace?.path;
      if (originalTracePath) {
        const originalRunRoot = dirname(originalTracePath);
        const relPath = relative(originalRunRoot, artifactPath);
        artifactPath = resolve(dirname(traceFile), relPath);
      }
      artifacts.push(JSON.parse(await readFile(artifactPath, 'utf8')) as CompactArtifact);
    }
  }

  const validRatios = artifacts
    .map((artifact) => artifact.stats?.reductionRatio)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const validBaselineRatios = artifacts
    .map((artifact) => artifact.stats?.baselineRatio)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const validCoverage = artifacts
    .map((artifact) => artifact.coverage?.actionRefCoverage)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const missingActionRefs = artifacts.flatMap((artifact) => artifact.coverage?.missingPlannedActionRefs ?? []);
  const worstRatios = [...artifacts]
    .filter((artifact) => typeof artifact.stats?.reductionRatio === 'number')
    .sort((a, b) => (b.stats?.reductionRatio ?? 0) - (a.stats?.reductionRatio ?? 0))
    .slice(0, 5);

  const average = (values: number[]) => values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;

  console.log(JSON.stringify({
    root,
    traceCount: traceFiles.length,
    compactArtifactCount: artifacts.length,
    averageCompactCurrentRatio: Number(average(validRatios).toFixed(4)),
    averagePlainBaselineCurrentRatio: Number(average(validBaselineRatios).toFixed(4)),
    averageActionRefCoverage: Number(average(validCoverage).toFixed(4)),
    missingPlannedActionRefCount: missingActionRefs.length,
    worstRatios: worstRatios.map((artifact) => ({
      episodeId: artifact.episodeId,
      reductionRatio: artifact.stats?.reductionRatio,
      originalBytes: artifact.stats?.originalBytes,
      compactBytes: artifact.stats?.compactBytes,
    })),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
