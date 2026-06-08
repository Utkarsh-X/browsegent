import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

interface AuditArtifact {
  failureCode?: string;
  actionKind?: string;
  summary?: {
    reason?: string;
    candidateCount?: number;
    sameRoleNameCandidates?: number;
    visibleReadyCandidates?: number;
  };
  selfHeal?: {
    attempted?: boolean;
    result?: string;
    reason?: string;
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

function increment(map: Record<string, number>, key: string | undefined): void {
  const safeKey = key || 'unknown';
  map[safeKey] = (map[safeKey] ?? 0) + 1;
}

async function main(): Promise<void> {
  const root = resolve(process.argv[2] ?? 'logs');
  const traceFiles = await findTraceFiles(root);
  const artifacts: AuditArtifact[] = [];

  for (const traceFile of traceFiles) {
    try {
      const trace = JSON.parse(await readFile(traceFile, 'utf8')) as {
        artifacts?: { refResolutionAudits?: Array<{ path: string }> };
      };
      for (const artifact of trace.artifacts?.refResolutionAudits ?? []) {
        if (!artifact?.path) continue;
        // Handle resilient path resolution (resolve relative to the trace file's directory if the path is not absolute or was stored under a different environment/run)
        let resolvedPath = artifact.path;
        if (!resolvedPath.startsWith('/') && !resolvedPath.includes(':')) {
          resolvedPath = join(traceFile, '..', resolvedPath);
        } else {
          // If stored as an absolute path on another user's machine, resolve it relative to local run root
          const parts = artifact.path.replace(/\\/g, '/').split('/ref-resolution/');
          if (parts.length === 2) {
            resolvedPath = join(traceFile, '..', 'ref-resolution', parts[1]);
          }
        }
        try {
          const parsed = JSON.parse(await readFile(resolvedPath, 'utf8')) as AuditArtifact;
          if (parsed) {
            artifacts.push(parsed);
          }
        } catch (err) {
          console.warn(`Failed to read/parse audit ${resolvedPath}:`, err);
        }
      }
    } catch (err) {
      console.warn(`Failed to read/parse trace file ${traceFile}:`, err);
    }
  }

  const byFailureCode: Record<string, number> = {};
  const byReason: Record<string, number> = {};
  const byAction: Record<string, number> = {};
  let selfHealAttempts = 0;
  let selfHealSuccesses = 0;

  for (const artifact of artifacts) {
    if (!artifact) continue;
    increment(byFailureCode, artifact.failureCode);
    increment(byReason, artifact.summary?.reason);
    increment(byAction, artifact.actionKind);
    if (artifact.selfHeal?.attempted) {
      selfHealAttempts += 1;
    }
    if (artifact.selfHeal?.result === 'succeeded') {
      selfHealSuccesses += 1;
    }
  }

  console.log(JSON.stringify({
    root,
    traceCount: traceFiles.length,
    auditArtifactCount: artifacts.length,
    byFailureCode,
    byReason,
    byAction,
    selfHealAttempts,
    selfHealSuccesses,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
