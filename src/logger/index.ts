// Logger — structured logging with file + console output
import * as fs from 'fs';
import * as path from 'path';

const LOG_DIR = process.env.LOG_DIR || './logs';

function ensureLogDir(): void {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function appendJsonl(filename: string, data: object): void {
  ensureLogDir();
  const filepath = path.join(LOG_DIR, filename);
  fs.appendFileSync(filepath, JSON.stringify(data) + '\n', 'utf8');
}

export const logger = {
  info: (context: string, message: string, data?: object) => {
    const entry = { level: 'info', timestamp: Date.now(), context, message, ...data };
    appendJsonl('debug.jsonl', entry);
    console.log(`[INFO] [${context}] ${message}`, data || '');
  },

  warn: (context: string, message: string, data?: object) => {
    const entry = { level: 'warn', timestamp: Date.now(), context, message, ...data };
    appendJsonl('debug.jsonl', entry);
    console.warn(`[WARN] [${context}] ${message}`, data || '');
  },

  error: (context: string, message: string, err?: unknown) => {
    const entry = {
      level: 'error',
      timestamp: Date.now(),
      context,
      message,
      error: err instanceof Error ? { message: err.message, stack: err.stack } : String(err)
    };
    appendJsonl('debug.jsonl', entry);
    console.error(`[ERROR] [${context}] ${message}`, err || '');
  }
};
