import type { TraceJsonValue } from './types';

export function toTraceJsonValue(value: unknown, path = '$', seen = new WeakSet<object>()): TraceJsonValue {
  if (value === null) {
    return null;
  }

  const valueType = typeof value;
  if (valueType === 'string' || valueType === 'boolean') {
    return value as string | boolean;
  }

  if (valueType === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError(`${path} is not JSON serializable: non-finite number`);
    }
    return value as number;
  }

  if (valueType === 'undefined' || valueType === 'function' || valueType === 'symbol' || valueType === 'bigint') {
    throw new TypeError(`${path} is not JSON serializable: ${valueType}`);
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      throw new TypeError(`${path} is not JSON serializable: circular reference`);
    }
    seen.add(value);
    const items = value.map((item, index) => toTraceJsonValue(item, `${path}[${index}]`, seen));
    seen.delete(value);
    return items;
  }

  if (!isPlainObject(value)) {
    throw new TypeError(`${path} is not JSON serializable: non-plain object`);
  }

  if (seen.has(value)) {
    throw new TypeError(`${path} is not JSON serializable: circular reference`);
  }

  seen.add(value);
  const output: Record<string, TraceJsonValue> = {};
  for (const key of Object.keys(value).sort()) {
    const item = (value as Record<string, unknown>)[key];
    if (item !== undefined) {
      output[key] = toTraceJsonValue(item, `${path}.${key}`, seen);
    }
  }
  seen.delete(value);
  return output;
}

export function stringifyTraceJson(value: unknown): string {
  return `${JSON.stringify(toTraceJsonValue(value), null, 2)}\n`;
}

export function cloneTraceJson<T>(value: T): T {
  return JSON.parse(stringifyTraceJson(value)) as T;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
