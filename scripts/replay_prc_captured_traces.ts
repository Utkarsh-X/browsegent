import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { getEncoding } from 'js-tiktoken';
import { PlannerRepresentationCompiler } from '../src/v2/planner/prc/PlannerRepresentationCompiler';
import { PromptLayoutEngine } from '../src/v2/planner/prc/PromptLayoutEngine';
import type { PlannerInput } from '../src/v2/planner/types';

interface EpisodeMetrics {
  file: string;
  taskId: string;
  episodeId: string;
  rawJsonBytes: number;
  rawJsonTokensCl100k: number;
  rawJsonTokensO200k: number;

  baselineBytes: number;
  baselineTokensCl100k: number;
  baselineTokensO200k: number;

  p1Bytes: number;
  p1TokensCl100k: number;
  p1TokensO200k: number;

  p1p3Bytes: number;
  p1p3TokensCl100k: number;
  p1p3TokensO200k: number;

  actionRefsTotal: number;
  actionRefsInBaseline: number;
  actionRefsInP1: number;
  actionRefsInP1P3: number;

  failureRefsTotal: number;
  failureRefsInP1P3: number;

  selectOptionsTotal: number;
  selectOptionsInP1P3: number;
}

function findPlannerInputFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      findPlannerInputFiles(fullPath, out);
    } else if (entry.endsWith('-input.json')) {
      out.push(fullPath);
    }
  }
  return out;
}

async function main() {
  console.log('Initializing tokenizers (cl100k_base, o200k_base)...');
  const encCl100k = getEncoding('cl100k_base');
  const encO200k = getEncoding('o200k_base');

  const traceDir = join(process.cwd(), 'logs', 'webvoyager-lite', 'webvoyager_lite_1787773616455', 'traces');
  console.log(`Scanning trace directory: ${traceDir}`);
  const files = findPlannerInputFiles(traceDir);
  console.log(`Found ${files.length} planner input trace files.\n`);

  if (files.length === 0) {
    console.error('No planner input files found.');
    process.exit(1);
  }

  const compiler = new PlannerRepresentationCompiler();
  const layout = new PromptLayoutEngine();
  const metrics: EpisodeMetrics[] = [];

  let skippedCount = 0;

  for (const file of files) {
    let rawContent: string;
    let parsed: unknown;
    try {
      rawContent = readFileSync(file, 'utf8');
      parsed = JSON.parse(rawContent);
    } catch (err) {
      console.warn(`Failed to parse ${file}:`, err);
      skippedCount++;
      continue;
    }

    const input = ((parsed as Record<string, unknown>).plannerInput ?? parsed) as PlannerInput;
    if (!input.goal || !input.current?.refs || !input.episodeId) {
      skippedCount++;
      continue;
    }

    const rawJsonStr = `Planner input JSON:\n${JSON.stringify(input)}`;
    const ir = compiler.compile(input);

    const baselineStr = `Planner input:\n${layout.render(ir, {})}`;
    const p1Str = `Planner input:\n${layout.render(ir, { prcTierOmitted: true })}`;
    const p1p3Str = `Planner input:\n${layout.render(ir, { prcTierOmitted: true, compactDataPlane: true })}`;

    // Calculate action ref coverage
    const actionRefs = new Set<string>();
    if (input.workingSet?.actionSurface) {
      const s = input.workingSet.actionSurface;
      for (const r of [...s.clickableRefs, ...s.typeableRefs, ...s.selectableRefs, ...s.readableRefs]) {
        actionRefs.add(r);
      }
    }

    let actionRefsInBaseline = 0;
    let actionRefsInP1 = 0;
    let actionRefsInP1P3 = 0;
    for (const r of actionRefs) {
      if (baselineStr.includes(r)) actionRefsInBaseline++;
      if (p1Str.includes(r)) actionRefsInP1++;
      if (p1p3Str.includes(r)) actionRefsInP1P3++;
    }

    // Failure refs
    const failureRefs = new Set<string>();
    for (const f of input.failures ?? []) {
      if (f.targetRef) failureRefs.add(f.targetRef);
    }
    let failureRefsInP1P3 = 0;
    for (const f of failureRefs) {
      if (p1p3Str.includes(f)) failureRefsInP1P3++;
    }

    // Select options
    let selectOptionsTotal = 0;
    let selectOptionsInP1P3 = 0;
    for (const ref of Object.values(input.current.refs)) {
      if (actionRefs.has(ref.refId) && ref.selectOptions?.length) {
        for (const opt of ref.selectOptions) {
          selectOptionsTotal++;
          if (p1p3Str.includes(opt)) selectOptionsInP1P3++;
        }
      }
    }

    metrics.push({
      file,
      taskId: file.split('traces\\')[1]?.split('\\')[0] ?? 'unknown',
      episodeId: input.episodeId,

      rawJsonBytes: Buffer.byteLength(rawJsonStr, 'utf8'),
      rawJsonTokensCl100k: encCl100k.encode(rawJsonStr).length,
      rawJsonTokensO200k: encO200k.encode(rawJsonStr).length,

      baselineBytes: Buffer.byteLength(baselineStr, 'utf8'),
      baselineTokensCl100k: encCl100k.encode(baselineStr).length,
      baselineTokensO200k: encO200k.encode(baselineStr).length,

      p1Bytes: Buffer.byteLength(p1Str, 'utf8'),
      p1TokensCl100k: encCl100k.encode(p1Str).length,
      p1TokensO200k: encO200k.encode(p1Str).length,

      p1p3Bytes: Buffer.byteLength(p1p3Str, 'utf8'),
      p1p3TokensCl100k: encCl100k.encode(p1p3Str).length,
      p1p3TokensO200k: encO200k.encode(p1p3Str).length,

      actionRefsTotal: actionRefs.size,
      actionRefsInBaseline,
      actionRefsInP1,
      actionRefsInP1P3,

      failureRefsTotal: failureRefs.size,
      failureRefsInP1P3,

      selectOptionsTotal,
      selectOptionsInP1P3,
    });
  }

  console.log(`Processed ${metrics.length} valid episodes (${skippedCount} skipped).\n`);

  // Compute Aggregates
  const totalEpisodes = metrics.length;
  const sum = (fn: (m: EpisodeMetrics) => number) => metrics.reduce((acc, m) => acc + fn(m), 0);
  const avg = (fn: (m: EpisodeMetrics) => number) => sum(fn) / totalEpisodes;

  const totalRawBytes = sum(m => m.rawJsonBytes);
  const totalRawTokensCl100k = sum(m => m.rawJsonTokensCl100k);
  const totalRawTokensO200k = sum(m => m.rawJsonTokensO200k);

  const totalBaseBytes = sum(m => m.baselineBytes);
  const totalBaseTokensCl100k = sum(m => m.baselineTokensCl100k);
  const totalBaseTokensO200k = sum(m => m.baselineTokensO200k);

  const totalP1Bytes = sum(m => m.p1Bytes);
  const totalP1TokensCl100k = sum(m => m.p1TokensCl100k);
  const totalP1TokensO200k = sum(m => m.p1TokensO200k);

  const totalP1P3Bytes = sum(m => m.p1p3Bytes);
  const totalP1P3TokensCl100k = sum(m => m.p1p3TokensCl100k);
  const totalP1P3TokensO200k = sum(m => m.p1p3TokensO200k);

  const totalActionRefs = sum(m => m.actionRefsTotal);
  const coveredBaseRefs = sum(m => m.actionRefsInBaseline);
  const coveredP1Refs = sum(m => m.actionRefsInP1);
  const coveredP1P3Refs = sum(m => m.actionRefsInP1P3);

  const totalFailureRefs = sum(m => m.failureRefsTotal);
  const coveredFailureRefs = sum(m => m.failureRefsInP1P3);

  const totalSelectOpts = sum(m => m.selectOptionsTotal);
  const coveredSelectOpts = sum(m => m.selectOptionsInP1P3);

  console.log('========================================================================================');
  console.log('                    OFFLINE TRACE REPLAY & PRC COMPRESSION AUDIT                        ');
  console.log('========================================================================================');
  console.log(`Total Episodes Evaluated: ${totalEpisodes}`);
  console.log('----------------------------------------------------------------------------------------');
  console.log('| Metric                     | Raw JSON     | Baseline PRC | P1 (Tier Drop) | P1+P3 (Compact)|');
  console.log('|----------------------------|--------------|--------------|----------------|----------------|');
  console.log(`| Total Bytes                | ${totalRawBytes.toLocaleString().padEnd(12)} | ${totalBaseBytes.toLocaleString().padEnd(12)} | ${totalP1Bytes.toLocaleString().padEnd(14)} | ${totalP1P3Bytes.toLocaleString().padEnd(14)} |`);
  console.log(`| Mean Bytes / Episode       | ${Math.round(avg(m => m.rawJsonBytes)).toLocaleString().padEnd(12)} | ${Math.round(avg(m => m.baselineBytes)).toLocaleString().padEnd(12)} | ${Math.round(avg(m => m.p1Bytes)).toLocaleString().padEnd(14)} | ${Math.round(avg(m => m.p1p3Bytes)).toLocaleString().padEnd(14)} |`);
  console.log(`| Byte Reduction vs Baseline | ${(((totalRawBytes - totalBaseBytes) / totalRawBytes) * 100).toFixed(1)}% bloated| 0.0% (Base)  | ${(((totalBaseBytes - totalP1Bytes) / totalBaseBytes) * 100).toFixed(1)}% reduction   | ${(((totalBaseBytes - totalP1P3Bytes) / totalBaseBytes) * 100).toFixed(1)}% reduction   |`);
  console.log('|----------------------------|--------------|--------------|----------------|----------------|');
  console.log(`| Total Tokens (cl100k_base) | ${totalRawTokensCl100k.toLocaleString().padEnd(12)} | ${totalBaseTokensCl100k.toLocaleString().padEnd(12)} | ${totalP1TokensCl100k.toLocaleString().padEnd(14)} | ${totalP1P3TokensCl100k.toLocaleString().padEnd(14)} |`);
  console.log(`| Mean Tokens (cl100k_base)  | ${Math.round(avg(m => m.rawJsonTokensCl100k)).toLocaleString().padEnd(12)} | ${Math.round(avg(m => m.baselineTokensCl100k)).toLocaleString().padEnd(12)} | ${Math.round(avg(m => m.p1TokensCl100k)).toLocaleString().padEnd(14)} | ${Math.round(avg(m => m.p1p3TokensCl100k)).toLocaleString().padEnd(14)} |`);
  console.log(`| Token Red. vs Baseline     | ${(((totalRawTokensCl100k - totalBaseTokensCl100k) / totalRawTokensCl100k) * 100).toFixed(1)}% bloated| 0.0% (Base)  | ${(((totalBaseTokensCl100k - totalP1TokensCl100k) / totalBaseTokensCl100k) * 100).toFixed(1)}% reduction   | ${(((totalBaseTokensCl100k - totalP1P3TokensCl100k) / totalBaseTokensCl100k) * 100).toFixed(1)}% reduction   |`);
  console.log('|----------------------------|--------------|--------------|----------------|----------------|');
  console.log(`| Total Tokens (o200k_base)  | ${totalRawTokensO200k.toLocaleString().padEnd(12)} | ${totalBaseTokensO200k.toLocaleString().padEnd(12)} | ${totalP1TokensO200k.toLocaleString().padEnd(14)} | ${totalP1P3TokensO200k.toLocaleString().padEnd(14)} |`);
  console.log(`| Mean Tokens (o200k_base)   | ${Math.round(avg(m => m.rawJsonTokensO200k)).toLocaleString().padEnd(12)} | ${Math.round(avg(m => m.baselineTokensO200k)).toLocaleString().padEnd(12)} | ${Math.round(avg(m => m.p1TokensO200k)).toLocaleString().padEnd(14)} | ${Math.round(avg(m => m.p1p3TokensO200k)).toLocaleString().padEnd(14)} |`);
  console.log('|========================================================================================|');
  console.log('                                 INVARIANCE & INTEGRITY GATES                            ');
  console.log('|----------------------------------------------------------------------------------------|');
  console.log(`| Action Ref Coverage Rate (Baseline): ${coveredBaseRefs}/${totalActionRefs} (${((coveredBaseRefs / totalActionRefs) * 100).toFixed(2)}%)`);
  console.log(`| Action Ref Coverage Rate (P1):       ${coveredP1Refs}/${totalActionRefs} (${((coveredP1Refs / totalActionRefs) * 100).toFixed(2)}%)`);
  console.log(`| Action Ref Coverage Rate (P1+P3):    ${coveredP1P3Refs}/${totalActionRefs} (${((coveredP1P3Refs / totalActionRefs) * 100).toFixed(2)}%)`);
  console.log(`| Failure Target Preservation:         ${coveredFailureRefs}/${totalFailureRefs} (${totalFailureRefs ? ((coveredFailureRefs / totalFailureRefs) * 100).toFixed(2) : 100}%)`);
  console.log(`| Select Option Preservation:          ${coveredSelectOpts}/${totalSelectOpts} (${totalSelectOpts ? ((coveredSelectOpts / totalSelectOpts) * 100).toFixed(2) : 100}%)`);
  console.log('========================================================================================\n');
}

main().catch(err => {
  console.error('Replay failed:', err);
  process.exit(1);
});
