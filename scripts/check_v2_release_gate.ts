import { spawnSync } from 'node:child_process';

export interface ReleaseGateCommand {
  name: string;
  command: string;
  args: string[];
  allowExitCodeOne?: boolean;
}

export interface ReleaseGateCommandResult {
  status: number | null;
}

export interface ReleaseGateRunOptions {
  commands?: ReleaseGateCommand[];
  runCommand?: (command: ReleaseGateCommand) => ReleaseGateCommandResult;
}

export interface ReleaseGateRunResult {
  ok: boolean;
  failedCommand?: {
    name: string;
    exitCode: number;
  };
}

export function buildV2ReleaseGateCommands(options: { platform?: NodeJS.Platform } = {}): ReleaseGateCommand[] {
  const platform = options.platform ?? process.platform;

  return [
    npmScript('build', 'build', platform),
    npmScript('unit tests', 'test:unit', platform),
    npmScript('v2 governance checks', 'check:v2', platform),
    {
      name: 'v2 integration tests',
      command: 'node',
      args: [
        '.\\node_modules\\tsx\\dist\\cli.cjs',
        '--test',
        'tests\\integration\\v2\\observationRuntime.test.ts',
        'tests\\integration\\v2\\mvrRuntime.test.ts',
        'tests\\integration\\v2\\v1Compatibility.test.ts',
        'tests\\integration\\v2\\publicAgentMode.test.ts',
      ],
    },
    {
      name: 'continuity stress eval',
      command: 'node',
      args: ['.\\node_modules\\tsx\\dist\\cli.cjs', 'tests\\eval\\v2\\run_continuity_stress.ts'],
    },
    {
      name: 'agent smoke eval',
      command: 'node',
      args: ['.\\node_modules\\tsx\\dist\\cli.cjs', 'tests\\eval\\v2\\run_agent_smoke.ts'],
    },
    {
      name: 'provider smoke eval',
      command: 'node',
      args: ['.\\node_modules\\tsx\\dist\\cli.cjs', 'tests\\eval\\v2\\run_provider_smoke.ts'],
    },
    {
      name: 'git diff whitespace check',
      command: 'git',
      args: ['diff', '--check'],
    },
    {
      name: 'trailing whitespace scan',
      command: 'rg',
      args: [
        '-n',
        '[ \\t]+$',
        'docs\\governance',
        'docs\\refined-architecture-v2.1',
        'docs\\superpowers\\plans',
        'scripts',
        'src\\v2',
        'tests\\unit\\v2',
        'tests\\integration\\v2',
        'tests\\eval\\v2',
        'tests\\fixtures\\v2',
        'package.json',
        'skills\\browsegent-dev',
        'skills\\codex.md',
        '.github\\workflows',
      ],
      allowExitCodeOne: true,
    },
    {
      name: 'unfinished marker scan',
      command: 'rg',
      args: [
        '-n',
        'TO[D]O|FIXM[E]|T[B]D',
        'docs\\governance',
        'docs\\refined-architecture-v2.1',
        'docs\\superpowers\\plans',
        'scripts',
        'src\\v2',
        'tests\\unit\\v2',
        'tests\\integration\\v2',
        'tests\\eval\\v2',
        'skills\\browsegent-dev',
        'skills\\codex.md',
        '.github\\workflows',
      ],
      allowExitCodeOne: true,
    },
  ];
}

export function runV2ReleaseGate(options: ReleaseGateRunOptions = {}): ReleaseGateRunResult {
  const commands = options.commands ?? buildV2ReleaseGateCommands();
  const runCommand = options.runCommand ?? runCommandWithInheritedStdio;

  for (const command of commands) {
    const result = runCommand(command);
    const exitCode = result.status ?? 1;
    if (exitCode === 0 || (command.allowExitCodeOne && exitCode === 1)) {
      continue;
    }

    return {
      ok: false,
      failedCommand: {
        name: command.name,
        exitCode,
      },
    };
  }

  return { ok: true };
}

function npmScript(name: string, script: string, platform: NodeJS.Platform): ReleaseGateCommand {
  if (platform === 'win32') {
    return {
      name,
      command: 'cmd',
      args: ['/c', 'npm', 'run', script],
    };
  }

  return {
    name,
    command: 'npm',
    args: ['run', script],
  };
}

function runCommandWithInheritedStdio(command: ReleaseGateCommand): ReleaseGateCommandResult {
  process.stdout.write(`\n[v2-release-gate] ${command.name}\n`);
  const result = spawnSync(command.command, command.args, {
    stdio: 'inherit',
    shell: false,
  });
  return { status: result.status };
}

if (require.main === module) {
  const result = runV2ReleaseGate();
  if (!result.ok) {
    process.stderr.write(
      `v2 release gate failed at "${result.failedCommand?.name}" with exit code ${result.failedCommand?.exitCode}\n`,
    );
    process.exitCode = result.failedCommand?.exitCode ?? 1;
  } else {
    process.stdout.write('v2 release gate passed\n');
  }
}
