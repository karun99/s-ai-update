import { isIP } from 'node:net';
import { resolve as dnsResolve } from 'node:dns/promises';

const BLOCKED_HOSTS = ['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0', '[::]'];

const BLOCKED_RANGES: Array<{ test: (ip: string) => boolean; label: string }> = [
  { test: (ip) => ip === '127.0.0.1' || ip === '::1', label: 'loopback' },
  { test: (ip) => /^10\./.test(ip), label: 'RFC1918 10.x' },
  { test: (ip) => /^172\.(1[6-9]|2\d|3[01])\./.test(ip), label: 'RFC1918 172.16-31' },
  { test: (ip) => /^192\.168\./.test(ip), label: 'RFC1918 192.168' },
  { test: (ip) => /^169\.254\./.test(ip), label: 'link-local' },
  { test: (ip) => /^0\./.test(ip), label: 'current network' },
  { test: (ip) => /^100\.(6[4-9]|[7-9]\d|1[0-1][0-9]|12[0-7])\./.test(ip), label: 'CGNAT 100.64-127' },
  { test: (ip) => /^192\.0\.0\./.test(ip), label: 'IETF protocol' },
  { test: (ip) => /^192\.0\.2\./.test(ip), label: 'documentation 192.0.2' },
  { test: (ip) => /^198\.51\.100\./.test(ip), label: 'documentation 198.51.100' },
  { test: (ip) => /^203\.0\.113\./.test(ip), label: 'documentation 203.0.113' },
  { test: (ip) => /^22[4-9]\./.test(ip) || /^23[0-9]\./.test(ip) || /^24[0-9]\./.test(ip) || /^25[0-5]\./.test(ip), label: 'multicast/broadcast' },
  { test: (ip) => /^fc00:/.test(ip) || /^fd/.test(ip), label: 'IPv6 ULA' },
  { test: (ip) => /^fe[89ab]/i.test(ip), label: 'IPv6 link-local' },
  { test: (ip) => /^ff/i.test(ip), label: 'IPv6 multicast' },
];

const ALLOWED_SCHEMES = new Set(['http:', 'https:']);
const MAX_REDIRECTS = 5;
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;

function normalizeIPv4(ip: string): string {
  if (ip.includes('.')) return ip;
  const v4Match = ip.match(/::ffff:(\d+\.\d+\.\d+\.\d+)/i);
  if (v4Match) return v4Match[1];
  return ip;
}

function isBlockedIP(ip: string): string | null {
  const normalized = normalizeIPv4(ip);
  for (const rule of BLOCKED_RANGES) {
    if (rule.test(normalized)) return rule.label;
  }
  return null;
}

function isIPAddress(hostname: string): boolean {
  return isIP(hostname) !== 0;
}

function dnsRebindGuard(hostname: string): { blocked: boolean; reason?: string } {
  if (isIPAddress(hostname)) {
    const blockReason = isBlockedIP(hostname);
    if (blockReason) return { blocked: true, reason: `Direct IP ${hostname} is ${blockReason}` };
    return { blocked: false };
  }
  return { blocked: false };
}

export async function validateUrlSafety(urlStr: string): Promise<{ safe: boolean; error?: string }> {
  let url: URL;
  try {
    url = new URL(urlStr);
  } catch {
    return { safe: false, error: 'Invalid URL format' };
  }

  if (!ALLOWED_SCHEMES.has(url.protocol)) {
    return { safe: false, error: `Blocked scheme: ${url.protocol}. Only HTTP(S) allowed` };
  }

  const hostname = url.hostname.toLowerCase();

  if (BLOCKED_HOSTS.includes(hostname)) {
    return { safe: false, error: `Blocked hostname: ${hostname}` };
  }

  if (/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.)/.test(hostname)) {
    return { safe: false, error: `Blocked private IP range: ${hostname}` };
  }

  const directCheck = dnsRebindGuard(hostname);
  if (directCheck.blocked) {
    return { safe: false, error: directCheck.reason };
  }

  if (!isIPAddress(hostname)) {
    try {
      const resolved = await dnsResolve(hostname);
      for (const ip of resolved) {
        const blockReason = isBlockedIP(ip);
        if (blockReason) {
          return { safe: false, error: `DNS resolution for ${hostname} returned ${ip} (${blockReason})` };
        }
      }
    } catch (err) {
      return { safe: false, error: `DNS resolution failed for ${hostname}: ${(err as Error).message}` };
    }
  }

  return { safe: true };
}

export async function safeFetch(
  url: string,
  options: {
    timeout?: number;
    maxRedirects?: number;
    maxResponseBytes?: number;
    headers?: Record<string, string>;
  } = {}
): Promise<Response> {
  const validation = await validateUrlSafety(url);
  if (!validation.safe) {
    throw new Error(`SSRF blocked: ${validation.error}`);
  }

  const maxRedirects = options.maxRedirects ?? MAX_REDIRECTS;
  const timeout = options.timeout ?? 30_000;

  let currentUrl = url;
  let redirectCount = 0;

  while (redirectCount <= maxRedirects) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const resp = await fetch(currentUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'S-AI/6.0 (AI Research Assistant)',
          ...options.headers
        },
        redirect: 'manual'
      });

      clearTimeout(timer);

      if ([301, 302, 303, 307, 308].includes(resp.status)) {
        redirectCount++;
        const location = resp.headers.get('location');
        if (!location) throw new Error('Redirect without Location header');

        const redirectUrl = new URL(location, currentUrl).toString();
        const redirectValidation = await validateUrlSafety(redirectUrl);
        if (!redirectValidation.safe) {
          throw new Error(`SSRF blocked on redirect: ${redirectValidation.error}`);
        }
        currentUrl = redirectUrl;
        continue;
      }

      const contentLength = parseInt(resp.headers.get('content-length') || '0', 10);
      const maxBytes = options.maxResponseBytes ?? MAX_RESPONSE_BYTES;
      if (contentLength > maxBytes) {
        throw new Error(`Response too large: ${contentLength} bytes (max: ${maxBytes})`);
      }

      return resp;
    } catch (err) {
      clearTimeout(timer);
      throw err;
    }
  }

  throw new Error(`Too many redirects (max: ${maxRedirects})`);
}

export function isPrivateUrl(urlStr: string): boolean {
  try {
    const u = new URL(urlStr);
    const hostname = u.hostname.toLowerCase();
    if (BLOCKED_HOSTS.includes(hostname)) return true;
    if (/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.)/.test(hostname)) return true;
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return true;
    return false;
  } catch { return true; }
}

export { MAX_RESPONSE_BYTES, MAX_REDIRECTS, BLOCKED_HOSTS };
