import fs from 'node:fs';
import path from 'node:path';

export interface SourceFileInput {
  path: string;
  content: string;
}

export interface CognitionLeakageViolation {
  path: string;
  line: number;
  column: number;
  phrase: string;
  snippet: string;
}

export interface CognitionLeakageCheckResult {
  ok: boolean;
  violations: CognitionLeakageViolation[];
}

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

export const V2_PROTECTED_RUNTIME_DIRECTORIES = [
  'src/v2/runtime',
  'src/v2/substrate',
  'src/v2/brain1',
  'src/v2/brain2',
  'src/v2/graph',
];

export const V2_FORBIDDEN_COGNITION_PHRASES = [
  'try another',
  'better strategy',
  'not useful',
  'user wants',
  'should search',
  'task complete',
  'workflow',
  'recommend',
  'advice',
];

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/^\.\//, '');
}

function isWithin(filePath: string, directory: string): boolean {
  const normalizedFilePath = normalizePath(filePath);
  const normalizedDirectory = normalizePath(directory);
  return normalizedFilePath === normalizedDirectory || normalizedFilePath.startsWith(`${normalizedDirectory}/`);
}

function isProtectedRuntimeFile(filePath: string): boolean {
  return V2_PROTECTED_RUNTIME_DIRECTORIES.some(directory => isWithin(filePath, directory));
}

export function checkV2NoCognitionLeakage(files: SourceFileInput[]): CognitionLeakageCheckResult {
  const violations: CognitionLeakageViolation[] = [];

  for (const file of files) {
    const filePath = normalizePath(file.path);
    if (!isProtectedRuntimeFile(filePath)) {
      continue;
    }

    const lines = file.content.split(/\r?\n/);
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const line = lines[lineIndex];
      const lowerLine = line.toLowerCase();

      for (const phrase of V2_FORBIDDEN_COGNITION_PHRASES) {
        const column = lowerLine.indexOf(phrase);
        if (column === -1) {
          continue;
        }

        violations.push({
          path: filePath,
          line: lineIndex + 1,
          column: column + 1,
          phrase,
          snippet: line.trim(),
        });
      }
    }
  }

  return {
    ok: violations.length === 0,
    violations,
  };
}

function collectProjectFiles(projectRoot: string, directories: string[]): SourceFileInput[] {
  const files: SourceFileInput[] = [];

  const walk = (relativeDirectory: string): void => {
    const absoluteDirectory = path.join(projectRoot, relativeDirectory);
    if (!fs.existsSync(absoluteDirectory)) {
      return;
    }

    for (const entry of fs.readdirSync(absoluteDirectory, { withFileTypes: true })) {
      const relativeEntryPath = path.join(relativeDirectory, entry.name);
      const absoluteEntryPath = path.join(projectRoot, relativeEntryPath);

      if (entry.isDirectory()) {
        walk(relativeEntryPath);
        continue;
      }

      if (!SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
        continue;
      }

      files.push({
        path: normalizePath(relativeEntryPath),
        content: fs.readFileSync(absoluteEntryPath, 'utf8'),
      });
    }
  };

  for (const directory of directories) {
    walk(directory);
  }

  return files;
}

export function runV2NoCognitionLeakageCli(projectRoot = process.cwd()): CognitionLeakageCheckResult {
  const result = checkV2NoCognitionLeakage(collectProjectFiles(projectRoot, V2_PROTECTED_RUNTIME_DIRECTORIES));

  if (!result.ok) {
    for (const violation of result.violations) {
      console.error(
        `${violation.path}:${violation.line}:${violation.column} forbidden phrase "${violation.phrase}" in v2 runtime boundary`,
      );
    }
    process.exitCode = 1;
  } else {
    console.log('v2 cognition leakage checks passed');
  }

  return result;
}

if (require.main === module) {
  runV2NoCognitionLeakageCli();
}
