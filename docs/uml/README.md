# S-AI — UML Diagrams Index

All S-AI architecture is documented as **Mermaid** diagrams that render natively on GitHub (no plugins required).

| Document | Contents | Diagram types |
|---|---|---|
| [class-diagrams.md](class-diagrams.md) | Core engine classes, execution layer, security layer, MCP classes | `classDiagram` |
| [sequence-diagrams.md](sequence-diagrams.md) | Swarm query, MCP server/client flows, tool execution + approval, file sandbox | `sequenceDiagram` |
| [component-diagrams.md](component-diagrams.md) | System composition, job scheduling state, reach failover, consolidation | `flowchart` / `stateDiagram` |

## Index of Diagrams

### Class Diagrams
1. **Core Engine** — `Swarm`, `Agent`, `BaseProvider`, `NeuralMap`, `KnowledgeGraph`
2. **Execution Layer** — `ExecutionEngine` → `SecureExecutionEngine` (hardened), `ToolRegistry`, plans/reports
3. **Security Layer** — `AuthMiddleware`, `SsrfProtector`, `Sandbox`, `RateLimiter`
4. **MCP Integration** — `McpServer`, `SwarmMcpServerFactory`, `Client`, `McpClientManager`

### Sequence Diagrams
1. Multi-Agent Swarm Query
2. MCP STDIO Server (exposing S-AI to AI clients)
3. MCP Client Manager (consuming external MCP servers)
4. Synthetic Executive — tool execution with approval
5. Structured File Sandbox

### Component / Flow Diagrams
1. System Component diagram
2. OpenWorker Job Scheduling state flow
3. Provider / Reach failover
4. Consolidation ("sleep") flow

---
*For the full architecture narrative see [docs/architecture.md](../architecture.md).*
