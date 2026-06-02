import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { WebVoyagerReferenceAnswer, WebVoyagerSourceTask } from './types';

interface RawWebVoyagerTask {
  web_name: string;
  id: string;
  ques: string;
  web: string;
}

interface RawReferenceAnswer {
  id: string | number;
  type?: string;
  ans: unknown;
}

export async function loadWebVoyagerSource(sourceRoot: string): Promise<{
  tasks: WebVoyagerSourceTask[];
  references: Map<string, WebVoyagerReferenceAnswer>;
}> {
  const dataPath = join(sourceRoot, 'data', 'WebVoyager_data.jsonl');
  const referencesPath = join(sourceRoot, 'data', 'reference_answer.json');
  const [data, references] = await Promise.all([
    readFile(dataPath, 'utf8'),
    readFile(referencesPath, 'utf8'),
  ]);
  return {
    tasks: parseWebVoyagerJsonl(data),
    references: parseWebVoyagerReferenceAnswers(references),
  };
}

export function parseWebVoyagerJsonl(data: string): WebVoyagerSourceTask[] {
  return data
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const raw = JSON.parse(line) as RawWebVoyagerTask;
      return {
        id: raw.id,
        webName: raw.web_name,
        question: raw.ques,
        url: raw.web,
      };
    });
}

export function parseWebVoyagerReferenceAnswers(data: string): Map<string, WebVoyagerReferenceAnswer> {
  const raw = JSON.parse(data) as Record<string, RawReferenceAnswer[] | { answers?: RawReferenceAnswer[] }>;
  const references = new Map<string, WebVoyagerReferenceAnswer>();

  for (const [webName, value] of Object.entries(raw)) {
    const answers = Array.isArray(value) ? value : value.answers ?? [];
    for (const answer of answers) {
      const id = normalizeReferenceId(webName, answer.id);
      references.set(id, {
        id,
        webName,
        type: answer.type,
        answer: answer.ans,
      });
    }
  }

  return references;
}

function normalizeReferenceId(webName: string, id: string | number): string {
  const stringId = String(id);
  return stringId.includes('--') ? stringId : `${webName}--${stringId}`;
}
