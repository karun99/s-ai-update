import { describe, it } from 'node:test';
import assert from 'node:assert';
import { isPrivateUrl, validateUrlSafety, MAX_RESPONSE_BYTES, MAX_REDIRECTS, BLOCKED_HOSTS } from '../../src/security/ssrf.js';

describe('SSRF - isPrivateUrl (sync)', () => {
  it('blocks localhost', () => {
    assert.strictEqual(isPrivateUrl('http://localhost/admin'), true);
  });

  it('blocks 127.0.0.1', () => {
    assert.strictEqual(isPrivateUrl('http://127.0.0.1:8080/secret'), true);
  });

  it('blocks ::1', () => {
    assert.strictEqual(isPrivateUrl('http://[::1]/'), true);
  });

  it('blocks RFC1918 10.x', () => {
    assert.strictEqual(isPrivateUrl('http://10.0.0.1/api'), true);
  });

  it('blocks RFC1918 172.16-31', () => {
    assert.strictEqual(isPrivateUrl('http://172.16.0.1/'), true);
    assert.strictEqual(isPrivateUrl('http://172.31.255.255/'), true);
  });

  it('blocks RFC1918 192.168', () => {
    assert.strictEqual(isPrivateUrl('http://192.168.1.1/'), true);
  });

  it('blocks link-local 169.254', () => {
    assert.strictEqual(isPrivateUrl('http://169.254.169.254/'), true);
  });

  it('blocks non-HTTP schemes', () => {
    assert.strictEqual(isPrivateUrl('file:///etc/passwd'), true);
    assert.strictEqual(isPrivateUrl('ftp://example.com'), true);
    assert.strictEqual(isPrivateUrl('javascript:alert(1)'), true);
  });

  it('allows public HTTP URLs', () => {
    assert.strictEqual(isPrivateUrl('https://example.com'), false);
    assert.strictEqual(isPrivateUrl('http://google.com'), false);
  });

  it('handles invalid URLs', () => {
    assert.strictEqual(isPrivateUrl('not-a-url'), true);
    assert.strictEqual(isPrivateUrl(''), true);
  });
});

describe('SSRF - validateUrlSafety (async)', async () => {
  it('blocks localhost', async () => {
    const result = await validateUrlSafety('http://localhost/admin');
    assert.strictEqual(result.safe, false);
    assert.ok(result.error?.includes('localhost'));
  });

  it('blocks 127.0.0.1', async () => {
    const result = await validateUrlSafety('http://127.0.0.1/secret');
    assert.strictEqual(result.safe, false);
  });

  it('blocks file:// scheme', async () => {
    const result = await validateUrlSafety('file:///etc/passwd');
    assert.strictEqual(result.safe, false);
    assert.ok(result.error?.includes('scheme'));
  });

  it('blocks private IP ranges', async () => {
    const result = await validateUrlSafety('http://10.0.0.1/');
    assert.strictEqual(result.safe, false);
    assert.ok(result.error?.includes('private'));
  });

  it('blocks 169.254 metadata endpoint', async () => {
    const result = await validateUrlSafety('http://169.254.169.254/latest/meta-data/');
    assert.strictEqual(result.safe, false);
  });

  it('handles invalid URL format', async () => {
    const result = await validateUrlSafety('not-a-valid-url');
    assert.strictEqual(result.safe, false);
    assert.ok(result.error?.includes('Invalid URL'));
  });
});

describe('SSRF constants', () => {
  it('MAX_REDIRECTS is defined', () => {
    assert.strictEqual(typeof MAX_REDIRECTS, 'number');
    assert.ok(MAX_REDIRECTS > 0);
  });

  it('MAX_RESPONSE_BYTES is defined', () => {
    assert.strictEqual(typeof MAX_RESPONSE_BYTES, 'number');
    assert.ok(MAX_RESPONSE_BYTES > 0);
  });

  it('BLOCKED_HOSTS includes expected entries', () => {
    assert.ok(BLOCKED_HOSTS.includes('localhost'));
    assert.ok(BLOCKED_HOSTS.includes('127.0.0.1'));
    assert.ok(BLOCKED_HOSTS.includes('::1'));
  });
});
