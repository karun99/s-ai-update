import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { z } from 'zod';
import { getToolMeta, getRiskForTool } from '../execution/registry.js';
import { isPathInSandbox, validateShellCommand } from './sandbox.js';
function getAuditDir() {
    const dir = join(homedir(), '.s-ai', 'audit');
    if (!existsSync(dir))
        mkdirSync(dir, { recursive: true });
    return dir;
}
function redactSensitive(obj) {
    if (typeof obj === 'string') {
        if (obj.length > 20 && /[A-Za-z0-9+/=]{20,}/.test(obj))
            return '[REDACTED]';
        if (obj.includes('@') && obj.includes('.'))
            return '[EMAIL_REDACTED]';
        return obj;
    }
    if (Array.isArray(obj))
        return obj.map(redactSensitive);
    if (obj && typeof obj === 'object') {
        const result = {};
        const sensitiveKeys = ['apiKey', 'secret', 'token', 'password', 'key', 'credential', 'authorization'];
        for (const [k, v] of Object.entries(obj)) {
            if (sensitiveKeys.some(sk => k.toLowerCase().includes(sk))) {
                result[k] = '[REDACTED]';
            }
            else {
                result[k] = redactSensitive(v);
            }
        }
        return result;
    }
    return obj;
}
function auditLog(entry) {
    const path = join(getAuditDir(), `${new Date().toISOString().slice(0, 10)}.jsonl`);
    appendFileSync(path, JSON.stringify({ ...entry, timestamp: new Date().toISOString() }) + '\n');
}
function buildZodSchema(params) {
    const shape = {};
    for (const [key, def] of Object.entries(params)) {
        let field;
        switch (def.type) {
            case 'string':
                field = z.string();
                break;
            case 'number':
                field = z.number();
                break;
            case 'boolean':
                field = z.boolean();
                break;
            case 'object':
                field = z.record(z.string(), z.unknown());
                break;
            case 'array':
                field = z.array(z.unknown());
                break;
            default: field = z.unknown();
        }
        if (def.enum)
            field = z.enum(def.enum);
        if (def.required) {
            shape[key] = field;
        }
        else {
            shape[key] = field.optional();
        }
    }
    return z.object(shape);
}
export class SecureExecutionEngine {
    config;
    approvalHandler;
    pendingApprovals = new Map();
    activeExecutions = 0;
    abortControllers = new Map();
    constructor(config = {}) {
        this.config = {
            autoApproveLowRisk: false,
            maxConcurrentActions: 5,
            timeout: 30_000,
            auditLog: true,
            ...config
        };
        this.approvalHandler = config.defaultApprovalHandler ?? this._defaultApprovalHandler.bind(this);
    }
    setApprovalHandler(handler) {
        this.approvalHandler = handler;
    }
    createPlan(actions, rationale, consensusScore, swarmRounds, elapsed) {
        const proposals = actions.map(a => ({
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
    async executePlan(plan, toolExecutor) {
        const results = [];
        let approved = 0, denied = 0, executed = 0, failed = 0;
        const start = Date.now();
        const concurrencyLimit = this.config.maxConcurrentActions ?? 5;
        const executing = [];
        for (const action of plan.actions) {
            while (this.activeExecutions >= concurrencyLimit) {
                await Promise.race(executing);
            }
            const resultPromise = this.executeAction(action, toolExecutor).then(result => {
                results.push(result);
                this.activeExecutions--;
                if (result.status === 'approved' || result.status === 'executed')
                    approved++;
                if (result.status === 'denied' || result.status === 'cancelled')
                    denied++;
                if (result.status === 'executed')
                    executed++;
                if (result.status === 'failed')
                    failed++;
            });
            this.activeExecutions++;
            executing.push(resultPromise);
        }
        await Promise.all(executing);
        const report = {
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
    async executeAction(action, toolExecutor) {
        const start = Date.now();
        const abortController = new AbortController();
        this.abortControllers.set(action.id, abortController);
        try {
            if (action.riskLevel === 'critical') {
                if (this.config.auditLog)
                    auditLog({ type: 'action_denied', actionId: action.id, tool: action.tool, reason: 'critical risk auto-denied' });
                return { actionId: action.id, tool: action.tool, status: 'denied', error: 'Critical risk actions are auto-denied', durationMs: Date.now() - start };
            }
            const validationError = this.validateAction(action);
            if (validationError) {
                if (this.config.auditLog)
                    auditLog({ type: 'action_denied', actionId: action.id, tool: action.tool, reason: validationError });
                return { actionId: action.id, tool: action.tool, status: 'denied', error: validationError, durationMs: Date.now() - start };
            }
            const needsApproval = this._needsApproval(action);
            if (needsApproval) {
                const response = await this._requestApproval(action);
                if (response.decision === 'deny') {
                    if (this.config.auditLog)
                        auditLog({ type: 'action_denied', actionId: action.id, tool: action.tool, reason: response.reason ?? 'user denied' });
                    return { actionId: action.id, tool: action.tool, status: 'denied', error: response.reason ?? 'User denied', durationMs: Date.now() - start, approvalDecision: 'deny' };
                }
            }
            const output = await this.executeWithTimeout(() => toolExecutor(action.tool, action.params), this.config.timeout ?? 30_000, abortController.signal);
            if (this.config.auditLog)
                auditLog({
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
        }
        catch (err) {
            if (this.config.auditLog)
                auditLog({ type: 'action_failed', actionId: action.id, tool: action.tool, error: err.message });
            return {
                actionId: action.id,
                tool: action.tool,
                status: 'failed',
                error: err.message,
                durationMs: Date.now() - start
            };
        }
        finally {
            this.abortControllers.delete(action.id);
        }
    }
    validateAction(action) {
        const meta = getToolMeta(action.tool);
        if (!meta)
            return `Unknown tool: ${action.tool}`;
        try {
            const schema = buildZodSchema(meta.params);
            schema.parse(action.params);
        }
        catch (err) {
            return `Parameter validation failed: ${err.message}`;
        }
        if (action.tool === 'readFile' || action.tool === 'writeFile' || action.tool === 'listDir') {
            const pathParam = action.params.path;
            if (pathParam) {
                const pathCheck = isPathInSandbox(pathParam);
                if (!pathCheck.safe)
                    return `Filesystem sandbox: ${pathCheck.reason}`;
            }
        }
        if (action.tool === 'execShell') {
            const command = action.params.command;
            if (command) {
                const cmdCheck = validateShellCommand(command);
                if (!cmdCheck.allowed)
                    return `Shell sandbox: ${cmdCheck.reason}`;
            }
        }
        return null;
    }
    async executeWithTimeout(fn, timeoutMs, signal) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new Error('Execution timeout'));
            }, timeoutMs);
            signal.addEventListener('abort', () => {
                clearTimeout(timer);
                reject(new Error('Execution aborted'));
            });
            fn().then((result) => { clearTimeout(timer); resolve(result); }, (err) => { clearTimeout(timer); reject(err); });
        });
    }
    parseActionPlan(text, consensusScore, swarmRounds, elapsed) {
        try {
            const jsonMatch = text.match(/```json\s*([\s\S]*?)```/) || text.match(/\{[\s\S]*"actions"[\s\S]*\}/);
            if (!jsonMatch)
                return null;
            const jsonStr = jsonMatch[1] || jsonMatch[0];
            const parsed = JSON.parse(jsonStr);
            if (!parsed.actions || !Array.isArray(parsed.actions))
                return null;
            return this.createPlan(parsed.actions, parsed.rationale || '', consensusScore, swarmRounds, elapsed);
        }
        catch {
            return null;
        }
    }
    _needsApproval(action) {
        if (this.config.autoApproveLowRisk && action.riskLevel === 'low')
            return false;
        const meta = getToolMeta(action.tool);
        return meta?.requiresApproval ?? (action.riskLevel === 'high' || action.riskLevel === 'critical');
    }
    async _requestApproval(action) {
        const request = {
            actionId: action.id,
            tool: action.tool,
            riskLevel: action.riskLevel,
            params: redactSensitive(action.params),
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
    async _defaultApprovalHandler(request) {
        return { actionId: request.actionId, decision: 'deny', reason: 'No approval handler configured', timestamp: Date.now() };
    }
    getPendingApprovals() {
        return [...this.pendingApprovals.values()].map(v => v.request);
    }
    resolveApproval(actionId, decision, reason) {
        const pending = this.pendingApprovals.get(actionId);
        if (!pending)
            return false;
        pending.resolve({ actionId, decision, reason, timestamp: Date.now() });
        this.pendingApprovals.delete(actionId);
        return true;
    }
    abortAction(actionId) {
        const controller = this.abortControllers.get(actionId);
        if (!controller)
            return false;
        controller.abort();
        this.abortControllers.delete(actionId);
        return true;
    }
}
//# sourceMappingURL=registry-executor.js.map