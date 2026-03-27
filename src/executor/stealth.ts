// Stealth Utilities — jitter and human-like timing
// All executor actions use these — stealth lives in one place

export async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function jitter(minMs = 50, maxMs = 200): Promise<void> {
  await sleep(minMs + Math.random() * (maxMs - minMs));
}

export async function typeDelay(): Promise<void> {
  await sleep(30 + Math.random() * 50);
}

export async function actionSettle(fastMs = 300, slowMs = 800): Promise<void> {
  await sleep(fastMs + Math.random() * (slowMs - fastMs));
}
