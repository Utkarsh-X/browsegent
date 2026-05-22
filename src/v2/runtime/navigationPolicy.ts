export const NAVIGATION_URL_POLICY_MESSAGE = 'navigate URL must use http, https, or file';

const SUPPORTED_NAVIGATION_PROTOCOLS = new Set(['http:', 'https:', 'file:']);

export function isSupportedNavigationUrl(url: string): boolean {
  try {
    return SUPPORTED_NAVIGATION_PROTOCOLS.has(new URL(url).protocol);
  } catch {
    return false;
  }
}
