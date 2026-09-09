/* AX-name-oracle probe (perception round 2 execution, blueprint §1).
   Production-parity capture (stealth session + ObservationService) + one-shot
   enable-less Accessibility.getFullAXTree joined on backendNodeId.
   Probe-only tooling: never imported by src/. */
import fs from 'node:fs';
import path from 'node:path';

const { BrowserSession } = await import('../src/v2/substrate/BrowserSession');
const { ObservationService } = await import('../src/v2/substrate/ObservationService');
const { CdpBridge } = await import('../src/v2/substrate/CdpBridge');
const { StabilizationService } = await import('../src/v2/runtime/StabilizationService');
const { loadWebVoyagerSource } = await import('../tests/benchmark/webvoyager/source_loader');
const { resolveWebVoyagerTaskIds } = await import('../tests/benchmark/webvoyager/task_selection');
const { selectWebVoyagerLiteTasks, toBenchmarkTasks } = await import('../tests/benchmark/webvoyager/task_selection');

const SOURCE_ROOT = process.env.WEBVOYAGER_SOURCE_ROOT ?? 'D:\\agent-tools\\WebVoyager';
const OUT_DIR = path.resolve('logs', 'ax-oracle-probe');
fs.mkdirSync(OUT_DIR, { recursive: true });

const source = await loadWebVoyagerSource(SOURCE_ROOT);
const ids = resolveWebVoyagerTaskIds('balanced30');
const tasks = toBenchmarkTasks(selectWebVoyagerLiteTasks(source.tasks, ids), source.references, new Date());
const casualty = new Set(['webvoyager_GitHub__0', 'webvoyager_Wolfram__Alpha__0', 'webvoyager_ESPN__0', 'webvoyager_Coursera__0']);

process.env.BROWSEGENT_STEALTH = '1';
const session = new BrowserSession({ headed: false, viewport: { width: 1280, height: 720 } });
const stabilization = new StabilizationService();
const observation = new ObservationService();

const isGlyphJunk = (s: string) => /[\uE000-\uF8FF\u0000-\u001F\u007F-\u009F]/.test(s);
const isUrlLike = (s: string) => /^(https?:\/\/|www\.|\/[\w.-]+\/)/i.test(s.trim());
const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

function classifyPair(ref: { name?: string; text?: string }, ax: { name?: string; value?: string; ignored?: boolean }) {
  const walkName = ref.name ?? '';
  const axName = ax.name ?? '';
  if (!walkName && !axName) return 'both_anonymous';
  if (!axName) return 'ax_anonymous';
  if (!walkName) return 'better_anon_healed';
  if (walkName === axName) return 'same';
  const worse =
    (isGlyphJunk(axName) && !isGlyphJunk(walkName)) ||
    (isUrlLike(axName) && !isUrlLike(walkName)) ||
    (axName.length > walkName.length * 1.5 && words(axName) <= words(walkName));
  return worse ? 'worse' : 'better_other';
}

const rows: Record<string, unknown>[] = [];
let armB = 0;
for (const task of tasks) {
  const t0 = Date.now();
  const row: Record<string, unknown> = {
    taskId: task.taskId, url: task.url, casualty: casualty.has(task.taskId), arm: 'A',
  };
  try {
    await session.open(task.url);
    const page = session.currentPage();
    await stabilization.waitForSettledState(page).catch(() => undefined);
    const obs = await observation.capture({
      sessionId: 'axprobe', generationId: 1, page, retryEmptyNavigationCapture: true,
    });
    row.refs = obs.refs.length;
    row.walkMs = obs.stats.durationMs;

    // Arm B (enable A/B) on the first 6 pages
    const useArmB = armB < 6;
    const bridge = await CdpBridge.create(page);
    let axNodes: Array<Record<string, unknown>> = [];
    let axMs = 0; let axBytes = 0; let axError: string | undefined;
    try {
      if (useArmB) {
        row.arm = 'B';
        await bridge.send('Accessibility.enable');
      }
      const t1 = Date.now();
      try {
        const ax = await bridge.send<{ nodes?: Array<Record<string, unknown>> }>('Accessibility.getFullAXTree');
        axMs = Date.now() - t1;
        axNodes = ax.nodes ?? [];
        axBytes = Buffer.byteLength(JSON.stringify(axNodes));
      } catch (e) {
        axError = String(e).slice(0, 120);
      } finally {
        if (useArmB) await bridge.send('Accessibility.disable').catch(() => undefined);
      }
      if (useArmB) armB += 1;
    } finally {
      await bridge.dispose();
    }
    row.axMs = axMs; row.axBytes = axBytes; if (axError) row.axError = axError;

    const axByBackend = new Map<number, Record<string, unknown>>();
    for (const n of axNodes) {
      const b = n.backendDOMNodeId as number | undefined;
      if (typeof b === 'number') axByBackend.set(b, n);
    }
    const getStr = (n: Record<string, unknown> | undefined, k: string) =>
      ((n?.[k] as { value?: string } | undefined)?.value ?? '');

    let withBackend = 0, joined = 0, joinedIgnored = 0, missingAx = 0;
    const anon = { total: 0, joined: 0, healed: 0, healedLens: [] as number[] };
    const mush = { total: 0, joined: 0, axNamed: 0, shorter: 0 };
    const quality = { same: 0, better_anon_healed: 0, better_other: 0, worse: 0, ax_anonymous: 0, both_anonymous: 0 };
    let roleDiverge = 0;
    for (const ref of obs.refs) {
      const b = ref.backendNodeId;
      if (typeof b !== 'number') continue;
      withBackend += 1;
      const ax = axByBackend.get(b);
      if (!ax) { missingAx += 1; continue; }
      const ignored = ax.ignored === true;
      if (ignored) { joinedIgnored += 1; continue; }
      joined += 1;
      const axName = getStr(ax, 'name');
      const axValue = getStr(ax, 'value');
      const anonymous = ref.name === undefined && ref.text === undefined;
      const mushName = ref.name !== undefined && ref.name === ref.text;
      if (anonymous) {
        anon.total += 1;
        if (axName && !isGlyphJunk(axName) && !isUrlLike(axName)) { anon.joined += 1; anon.healed += 1; anon.healedLens.push(axName.length); }
      }
      if (mushName) {
        mush.total += 1;
        if (axName) { mush.joined += 1; mush.axNamed += 1; if (axName.length <= (ref.name as string).length) mush.shorter += 1; }
      }
      const cls = classifyPair(ref as { name?: string; text?: string }, { name: axName, value: axValue, ignored });
      (quality as Record<string, number>)[cls] += 1;
      const axRole = getStr(ax, 'role');
      if (axRole && ref.role && axRole.toLowerCase() !== String(ref.role).toLowerCase()) roleDiverge += 1;
    }
    row.join = { withBackend, joined, joinedIgnored, missingAx };
    row.anonymous = anon;
    row.mush = mush;
    row.quality = quality;
    row.roleDiverge = roleDiverge;
    row.title = obs.title.slice(0, 60);
  } catch (e) {
    row.error = String(e).slice(0, 160);
  }
  row.wallMs = Date.now() - t0;
  rows.push(row);
  console.log(`${task.taskId}: arm=${row.arm} refs=${row.refs ?? '?'} join=${JSON.stringify(row.join ?? {})} ax=${row.axMs ?? '?'}ms [${row.wallMs}ms]${row.error ? ' ERR:' + (row.error as string).slice(0, 60) : ''}`);
  fs.writeFileSync(path.join(OUT_DIR, 'pages.json'), JSON.stringify(rows, null, 2));
}

await session.close().catch(() => undefined);

// Summary
const ok = rows.filter(r => !r.error);
const tot = (k: (r: Record<string, unknown>) => number) => ok.reduce((a, r) => a + k(r), 0);
const summary = `# AX-oracle probe summary (${new Date().toISOString()})

Pages captured: ${ok.length}/${rows.length}
Refs total: ${tot(r => r.refs as number)} | with backendNodeId: ${tot(r => (r.join as Record<string, number>)?.withBackend ?? 0)} | joined: ${tot(r => (r.join as Record<string, number>)?.joined ?? 0)} | joined-ignored: ${tot(r => (r.join as Record<string, number>)?.joinedIgnored ?? 0)} | missing-AX: ${tot(r => (r.join as Record<string, number>)?.missingAx ?? 0)}

## (a) Anonymous heal
anonymous refs: ${tot(r => (r.anonymous as Record<string, number>)?.total ?? 0)} | AX-named (G0-clean): ${tot(r => (r.anonymous as Record<string, number>)?.healed ?? 0)} | heal rate: ${(100 * tot(r => (r.anonymous as Record<string, number>)?.healed ?? 0) / Math.max(1, tot(r => (r.anonymous as Record<string, number>)?.total ?? 0))).toFixed(1)}%

## (b) Mush repair
mush refs: ${tot(r => (r.mush as Record<string, number>)?.total ?? 0)} | AX-named: ${tot(r => (r.mush as Record<string, number>)?.axNamed ?? 0)} | AX name shorter-or-equal: ${tot(r => (r.mush as Record<string, number>)?.shorter ?? 0)}

## (c) Name-quality census (JOINED non-ignored)
same ${tot(r => (r.quality as Record<string, number>)?.same ?? 0)} | better(anon-heal) ${tot(r => (r.quality as Record<string, number>)?.better_anon_healed ?? 0)} | better(other) ${tot(r => (r.quality as Record<string, number>)?.better_other ?? 0)} | worse ${tot(r => (r.quality as Record<string, number>)?.worse ?? 0)} | ax-anonymous ${tot(r => (r.quality as Record<string, number>)?.ax_anonymous ?? 0)}

## (d) Role divergence: ${tot(r => r.roleDiverge as number)}

## (e) Cost
AX latency mean: ${(tot(r => r.axMs as number) / Math.max(1, ok.length)).toFixed(0)}ms | AX bytes mean: ${(tot(r => r.axBytes as number) / Math.max(1, ok.length)).toFixed(0)} | walk capture mean: ${(tot(r => r.walkMs as number) / Math.max(1, ok.length)).toFixed(0)}ms
Arm B (enable) pages: ${rows.filter(r => r.arm === 'B').length}
`;
fs.writeFileSync(path.join(OUT_DIR, 'summary.md'), summary);
console.log('\n' + summary);
