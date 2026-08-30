# S-AI — UML Sequence Diagrams

This document provides Mermaid sequence diagrams for the key interaction flows of the S-AI Artificial Mind / OpenWorker system. Diagrams render natively on GitHub.

## 1. Multi-Agent Swarm Query

The core swarm pipeline: Orchestrator → Researchers → Analyst A/B → Critic → Synthesizer, with optional Action Planner producing an execution plan.

```mermaid
sequenceDiagram
    autonumber
    participant U as User / MCP
    participant S as Swarm
    participant O as Orchestrator
    participant R as Researcher
    participant A1 as Analyst A
    participant A2 as Analyst B (Devil's Advocate)
    participant C as Critic
    participant Syn as Synthesizer
    participant AP as Action Planner
    participant P as Provider

    U->>S: run(question, {maxRounds})
    S->>S: status = 'running'
    S->>O: think(question)
    O->>P: complete([system, question])
    P-->>O: plan + perspective
    O-->>S: plan

    loop per round
        S->>R: think(plan)
        R->>P: complete(...)
        P-->>R: research
        R-->>S: findings

        par Analyst A and Analyst B
            S->>A1: think(plan + research)
            A1->>P: complete(...)
            P-->>A1: analysis
            A1-->>S: analysis-a
        and
            S->>A2: think(plan + research, adversarial)
            A2->>P: complete(...)
            P-->>A2: counter-analysis
            A2-->>S: analysis-b
        end

        S->>C: think(plan + analyses)
        C->>P: complete(...)
        P-->>C: score + critique
        C-->>S: consensus score
    end

    S->>Syn: think(plan, analyses, consensus)
    Syn->>P: complete(...)
    P-->>Syn: synthesized answer
    Syn-->>S: content

    opt if actions needed
        S->>AP: think(synthesized answer)
        AP->>P: complete(...)
        P-->>AP: execution plan (JSON)
        AP-->>S: executionPlan
    end

    S-->>U: RunResult { content, consensus, rounds }
```

## 2. MCP STDIO Server (Exposing S-AI to AI Clients)

Shows how S-AI registers tools/resources/prompts and serves them over stdio for any MCP-compatible client (Claude, Cursor, terminal AIs, etc.).

```mermaid
sequenceDiagram
    autonumber
    participant C as MCP Client (host app)
    participant T as StdioServerTransport
    participant M as S-AI McpServer
    participant SW as Swarm
    participant KG as KnowledgeGraph
    participant NM as NeuralMap

    C->>M: spawn process (stdio)
    C->>T: initialize
    T->>M: request (initialize)
    M-->>T: capabilities
    T-->>C: initialized

    C->>T: tools/list
    T->>M: tools/list
    M-->>T: swarm_query, crawl_web, graph_*, persona_*, ...
    T-->>C: tool list

    C->>T: tools/call (persona_set)
    T->>M: handle persona_set
    M->>NM: setProfile({name, bio, worldview})
    NM-->>M: profile
    M->>SW: setPersonaContext(profile)
    M-->>T: result
    T-->>C: content

    C->>T: tools/call (swarm_query)
    T->>M: handle swarm_query
    M->>SW: run(question, {maxRounds})
    SW-->>M: RunResult
    M-->>T: text content
    T-->>C: content

    C->>T: resources/read (s-ai://graph)
    T->>M: read resource
    M->>KG: graph.graph
    KG-->>M: graph data
    M-->>T: JSON resource
    T-->>C: resource contents
```

## 3. MCP Client Manager (Consuming External MCP Servers)

Shows how S-AI connects to external MCP servers (filesystem, github, browser, etc.) and aggregates their tools.

```mermaid
sequenceDiagram
    autonumber
    participant APP as S-AI Application
    participant MGR as McpClientManager
    participant CL as Client
    participant ST as StdioClientTransport
    participant EXT as External MCP Server

    APP->>MGR: connectAll()
    MGR->>MGR: read getMcpConfig()
    loop each server config
        MGR->>ST: new StdioClientTransport({command, args, env})
        MGR->>CL: new Client()
        CL->>ST: connect()
        ST->>EXT: spawn process
        CL->>EXT: initialize handshake
        EXT-->>CL: capabilities
        CL->>EXT: tools/list
        EXT-->>CL: tools
        CL-->>MGR: tools
        MGR->>MGR: register `${server}:${tool}` in tools map
        MGR->>MGR: clients.set(name, client)
    end

    APP->>MGR: callTool(server, tool, args)
    MGR->>CL: callTool({name, arguments})
    CL->>EXT: tools/call
    EXT-->>CL: result
    CL-->>MGR: content
    MGR-->>APP: result
```

## 4. Synthetic Executive — Tool Execution with Approval

Shows how the execution engine routes an action through the approval gate, then executes it via the tool registry with full audit logging.

```mermaid
sequenceDiagram
    autonumber
    participant SW as Swarm
    participant EX as SecureExecutionEngine
    participant TR as ToolRegistry
    participant AH as ApprovalHandler (UI/API)
    participant LOG as Audit Log

    SW->>EX: executePlan(plan, runTool)

    loop For each action in plan.actions
        EX->>TR: validateToolParams(name, params)
        TR-->>EX: { valid } | { error }

        alt requires approval
            EX->>EX: riskFloor / policy gate
            EX->>AH: requestApproval(action)
            AH-->>EX: { allow | deny | allow-always }
            EX->>LOG: log approval decision (PII redacted)
        else auto-execute
            EX->>LOG: log action start
        end

        EX->>TR: resolve tool from registry
        EX->>EX: runTool(action) with AbortSignal timeout
        EX->>LOG: log result / error
    end

    EX-->>SW: ExecutionReport { results, auditTrail, totalCost }
```

## 5. Structured File Sandbox

Shows file-system and shell command validation for untrusted tool operations.

```mermaid
sequenceDiagram
    autonumber
    participant T as Tool / Agent
    participant SB as Sandbox
    participant FS as File System / Shell

    T->>SB: validateShellCommand(cmd)
    SB->>SB: normalize + split tokens
    alt matches DENY_PATTERNS (.ssh, .aws, .env, keys)
        SB-->>T: { blocked }
    else is dangerous command (curl/wget/netcat)
        SB-->>T: { blocked: dangerous }
    else valid in safe mode
        SB->>FS: execute within SAFE_ROOTS
        FS-->>SB: output
        SB-->>T: { allowed, output }
    end

    T->>SB: isPathInSandbox(path)
    SB->>SB: resolve realpath, compare against SAFE_ROOTS
    SB-->>T: { allowed } | { blocked }
```

---
*See [class-diagrams.md](class-diagrams.md) for structure and [component-diagrams.md](component-diagrams.md) for high-level composition.*
