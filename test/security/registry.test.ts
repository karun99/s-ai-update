import { describe, it } from 'node:test';
import assert from 'node:assert';
import { validateToolParams, getToolMeta, listToolMeta, getRiskForTool } from '../../src/execution/registry.js';

describe('Tool Registry - validateToolParams', () => {
  it('validates readFile params correctly', () => {
    const result = validateToolParams('readFile', { path: '/tmp/test.txt' });
    assert.strictEqual(result.valid, true);
  });

  it('rejects readFile with missing path', () => {
    const result = validateToolParams('readFile', {});
    assert.strictEqual(result.valid, false);
    assert.ok(result.error);
  });

  it('validates writeFile params correctly', () => {
    const result = validateToolParams('writeFile', { path: '/tmp/test.txt', content: 'hello' });
    assert.strictEqual(result.valid, true);
  });

  it('rejects writeFile with missing content', () => {
    const result = validateToolParams('writeFile', { path: '/tmp/test.txt' });
    assert.strictEqual(result.valid, false);
  });

  it('validates execShell with command', () => {
    const result = validateToolParams('execShell', { command: 'ls -la' });
    assert.strictEqual(result.valid, true);
  });

  it('rejects execShell without command', () => {
    const result = validateToolParams('execShell', {});
    assert.strictEqual(result.valid, false);
  });

  it('validates httpRequest with url', () => {
    const result = validateToolParams('httpRequest', { url: 'https://example.com' });
    assert.strictEqual(result.valid, true);
  });

  it('validates httpRequest with method enum', () => {
    const result = validateToolParams('httpRequest', { url: 'https://example.com', method: 'POST' });
    assert.strictEqual(result.valid, true);
  });

  it('rejects httpRequest with invalid method', () => {
    const result = validateToolParams('httpRequest', { url: 'https://example.com', method: 'INVALID' });
    assert.strictEqual(result.valid, false);
  });

  it('validates swarmQuery', () => {
    const result = validateToolParams('swarmQuery', { question: 'What is AI?' });
    assert.strictEqual(result.valid, true);
  });

  it('rejects unknown tool', () => {
    const result = validateToolParams('nonexistentTool', {});
    assert.strictEqual(result.valid, false);
    assert.ok(result.error?.includes('Unknown tool'));
  });

  it('validates notify with required fields', () => {
    const result = validateToolParams('notify', { title: 'Alert', message: 'Something happened' });
    assert.strictEqual(result.valid, true);
  });
});

describe('Tool Registry - getToolMeta', () => {
  it('returns metadata for known tools', () => {
    const meta = getToolMeta('readFile');
    assert.ok(meta);
    assert.strictEqual(meta.name, 'readFile');
    assert.strictEqual(meta.riskLevel, 'low');
    assert.strictEqual(meta.category, 'filesystem');
  });

  it('returns undefined for unknown tools', () => {
    const meta = getToolMeta('nonexistent');
    assert.strictEqual(meta, undefined);
  });

  it('execShell is classified as high risk', () => {
    const meta = getToolMeta('execShell');
    assert.ok(meta);
    assert.strictEqual(meta.riskLevel, 'high');
    assert.strictEqual(meta.requiresApproval, true);
  });
});

describe('Tool Registry - getRiskForTool', () => {
  it('returns low for readFile', () => {
    assert.strictEqual(getRiskForTool('readFile'), 'low');
  });

  it('returns high for execShell', () => {
    assert.strictEqual(getRiskForTool('execShell'), 'high');
  });

  it('returns high for unknown tools (fail-closed)', () => {
    assert.strictEqual(getRiskForTool('unknownTool'), 'high');
  });
});

describe('Tool Registry - listToolMeta', () => {
  it('returns all registered tools', () => {
    const tools = listToolMeta();
    assert.ok(tools.length >= 12);
    const names = tools.map(t => t.name);
    assert.ok(names.includes('readFile'));
    assert.ok(names.includes('execShell'));
    assert.ok(names.includes('httpRequest'));
    assert.ok(names.includes('crawlWeb'));
  });
});
