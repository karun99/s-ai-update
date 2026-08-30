# S-AI — UML Class Diagrams

This document provides Mermaid UML class diagrams for the core architecture of the S-AI Artificial Mind / OpenWorker system. All diagrams are written in [Mermaid](https://mermaid.js.org/) and render natively on GitHub.

## 1. Core Engine Classes

The engine (`@saikarun/s-ai`) is composed of the swarm, agents, neural map, knowledge graph, and execution layer.

```mermaid
classDiagram
    class Swarm {
        +Map~string, Agent~ agents
        +RoundResult[] rounds
        +string status
        -string _personaContext
        +constructor(config)
        +addAgent(id, name, role, opts) Agent
        +getAgent(id) Agent
        +run(userMessage, options) Promise~RunResult~
        +setPersonaContext(ctx) void
        +getStatus() SwarmStatus
        +stream(userMessage, options) Readable
        +_initDefaultAgents() void
        +_createProvider(providerName?) BaseProvider
    }
    Swarm o-- Agent : "contains 6–7"

    class Agent {
        +string id
        +string name
        +string role
        +AgentConfig config
        +BaseProvider provider
        +string status
        +Message[] history
        +AgentMetrics metrics
        +constructor(name, role, config)
        +setProvider(provider) this
        +setPersonaContext(ctx) void
        +think(input, personaContext?) Promise~string~
        +resetHistory() void
    }
    Agent o-- BaseProvider : "uses"

    class BaseProvider {
        <<abstract>>
        +string name
        +complete(messages, options) Promise~Completion~
        +stream?(messages, options) AsyncGenerator
    }

    class NeuralMap {
        +constructor(config)
        +getProfile() PersonaProfile
        +setProfile(data) PersonaProfile
        +clearProfile() void
        +addContextNode(node) ContextNode
        +addInteraction(user, agent, sentiment) void
        +buildPersonaContext() string
        +buildSystemPromptDirective() string
        +analyzeSentiment(text) string
        +listProfiles() string[]
    }
    Swarm ..> NeuralMap : "persona context"

    class KnowledgeGraph {
        +string graphDir
        +GraphData graph
        +constructor(graphDir?)
        +addNode(type, label, data) string
        +addEdge(source, target, relation, weight) void
        +getNode(id) GraphNode
        +getEdges(nodeId) GraphEdge[]
        +query(question) QueryResult[]
        +addConversation(user, reply) void
        +getStats() GraphStats
        +getHistory(limit) Array
    }
    Swarm ..> KnowledgeGraph : "memory"

    note for Swarm "Initialized with 7 agents:\norchestrator, researcher, analyst-a,\nanalyst-b, critic, synthesizer, action-planner"
```

## 2. Execution Layer (Synthetic Executive)

The execution layer produces risk-rated action plans, routes them through approval gates, and executes them with full auditability.

```mermaid
classDiagram
    class ExecutionEngine {
        +ExecutionEngineConfig config
        +constructor(config)
        +setApprovalHandler(handler) void
        +createPlan(actions, rationale, confidence, riskFloor, budget) ExecutionPlan
        +executePlan(plan, runTool) Promise~ExecutionReport~
        +executeAction(action, runTool) Promise~ActionResult~
        +parseActionPlan(text) ExecutionPlan
        +getPendingApprovals() ApprovalRequest[]
        +resolveApproval(actionId, decision, reason) boolean
    }
    ExecutionEngine o-- ExecutionPlan : "creates"
    ExecutionEngine ..> ApprovalHandler : "calls on approval"

    class SecureExecutionEngine {
        +constructor(config)
        +setApprovalHandler(handler) void
        +createPlan(actions, rationale, confidence, riskFloor, budget) ExecutionPlan
        +executePlan(plan, runTool) Promise~ExecutionReport~
        +executeAction(action, runTool) Promise~ActionResult~
        +parseActionPlan(text) ExecutionPlan
        +getPendingApprovals() ApprovalRequest[]
        +resolveApproval(actionId, decision, reason) boolean
        +abortAction(actionId) boolean
        -_requestApproval(action) Promise~ApprovalResponse~
        -_enforceConcurrency() void
        -_redact(entry) string
    }
    SecureExecutionEngine --|> ExecutionEngine : "extends (hardened)"

    class ToolRegistry {
        +REGISTRY Map
        +ZOD_SCHEMAS Map
        +getToolMeta(name) ToolMetadata
        +validateToolParams(name, params) ValidationResult
        +listToolMeta() ToolMetadata[]
        +getToolsByRisk(level) ToolMetadata[]
        +getRiskForTool(name) RiskLevel
    }
    SecureExecutionEngine ..> ToolRegistry : "validation"

    class ActionProposal {
        +string tool
        +Record params
        +string reason
        +RiskLevel riskLevel
        +boolean reversible
        +string id
    }
    class ExecutionPlan {
        +ActionProposal[] actions
        +string rationale
        +number confidence
        +RiskLevel riskFloor
        +number budget
        +string id
    }
    class ExecutionReport {
        +string planId
        +ActionResult[] results
        +string[][] dependencies
        +boolean approved
        +string[] auditTrail
        +number totalCost
    }

    note for SecureExecutionEngine "Adds: registry-bound execution,\nZod validation, AbortSignal timeouts,\nconcurrency enforcement, PII redaction"
```

## 3. Security Layer

```mermaid
classDiagram
    class AuthMiddleware {
        +hashToken(token, salt?) string
        +generateAuthToken() string
        +revokeToken() void
        +getAuthConfig() AuthConfig
        +authRequired(req, res, next) void
    }

    class SsrfProtector {
        +MAX_REDIRECTS number
        +MAX_RESPONSE_BYTES number
        +BLOCKED_HOSTS string[]
        +isPrivateUrl(url) boolean
        +validateUrlSafety(url) Promise~UrlSafety~
        +safeFetch(url, init) Promise~Response~
    }

    class Sandbox {
        +WORKSPACE_ROOT string
        +DENY_PATTERNS string[]
        +SAFE_ROOTS string[]
        +isPathInSandbox(path) result
        +validateShellCommand(cmd, config) result
        +validateWorkingDirectory(cwd) result
        +createFileHash(content) string
    }

    class RateLimiter {
        +handler(req, res, next) void
    }

    AuthMiddleware ..> SsrfProtector : "shares token storage"
    Sandbox <.. SecureExecutionEngine : "enforced per action"
```

## 4. MCP Integration Classes

```mermaid
classDiagram
    class McpServer {
        +name string
        +version string
        +tool(name, desc, schema, handler) void
        +resource(desc, uri, metadata, handler) void
        +prompt(name, desc, argsSchema, handler) void
        +connect(transport) Promise
    }
    class StdioServerTransport {
        +connect() Promise
    }
    class SwarmMcpServerFactory {
        +createSwarmMcpServer(options) McpServer
        +startStdioMcp() Promise
    }
    SwarmMcpServerFactory ..> McpServer : "registers 15+ tools"
    SwarmMcpServerFactory ..> Swarm
    SwarmMcpServerFactory ..> KnowledgeGraph
    SwarmMcpServerFactory ..> NeuralMap

    class Client {
        +connect(transport) Promise
        +listTools() Promise
        +callTool(req) Promise
        +close() Promise
    }
    class StdioClientTransport {
        +constructor(config)
    }
    class McpClientManager {
        +Map clients
        +Map tools
        +connectToServer(config) Promise
        +callTool(server, tool, args) Promise
        +connectAll() Promise
        +disconnectAll() Promise
        +listAllTools() Array
        +listConnectedServers() string[]
    }
    McpClientManager o-- Client : "manages"
    McpClientManager ..> StdioClientTransport : "spawns"
```

---
*Generated from source code. See [sequence-diagrams.md](sequence-diagrams.md) for interaction flows.*
