import { FilteredNode, Brain1Result } from './types';
import { getEncoding } from 'js-tiktoken';

// Use cl100k_base — compatible with GPT-4 / Claude / Gemini tokenizers (approximate)
const enc = getEncoding('cl100k_base');

export interface SerializedOutput {
  json: string;
  tokenCount: number;
  nodeCount: number;
  compressionNote: string;
}

export function serialize(result: Brain1Result): SerializedOutput {
  // Minimal serialization — P7: flat, no nesting, minimal keys
  // Only type initial, value (capped at 80 chars), and selector
  const minimal = result.nodes.map(n => ({
    t: n.type[0],        // 'd'=data, 't'=trigger, 'i'=input, 'c'=cell
    v: n.value.slice(0, 80),
    s: n.sel,
  }));

  const json = JSON.stringify(minimal);
  const tokens = enc.encode(json);

  return {
    json,
    tokenCount: tokens.length,
    nodeCount: result.nodes.length,
    compressionNote: `${result.metrics.totalNodesWalked} nodes → ${result.nodes.length} kept → ${tokens.length} tokens`
  };
}

export function countTokens(text: string): number {
  return enc.encode(text).length;
}
