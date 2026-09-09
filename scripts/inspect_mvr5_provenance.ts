import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ProjectionService } from '../src/v2/brain1/ProjectionService';
import { buildTaskEvidenceCoverage, type TaskEvidenceRead } from '../src/v2/agent/TaskEvidenceCoverage';
import type { BrowserObservation } from '../src/v2/runtime/types';
import type { OperationalProjection } from '../src/v2/brain1/projectionTypes';

interface TaskTraceConfig {
  name: string;
  dirName: string;
  goal: string;
}

const MVR5_TASKS: TaskTraceConfig[] = [
  {
    name: 'Cambridge Dictionary--0',
    dirName: 'webvoyager_lite_1787773616455_webvoyager_Cambridge__Dictionary__0_a1',
    goal: 'Find the Cambridge definition and pronunciation for serendipity',
  },
  {
    name: 'ArXiv--0',
    dirName: 'webvoyager_lite_1787773616455_webvoyager_ArXiv__0_a1',
    goal: 'Find latest preprints about quantum computing on arXiv and report the top results',
  },
  {
    name: 'GitHub--0',
    dirName: 'webvoyager_lite_1787773616455_webvoyager_GitHub__0_a1',
    goal: 'Find trending TypeScript repositories on GitHub and note top stars',
  },
  {
    name: 'Google Map--10',
    dirName: 'webvoyager_lite_1787773616455_webvoyager_Google__Map__10_a1',
    goal: 'Find basic information for Castle Mountains National Monument on Google Maps',
  },
  {
    name: 'Wolfram Alpha--0',
    dirName: 'webvoyager_lite_1787773616455_webvoyager_Wolfram__Alpha__0_a1',
    goal: 'Calculate the derivative of x^3 * sin(x) on Wolfram Alpha',
  },
];

function extractSurfaceEvidence(projection: OperationalProjection, observationId: string): TaskEvidenceRead[] {
  const seenRefs = new Set<string>();
  const surfaceReads: TaskEvidenceRead[] = [];

  for (const item of [
    ...(projection.readables ?? []),
    ...(projection.interactions ?? []),
    ...(projection.navigation ?? []),
  ]) {
    if (seenRefs.has(item.refId)) continue;
    seenRefs.add(item.refId);

    if (item.visibility !== 'visible') continue;
    const text = [item.name, item.text].filter(Boolean).join(' ').trim();
    if (!text) continue;

    surfaceReads.push({
      kind: 'surface_observation',
      sourceKind: 'surface_observation',
      observationId,
      targetRef: item.refId,
      refIds: [item.refId],
      text,
    });
  }

  return surfaceReads;
}

async function main() {
  const projectionService = new ProjectionService();
  const baseTracesDir = join(process.cwd(), 'logs', 'webvoyager-lite', 'webvoyager_lite_1787773616455', 'traces');

  console.log('========================================================================================');
  console.log('                 MVR5-STABLE PROVENANCE TELEMETRY & COVERAGE AUDIT                      ');
  console.log('========================================================================================\n');

  for (const task of MVR5_TASKS) {
    const traceDir = join(baseTracesDir, task.dirName);
    if (!existsSync(traceDir)) {
      console.warn(`Skipping ${task.name}: trace dir not found at ${traceDir}`);
      continue;
    }

    const tracePath = join(traceDir, 'trace.json');
    if (!existsSync(tracePath)) {
      console.warn(`Skipping ${task.name}: trace.json not found`);
      continue;
    }

    const trace = JSON.parse(readFileSync(tracePath, 'utf8'));
    const observationArtifacts = trace.artifacts?.observations ?? [];
    if (observationArtifacts.length === 0) {
      console.warn(`No observations for ${task.name}`);
      continue;
    }

    const finalObsArtifact = observationArtifacts[observationArtifacts.length - 1];
    const finalObsPath = finalObsArtifact.path;
    const observation: BrowserObservation = JSON.parse(readFileSync(finalObsPath, 'utf8'));

    const projection = projectionService.project(observation);
    const surfaceEvidence = extractSurfaceEvidence(projection, observation.observationId);
    const toolReads: TaskEvidenceRead[] = [];

    const coverage = buildTaskEvidenceCoverage(task.goal, toolReads, surfaceEvidence);

    console.log(`Task: ${task.name}`);
    console.log(`  Observation ID:        ${observation.observationId}`);
    console.log(`  Surface Evidence Count:${surfaceEvidence.length}`);
    console.log(`  Tool Read Count:       ${toolReads.length}`);
    console.log(`  Coverage ContractKind: ${coverage.contractKind}`);
    console.log(`  Coverage Status:       ${coverage.status}`);
    console.log(`  Requirements:`);
    for (const req of coverage.requirements) {
      console.log(`    - ${req.key}: ${req.status} (supporting reads: ${req.supportingReadIndexes.length})`);
      if (req.supportingReadIndexes.length > 0) {
        for (const idx of req.supportingReadIndexes.slice(0, 2)) {
          const item = surfaceEvidence[idx];
          console.log(`        Ref: ${item.targetRef} | Text: "${item.text.slice(0, 70)}..."`);
        }
      }
    }
    console.log('----------------------------------------------------------------------------------------');
  }
}

main().catch(console.error);
