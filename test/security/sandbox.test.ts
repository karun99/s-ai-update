import { describe, it } from 'node:test';
import assert from 'node:assert';
import { isPathInSandbox, validateShellCommand, WORKSPACE_ROOT } from '../../src/security/sandbox.js';
import { homedir } from 'node:os';
import { join } from 'node:path';

describe('Filesystem Sandbox', () => {
  it('allows paths within workspace', () => {
    const result = isPathInSandbox(join(WORKSPACE_ROOT, 'project', 'file.txt'));
    assert.strictEqual(result.safe, true);
  });

  it('allows paths in .s-ai/data', () => {
    const result = isPathInSandbox(join(homedir(), '.s-ai', 'data', 'graph', 'test.json'));
    assert.strictEqual(result.safe, true);
  });

  it('blocks paths outside allowed roots', () => {
    const result = isPathInSandbox('/etc/passwd');
    assert.strictEqual(result.safe, false);
  });

  it('blocks .ssh directory', () => {
    const result = isPathInSandbox(join(WORKSPACE_ROOT, '.ssh', 'id_rsa'));
    assert.strictEqual(result.safe, false);
    assert.ok(result.reason?.includes('.ssh'));
  });

  it('blocks .env files', () => {
    const result = isPathInSandbox(join(WORKSPACE_ROOT, '.env'));
    assert.strictEqual(result.safe, false);
  });

  it('blocks credential files', () => {
    const result = isPathInSandbox(join(WORKSPACE_ROOT, 'credentials'));
    assert.strictEqual(result.safe, false);
  });

  it('blocks key files', () => {
    const result = isPathInSandbox(join(WORKSPACE_ROOT, 'certs', 'server.key'));
    assert.strictEqual(result.safe, false);
  });

  it('blocks .aws directory', () => {
    const result = isPathInSandbox(join(homedir(), '.aws', 'credentials'));
    assert.strictEqual(result.safe, false);
  });
});

describe('Shell Command Sandbox', () => {
  it('allows safe commands in safe mode', () => {
    const result = validateShellCommand('ls -la', { mode: 'safe' });
    assert.strictEqual(result.allowed, true);
  });

  it('blocks rm in safe mode', () => {
    const result = validateShellCommand('rm -rf /', { mode: 'safe' });
    assert.strictEqual(result.allowed, false);
    assert.ok(result.reason?.includes('blocked'));
  });

  it('blocks curl in safe mode', () => {
    const result = validateShellCommand('curl http://evil.com', { mode: 'safe' });
    assert.strictEqual(result.allowed, false);
  });

  it('blocks command substitution', () => {
    const result = validateShellCommand('cat $(whoami)', { mode: 'safe' });
    assert.strictEqual(result.allowed, false);
    assert.ok(result.reason?.includes('substitution'));
  });

  it('blocks backtick substitution', () => {
    const result = validateShellCommand('echo `whoami`', { mode: 'safe' });
    assert.strictEqual(result.allowed, false);
  });

  it('allows commands in full mode', () => {
    const result = validateShellCommand('rm -rf /', { mode: 'full' });
    assert.strictEqual(result.allowed, true);
  });

  it('allows allowed commands in restricted mode', () => {
    const result = validateShellCommand('git status', {
      mode: 'restricted',
      allowedCommands: ['git', 'ls', 'cat']
    });
    assert.strictEqual(result.allowed, true);
  });

  it('blocks commands not in allowlist in restricted mode', () => {
    const result = validateShellCommand('rm -rf /', {
      mode: 'restricted',
      allowedCommands: ['git', 'ls', 'cat']
    });
    assert.strictEqual(result.allowed, false);
    assert.ok(result.reason?.includes('not in allowlist'));
  });

  it('blocks empty commands', () => {
    const result = validateShellCommand('', { mode: 'safe' });
    assert.strictEqual(result.allowed, false);
  });
});
