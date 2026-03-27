// ── parser.ts — Phased Syntax Repair ────────────────────────────────────────
// 4 phases: clean → extract → repair → normalize
// Each phase is a pure function, independently testable.

// ── Phase 1: clean() ────────────────────────────────────────────────────────
// Strip wrapper noise. Input: raw LLM text. Output: text closer to JSON.

export function clean(raw: string): string {
  let text = raw.trim();

  // 1a. Strip Qwen3 <think>...</think> reasoning tags
  text = text.replace(/<think>[\s\S]*?<\/think>\s*/g, '');

  // 1b. Handle unclosed <think> (model hit max_tokens mid-thought)
  if (text.includes('<think>') && !text.includes('</think>')) {
    const before = text.substring(0, text.indexOf('<think>')).trim();
    if (before.startsWith('{') || before.startsWith('[')) {
      text = before;
    } else {
      // Everything is inside a <think> block — no JSON present
      const after = text.substring(text.indexOf('<think>') + 7).trim();
      text = after; // try to salvage what's after <think>
    }
  }

  // 1c. Strip markdown code fences
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (fenceMatch) {
    text = fenceMatch[1].trim();
  }

  // 1d. Strip HTML-like tags (Groq-style headers, function wrappers)
  // e.g. <|header_start|>assistant<|header_end|>, <function=AgentOutput>...</function>
  text = text.replace(/<\|[^|]*\|>/g, '');
  text = text.replace(/<\/?function[^>]*>/g, '');

  return text.trim();
}

// ── Phase 2: extract() ─────────────────────────────────────────────────────
// Find the JSON substring. Input: cleaned text. Output: JSON substring or null.

export function extract(text: string): string | null {
  // Skip preamble — find first { or [
  let start = -1;
  const firstBrace = text.indexOf('{');
  const firstBracket = text.indexOf('[');

  if (firstBrace >= 0 && firstBracket >= 0) {
    start = Math.min(firstBrace, firstBracket);
  } else {
    start = Math.max(firstBrace, firstBracket);
  }

  if (start < 0) return null;

  // Walk from start to find the balanced closing brace/bracket
  const open = text[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inStr = false;
  let esc = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (esc) { esc = false; continue; }
    if (ch === '\\') { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '{' || ch === '[') depth++;
    if (ch === '}' || ch === ']') {
      depth--;
      if (depth === 0) return text.substring(start, i + 1);
    }
  }

  // No balanced close found — return from start to end (truncated JSON)
  return text.substring(start);
}

// ── Phase 3: repair() ───────────────────────────────────────────────────────
// Fix broken-but-recoverable JSON. Input: extracted JSON. Output: fixed JSON.

export function repair(text: string): string {
  // 3a. Fix control characters inside JSON strings
  text = fixControlCharsInStrings(text);

  // 3b. Remove trailing commas before } or ]
  text = text.replace(/,\s*([}\]])/g, '$1');

  // 3c. Close unclosed strings/brackets/braces (truncation recovery)
  text = repairTruncation(text);

  return text;
}

function fixControlCharsInStrings(content: string): string {
  // State-machine: only escape control chars INSIDE quoted strings.
  // Matches browser-use's _fix_control_characters_in_json().
  const result: string[] = [];
  let inString = false;
  let escaped = false;

  for (let i = 0; i < content.length; i++) {
    const ch = content[i];

    if (!inString) {
      if (ch === '"') inString = true;
      result.push(ch);
    } else {
      if (escaped) {
        result.push(ch);
        escaped = false;
      } else if (ch === '\\') {
        result.push(ch);
        escaped = true;
      } else if (ch === '"') {
        result.push(ch);
        inString = false;
      } else if (ch === '\n') {
        result.push('\\n');
      } else if (ch === '\r') {
        result.push('\\r');
      } else if (ch === '\t') {
        result.push('\\t');
      } else if (ch.charCodeAt(0) < 32) {
        // Other control characters → unicode escape
        result.push(`\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);
      } else {
        result.push(ch);
      }
    }
  }

  return result.join('');
}

function repairTruncation(text: string): string {
  let braces = 0, brackets = 0, inStr = false, esc = false;

  for (const ch of text) {
    if (esc) { esc = false; continue; }
    if (ch === '\\') { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '{') braces++;
    if (ch === '}') braces--;
    if (ch === '[') brackets++;
    if (ch === ']') brackets--;
  }

  // Close unclosed string
  if (inStr) text += '"';

  // Remove dangling comma at end
  text = text.replace(/,\s*$/, '');

  // Close unclosed brackets/braces
  while (brackets > 0) { text += ']'; brackets--; }
  while (braces > 0) { text += '}'; braces--; }

  return text;
}

// ── Phase 4: normalize() ────────────────────────────────────────────────────
// Fix field names and structure. Input: parsed object. Output: normalized object.

const FIELD_MAP: Record<string, string> = {
  answer: 'val', value: 'val', result: 'val',
  actions: 'plan', steps: 'plan',
  action: 'tool', command: 'tool',
  selector: 'sel', target: 'sel', element: 'sel',
  query: 'text', input: 'text',
  thought: 'reason', thinking: 'reason', explanation: 'reason',
  status: 'confidence',
};

export function normalize(obj: unknown): Record<string, unknown> | null {
  // Unwrap array-wrapped single object: [{...}] → {...}
  if (Array.isArray(obj) && obj.length === 1 && typeof obj[0] === 'object' && obj[0] !== null) {
    obj = obj[0];
  }

  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return null;

  const raw = obj as Record<string, unknown>;
  const normalized: Record<string, unknown> = {};

  // Map field names
  for (const [key, value] of Object.entries(raw)) {
    const nk = FIELD_MAP[key.toLowerCase()] ?? key;
    if (!(nk in normalized) || key === nk) {
      normalized[nk] = value;
    }
  }

  // Normalize plan step field names
  if (Array.isArray(normalized['plan'])) {
    normalized['plan'] = (normalized['plan'] as Record<string, unknown>[]).map(step => {
      if (typeof step !== 'object' || step === null) return step;
      const s: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(step)) {
        const nk = FIELD_MAP[k.toLowerCase()] ?? k;
        s[nk] = v;
      }
      return s;
    });
  }

  // Auto-promote reason → val when done:true but val missing
  if (normalized['done'] === true && !normalized['val'] && normalized['reason']) {
    normalized['val'] = normalized['reason'];
  }

  return normalized;
}

// ── Top-level: robustJsonParse() ────────────────────────────────────────────
// Chains all phases: clean → extract → repair → parse → normalize

export function robustJsonParse(raw: string): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'string') return null;

  // Phase 1: Clean wrapper noise
  const cleaned = clean(raw);

  // Phase 2: Extract JSON substring
  const extracted = extract(cleaned);
  if (!extracted) return null;

  // Phase 3: Repair broken JSON
  const repaired = repair(extracted);

  // Phase 4: Parse
  let parsed: unknown;
  try {
    parsed = JSON.parse(repaired);
  } catch {
    // Try one more time with the original extracted (before repair)
    try {
      parsed = JSON.parse(extracted);
    } catch {
      return null;
    }
  }

  // Phase 5: Normalize field names and structure
  return normalize(parsed);
}
