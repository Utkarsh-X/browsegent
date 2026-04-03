import OpenAI from 'openai';

import { countTokens } from '../brain1/serializer';
import { getRuntimeConfig, resolveLlmSelection, type LlmProvider } from '../config/runtime';
import { buildGeminiResponseSchema } from '../executor/catalog';
import { logger } from '../logger';

export interface ProviderResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

export function detectProvider(model: string): LlmProvider {
  if (model.startsWith('gemini') || model.startsWith('google/gemini')) return 'gemini';
  if (model.startsWith('cerebras/') || model.startsWith('qwen')) return 'cerebras';
  if (model.startsWith('ollama/')) return 'ollama';
  return 'openai';
}

export function normalizeProviderModel(model: string): string {
  return resolveLlmSelection(model).model;
}

export async function callProvider(system: string, user: string): Promise<ProviderResult> {
  const selection = resolveLlmSelection();

  switch (selection.provider) {
    case 'gemini':
      return callGemini(system, user, selection.model);
    case 'cerebras':
      return callCerebras(system, user, selection.model);
    case 'ollama': {
      const text = await callOllama(system, user, selection.model);
      return {
        text,
        inputTokens: countTokens(system + user),
        outputTokens: countTokens(text),
      };
    }
    case 'openai': {
      const text = await callOpenAI(system, user, selection.model);
      return {
        text,
        inputTokens: countTokens(system + user),
        outputTokens: countTokens(text),
      };
    }
  }
}

async function callOllama(system: string, user: string, model: string): Promise<string> {
  const runtime = getRuntimeConfig();
  const response = await fetch(`${runtime.llm.ollamaBaseUrl}/v1/chat/completions`, {
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

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new Error(`Ollama API error: ${response.status}${errorBody ? ` - ${errorBody}` : ''}`);
  }

  const data = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  return data.choices?.[0]?.message?.content ?? '';
}

async function callGemini(system: string, user: string, model: string): Promise<ProviderResult> {
  const apiKey = getRuntimeConfig().llm.geminiApiKey;
  if (!apiKey) throw new Error('GEMINI_API_KEY not set in .env');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const responseSchema = buildGeminiResponseSchema();
  const body = JSON.stringify({
    system_instruction: { parts: [{ text: system }] },
    contents: [{ parts: [{ text: user }] }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 1024,
      responseMimeType: 'application/json',
      responseJsonSchema: responseSchema,
    },
  });

  const retries = 3;
  const retryCodes = new Set([429, 500, 502, 503]);

  for (let attempt = 1; attempt <= retries; attempt++) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });

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
          `API_QUOTA_EXCEEDED: Key ...${apiKey.slice(-6)} hit rate limit. ` +
          'Switch to the next GEMINI_API_KEY in .env and re-run.',
        );
      }
    }

    if (retryCodes.has(response.status) && attempt < retries) {
      const wait = Math.pow(2, attempt) * 1000;
      logger.warn('providers', `Gemini ${response.status} retry ${attempt}/${retries} in ${wait}ms`);
      await new Promise(resolve => setTimeout(resolve, wait));
      continue;
    }

    const errorBody = await response.text().catch(() => '');
    throw new Error(`Gemini API error: ${response.status}${errorBody ? ` - ${errorBody}` : ''}`);
  }

  throw new Error('Gemini API: all retries exhausted');
}

async function callOpenAI(system: string, user: string, model: string): Promise<string> {
  const apiKey = getRuntimeConfig().llm.openaiApiKey;
  if (!apiKey) throw new Error('OPENAI_API_KEY not set in .env');

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.1,
      max_tokens: 512,
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new Error(`OpenAI API error: ${response.status}${errorBody ? ` - ${errorBody}` : ''}`);
  }

  const data = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  return data.choices?.[0]?.message?.content ?? '';
}

async function callCerebras(system: string, user: string, model: string): Promise<ProviderResult> {
  const apiKey = getRuntimeConfig().llm.cerebrasApiKey;
  if (!apiKey) throw new Error('CEREBRAS_API_KEY not set in .env');

  const client = new OpenAI({ apiKey, baseURL: 'https://api.cerebras.ai/v1' });
  const retries = 3;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await client.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0.1,
        max_completion_tokens: 1024,
        response_format: { type: 'json_object' },
      });

      return {
        text: response.choices[0]?.message?.content ?? '',
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
      };
    } catch (error: any) {
      const isQuota = error?.status === 429 || String(error).includes('quota') || String(error).includes('rate_limit');
      if (isQuota) {
        throw new Error('API_QUOTA_EXCEEDED: Cerebras key hit rate limit.');
      }

      if (attempt < retries) {
        const wait = Math.pow(2, attempt) * 1000;
        logger.warn('providers', `Cerebras error, retry ${attempt}/${retries} in ${wait}ms`);
        await new Promise(resolve => setTimeout(resolve, wait));
      } else {
        throw error;
      }
    }
  }

  throw new Error('Cerebras API: all retries exhausted');
}
