import { createServer, type Server } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';

import type { BenchmarkTask } from './types';

export interface LocalFixtureServer {
  baseUrl: string;
  rewriteTask(task: BenchmarkTask): BenchmarkTask;
  close(): Promise<void>;
}

const DEFAULT_FIXTURE_ROOT = resolve('tests/fixtures/v2');

export async function startLocalFixtureServerForTasks(
  tasks: BenchmarkTask[],
  fixtureRoot: string = DEFAULT_FIXTURE_ROOT,
): Promise<LocalFixtureServer | undefined> {
  const normalizedRoot = resolve(fixtureRoot);
  if (!tasks.some(task => canRewriteFixtureUrl(task.url, normalizedRoot))) {
    return undefined;
  }

  const server = createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
      const requestPath = decodeURIComponent(requestUrl.pathname).replace(/^\/+/, '');
      const filePath = resolve(normalizedRoot, requestPath);

      if (!isInsideRoot(filePath, normalizedRoot)) {
        response.writeHead(403);
        response.end('Forbidden');
        return;
      }

      const fileStat = await stat(filePath);
      if (!fileStat.isFile()) {
        response.writeHead(404);
        response.end('Not found');
        return;
      }

      response.writeHead(200, { 'content-type': contentType(filePath) });
      response.end(await readFile(filePath));
    } catch {
      response.writeHead(404);
      response.end('Not found');
    }
  });

  await listen(server);
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    baseUrl,
    rewriteTask: (task: BenchmarkTask) => ({
      ...task,
      url: rewriteFixtureUrl(task.url, normalizedRoot, baseUrl) ?? task.url,
    }),
    close: () => close(server),
  };
}

function rewriteFixtureUrl(url: string, fixtureRoot: string, baseUrl: string): string | undefined {
  if (!canRewriteFixtureUrl(url, fixtureRoot)) return undefined;
  const filePath = fileURLToPath(url);
  const relativePath = relative(fixtureRoot, filePath).split(sep).map(encodeURIComponent).join('/');
  return `${baseUrl}/${relativePath}`;
}

function canRewriteFixtureUrl(url: string, fixtureRoot: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'file:') return false;
    return isInsideRoot(fileURLToPath(parsed), fixtureRoot);
  } catch {
    return false;
  }
}

function isInsideRoot(filePath: string, fixtureRoot: string): boolean {
  const normalizedPath = resolve(filePath);
  const normalizedRoot = resolve(fixtureRoot);
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}${sep}`);
}

function contentType(filePath: string): string {
  switch (extname(filePath).toLowerCase()) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.js':
      return 'text/javascript; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    default:
      return 'application/octet-stream';
  }
}

function listen(server: Server): Promise<void> {
  return new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', rejectListen);
      resolveListen();
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolveClose, rejectClose) => {
    server.close(error => {
      if (error) rejectClose(error);
      else resolveClose();
    });
  });
}
