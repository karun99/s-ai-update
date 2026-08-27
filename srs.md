# Software Requirements Specification — OpenWorker Suite

| | |
|---|---|
| **Product** | OpenWorker Suite (working title: `openworker`) |
| **Version** | SRS v2.0 |
| **Date** | 2026-08-23 |
| **Status** | DRAFT — pending owner validation (gate before M1 development) |
| **Owner** | Sai Karun Nandipati (nsk) |
| **License target** | MIT |
| **Engine lineage** | S-AI v5.1 / You-AI (`@saikarun/s-ai`) |
| **Companion docs** | [docs/architecture.md](docs/architecture.md) · [docs/soi-spec.md](docs/soi-spec.md) · [docs/packaging-installers.md](docs/packaging-installers.md) |

---

## 1. Introduction

### 1.1 Purpose
OpenWorker Suite packages the You-AI / S-AI multi-agent engine as a self-hosted "AI coworker"
product with first-class installers for Windows, macOS, Linux (shell), and Android, under a
strict minimum-resource envelope. It follows a unified provider layer + desktop harness
architecture, and integrates an Agent-Reach-style capability
layer plus a new **Simulated Organoid Intelligence (SOI)** module.

### 1.2 Scope
In scope:
- Desktop worker runtime (chat, tasks, scheduled automations, research) reusing S-AI core.
- Unified multi-provider LLM routing (`provider:model` strings).
- Reach channel registry (web, YouTube, GitHub, RSS, arXiv, …) with doctor health checks.
- SOI: a software-only simulation of organoid-inspired neural dynamics for memory
  consolidation and consensus modulation. Simulated version only — no biological hardware.
- Native installers: Windows setup EXE, macOS DMG, Linux POSIX shell installer,
  Android Termux bootstrap + PWA.
- Local web dashboard/PWA (You-AI UI as baseline).

Out of scope (v1): iOS app, cloud sync between devices, voice wakeup always-listening,
biological/hardware organoid interfaces, team/multi-user auth server.

### 1.3 References
1. OpenWorker — desktop AI coworker distribution model.
2. Agent-Reach — capability-layer pattern: ordered backend lists per channel, `doctor`
   probing, safe-by-default install, SKILL.md export (Panniantong/Agent-Reach).
3. You-AI project site — product ingredients (you-ai-project.netlify.app).
4. S-AI v5.1 CLI — existing engine (`@saikarun/s-ai`, npm).
5. Collabuild 9-stage MAS pipeline (research paper → working prototype).
6. Izhikevich (2003) simple spiking model; Maass et al. liquid state machines; STDP literature
   — theoretical basis for SOI (see docs/soi-spec.md).
7. Duet — Digital Twin Technology (`nsktech994/Duet--Digital-Twin-Technology`) — owner's
   personified-intelligence application; its **Duet Protocol** (`[[PRIMARY]]` / `[[META]]` /
   `[[RESPONSE]]` streams over a persona-seeded twin) defines the macro-architecture of SOI.

### 1.4 Definitions
| Term | Meaning |
|---|---|
| OKF | Open Knowledge Framework — AES-256 + SHA-256 encrypted local knowledge store |
| SOI | Simulated Organoid Intelligence — this suite's simulated bio-plausible neural layer |
| LSM | Liquid State Machine — reservoir-computing paradigm SOI implements |
| STDP | Spike-Timing-Dependent Plasticity — learning rule used by SOI |
| Reach | Internet-access channel registry with primary/fallback backends per channel |
| Worker | A unit of delegated work: prompt/job executed by the swarm with tool permissions |
| SEA | Single Executable Application (self-contained binary, no runtime install required) |

### 1.5 Personas
- P1 Student — free-tier providers only, Study Buddy, Bhashini, low-end Android via Termux.
- P2 Researcher — Research Mapper, arXiv reach channel, SOI passive memory consolidation.
- P3 Knowledge professional — scheduled workers, file/email tools with approval policies.

---

## 2. Overall Description

### 2.1 Product perspective
A single Node.js codebase distributed four ways:

```
┌────────────────────────────────────────────────────────────────┐
│                     PRESENTATION SHELLS                        │
│  Win installer │ macOS .app │ Linux shell/systemd │ Termux+PWA │
├────────────────────────────────────────────────────────────────┤
│              OPENWORKER HARNESS (this project)                 │
│   worker runtime · job scheduler · permission policies         │
│   update feed · secrets vault · SOI core · reach registry      │
├────────────────────────────────────────────────────────────────┤
│                YOU-AI / S-AI ENGINE (existing)                 │
│   6-agent swarm · neural mapping persona · knowledge graph     │
│   study buddy · research mapper · bhashini · MCP · crawl       │
├────────────────────────────────────────────────────────────────┤
│   PROVIDERS (20+, unified routing)            REACH BACKENDS      │
│   openrouter openai anthropic google ollama  jina gh yt-dlp    │
│   grok kimi cohere bedrock vertex +15 more   rss arxiv …       │
└────────────────────────────────────────────────────────────────┘
```

The harness is additive: it depends on `@saikarun/s-ai` as a library and never forks the
engine. Users who already run `s-ai` migrate by importing config (FR-C9).

### 2.2 Design principles
1. Minimum resources — no Electron, no bundled browser, no resident daemon unless serving.
2. Local-first — keys and data never leave the device except to chosen AI providers.
3. Safe-by-default — destructive tools require explicit approval.
4. Capability layer, not wrapper — Reach routes to upstream tools; no reimplementation.
5. Simulation honesty — SOI is labeled everywhere as *simulated*, inspired-by-biology
   engineering (reservoir computing), not biological computation; its personified behavior
   is grounded in the owner's Duet Protocol, not in consciousness claims.
6. Implementability over ambition — every subsystem must be buildable by one developer on
   mid-range hardware; budgets in §4 are hard gates, not aspirations.

### 2.3 Constraints
- Node >= 18 runtime capability (Termux ships nodejs-lts); ESM TypeScript.
- Zero platform fee; user brings API keys or uses Ollama/OpenRouter-free locally.
- Single-repo monorepo layout under this repository (`suite/` workspace).

---

## 3. Functional Requirements

Priority classes: **M** = must (v1 gate), **S** = should, **C** = could/stretch.

### 3.1 Core (engine reuse & routing)
- **FR-C1 (M)** Route all model calls through unified `provider:model` identifiers
  (e.g. `openrouter:meta-llama/...`, `ollama:llama3`).
- **FR-C2 (M)** Expose existing commands behind the `openworker` binary:
  `ask, serve, swarm, persona, graph, crawl, search, mcp, provider, skill, engine,
  research, bhashini, reach, status, study` (parity with s-ai v5.1 surface).
- **FR-C3 (M)** Streaming responses (token chunks) on all OpenAI-compatible providers.
- **FR-C4 (M)** Bias-reduced 6-agent swarm pipeline retained unchanged
  (Orchestrator → Researcher → Analyst A/B → Critic → Synthesizer).
- **FR-C5 (M)** Neural Mapping digital-twin persona persists across sessions (OKF-backed).
- **FR-C6 (M)** Knowledge graph CRUD + stats; graphify ingestion from conversations/crawls.
- **FR-C7 (S)** Study Buddy teach-the-bot loop with mentor personas and recap export.
- **FR-C8 (S)** Collabuild mode: `openworker build --paper <id|file>` runs the 9-stage
  research→prototype pipeline producing SRS/design/code artifacts in `~/.openworker/artifacts/`.
- **FR-C9 (M)** One-shot migration: `openworker import s-ai` reads `~/.s-ai/config.json`.

### 3.2 Workers, jobs & permissions
- **FR-W1 (M)** Job model: `{id, name, trigger(manual|schedule|event), task, tools[], policy}`.
- **FR-W2 (M)** Cron-style scheduler (`openworker jobs add "0 9 * * Mon" ...`) persisted in
  `jobs.json`; fires only while a host process lives (CLI watch or dashboard tab).
- **FR-W3 (M)** Tool permission policies: `allow-all | deny-list | require-approval`
  per job; file-write and shell-exec tools default to `require-approval` with a
  y/n terminal prompt (CLI) or modal (dashboard).
- **FR-W4 (S)** Artifacts: PDF/DOCX/XLSX/MD outputs written to a per-job directory with manifest.
- **FR-W5 (S)** Job history + last-run status in `status` output and dashboard.

### 3.3 Reach capability layer (Agent-Reach pattern)
- **FR-R1 (M)** Channel interface with ordered backend lists; first healthy backend wins;
  failover is automatic and logged (no user action).
- **FR-R2 (M)** `openworker reach doctor` actively probes each candidate backend (network
  call or version check), reports active backend + fix prescription; exit code reflects health.
- **FR-R3 (M)** Channels v1: web (Jina Reader), youtube (yt-dlp), github (gh/api), rss,
  arxiv (existing), crawl (existing fetch engine). Cookie-based channels (twitter/reddit)
  are v1.1.
- **FR-R4 (S)** `openworker skill export reach` emits a SKILL.md describing available
  channels/backends for external agent harnesses.
- **FR-R5 (S)** Safe install posture: environment checks never modify system state without
  explicit `--system` flag.

### 3.4 SOI — Simulated Organoid Intelligence (Duet-grounded, personified)
Full technical spec: [docs/soi-spec.md](docs/soi-spec.md). The macro-architecture adopts the
owner's **Duet Protocol** (ref [8]): one sparse simulated reservoir partitioned into three
functionally specialized pools — **Primary** (executive reaction), **Meta** (reflective
perception-delta), **Expressive** (clone output integration) — seeded from the twin's
Cognitive Profile / OKF persona vector so each user's twin has a measurable dynamical
fingerprint (`persona_drift`). Requirements:
- **FR-S1 (M)** Software-only simulation: LIF neurons in three Duet pools with small-world
  sparse connectivity; deterministic, seedable, CPU-only, typed arrays, zero dependencies.
- **FR-S2 (M)** Modes: `off` (default; module never loads), `passive` (one Duet cycle per
  conversation turn + memory consolidation), `active` (additionally modulates swarm
  weights). Active mode shown in every affected output header.
- **FR-S3 (M)** Cycle semantics per turn: prompt encodes to spike trains into Primary;
  delayed copy feeds Meta; Expressive integrates both; pool rate readouts decode to
  `{confidence, novelty, bias_anomaly, salience, persona_drift}` consumed by Orchestrator,
  Critic, Synthesizer. SOI modulates the swarm; it never generates response text.
- **FR-S4 (M)** Plasticity: STDP on excitatory edges + homeostatic thresholds; weekly or
  manual "sleep" consolidation folds salient traces into the knowledge graph and nudges
  Neural Mapping tone weights (bounded).
- **FR-S5 (M)** Hard resource caps (CI-gated): default 3-pool total **8,192 neurons /
  ~330k synapses ≤ 6 MB RSS, cycle ≤ 5 ms**, consolidation ≤ 300 ms; configs above
  102,400 neurons refuse to load without `--unsafe-i-understand`. Identical defaults on
  Android/Termux.
- **FR-S6 (S)** `openworker soi status/feed/stats/consolidate/reset`; encrypted rolling
  checkpoints under OKF key material.
- **FR-S7 (C)** Persona re-seeding via updated Duet Cognitive Profile resets plasticity
  without touching the knowledge graph.
- **FR-S8 (M)** Off-mode purity: absent `soi.config.json` ⇒ no SOI module evaluation and
  zero runtime cost (verifiable via module-load trace test).

### 3.5 Providers & keys
- **FR-K1 (M)** Key storage: OS keychain where available (Windows DPAPI via PowerShell,
  macOS `security`, Linux libsecret); fallback 0600 file encrypted AES-256-GCM with
  SHA-256 integrity (OKF scheme).
- **FR-K2 (M)** Keys never appear in logs, errors, or `--verbose` output (redaction filter).

### 3.6 Presentation
- **FR-U1 (M)** Dashboard = existing You-AI web UI served on loopback
  (`127.0.0.1:3000` default, `--port` override); binds loopback only unless `--host` given.
- **FR-U2 (M)** Dashboard is a PWA: manifest + service worker → installable home-screen
  app on Android/desktop browsers.
- **FR-U3 (S)** Tray presence (Win/macOS/Linux DEs): optional, starts dashboard hidden;
  skipped entirely if unsupported rather than bundling a GUI toolkit.

### 3.7 Distribution & updates
- **FR-D1 (M)** Artifacts per release (naming in docs/packaging-installers.md):
  Windows setup EXE, macOS universal DMG, Linux tarball + `install.sh`, Termux script URL.
- **FR-D2 (M)** `openworker update` checks signed release-feed JSON; prints or applies diff.
- **FR-D3 (M)** Every artifact published with SHA256SUMS; feed signed (minisign or cosign).

---

## 4. Non-Functional Requirements

| ID | Requirement | Budget / rule |
|---|---|---|
| NFR-1 | Idle memory (no serve) | process exits after command; no resident daemon |
| NFR-2 | Idle memory (serve) | RSS ≤ 60 MB desktop, ≤ 90 MB Android/Termux |
| NFR-3 | Active memory | ≤ 150 MB during streaming chat incl. SOI passive |
| NFR-4 | Cold start | `--help` ≤ 800 ms; first streamed byte ≤ 3 s (network permitting) |
| NFR-5 | Installer size | Win ≤ 110 MB · macOS ≤ 120 MB · Linux ≤ 105 MB · Termux script ≤ 10 KB |
| NFR-6 | Installed disk | ≤ 260 MB desktop (excl. caches/graph) |
| NFR-7 | SOI overhead | off: zero (module not imported); passive: ≤ 6 MB RSS, ≤ 5 ms per turn cycle, consolidation ≤ 300 ms (FR-S5) |
| NFR-8 | Privacy | no telemetry of any kind in v1; crash logs stay local until user sends |
| NFR-9 | Security | loopback-only server; CSP headers; secrets redaction (FR-K2); Observatory ≥ A |
| NFR-10 | Accessibility | dashboard WCAG AA contrast; keyboard-navigable modals |
| NFR-11 | i18n | Bhashini parity (22 languages) carried over; UI strings English v1 |
| NFR-12 | Compatibility | Win 10+/x64, macOS 13+ (arm64+x64), Linux glibc ≥ 2.31 x64/arm64, Android w/ Termux node ≥ 18 |
| NFR-13 | Determinism | SOI runs reproducible given seed; CI golden-run test |

---

## 5. Data Model & Storage

```
~/.openworker/
├── config.json          # non-secret settings (mode, port, provider defaults)
├── keys.enc             # AES-256-GCM vault (or OS keychain alias table)
├── okf/                 # encrypted OKF store (persona, graph seeds, SOI meta)
├── graph/               # knowledge graph persistence (jsonl + index)
├── soi/
│   ├── state.bin        # sparse reservoir state snapshot (typed arrays)
│   └── checkpoints/     # rolling 3 checkpoints, encrypted
├── jobs.json            # scheduled/manual job definitions + history ring buffer
├── artifacts/<job>/     # FR-W4 outputs + manifest.json
├── cache/reach/         # TTL'd backend responses (jina, rss, arxiv)
└── logs/openworker.log  # 3 × 5 MB rotated; secret-redacted
```

Migration from `~/.s-ai/**` is copy-forward (never deletes source).

---

## 6. Platform Packaging (summary)

Detailed build/sign/publish specs live in
[docs/packaging-installers.md](docs/packaging-installers.md). Summary:

| Platform | Artifact | Mechanism | Notes |
|---|---|---|---|
| Windows | `OpenWorker-setup-x64.exe` | Inno Setup wrapping SEA binary | per-user install, optional autostart, uninstaller |
| macOS | `OpenWorker-macos.dmg` | .app bundle (universal2) + hdiutil UDZO | Gatekeeper: sign + notarize when cert available; ad-hoc fallback documented |
| Linux | `openworker-linux-.tar.gz` + `install.sh` | POSIX shell installer to `~/.local` | optional systemd --user unit + .desktop entry; no root required |
| Android | Termux one-liner + PWA | `pkg install nodejs-lts` then npm install | dashboard installed as home-screen PWA; APK wrapper deferred (v2) |

Single-executable strategy: Bun `--compile` primary, Node SEA documented fallback;
both produce self-contained binaries so end users need no Node install.

---

## 7. Architecture (summary)

See [docs/architecture.md](docs/architecture.md). Layer map above (§2.1); module ownership:

| Suite module | Path (new) | Depends on |
|---|---|---|
| CLI shim | `suite/src/cli.ts` | `@saikarun/s-ai` exports |
| Worker/jobs | `suite/src/worker/*` | engine swarm + tools |
| Policies | `suite/src/policy.ts` | tools registry |
| Reach upgrade | extends `src/reach/channels.ts` | — |
| SOI core | `suite/src/soi/*` | engine graph (consolidation sink) |
| Vault | `suite/src/vault.ts` | OS keychain / crypto |
| Update feed | `suite/src/update.ts` | release JSON + signature |

---

## 8. Testing & QA

- Unit: policy decisions, reach failover order, vault round-trip, SOI step math (golden vectors).
- Integration: scripted provider mock server; swarm dry-run; doctor against sandboxed backends.
- SOI determinism: fixed seed → byte-identical 100k-step digest (NFR-13).
- Resource regression: CI job asserts RSS/startup budgets (NFR-2..4) on linux-x64 runner.
- Installer smoke matrix (manual, per release): Win11 x64, macOS 14 arm64 + 13 x64,
  Ubuntu 22.04, Debian 12, Fedora 40, Termux (Android 12+).
- Security: `npm audit --omit=dev`, Observatory scan of dashboard ≥ A (NFR-9).

## 9. Release Engineering

GitHub Actions matrix builds binaries → hashes → signs feed → attaches to release.
Draft workflow skeleton specified in packaging doc §CI; tags `v0.x.y`; prerelease channel
`next` honored by FR-D2.

---

## 10. Milestones & Acceptance Criteria

| Milestone | Content | Acceptance gate |
|---|---|---|
| M0 | This documentation set validated | Owner signs off SRS v2.0 |
| M1 | Workspace scaffold; CLI shim; import; vault | `openworker ask` works via existing s-ai core; budgets NFR-4 met |
| M2 | Reach v2 registry + doctor probing | doctor exit codes correct on 5-channel matrix |
| M3 | Jobs, schedules, approval policies, artifacts | approval modal blocks shell-exec by default; cron fires while host alive |
| M4 | SOI core (off/passive) + Duet persona seeding + consolidation | determinism test passes; ≤6MB @8,192 neurons; twin fingerprint separable; KG receives traces |
| M5 | SEA builds + 3 desktop installers + update feed | smoke matrix green unsigned; feed verifies |
| M6 | Android: Termux script + PWA manifest | fresh Termux install → dashboard usable < 10 min on mid-range phone |

## 11. Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Unsigned EXE/DMG triggers SmartScreen/Gatekeeper warnings | adoption friction | document bypass; pursue code-signing certs post-v1 (packaging doc §Signing) |
| Bun compile edge cases (native addons) | build failure | Node SEA fallback path kept warm in CI |
| Termux background execution limits (Doze) | missed scheduled jobs | jobs require active session/wake-lock; documented limitation, not silent failure |
| Provider API drift | broken channels/providers | reach failover + provider contract tests against mocks |
| SOI perceived as pseudoscience | credibility | strict "simulated, bio-inspired engineering" labeling; claims limited to memory/modulation behavior; Duet protocol is presentation semantics, not a consciousness claim |
| Repo growth (monorepo) | maintenance | `suite/` isolated workspace; engine untouched |

## 12. Traceability (owner asks → requirements)

| Owner directive | Coverage |
|---|---|
| "use unified multi-provider routing" | FR-C1..C3 (unified routing) |
| "windows installer / mac installer / linux shell / android" | §6, FR-D1, packaging doc, M5/M6 |
| "minimum resources" | NFR-1..7, FR-S5 |
| "my ingredients (you-ai-project.netlify.app)" | §2.1 engine reuse, FR-C4..C8, U1; ingredient table below |
| "Agent-Reach link" | FR-R1..R5 |
| "simulated organoid intelligence, simulated version" | FR-S1..S8, docs/soi-spec.md |
| "use Duet Digital-Twin for personified intelligence; keep it minimal and implementable" | §1.3[8], §2.2(5–6), FR-S1..S8 (Duet pools, tightened caps), soi-spec §3.1/§7 |
| "update all technical documentation; validation gate" | M0 gate; doc set §Companion docs |

**Ingredient mapping**

| Ingredient (yours) | Role in suite |
|---|---|
| You-AI web app | dashboard UI baseline (public/*.html) |
| S-AI v5.1 CLI | engine + command surface (FR-C2) |
| You-AI Engine prototype | modular extraction target post-v1 |
| AIOS (<150 MB agentic OS) | resource-envelope precedent; informs NFR budgets |
| Collabuild 9-stage pipeline | FR-C8 `build` worker mode |
| Prompt-Code (15k prompts) | future skills marketplace (roadmap) |
| OKF AES-256+SHA-256 | FR-K1 vault + SOI checkpoints |
| **Duet — Digital Twin Technology** | personified-intelligence architecture for SOI (Duet Protocol → Primary/Meta/Expressive pools; FR-S1..S8) |
| Bhashini / Study Buddy / Research Mapper / Neural Mapping | carried features (FR-C5..C7, NFR-11) |

## 13. Roadmap beyond v1
APK/Capacitor wrapper · Tauri tray shell · Prompt-Code skill marketplace ·
multi-device sync (opt-in, E2E) · voice wake word · SOI active-mode tuning UI ·
iOS shell.

## 14. Open Questions (for validator)
1. Product name final? (`openworker` vs `you-ai-suite`) — blocks M1 scaffold naming.
2. Signing certificates available in near term? (affects M5 acceptance wording)
3. Default SOI mode shipping `off` confirmed?
4. Keep port 3000 default or move to 4319 to avoid clashes?

---

*End of SRS v2.0. Validation requested before M1 begins.*
