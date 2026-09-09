import { getEncoding } from 'js-tiktoken';

// Use cl100k_base — compatible with modern LLM tokenizers (approximate)
const enc = getEncoding('cl100k_base');

export function countTokens(text: string): number {
  return enc.encode(text).length;
}
