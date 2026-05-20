import type { CDPSession, Page } from 'playwright';

export class CdpBridge {
  private constructor(private readonly session: CDPSession) {}

  static async create(page: Page): Promise<CdpBridge> {
    const session = await page.context().newCDPSession(page);
    return new CdpBridge(session);
  }

  async send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    const looseSession = this.session as unknown as {
      send: (method: string, params?: Record<string, unknown>) => Promise<T>;
    };
    return looseSession.send(method, params);
  }

  async dispose(): Promise<void> {
    await this.session.detach().catch(() => undefined);
  }
}
