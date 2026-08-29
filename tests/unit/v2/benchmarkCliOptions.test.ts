import test from 'node:test';
import assert from 'node:assert/strict';

import { readCliOptions as readBenchmarkCliOptions } from '../../benchmark/v2/run_benchmark';
import type { RunBenchmarkOptions } from '../../benchmark/v2/run_benchmark';
import { readCliOptions as readWebVoyagerCliOptions } from '../../benchmark/webvoyager/run_webvoyager_lite';
import type { RunWebVoyagerLiteOptions } from '../../benchmark/webvoyager/run_webvoyager_lite';

function withArgv<T>(argv: string[], run: () => T): T {
  const originalArgv = process.argv;
  process.argv = ['node', 'benchmark_cli', ...argv];
  try {
    return run();
  } finally {
    process.argv = originalArgv;
  }
}

function benchmarkCli(argv: string[]): RunBenchmarkOptions {
  return withArgv(argv, () => readBenchmarkCliOptions());
}

function webVoyagerCli(argv: string[]): RunWebVoyagerLiteOptions {
  return withArgv(['--source-root', 'external/WebVoyager', ...argv], () => readWebVoyagerCliOptions());
}

test('benchmark CLI leaves planner serialization and working set options undefined when no flags are passed', () => {
  const options = benchmarkCli([]);
  assert.equal(options.plannerMode, 'current');
  assert.equal(options.plannerSerialization, undefined);
  assert.equal(options.workingSetOptions, undefined);
});

test('benchmark CLI parses --planner-serialization without adding absent serialization flags', () => {
  const prcOptions = benchmarkCli(['--planner-serialization', 'prc']);
  assert.deepEqual(prcOptions.plannerSerialization, { mode: 'prc' });
  assert.equal('prcTierOmitted' in (prcOptions.plannerSerialization ?? {}), false);
  assert.equal('compactDataPlane' in (prcOptions.plannerSerialization ?? {}), false);
  assert.equal(prcOptions.workingSetOptions, undefined);

  const jsonOptions = benchmarkCli(['--planner-serialization', 'json']);
  assert.deepEqual(jsonOptions.plannerSerialization, { mode: 'json' });
});

test('benchmark CLI accepts serialization-only flags only with --planner-serialization prc', () => {
  const tierOmitted = benchmarkCli(['--planner-serialization', 'prc', '--prc-tier-omitted']);
  assert.deepEqual(tierOmitted.plannerSerialization, { mode: 'prc', prcTierOmitted: true });

  const compactDataPlane = benchmarkCli(['--planner-serialization', 'prc', '--compact-data-plane']);
  assert.deepEqual(compactDataPlane.plannerSerialization, { mode: 'prc', compactDataPlane: true });

  const both = benchmarkCli(['--planner-serialization', 'prc', '--prc-tier-omitted', '--compact-data-plane']);
  assert.deepEqual(both.plannerSerialization, { mode: 'prc', prcTierOmitted: true, compactDataPlane: true });
});

test('benchmark CLI rejects serialization-only flags without --planner-serialization prc', () => {
  assert.throws(
    () => benchmarkCli(['--prc-tier-omitted']),
    /--prc-tier-omitted require --planner-serialization prc\./,
  );
  assert.throws(
    () => benchmarkCli(['--compact-data-plane']),
    /--compact-data-plane require --planner-serialization prc\./,
  );
  assert.throws(
    () => benchmarkCli(['--planner-serialization', 'json', '--prc-tier-omitted', '--compact-data-plane']),
    /--prc-tier-omitted and --compact-data-plane require --planner-serialization prc\./,
  );
});

test('benchmark CLI rejects explicit planner serialization with --planner-mode compact_enforced', () => {
  assert.throws(
    () => benchmarkCli(['--planner-serialization', 'prc', '--planner-mode', 'compact_enforced']),
    /--planner-serialization cannot be combined with --planner-mode compact_enforced/,
  );
  assert.throws(
    () => benchmarkCli(['--planner-serialization', 'json', '--planner-mode', 'compact_enforced']),
    /--planner-serialization cannot be combined with --planner-mode compact_enforced/,
  );
  const enforcedWithoutSerialization = benchmarkCli(['--planner-mode', 'compact_enforced']);
  assert.equal(enforcedWithoutSerialization.plannerMode, 'compact_enforced');
  assert.equal(enforcedWithoutSerialization.plannerSerialization, undefined);
});

test('benchmark CLI parses --readable-phrase-bonus independent of planner mode and serialization', () => {
  const bonusOnly = benchmarkCli(['--readable-phrase-bonus', '60']);
  assert.deepEqual(bonusOnly.workingSetOptions, { readablePhraseBonus: 60 });
  assert.equal(bonusOnly.plannerSerialization, undefined);

  const withEnforcedMode = benchmarkCli(['--readable-phrase-bonus', '60', '--planner-mode', 'compact_enforced']);
  assert.deepEqual(withEnforcedMode.workingSetOptions, { readablePhraseBonus: 60 });
  assert.equal(withEnforcedMode.plannerMode, 'compact_enforced');
  assert.equal(withEnforcedMode.plannerSerialization, undefined);

  const withJsonSerialization = benchmarkCli(['--readable-phrase-bonus', '60', '--planner-serialization', 'json']);
  assert.deepEqual(withJsonSerialization.workingSetOptions, { readablePhraseBonus: 60 });
  assert.deepEqual(withJsonSerialization.plannerSerialization, { mode: 'json' });
});

test('benchmark CLI accepts zero as --readable-phrase-bonus', () => {
  const options = benchmarkCli(['--readable-phrase-bonus', '0']);
  assert.deepEqual(options.workingSetOptions, { readablePhraseBonus: 0 });
});

test('benchmark CLI rejects non-finite or negative --readable-phrase-bonus values', () => {
  assert.throws(
    () => benchmarkCli(['--readable-phrase-bonus', 'abc']),
    /Unsupported --readable-phrase-bonus "abc"\. Use a non-negative finite number\./,
  );
  assert.throws(
    () => benchmarkCli(['--readable-phrase-bonus', '-1']),
    /Unsupported --readable-phrase-bonus "-1"\. Use a non-negative finite number\./,
  );
  assert.throws(
    () => benchmarkCli(['--readable-phrase-bonus', 'Infinity']),
    /Unsupported --readable-phrase-bonus "Infinity"\. Use a non-negative finite number\./,
  );
  assert.throws(
    () => benchmarkCli(['--readable-phrase-bonus', 'NaN']),
    /Unsupported --readable-phrase-bonus "NaN"\. Use a non-negative finite number\./,
  );
});

test('webvoyager lite CLI leaves planner serialization and working set options undefined when no flags are passed', () => {
  const options = webVoyagerCli([]);
  assert.equal(options.plannerMode, 'current');
  assert.equal(options.plannerSerialization, undefined);
  assert.equal(options.workingSetOptions, undefined);
});

test('webvoyager lite CLI parses planner serialization flags', () => {
  const prcOptions = webVoyagerCli(['--planner-serialization', 'prc', '--prc-tier-omitted', '--compact-data-plane']);
  assert.deepEqual(prcOptions.plannerSerialization, { mode: 'prc', prcTierOmitted: true, compactDataPlane: true });

  const jsonOptions = webVoyagerCli(['--planner-serialization', 'json']);
  assert.deepEqual(jsonOptions.plannerSerialization, { mode: 'json' });
  assert.equal(jsonOptions.workingSetOptions, undefined);
});

test('webvoyager lite CLI rejects serialization-only flags without --planner-serialization prc', () => {
  assert.throws(
    () => webVoyagerCli(['--prc-tier-omitted']),
    /--prc-tier-omitted require --planner-serialization prc\./,
  );
  assert.throws(
    () => webVoyagerCli(['--compact-data-plane']),
    /--compact-data-plane require --planner-serialization prc\./,
  );
});

test('webvoyager lite CLI rejects explicit planner serialization with --planner-mode compact_enforced', () => {
  assert.throws(
    () => webVoyagerCli(['--planner-serialization', 'prc', '--planner-mode', 'compact_enforced']),
    /--planner-serialization cannot be combined with --planner-mode compact_enforced/,
  );
});

test('webvoyager lite CLI parses --readable-phrase-bonus independent of planner mode and serialization', () => {
  const bonusOnly = webVoyagerCli(['--readable-phrase-bonus', '60']);
  assert.deepEqual(bonusOnly.workingSetOptions, { readablePhraseBonus: 60 });
  assert.equal(bonusOnly.plannerSerialization, undefined);

  const withEnforcedMode = webVoyagerCli(['--readable-phrase-bonus', '60', '--planner-mode', 'compact_enforced']);
  assert.deepEqual(withEnforcedMode.workingSetOptions, { readablePhraseBonus: 60 });
  assert.equal(withEnforcedMode.plannerMode, 'compact_enforced');
});

test('webvoyager lite CLI rejects non-finite or negative --readable-phrase-bonus values', () => {
  assert.throws(
    () => webVoyagerCli(['--readable-phrase-bonus', 'abc']),
    /Unsupported --readable-phrase-bonus "abc"\. Use a non-negative finite number\./,
  );
  assert.throws(
    () => webVoyagerCli(['--readable-phrase-bonus', '-5']),
    /Unsupported --readable-phrase-bonus "-5"\. Use a non-negative finite number\./,
  );
  assert.throws(
    () => webVoyagerCli(['--readable-phrase-bonus', 'Infinity']),
    /Unsupported --readable-phrase-bonus "Infinity"\. Use a non-negative finite number\./,
  );
});
