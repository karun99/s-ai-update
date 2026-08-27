import { describe, it } from 'node:test';
import assert from 'node:assert';
import { hashToken, generateAuthToken, revokeToken, getAuthConfig } from '../../src/security/auth.js';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

describe('Auth - hashToken', () => {
  it('returns a hex string', () => {
    const hash = hashToken('test-token');
    assert.match(hash, /^[a-f0-9]{64}$/);
  });

  it('is deterministic', () => {
    const h1 = hashToken('hello');
    const h2 = hashToken('hello');
    assert.strictEqual(h1, h2);
  });

  it('produces different hashes for different inputs', () => {
    const h1 = hashToken('token-a');
    const h2 = hashToken('token-b');
    assert.notStrictEqual(h1, h2);
  });
});

describe('Auth - generateAuthToken', () => {
  it('generates a token with s-ai prefix', () => {
    const token = generateAuthToken();
    assert.ok(token.startsWith('s-ai-'));
    assert.ok(token.length > 36);
  });

  it('generates unique tokens on subsequent calls (if no existing token)', () => {
    const authDir = join(homedir(), '.s-ai', 'auth');
    if (!existsSync(authDir)) mkdirSync(authDir, { recursive: true });
    revokeToken();
    const t1 = generateAuthToken();
    revokeToken();
    const t2 = generateAuthToken();
    assert.notStrictEqual(t1, t2);
  });
});

describe('Auth - getAuthConfig', () => {
  it('returns an object with mode', () => {
    const config = getAuthConfig();
    assert.ok(['local', 'lan', 'off'].includes(config.mode));
  });
});
