import test from 'node:test';
import assert from 'node:assert/strict';

async function loadReleaseGateScript() {
  try {
    return await import('../../../scripts/check_v2_release_gate');
  } catch (error) {
    assert.fail(`expected v2 release gate script module to exist: ${(error as Error).message}`);
  }
}

test('buildV2ReleaseGateCommands returns the required release command order', async () => {
  const { buildV2ReleaseGateCommands } = await loadReleaseGateScript();
  const commands = buildV2ReleaseGateCommands({ platform: 'win32' });

  assert.deepEqual(
    commands.map((command: { name: string }) => command.name),
    [
      'build',
      'unit tests',
      'v2 governance checks',
      'v2 integration tests',
      'continuity stress eval',
      'agent smoke eval',
      'provider smoke eval',
      'git diff whitespace check',
      'trailing whitespace scan',
      'unfinished marker scan',
    ],
  );
  assert.deepEqual(commands[0].command, 'cmd');
  assert.deepEqual(commands[0].args, ['/c', 'npm', 'run', 'build']);
  assert.equal(commands[8].allowExitCodeOne, true);
  assert.equal(commands[9].allowExitCodeOne, true);

  const trailingWhitespaceScan = commands.find((command: { name: string }) => command.name === 'trailing whitespace scan');
  const unfinishedMarkerScan = commands.find((command: { name: string }) => command.name === 'unfinished marker scan');
  assert.ok(trailingWhitespaceScan?.args.includes('docs\\refined-architecture-v2.1'));
  assert.ok(unfinishedMarkerScan?.args.includes('docs\\refined-architecture-v2.1'));
  assert.ok(trailingWhitespaceScan?.args.includes('.github\\workflows'));
  assert.ok(unfinishedMarkerScan?.args.includes('.github\\workflows'));
});

test('runV2ReleaseGate reports the failing command name and exit code', async () => {
  const { runV2ReleaseGate } = await loadReleaseGateScript();
  const result = runV2ReleaseGate({
    commands: [
      { name: 'passing', command: 'ok', args: [] },
      { name: 'failing', command: 'fail', args: [] },
    ],
    runCommand: command => ({
      status: command.name === 'failing' ? 7 : 0,
    }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.failedCommand?.name, 'failing');
  assert.equal(result.failedCommand?.exitCode, 7);
});

test('runV2ReleaseGate treats rg no-match exit code as success only for no-match scans', async () => {
  const { runV2ReleaseGate } = await loadReleaseGateScript();
  const result = runV2ReleaseGate({
    commands: [
      { name: 'trailing whitespace scan', command: 'rg', args: [], allowExitCodeOne: true },
      { name: 'ordinary rg failure', command: 'rg', args: [] },
    ],
    runCommand: command => ({
      status: command.name === 'ordinary rg failure' ? 1 : 1,
    }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.failedCommand?.name, 'ordinary rg failure');
  assert.equal(result.failedCommand?.exitCode, 1);
});
