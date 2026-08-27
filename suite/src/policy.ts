/**
 * Policy engine (FR-W3) — allow-all | deny-list | require-approval.
 *
 * Modeled on the governed-execution gate pattern from 26zl/cybersec-toolkit
 * (registry allowlist, per-tool blocked-flag denylist, human-in-the-loop
 * approval, rate limiting). Destructive tools default to require-approval;
 * catastrophic flag patterns are denied in EVERY mode.
 */
import { appendLog } from './config.js';
import { redactSecrets } from './vault.js';

export type PolicyMode = 'allow-all' | 'deny-list' | 'require-approval';

export type ApprovalDecision = 'allow' | 'deny' | 'allow-always';

export interface ApprovalRequest {
  jobId?: string;
  tool: string;
  reason: string;
  params: Record<string, unknown>;
}

export type Approver = (req: ApprovalRequest) => Promise<ApprovalDecision> | ApprovalDecision;

export interface Policy {
  mode: PolicyMode;
  /** deny-list mode: tool names or `tool` prefixes that are refused outright */
  deny?: string[];
  /** require-approval / allow-all override: extra tools forced through approval */
  requireApprovalFor?: string[];
  /** tools explicitly exempt from approval even in require-approval mode */
  allowWithoutApproval?: string[];
  /** max executions per minute per policy instance (rate limiting) */
  maxPerMinute?: number;
}

export interface PolicyDecision {
  allowed: boolean;
  requiresApproval: boolean;
  reason: string;
}

/** Tools that touch the filesystem outside caches or execute processes. */
export const DESTRUCTIVE_TOOLS: string[] = ['writeFile', 'shell', 'exec', 'bash', 'runScript'];

/**
 * Catastrophic argument patterns — denied regardless of mode. Inspired by the
 * cybersec-toolkit blocked-flag list (e.g. sqlmap --os-shell, nmap -iL).
 */
const HARD_DENIED_PATTERNS: Array<{ test: RegExp; why: string }> = [
  { test: /rm\s+-rf\s+(~|\/)(\s|$)/, why: 'recursive delete of home/root' },
  { test: /mkfs(\.|\s)/, why: 'filesystem formatting' },
  { test: /:\(\)\{.*\};:/, why: 'fork bomb' },
  { test: /--os-shell/, why: 'os-shell escalation flag' },
  { test: /dd\s+if=.*of=\/dev\//, why: 'raw device write' },
  { test: />\s*\/dev\/sd[a-z]/, why: 'raw device redirect' },
  { test: /shutdown|reboot\s+-f/, why: 'system power control' }
];

const DEFAULT_MAX_PER_MINUTE = 60;

export class PolicyEngine {
  private policy: Policy;
  private approver: Approver | null = null;
  private approvedAlways: Set<string> = new Set();
  private execTimestamps: number[] = [];

  constructor(policy?: Partial<Policy>, approver?: Approver) {
    this.policy = {
      mode: 'require-approval',
      deny: [],
      requireApprovalFor: [],
      allowWithoutApproval: [],
      maxPerMinute: DEFAULT_MAX_PER_MINUTE,
      ...policy
    };
    if (approver) this.approver = approver;
  }

  setApprover(approver: Approver): void { this.approver = approver; }

  private _isDestructive(tool: string): boolean {
    return DESTRUCTIVE_TOOLS.some(d => tool === d || tool.startsWith(`${d}:`));
  }

  private _rateLimited(): boolean {
    const now = Date.now();
    this.execTimestamps = this.execTimestamps.filter(t => now - t < 60_000);
    const cap = this.policy.maxPerMinute ?? DEFAULT_MAX_PER_MINUTE;
    return this.execTimestamps.length >= cap;
  }

  private _recordExec(): void { this.execTimestamps.push(Date.now()); }

  decide(tool: string, params: Record<string, unknown> = {}): PolicyDecision {
    const serializedParams = redactSecrets(JSON.stringify(params ?? {}));
    for (const { test, why } of HARD_DENIED_PATTERNS) {
      if (test.test(serializedParams)) {
        appendLog(`policy hard-deny ${tool}: ${why}`);
        return { allowed: false, requiresApproval: false, reason: `hard-denied: ${why}` };
      }
    }

    const denyList = this.policy.deny ?? [];
    if (this.policy.mode === 'deny-list') {
      const hit = denyList.find(d => tool === d || tool.startsWith(`${d}.`) || tool.startsWith(`${d}:`));
      if (hit) return { allowed: false, requiresApproval: false, reason: `tool "${tool}" is on the deny-list ("${hit}")` };
      return this._finalAllow(tool, 'not on deny-list');
    }

    if (this._isDestructive(tool) && !(this.policy.allowWithoutApproval ?? []).includes(tool)) {
      if (this.policy.mode === 'require-approval') return { allowed: true, requiresApproval: true, reason: 'destructive tool requires approval' };
    }

    const forcedApproval = (this.policy.requireApprovalFor ?? []).some(d => tool === d || tool.startsWith(`${d}:`));
    if (forcedApproval && !this.approvedAlways.has(tool)) {
      return { allowed: true, requiresApproval: true, reason: `tool "${tool}" is configured to require approval` };
    }

    return this._finalAllow(tool, `mode=${this.policy.mode}`);
  }

  private _finalAllow(tool: string, why: string): PolicyDecision {
    if (this._rateLimited()) {
      return { allowed: false, requiresApproval: false, reason: `rate limit exceeded (${this.policy.maxPerMinute}/min)` };
    }
    this._recordExec();
    appendLog(`policy allow ${tool} (${why})`);
    return { allowed: true, requiresApproval: false, reason: why };
  }

  /**
   * Full gated execution path: decide -> (approval?) -> run -> audit log.
   * Returns `{ ok:false }` with a reason when refused; never throws for refusals.
   */
  async execute<T>(
    tool: string,
    params: Record<string, unknown>,
    run: () => Promise<T>
  ): Promise<{ ok: true; result: T; decision: PolicyDecision } | { ok: false; reason: string }> {
    let decision = this.decide(tool, params);

    if (decision.allowed && decision.requiresApproval && !this.approvedAlways.has(tool)) {
      if (!this.approver) {
        return { ok: false, reason: `approval required for "${tool}" but no approver is attached` };
      }
      const verdict = await this.approver({ tool, params, reason: decision.reason });
      if (verdict === 'allow-always') this.approvedAlways.add(tool);
      if (verdict !== 'allow' && verdict !== 'allow-always') {
        appendLog(`policy approval DENIED ${tool}`);
        return { ok: false, reason: `user denied execution of "${tool}"` };
      }
      decision = { ...decision, requiresApproval: false, reason: `${decision.reason} (approved)` };
    }

    if (!decision.allowed) return { ok: false, reason: decision.reason };

    try {
      const result = await run();
      return { ok: true, result, decision };
    } catch (err) {
      appendLog(`policy execute ${tool} failed: ${redactSecrets((err as Error).message)}`);
      throw err;
    }
  }
}
