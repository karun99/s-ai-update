import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { z } from 'zod';
import type {
  ActionProposal, ExecutionPlan, ExecutionResult, ExecutionReport,
  ApprovalRequest, ApprovalResponse, ApprovalHandler, ExecutionEngineConfig,
  RiskLevel, ToolMetadata, ToolParamDef
} from '../execution/types.js';
import { getToolMeta, getRiskForTool } from '../execution/registry.js';
import { isPathInSandbox, validateShellCommand, WORKSPACE_ROOT } from './sandbox.js';

function getAuditDir(): string {
  const dir = join(homedir(), '.s-ai', 'audit');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function redactSensitive(obj: unknown): unknown {
  if (typeof obj === 'string') {
    if (obj.length > 20 && /[A-Za-z0-9+/=]{20,}/.test(obj)) return '[REDACTED]';
    if (obj.includes('@') && obj.includes('.')) return '[EMAIL_REDACTED]';
    return obj;
  }
  if (Array.isArray(obj)) return obj.map(redactSensitive);
  if (obj && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    const sensitiveKeys = ['apiKey', 'secret', 'token', 'password', 'key', 'credential', 'authorization'];
    for (const [k, v] of Object.entries(obj)) {
      if (sensitiveKeys.some(sk => k.toLowerCase().includes(sk))) {
        result[k] = '[REDACTED]';
      } else {
        result[k] = redactSensitive(v);
      }
    }
    return result;
  }
  return obj;
}

function auditLog(entry: Record<string, unknown>): void {
  const path = join(getAuditDir(), `${new Date().toISOString().slice(0, 10)}.jsonl`);
  appendFileSync(path, JSON.stringify({ ...entry, timestamp: new Date().toISOString() }) + '\n');
}

function buildZodSchema(params: Record<string, ToolParamDef>): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [key, def] of Object.entries(params)) {
    let field: z.ZodTypeAny;
    switch (def.type) {
      case 'string': field = z.string(); break;
      case 'number': field = z.number(); break;
      case 'boolean': field = z.boolean(); break;
      case 'object': field = z.record(z.unknown()); break;
      case 'array': field = z.array(z.unknown()); break;
      default: field = z.unknown();
    }
    if (def.enum) field = z.enum(def.enum as [string, ...string[]]);
    if (def.required) {
      shape[key] = field;
    } else {
      shape[key] = field.optional();
    }
  }
  return z.object(shape);
}

type ToolExecutorFn = (tool: string, params: Record<string, unknown>) => Promise<unknown>;

export class SecureExecutionEngine {
  private config: ExecutionEngineConfig;
  private approvalHandler: ApprovalHandler;
  private pendingApprovals: Map<string, { resolve: (r: ApprovalResponse) => void; request: ApprovalRequest }> = new Map();
  private activeExecutions: number = 0;
  private abortControllers: Map<string, AbortController> = new Map();

  constructor(config: ExecutionEngineConfig = {}) {
    this.config = {
      autoApproveLowRisk: false,
      maxConcurrentActions: 5,
      timeout: 30_000,
      auditLog: true,
      ...config
    };
    this.approvalHandler = config.defaultApprovalHandler ?? this._defaultApprovalHandler.bind(this);
  }

  setApprovalHandler(handler: ApprovalHandler): void {
    this.approvalHandler = handler;
  }

  createPlan(
    actions: Array<{ tool: string; params: Record<string, unknown>; reason: string }>,
    rationale: string,
    consensusScore: number,
    swarmRounds: number,
    elapsed: number
  ): ExecutionPlan {
    const proposals: ActionProposal[] = actions.map(a => ({
      id: randomUUID().slice(0, 8),
      tool: a.tool,
      params: a.params,
      riskLevel: getRiskForTool(a.tool),
      reason: a.reason,
      reversible: getToolMeta(a.tool)?.reversible ?? false,
      proposedBy: 'swarm',
      timestamp: Date.now()
    }));

    return {
      id: randomUUID().slice(0, 8),
      actions: proposals,
      rationale,
      consensusScore,
      swarmRounds,
      elapsed,
      timestamp: Date.now()
    };
  }

  async executePlan(
    plan: ExecutionPlan,
    toolExecutor: ToolExecutorFn
  ): Promise<ExecutionReport> {
    const results: ExecutionResult[] = [];
    let approved = 0, denied = 0, executed = 0, failed = 0;
    const start = Date.now();

    const concurrencyLimit = this.config.maxConcurrentActions ?? 5;
    const executing: Promise<void>[] = [];

    for (const action of plan.actions) {
      while (this.activeExecutions >= concurrencyLimit) {
        await Promise.race(executing);
      }

      const resultPromise = this.executeAction(action, toolExecutor).then(result => {
        results.push(result);
        this.activeExecutions--;
        if (result.status === 'approved' || result.status === 'executed') approved++;
        if (result.status === 'denied' || result.status === 'cancelled') denied++;
        if (result.status === 'executed') executed++;
        if (result.status === 'failed') failed++;
      });

      this.activeExecutions++;
      executing.push(resultPromise);
    }

    await Promise.all(executing);

    const report: ExecutionReport = {
      planId: plan.id,
      results,
      totalActions: plan.actions.length,
      approved,
      denied,
      executed,
      failed,
      elapsed: Date.now() - start
    };

    if (this.config.auditLog) {
      auditLog({ type: 'plan_executed', planId: plan.id, report: { total: report.totalActions, executed: report.executed, denied: report.denied, failed: report.failed } });
    }

    return report;
  }

  async executeAction(
    action: ActionProposal,
    toolExecutor: ToolExecutorFn
  ): Promise<ExecutionResult> {
    const start = Date.now();
    const abortController = new AbortController();
    this.abortControllers.set(action.id, abortController);

    try {
      if (action.riskLevel === 'critical') {
        if (this.config.auditLog) auditLog({ type: 'action_denied', actionId: action.id, tool: action.tool, reason: 'critical risk auto-denied' });
        return { actionId: action.id, tool: action.tool, status: 'denied', error: 'Critical risk actions are auto-denied', durationMs: Date.now() - start };
      }

      const validationError = this.validateAction(action);
      if (validationError) {
        if (this.config.auditLog) auditLog({ type: 'action_denied', actionId: action.id, tool: action.tool, reason: validationError });
        return { actionId: action.id, tool: action.tool, status: 'denied', error: validationError, durationMs: Date.now() - start };
      }

      const needsApproval = this._needsApproval(action);
      if (needsApproval) {
        const response = await this._requestApproval(action);
        if (response.decision === 'deny') {
          if (this.config.auditLog) auditLog({ type: 'action_denied', actionId: action.id, tool: action.tool, reason: response.reason ?? 'user denied' });
          return { actionId: action.id, tool: action.tool, status: 'denied', error: response.reason ?? 'User denied', durationMs: Date.now() - start, approvalDecision: 'deny' };
        }
      }

      const output = await this.executeWithTimeout(
        () => toolExecutor(action.tool, action.params),
        this.config.timeout ?? 30_000,
        abortController.signal
      );

      if (this.config.auditLog) auditLog({
        type: 'action_executed',
        actionId: action.id,
        tool: action.tool,
        riskLevel: action.riskLevel,
        params: redactSensitive(action.params)
      });

      return {
        actionId: action.id,
        tool: action.tool,
        status: 'executed',
        output,
        durationMs: Date.now() - start,
        approvalDecision: needsApproval ? 'allow' : undefined
      };
    } catch (err) {
      if (this.config.auditLog) auditLog({ type: 'action_failed', actionId: action.id, tool: action.tool, error: (err as Error).message });
      return {
        actionId: action.id,
        tool: action.tool,
        status: 'failed',
        error: (err as Error).message,
        durationMs: Date.now() - start
      };
    } finally {
      this.abortControllers.delete(action.id);
    }
  }

  private validateAction(action: ActionProposal): string | null {
    const meta = getToolMeta(action.tool);
    if (!meta) return `Unknown tool: ${action.tool}`;

    try {
      const schema = buildZodSchema(meta.params);
      schema.parse(action.params);
    } catch (err) {
      return `Parameter validation failed: ${(err as Error).message}`;
    }

    if (action.tool === 'readFile' || action.tool === 'writeFile' || action.tool === 'listDir') {
      const pathParam = action.params.path as string;
      if (pathParam) {
        const pathCheck = isPathInSandbox(pathParam);
        if (!pathCheck.safe) return `Filesystem sandbox: ${pathCheck.reason}`;
      }
    }

    if (action.tool === 'execShell') {
      const command = action.params.command as string;
      if (command) {
        const cmdCheck = validateShellCommand(command);
        if (!cmdCheck.allowed) return `Shell sandbox: ${cmdCheck.reason}`;
      }
    }

    return null;
  }

  private async executeWithTimeout<T>(
    fn: () => Promise<T>,
    timeoutMs: number,
    signal: AbortSignal
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Execution timeout'));
      }, timeoutMs);

      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new Error('Execution aborted'));
      });

      fn().then(
        (result) => { clearTimeout(timer); resolve(result); },
        (err) => { clearTimeout(timer); reject(err); }
      );
    });
  }

  parseActionPlan(
    text: string,
    consensusScore: number,
    swarmRounds: number,
    elapsed: number
  ): ExecutionPlan | null {
    try {
      const jsonMatch = text.match(/```json\s*([\s\S]*?)```/) || text.match(/\{[\s\S]*"actions"[\s\S]*\}/);
      if (!jsonMatch) return null;
      const jsonStr = jsonMatch[1] || jsonMatch[0];
      const parsed = JSON.parse(jsonStr);

      if (!parsed.actions || !Array.isArray(parsed.actions)) return null;

      return this.createPlan(
        parsed.actions,
        parsed.rationale || '',
        consensusScore,
        swarmRounds,
        elapsed
      );
    } catch {
      return null;
    }
  }

  private _needsApproval(action: ActionProposal): boolean {
    if (this.config.autoApproveLowRisk && action.riskLevel === 'low') return false;
    const meta = getToolMeta(action.tool);
    return meta?.requiresApproval ?? (action.riskLevel === 'high' || action.riskLevel === 'critical');
  }

  private async _requestApproval(action: ActionProposal): Promise<ApprovalResponse> {
    const request: ApprovalRequest = {
      actionId: action.id,
      tool: action.tool,
      riskLevel: action.riskLevel,
      params: redactSensitive(action.params) as Record<string, unknown>,
      reason: action.reason,
      reversible: action.reversible,
      timestamp: Date.now()
    };

    return new Promise(resolve => {
      this.pendingApprovals.set(action.id, { resolve, request });
      Promise.resolve(this.approvalHandler(request)).then(response => {
        this.pendingApprovals.delete(action.id);
        resolve(response);
      });
    });
  }

  private async _defaultApprovalHandler(request: ApprovalRequest): Promise<ApprovalResponse> {
    return { actionId: request.actionId, decision: 'deny', reason: 'No approval handler configured', timestamp: Date.now() };
  }

  getPendingApprovals(): ApprovalRequest[] {
    return [...this.pendingApprovals.values()].map(v => v.request);
  }

  resolveApproval(actionId: string, decision: 'allow' | 'deny' | 'allow-always', reason?: string): boolean {
    const pending = this.pendingApprovals.get(actionId);
    if (!pending) return false;
    pending.resolve({ actionId, decision, reason, timestamp: Date.now() });
    this.pendingApprovals.delete(actionId);
    return true;
  }

  abortAction(actionId: string): boolean {
    const controller = this.abortControllers.get(actionId);
    if (!controller) return false;
    controller.abort();
    this.abortControllers.delete(actionId);
    return true;
  }
}
