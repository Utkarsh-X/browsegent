import { readFile } from 'node:fs/promises';
import type { WebVoyagerManualAuditEntry, WebVoyagerManualAuditFile, WebVoyagerManualVerdict } from './types';

const VALID_VERDICTS = new Set<WebVoyagerManualVerdict>(['pass', 'partial', 'fail', 'environment_block', 'impossible']);

export async function loadWebVoyagerManualAudit(path: string | undefined): Promise<Map<string, WebVoyagerManualAuditEntry>> {
  if (!path) return new Map();
  const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown;
  return parseWebVoyagerManualAudit(parsed);
}

export function parseWebVoyagerManualAudit(value: unknown): Map<string, WebVoyagerManualAuditEntry> {
  if (!value || typeof value !== 'object' || !Array.isArray((value as WebVoyagerManualAuditFile).entries)) {
    throw new Error('Manual audit file must contain an entries array.');
  }

  const entries = new Map<string, WebVoyagerManualAuditEntry>();
  for (const rawEntry of (value as WebVoyagerManualAuditFile).entries) {
    if (!rawEntry || typeof rawEntry !== 'object') {
      throw new Error('Manual audit entry must be an object.');
    }
    const entry = rawEntry as WebVoyagerManualAuditEntry;
    if (typeof entry.taskId !== 'string' || entry.taskId.trim().length === 0) {
      throw new Error('Manual audit entry taskId must be a non-empty string.');
    }
    if (!VALID_VERDICTS.has(entry.verdict)) {
      throw new Error(`Manual audit entry ${entry.taskId} has invalid verdict ${String(entry.verdict)}.`);
    }
    if (typeof entry.reason !== 'string' || entry.reason.trim().length === 0) {
      throw new Error(`Manual audit entry ${entry.taskId} reason must be a non-empty string.`);
    }
    entries.set(entry.taskId, entry);
  }
  return entries;
}
