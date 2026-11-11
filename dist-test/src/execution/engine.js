/**
 * Execution Engine — bridges swarm reasoning to real-world actions.
 *
 * Flow: Swarm produces ActionPlan → ExecutionEngine routes each action
 * through PolicyEngine.decide() → ApprovalHandler (if required) → Tool execution → Audit log.
 *
 * This is the "Hand" of S-AI: the swarm thinks, the execution engine acts safely.
 */
import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { getToolMeta, getRiskForTool } from './registry.js';
function getAuditDir() {
    const dir = join(homedir(), '.s-ai', 'audit');
    if (!existsSync(dir))
        mkdirSync(dir, { recursive: true });
    return dir;
}
function auditLog(entry) {
    const path = join(getAuditDir(), `${new Date().toISOString().slice(0, 10)}.jsonl`);
    appendFileSync(path, JSON.stringify({ ...entry, timestamp: new Date().toISOString() }) + '\n');
}
export class ExecutionEngine {
    config;
    approvalHandler;
    pendingApprovals = new Map();
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
    /**
     * Create an execution plan from a list of action proposals.
     * Called after swarm consensus produces an action plan.
     */
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
    /**
     * Execute a full plan: each action goes through the policy gate.
     */
    async executePlan(plan, toolExecutor) {
        const results = [];
        let approved = 0, denied = 0, executed = 0, failed = 0;
        const start = Date.now();
        for (const action of plan.actions) {
            const result = await this.executeAction(action, toolExecutor);
            results.push(result);
            if (result.status === 'approved' || result.status === 'executed')
                approved++;
            if (result.status === 'denied' || result.status === 'cancelled')
                denied++;
            if (result.status === 'executed')
                executed++;
            if (result.status === 'failed')
                failed++;
        }
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
    /**
     * Execute a single action through the policy gate and approval system.
     */
    async executeAction(action, toolExecutor) {
        const start = Date.now();
        // Risk-based approval check
        if (action.riskLevel === 'critical') {
            if (this.config.auditLog)
                auditLog({ type: 'action_denied', actionId: action.id, tool: action.tool, reason: 'critical risk auto-denied' });
            return { actionId: action.id, tool: action.tool, status: 'denied', error: 'Critical risk actions are auto-denied', durationMs: Date.now() - start };
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
        // Execute
        try {
            const output = await Promise.race([
                toolExecutor(action.tool, action.params),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Execution timeout')), this.config.timeout))
            ]);
            if (this.config.auditLog)
                auditLog({ type: 'action_executed', actionId: action.id, tool: action.tool, riskLevel: action.riskLevel });
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
    }
    /**
     * Parse a structured action plan from swarm text output.
     * Expects JSON with `{ actions: [{ tool, params, reason }], rationale }`.
     */
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
            params: action.params,
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
}
//# sourceMappingURL=engine.js.map