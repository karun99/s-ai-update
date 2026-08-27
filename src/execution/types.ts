/**
 * Execution layer types — bridges swarm reasoning to real-world actions
 * with risk-based approval gating.
 */

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export type ApprovalDecision = 'allow' | 'deny' | 'allow-always';

export type ActionStatus = 'proposed' | 'approved' | 'denied' | 'executing' | 'executed' | 'failed' | 'cancelled';

export interface ToolMetadata {
  name: string;
  description: string;
  riskLevel: RiskLevel;
  category: ToolCategory;
  reversible: boolean;
  requiresApproval: boolean;
  rateLimit?: number;
  params: Record<string, ToolParamDef>;
}

export type ToolCategory =
  | 'filesystem'
  | 'network'
  | 'execution'
  | 'communication'
  | 'calendar'
  | 'notification'
  | 'data'
  | 'research';

export interface ToolParamDef {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description: string;
  required?: boolean;
  default?: unknown;
  enum?: string[];
}

export interface ActionProposal {
  id: string;
  tool: string;
  params: Record<string, unknown>;
  riskLevel: RiskLevel;
  reason: string;
  reversible: boolean;
  proposedBy: string;
  timestamp: number;
}

export interface ExecutionPlan {
  id: string;
  actions: ActionProposal[];
  rationale: string;
  consensusScore: number;
  swarmRounds: number;
  elapsed: number;
  timestamp: number;
}

export interface ExecutionResult {
  actionId: string;
  tool: string;
  status: ActionStatus;
  output?: unknown;
  error?: string;
  durationMs: number;
  approvalDecision?: ApprovalDecision;
}

export interface ExecutionReport {
  planId: string;
  results: ExecutionResult[];
  totalActions: number;
  approved: number;
  denied: number;
  executed: number;
  failed: number;
  elapsed: number;
}

export interface ApprovalRequest {
  actionId: string;
  tool: string;
  riskLevel: RiskLevel;
  params: Record<string, unknown>;
  reason: string;
  reversible: boolean;
  timestamp: number;
}

export interface ApprovalResponse {
  actionId: string;
  decision: ApprovalDecision;
  reason?: string;
  timestamp: number;
}

export type ApprovalHandler = (request: ApprovalRequest) => Promise<ApprovalResponse> | ApprovalResponse;

export interface ExecutionEngineConfig {
  defaultApprovalHandler?: ApprovalHandler;
  autoApproveLowRisk?: boolean;
  maxConcurrentActions?: number;
  timeout?: number;
  auditLog?: boolean;
}
