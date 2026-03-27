// ── providers.ts — Transport Layer ──────────────────────────────────────────
// Each provider: (system, user) → {text, inputTokens, outputTokens}
// Zero parsing. Zero retry logic for parse failures (that's llm.ts's job).
// Only transport-level retries (429, 500, 502, 503).

import { logger } from '../logger';
import { countTokens } from '../brain1/serializer';
import OpenAI from 'openai';

export interface ProviderResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

// ── Provider detection ──────────────────────────────────────────────────────

export function detectProvider(model: string): 'gemini' | 'cerebras' | 'openai' | 'ollama' {
  if (model.startsWith('gemini') || model.startsWith('google/gemini')) return 'gemini';
  if (model.startsWith('cerebras/') || model.startsWith('qwen')) return 'cerebras';
  if (model.startsWith('ollama/')) return 'ollama';
  if (process.env['CEREBRAS_API_KEY'] && !model.startsWith('gpt') && !model.startsWith('openai/')) return 'cerebras';
  return 'openai';
}

// ── Dispatcher ──────────────────────────────────────────────────────────────

export async function callProvider(system: string, user: string): Promise<ProviderResult> {
  const model = process.env['BROWSEGENT_MODEL'] ?? 'ollama/qwen3.5:4b';
  const provider = detectProvider(model);

  switch (provider) {
    case 'gemini':   return callGemini(system, user);
    case 'cerebras': return callCerebras(system, user);
    case 'ollama': {
      const text = await callOllama(system, user);
      return { text, inputTokens: countTokens(system + user), outputTokens: countTokens(text) };
    }
    case 'openai': {
      const text = await callOpenAI(system, user);
      return { text, inputTokens: countTokens(system + user), outputTokens: countTokens(text) };
    }
    default:
      throw new Error(`Provider "${provider}" not supported.`);
  }
}

// ── Ollama ──────────────────────────────────────────────────────────────────

async function callOllama(system: string, user: string): Promise<string> {
  const rawModel = process.env['BROWSEGENT_MODEL'] ?? 'ollama/qwen3.5:4b';
  const model = rawModel.startsWith('ollama/') ? rawModel.slice('ollama/'.length) : rawModel;

  const response = await fetch('http://127.0.0.1:11434/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.1,
      max_tokens: 1024,
    }),
  });

  if (!response.ok) throw new Error(`Ollama API error: ${response.status}`);
  const data = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content ?? '';
}

// ── Gemini ──────────────────────────────────────────────────────────────────

async function callGemini(system: string, user: string): Promise<ProviderResult> {
  const apiKey = process.env['GEMINI_API_KEY'];
  if (!apiKey) throw new Error('GEMINI_API_KEY not set in .env');
  const model = 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const responseSchema = {
    type: 'object',
    properties: {
      plan: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            tool: { type: 'string', enum: ['click', 'type', 'scroll', 'wait', 'get', 'close', 'select'] },
            sel:  { type: 'string' }, text: { type: 'string' },
            value: { type: 'string' }, direction: { type: 'string', enum: ['down', 'up'] },
          },
          required: ['tool'],
        },
      },
      done: { type: 'boolean' }, val: { type: 'string' },
      escalate: { type: 'string', enum: ['user_needed', 'captcha', 'dead_end'] },
      reason: { type: 'string' }, confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    },
  };

  const body = JSON.stringify({
    system_instruction: { parts: [{ text: system }] },
    contents: [{ parts: [{ text: user }] }],
    generationConfig: {
      temperature: 0.1, maxOutputTokens: 1024,
      responseMimeType: 'application/json', responseJsonSchema: responseSchema,
    },
  });

  const RETRIES = 3;
  const RETRY_CODES = new Set([429, 500, 502, 503]);

  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });

    if (response.ok) {
      const data = await response.json() as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
      };
      return {
        text: data.candidates?.[0]?.content?.parts?.[0]?.text ?? '',
        inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
      };
    }

    if (response.status === 429) {
      const errorBody = await response.text().catch(() => '');
      if (errorBody.includes('quota') || errorBody.includes('RESOURCE_EXHAUSTED') || errorBody.includes('rate')) {
        throw new Error(
          `API_QUOTA_EXCEEDED: Key ...${apiKey?.slice(-6)} hit rate limit. ` +
          `Switch to next GEMINI_API_KEY in .env and re-run.`
        );
      }
    }

    if (RETRY_CODES.has(response.status) && attempt < RETRIES) {
      const wait = Math.pow(2, attempt) * 1000;
      logger.warn('providers', `Gemini ${response.status} — retry ${attempt}/${RETRIES} in ${wait}ms`);
      await new Promise(r => setTimeout(r, wait));
      continue;
    }

    throw new Error(`Gemini API error: ${response.status}`);
  }

  throw new Error('Gemini API: all retries exhausted');
}

// ── OpenAI ──────────────────────────────────────────────────────────────────

async function callOpenAI(system: string, user: string): Promise<string> {
  const apiKey = process.env['OPENAI_API_KEY'];
  if (!apiKey) throw new Error('OPENAI_API_KEY not set in .env');

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      temperature: 0.1, max_tokens: 512,
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) throw new Error(`OpenAI API error: ${response.status}`);
  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content ?? '';
}

// ── Cerebras ────────────────────────────────────────────────────────────────

async function callCerebras(system: string, user: string): Promise<ProviderResult> {
  const apiKey = process.env['CEREBRAS_API_KEY'];
  if (!apiKey) throw new Error('CEREBRAS_API_KEY not set in .env');

  const rawModel = process.env['BROWSEGENT_MODEL'] ?? 'qwen-3-235b-a22b-instruct-2507';
  const model = rawModel.startsWith('cerebras/') ? rawModel.slice('cerebras/'.length) : rawModel;

  const client = new OpenAI({ apiKey, baseURL: 'https://api.cerebras.ai/v1' });
  const RETRIES = 3;

  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      const response = await client.chat.completions.create({
        model,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        temperature: 0.1, max_completion_tokens: 1024,
        response_format: { type: 'json_object' },
      });

      return {
        text: response.choices[0]?.message?.content ?? '',
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
      };

    } catch (err: any) {
      const isQuota = err?.status === 429 || String(err).includes('quota') || String(err).includes('rate_limit');
      if (isQuota) throw new Error(`API_QUOTA_EXCEEDED: Cerebras key hit rate limit.`);

      if (attempt < RETRIES) {
        const wait = Math.pow(2, attempt) * 1000;
        logger.warn('providers', `Cerebras error, retry ${attempt}/${RETRIES} in ${wait}ms`);
        await new Promise(r => setTimeout(r, wait));
      } else {
        throw err;
      }
    }
  }

  throw new Error('Cerebras API: all retries exhausted');
}
