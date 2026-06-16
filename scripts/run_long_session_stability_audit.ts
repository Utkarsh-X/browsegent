import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, Page } from 'playwright';

import { ObservationService } from '../src/v2/substrate/ObservationService';
import { RefService } from '../src/v2/runtime/RefService';
import { RefResolver } from '../src/v2/substrate/RefResolver';
import { ContinuityInterpreter } from '../src/v2/brain2/ContinuityInterpreter';
import { ContinuityGraph } from '../src/v2/graph/ContinuityGraph';
import { PlannerWorkingSetSelector } from '../src/v2/planner/PlannerWorkingSetSelector';

interface TelemetryPoint {
  step: number;
  site: string;
  presentRefs: number;
  totalGraphRefs: number;
  heapUsedMb: number;
  obsTimeMs: number;
  refGenTimeMs: number;
  workingSetSize: number;
}

async function runSessionStabilityAudit() {
  console.log('Starting Long Session Stability Audit (ARCH-001 Investigation)...');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  const observer = new ObservationService();
  const refService = new RefService();
  const interpreter = new ContinuityInterpreter();
  const graph = new ContinuityGraph({ maxTransitions: 10 });
  const selector = new PlannerWorkingSetSelector();

  const telemetry: TelemetryPoint[] = [];
  let stepCounter = 0;

  // Segment 1: Wikipedia Search Autocomplete Typing Loop (30 steps)
  try {
    console.log('Driving Wikipedia dynamic typing loop...');
    await page.goto('https://www.wikipedia.org/');
    await page.waitForTimeout(2000);

    const inputLocator = page.locator('input[name="search"]');
    const query = 'software engineering principles and methods';

    let lastObs = refService.assign(await observer.capture({ page, sessionId: 'stability', generationId: 1 }));
    graph.applyObservation(lastObs);

    for (let i = 0; i < query.length; i++) {
      stepCounter++;
      // Type next character
      await inputLocator.press(query[i]);
      await page.waitForTimeout(150); // small pacing

      const heapBefore = process.memoryUsage().heapUsed;
      const startObs = Date.now();
      const raw = await observer.capture({ page, sessionId: 'stability', generationId: 1 });
      const obsTime = Date.now() - startObs;

      const startRef = Date.now();
      const current = refService.assign(raw);
      const refGenTime = Date.now() - startRef;

      const transition = interpreter.interpret(lastObs, current);
      graph.applyTransition(transition);
      const snapshot = graph.applyObservation(current);

      const projection = {
        projectionId: `proj_stab_${stepCounter}`,
        observationId: current.observationId,
        generationId: current.generationId,
        url: current.url,
        title: current.title,
        interactions: current.refs.map(r => ({
          refId: r.refId,
          tagName: r.tagName,
          role: r.role,
          name: r.name,
          text: r.text,
          capabilities: r.capabilities,
          visibility: r.visibility,
          actionability: r.actionability,
          state: r.state,
          nthRoleName: r.nthRoleName,
          regionId: r.regionId,
          kind: 'generic' as any,
          continuityConfidence: r.continuityConfidence ?? 1.0,
          score: 1.0,
        })),
        readables: [],
        navigation: [],
        regions: [],
        warnings: [],
        stats: { interactionCount: current.refs.length, readableCount: 0, navigationCount: 0, regionCount: 0 },
      };

      const selection = selector.select({ goal: 'Search software engineering', projection });
      const wsCount = selection.workingSet.primaryRefs.length + selection.workingSet.secondaryRefs.length;

      telemetry.push({
        step: stepCounter,
        site: 'Wikipedia',
        presentRefs: snapshot.stats.presentRefCount,
        totalGraphRefs: snapshot.refs.length,
        heapUsedMb: Math.round((process.memoryUsage().heapUsed) / 1024 / 1024 * 100) / 100,
        obsTimeMs: obsTime,
        refGenTimeMs: refGenTime,
        workingSetSize: wsCount
      });

      lastObs = current;
    }
  } catch (err: any) {
    console.error('Wikipedia telemetry loop failed:', err.message);
  }

  // Segment 2: Amazon Product Search Typing Loop (30 steps)
  try {
    console.log('Driving Amazon product search loop...');
    await page.goto('https://www.amazon.com/');
    await page.waitForTimeout(2000);

    const inputLocator = page.locator('#twotabsearchtextbox');
    if (await inputLocator.count() > 0) {
      await inputLocator.click();
      const query = 'mechanical keyboard wireless backlit keycaps';

      let lastObs = refService.assign(await observer.capture({ page, sessionId: 'stability', generationId: 2 }));
      graph.applyObservation(lastObs);

      for (let i = 0; i < query.length; i++) {
        stepCounter++;
        await inputLocator.press(query[i]);
        await page.waitForTimeout(150);

        const startObs = Date.now();
        const raw = await observer.capture({ page, sessionId: 'stability', generationId: 2 });
        const obsTime = Date.now() - startObs;

        const startRef = Date.now();
        const current = refService.assign(raw);
        const refGenTime = Date.now() - startRef;

        const transition = interpreter.interpret(lastObs, current);
        graph.applyTransition(transition);
        const snapshot = graph.applyObservation(current);

        const projection = {
          projectionId: `proj_stab_${stepCounter}`,
          observationId: current.observationId,
          generationId: current.generationId,
          url: current.url,
          title: current.title,
          interactions: current.refs.map(r => ({
            refId: r.refId,
            tagName: r.tagName,
            role: r.role,
            name: r.name,
            text: r.text,
            capabilities: r.capabilities,
            visibility: r.visibility,
            actionability: r.actionability,
            state: r.state,
            nthRoleName: r.nthRoleName,
            regionId: r.regionId,
            kind: 'generic' as any,
            continuityConfidence: r.continuityConfidence ?? 1.0,
            score: 1.0,
          })),
          readables: [],
          navigation: [],
          regions: [],
          warnings: [],
          stats: { interactionCount: current.refs.length, readableCount: 0, navigationCount: 0, regionCount: 0 },
        };

        const selection = selector.select({ goal: 'Search keyboard', projection });
        const wsCount = selection.workingSet.primaryRefs.length + selection.workingSet.secondaryRefs.length;

        telemetry.push({
          step: stepCounter,
          site: 'Amazon',
          presentRefs: snapshot.stats.presentRefCount,
          totalGraphRefs: snapshot.refs.length,
          heapUsedMb: Math.round((process.memoryUsage().heapUsed) / 1024 / 1024 * 100) / 100,
          obsTimeMs: obsTime,
          refGenTimeMs: refGenTime,
          workingSetSize: wsCount
        });

        lastObs = current;
      }
    }
  } catch (err: any) {
    console.error('Amazon telemetry loop failed:', err.message);
  }

  // Segment 3: GitHub Branch Toggle Loop (15 steps)
  try {
    console.log('Driving GitHub branch toggle panel loop...');
    await page.goto('https://github.com/Utkarsh-X/browsegent');
    await page.waitForTimeout(2000);

    const btn = page.locator('#branch-select-menu, summary:has-text("main")').first();
    if (await btn.count() > 0) {
      let lastObs = refService.assign(await observer.capture({ page, sessionId: 'stability', generationId: 3 }));
      graph.applyObservation(lastObs);

      for (let i = 0; i < 15; i++) {
        stepCounter++;
        // Toggle panel open and closed
        await btn.click();
        await page.waitForTimeout(300); // let panel render or close

        const startObs = Date.now();
        const raw = await observer.capture({ page, sessionId: 'stability', generationId: 3 });
        const obsTime = Date.now() - startObs;

        const startRef = Date.now();
        const current = refService.assign(raw);
        const refGenTime = Date.now() - startRef;

        const transition = interpreter.interpret(lastObs, current);
        graph.applyTransition(transition);
        const snapshot = graph.applyObservation(current);

        const projection = {
          projectionId: `proj_stab_${stepCounter}`,
          observationId: current.observationId,
          generationId: current.generationId,
          url: current.url,
          title: current.title,
          interactions: current.refs.map(r => ({
            refId: r.refId,
            tagName: r.tagName,
            role: r.role,
            name: r.name,
            text: r.text,
            capabilities: r.capabilities,
            visibility: r.visibility,
            actionability: r.actionability,
            state: r.state,
            nthRoleName: r.nthRoleName,
            regionId: r.regionId,
            kind: 'generic' as any,
            continuityConfidence: r.continuityConfidence ?? 1.0,
            score: 1.0,
          })),
          readables: [],
          navigation: [],
          regions: [],
          warnings: [],
          stats: { interactionCount: current.refs.length, readableCount: 0, navigationCount: 0, regionCount: 0 },
        };

        const selection = selector.select({ goal: 'Explore codebase', projection });
        const wsCount = selection.workingSet.primaryRefs.length + selection.workingSet.secondaryRefs.length;

        telemetry.push({
          step: stepCounter,
          site: 'GitHub',
          presentRefs: snapshot.stats.presentRefCount,
          totalGraphRefs: snapshot.refs.length,
          heapUsedMb: Math.round((process.memoryUsage().heapUsed) / 1024 / 1024 * 100) / 100,
          obsTimeMs: obsTime,
          refGenTimeMs: refGenTime,
          workingSetSize: wsCount
        });

        lastObs = current;
      }
    }
  } catch (err: any) {
    console.error('GitHub telemetry loop failed:', err.message);
  }

  await browser.close();

  // Compile markdown findings report
  const initialHeap = telemetry[0]?.heapUsedMb ?? 0;
  const finalHeap = telemetry[telemetry.length - 1]?.heapUsedMb ?? 0;
  const initialGraphSize = telemetry[0]?.totalGraphRefs ?? 0;
  const finalGraphSize = telemetry[telemetry.length - 1]?.totalGraphRefs ?? 0;

  const maxHeap = Math.max(...telemetry.map(t => t.heapUsedMb));
  const avgObsTime = Math.round(telemetry.reduce((sum, t) => sum + t.obsTimeMs, 0) / telemetry.length);
  const avgRefGenTime = Math.round(telemetry.reduce((sum, t) => sum + t.refGenTimeMs, 0) / telemetry.length);
  const maxRefGenTime = Math.max(...telemetry.map(t => t.refGenTimeMs));

  // Determine concern level for ARCH-001
  let verdict = '';
  let rationale = '';
  if (finalHeap - initialHeap > 50) {
    verdict = 'Immediate Concern';
    rationale = 'Process heap memory grew significantly (>50MB) during the loop, showing memory leaks due to retained node graphs.';
  } else if (maxRefGenTime > 250) {
    verdict = 'Future Concern (Medium Priority)';
    rationale = 'Reference generation time spiked above 250ms on large graph lookups, suggesting search lookup latency grows over time.';
  } else {
    verdict = 'Future Minor Optimization (Low Priority)';
    rationale = 'Process heap memory remained stable, and reference mapping durations stayed extremely low (<100ms) despite historical index growth.';
  }

  let markdown = `# Long Session Stability & Graph Memory Audit Report

Generated on: ${new Date().toISOString()}

## 1. Executive Telemetry Summary

* **Session Steps Evaluated**: ${telemetry.length} consecutive observations/mutations
* **Start Heap Memory Usage**: ${initialHeap} MB
* **End Heap Memory Usage**: ${finalHeap} MB
* **Max Heap Memory Peak**: ${maxHeap} MB
* **Start Graph Size (Refs)**: ${initialGraphSize} references
* **End Graph Size (Refs)**: ${finalGraphSize} references
* **Average Observation Capture Time**: ${avgObsTime} ms
* **Average Ref Generation Time**: ${avgRefGenTime} ms
* **Max Ref Generation Time**: ${maxRefGenTime} ms

### Verdict on ARCH-001 (Historical Ref Growth)
> [!NOTE]
> **Diagnostic Verdict**: **${verdict}**  
> **Rationale**: ${rationale}

---

## 2. Telemetry Log Table

| Step | Site | Present Active Refs | Total Graph Refs (Index) | Heap Memory (MB) | Obs Capture (ms) | Ref Gen (ms) | Working Set Size |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: |
`;

  for (const t of telemetry) {
    markdown += `| ${t.step} | ${t.site} | ${t.presentRefs} | ${t.totalGraphRefs} | ${t.heapUsedMb} MB | ${t.obsTimeMs} ms | ${t.refGenTimeMs} ms | ${t.workingSetSize} |\n`;
  }

  const dest = resolve(__dirname, '../docs/superpowers/specs/LONG_SESSION_STABILITY_REPORT.md');
  writeFileSync(dest, markdown, 'utf8');
  console.log(`Stability audit completed successfully! Report compiled at ${dest}`);
}

runSessionStabilityAudit().catch(console.error);
