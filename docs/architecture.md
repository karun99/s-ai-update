# OpenWorker Suite — Architecture

| | |
|---|---|
| **Doc version** | 1.0 |
| **Status** | DRAFT — pending owner validation (M0 gate) |
| **Related** | [srs.md](../srs.md) · [docs/soi-spec.md](soi-spec.md) · [docs/packaging-installers.md](packaging-installers.md) |

## 1. System Layers

```
┌─────────────────────────────────────────────────────────────────────┐
│ SHELLS      Win setup.exe │ macOS .app/DMG │ Linux install.sh       │
│             Android: Termux bootstrap + PWA (home-screen install)   │
├─────────────────────────────────────────────────────────────────────┤
│ HARNESS    openworker CLI shim ── job scheduler ── policy engine    │
│            vault (OS keychain / OKF) ── update feed ── reach v2     │
├─────────────────────────────────────────────────────────────────────┤
│ SOI        Simulated Organoid Intelligence (Duet-protocol pools;    │
│            lazy-loaded, off by default)  → see docs/soi-spec.md     │
├─────────────────────────────────────────────────────────────────────┤
│ ENGINE     @saikarun/s-ai: 6-agent swarm · neural mapping persona   │
│            knowledge graph · study buddy · research mapper          │
│            bhashini · MCP client/server · crawl · OKF crypto        │
│            skills: ai-engine, ai-studio, research-mapper,           │
│            study-buddy, mcp-builder, skill-creator, base            │
├─────────────────────────────────────────────────────────────────────┤
│ ADAPTERS   providers (20+, provider:model routing) │ reach backends │
│            jina · yt-dlp · gh · rss · arxiv (+cookie tiers later)   │
└─────────────────────────────────────────────────────────────────────┘
```

Dependency rule: arrows point downward only. The harness never patches engine internals;
SOI communicates with the swarm exclusively through the signal hooks defined in srs §3.4.

## 2. Process Model

| Mode | Processes | Lifetime | Memory target |
|---|---|---|---|
| CLI one-shot (`ask`, `reach doctor`, …) | 1 | exits on completion | no floor; NFR-4 startup gate |
| Serve (dashboard/PWA host) | 1 node process + system browser tab | while serving | ≤ 60 MB desktop / ≤ 90 MB Termux |
| Job watch (`openworker jobs run`) | 1 | until stopped | serve budget − UI cache |

No Electron, no bundled browser, no resident agent. The dashboard is plain static files
(`public/`) served over loopback HTTP by `src/server.ts` (existing), extended with
`/api/soi/*`, `/api/jobs/*`, `/api/reach/*`, `/api/jobs/approvals/*`, `/api/approval-modal`.

## 3. Module Map (new code under `suite/`)

```
suite/
├── src/
│   ├── cli.ts              # arg parsing → dispatch into engine exports
│   ├── config.ts           # ~/.openworker layout, migration from ~/.s-ai
│   ├── vault.ts            # keychain abstraction + AES-256-GCM fallback (OKF)
│   ├── worker/
│   │   ├── jobs.ts         # definitions, cron parser, history ring buffer
│   │   ├── runner.ts       # executes a task through the engine swarm
│   │   └── artifacts.ts    # PDF/DOCX/XLSX/MD writers + manifest
│   ├── policy.ts           # allow-all | deny-list | require-approval
│   ├── reach/
│   │   ├── registry.ts     # ordered backends per channel, failover
│   │   └── doctor.ts       # active probing + fix prescriptions
│   ├── soi/                # spec: docs/soi-spec.md
│   │   ├── encode.ts  lif.ts  stdp.ts  core.ts  duet.ts
│   │   ├── consolidate.ts  persist.ts
│   └── update.ts           # release feed fetch + signature verify
├── installer/
│   ├── windows.iss         # Inno Setup script
│   ├── mac-bundle.sh       # .app layout + hdiutil DMG
│   ├── linux-install.sh    # POSIX shell installer
│   └── termux-bootstrap.sh # Android one-liner target
└── test/                   # mirrors src; golden fixtures for soi/
```

Engine reuse contract: only public exports of `@saikarun/s-ai` are imported
(providers, swarm, tools, mcp). If an export is missing, the harness adds a thin adapter in
`suite/src/adapters/` rather than modifying engine source.

### Skills (under `skills/`)

```
skills/
├── ai-engine/         # Prompt-to-app builder with HTML generation
├── ai-studio/         # Video generation via OpenRouter + NVIDIA AI
├── research-mapper/   # arXiv search, citation graphs, paper analysis
├── study-buddy/       # AI tutoring, quizzes, multi-mode mentoring
├── mcp-builder/       # Resource-efficient MCP server creation from templates
├── skill-creator/     # Modular skill composition and hot-plugging
└── base/              # Shared init, explore, search, inspect utilities
```

## 4. Key Flows

### 4.1 Ask (SOI passive)
```
user text ─▶ cli.ts ─▶ [vault unlock keys] ─▶ provider route (provider:model)
     │                                              │ stream chunks
     ├─ soi enabled? ─▶ SoiCore.ingest(text,'USER') │
     │                    returns signals           │
     ▼                                              ▼
swarm pipeline (Orchestrator→Researcher→AnalystA/B→Critic→Synthesizer)
     │  signals consumed: routing hint / Critic flag / salience tone
     ▼
streamed answer + optional `soi:` header ─▶ console or dashboard
```

### 4.2 Scheduled job with approval
```
jobs.json due ─▶ runner.ts builds task+tools ─▶ policy gate
      │                                          │ require-approval?
      │                                          ├─ yes: POST /api/jobs/approvals/:id
      │                                          │        → approval modal (GET /api/approval-modal)
      │                                          │        → dashboard UI polls /api/jobs/approvals
      │                                          └─ no: execute directly
      ▼
engine execution ─▶ artifacts/<job>/ ─▶ history ring ─▶ status/dashboard
```

### 4.3 Reach read
```
url/task ─▶ registry.canHandle(channel match) ─▶ try backend[0]
      └─ failure ─▶ mark unhealthy (TTL) ─▶ backend[1] ─▶ … ─▶ all down ⇒ error + prescription
doctor: probes every backend of every channel, prints active matrix, exit≠0 if tier-0 broken
```

### 4.4 Consolidation ("sleep", weekly or manual)
```
SoiCore.consolidate() ─▶ traces[] ─▶ engine knowledge-graph upsert
                     └─▶ Neural Mapping tone-weight nudges (bounded ±10%)
checkpoint encrypted (AES-256-GCM) ─▶ ~/.openworker/soi/checkpoints/
```

## 5. Cross-Cutting Decisions

| Concern | Decision | Rationale |
|---|---|---|
| Single executable | Bun `--compile` primary, Node SEA fallback | one static binary per OS/arch; no runtime install for users (packaging doc §2) |
| Server binding | loopback-only default; token header required if `--host` set | NFR-9 |
| Secrets | OS keychain first, encrypted-file fallback | zero new native deps |
| Telemetry | none (v1) | NFR-8 |
| SOI loading | dynamic import guarded by config presence | NFR-7 off-mode purity |
| Failure posture | failover where possible (reach/providers); otherwise explicit error + prescription | no silent degradation |
| Skills | modular skill registration via MCP tool/prompt/resource pattern | hot-pluggable, zero-overhead when unloaded |

## 6. Extension Points (post-v1)

- Cookie-tier reach channels (twitter/reddit/xhs) plug into `registry.ts`.
- Collabuild `build` mode registers as a worker task type (FR-C8).
- APK wrapper reuses the same PWA bundle via Capacitor/Tauri Mobile.
- Prompt-Code marketplace mounts as skill packs under the existing `skill` command.
- Approval modal dashboard (POST /api/jobs/approvals/:id, GET /api/approval-modal) for policy-gated tool execution.
- Study Buddy and Research Mapper serve as standalone dashboard pages via static file hosting.
