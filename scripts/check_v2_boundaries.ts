import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

export interface SourceFileInput {
  path: string;
  content: string;
}

export interface BoundaryViolation {
  path: string;
  line: number;
  ruleId: string;
  importPath: string;
  message: string;
}

export interface BoundaryCheckResult {
  ok: boolean;
  violations: BoundaryViolation[];
}

interface ImportReference {
  specifier: string;
  line: number;
}

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/^\.\//, '');
}

function stripKnownExtension(filePath: string): string {
  return filePath.replace(/\.(tsx?|jsx?|mjs|cjs|json)$/i, '');
}

function isWithin(filePath: string, directory: string): boolean {
  const normalizedFilePath = stripKnownExtension(normalizePath(filePath));
  const normalizedDirectory = normalizePath(directory);
  return normalizedFilePath === normalizedDirectory || normalizedFilePath.startsWith(`${normalizedDirectory}/`);
}

function resolveImportTarget(importerPath: string, specifier: string): string {
  const normalizedSpecifier = normalizePath(specifier);

  if (normalizedSpecifier.startsWith('.')) {
    const importerDirectory = path.posix.dirname(normalizePath(importerPath));
    return stripKnownExtension(path.posix.normalize(path.posix.join(importerDirectory, normalizedSpecifier)));
  }

  return stripKnownExtension(normalizedSpecifier);
}

function collectImports(file: SourceFileInput): ImportReference[] {
  const sourceFile = ts.createSourceFile(file.path, file.content, ts.ScriptTarget.Latest, true);
  const imports: ImportReference[] = [];

  const addImport = (specifier: ts.Expression | undefined, node: ts.Node): void => {
    if (!specifier || !ts.isStringLiteralLike(specifier)) {
      return;
    }

    imports.push({
      specifier: specifier.text,
      line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
    });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      addImport(node.moduleSpecifier, node);
    } else if (ts.isExportDeclaration(node)) {
      addImport(node.moduleSpecifier, node);
    } else if (ts.isCallExpression(node)) {
      const firstArgument = node.arguments[0];
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';

      if (isDynamicImport || isRequire) {
        addImport(firstArgument, node);
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return imports;
}

function addViolation(
  violations: BoundaryViolation[],
  filePath: string,
  importReference: ImportReference,
  ruleId: string,
  message: string,
): void {
  violations.push({
    path: filePath,
    line: importReference.line,
    ruleId,
    importPath: importReference.specifier,
    message,
  });
}

function isProviderOrAgentTarget(target: string): boolean {
  return (
    isWithin(target, 'src/providers') ||
    isWithin(target, 'src/agent') ||
    target === 'openai' ||
    target.startsWith('openai/')
  );
}

function isRuntimeServicePath(filePath: string): boolean {
  return (
    isWithin(filePath, 'src/v2/runtime') ||
    isWithin(filePath, 'src/v2/substrate') ||
    isWithin(filePath, 'src/v2/brain1') ||
    isWithin(filePath, 'src/v2/brain2') ||
    isWithin(filePath, 'src/v2/graph')
  );
}

export function checkV2Boundaries(files: SourceFileInput[]): BoundaryCheckResult {
  const violations: BoundaryViolation[] = [];

  for (const file of files) {
    const filePath = normalizePath(file.path);

    for (const importReference of collectImports(file)) {
      const target = resolveImportTarget(filePath, importReference.specifier);

      if (isWithin(filePath, 'src/v2/substrate') && isWithin(target, 'src/agent')) {
        addViolation(
          violations,
          filePath,
          importReference,
          'substrate-no-agent-imports',
          'v2 substrate must not import v1 agent modules',
        );
      }

      if (
        isWithin(filePath, 'src/v2/runtime') &&
        (isWithin(target, 'src/v2/planner') || isProviderOrAgentTarget(target))
      ) {
        addViolation(
          violations,
          filePath,
          importReference,
          'runtime-no-planner-or-provider-imports',
          'v2 runtime must not import planner, agent, or provider modules',
        );
      }

      if (isWithin(filePath, 'src/v2/graph') && isProviderOrAgentTarget(target)) {
        addViolation(
          violations,
          filePath,
          importReference,
          'graph-no-llm-or-provider-imports',
          'v2 graph must not import LLM, agent, or provider modules',
        );
      }

      if (isWithin(filePath, 'src/v2/brain1') && isWithin(target, 'src/v2/brain2')) {
        addViolation(
          violations,
          filePath,
          importReference,
          'brain1-no-brain2-imports',
          'Brain1 must not depend directly on Brain2 implementations',
        );
      }

      if (isRuntimeServicePath(filePath) && isWithin(target, 'src/v2/trace')) {
        addViolation(
          violations,
          filePath,
          importReference,
          'runtime-services-no-trace-imports',
          'v2 runtime services must not use trace as a decision dependency',
        );
      }

      if (isWithin(filePath, 'src') && isWithin(target, 'tests/eval')) {
        addViolation(
          violations,
          filePath,
          importReference,
          'src-no-eval-imports',
          'runtime source must not import evaluation code',
        );
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

export function runV2BoundaryCheckCli(projectRoot = process.cwd()): BoundaryCheckResult {
  const result = checkV2Boundaries(collectProjectFiles(projectRoot, ['src', path.join('tests', 'eval')]));

  if (!result.ok) {
    for (const violation of result.violations) {
      console.error(
        `${violation.path}:${violation.line} ${violation.ruleId}: ${violation.message} (${violation.importPath})`,
      );
    }
    process.exitCode = 1;
  } else {
    console.log('v2 boundary checks passed');
  }

  return result;
}

if (require.main === module) {
  runV2BoundaryCheckCli();
}
