# S-AI — Artificial Mind · Integrated OpenWorker

[![npm version](https://img.shields.io/npm/v/@saikarun/s-ai?color=6366f1&label=version)](https://www.npmjs.com/package/@saikarun/s-ai)
[![npm downloads](https://img.shields.io/npm/dm/@saikarun/s-ai?color=22c55e)](https://www.npmjs.com/package/@saikarun/s-ai)
[![License: MIT](https://img.shields.io/badge/license-MIT-ec4899)](LICENSE)
[![Node](https://img.shields.io/badge/node-18%2B-2c3e50)](package.json)
[![Security Audit](https://github.com/karun99/s-ai-update/actions/workflows/security.yml/badge.svg)](https://github.com/karun99/s-ai-update/actions/workflows/security.yml)
[![Build](https://github.com/karun99/s-ai-update/actions/workflows/build.yml/badge.svg)](https://github.com/karun99/s-ai-update/actions/workflows/build.yml)

> **Published:** [`@saikarun/s-ai`](https://www.npmjs.com/package/@saikarun/s-ai) | **License:** MIT | **Platform:** Node.js >= 18 | **Module:** ESM (TypeScript)

> **S-AI** is an **Artificial Mind** — a self-hosted, intelligence-first coworker that reasons across a multi-agent swarm, thinks *and* acts through a policy-gated execution layer, and ships as an **Integrated OpenWorker** harness with desktop installers, scheduled jobs, reach channels, a credentials vault, and simulated-organoid intelligence (SOI).

The system fuses **execution layer** (risk-rated tool execution with approval gates), **neural mapping (Digital Twin persona adaptation)**, **SOI (Simulated Organoid Intelligence)** for memory consolidation, **MCP Builder** (resource-efficient template-based MCP server creation), **Skill Creator** (customizable modular skill composition), **Research Mapper (Paperscape-style arXiv visualization)**, **Study Buddy (AI tutoring with gamified learning)**, **Bhashini multilingual AI**, crawl4ai web scraping, MCP integration, knowledge graph, and bias-reduced consensus.

**v6.1 Security:** Hardened for production — SSRF protection, filesystem & shell sandboxing, bearer-token auth, rate limiting, and a secure registry-bound execution engine, all covered by CI (gitleaks, OSV-Scanner, govulncheck, Semgrep, npm audit) and automated dependency updates via Dependabot.

**v6.0 New:** The swarm now thinks *and* acts — it produces execution plans with risk-rated actions that go through approval gates before execution. S-AI evolves from a reasoning engine into a full-fledged autonomous assistant.

**No advanced hardware required** — runs on any device with a browser or Node.js. Zero inference cost with OpenRouter free models. Your data stays on your device.

---

## The Artificial Mind & Integrated OpenWorker

S-AI is built as an **Artificial Mind** — a cohesive intelligence that combines many cognitive faculties rather than a single chat wrapper. It ships as an **Integrated OpenWorker**: a self-hosted "AI coworker" that installs natively and works for you on your own hardware.

| Capability | OpenWorker delivers |
|-----------|---------------------|
| **Swarm Reasoning** | 6–7 agent swarm with bias-reduced consensus reaches balanced, multi-perspective conclusions |
| **Synthetic Executive** | Plans then *acts* — risk-rated actions pass through approval gates before executing real tools |
| **Simulated Organoid Intelligence (SOI)** | Bio-inspired, simulated neural memory & consensus modulation (software-only, no hardware) |
| **Desktop Coworker** | Native installers for Windows (EXE/MSI), macOS (DMG), Linux, Android, and PWA |
| **Scheduled Jobs & Automations** | `openworker` daemon runs recurring worker jobs and cron-style automations |
| **Reach Channels** | Web, YouTube, GitHub, RSS, arXiv — with doctor health checks per channel |
| **Credentials Vault** | Secrets stored encrypted and injected only where needed |
| **Memory Graph** | Persistent knowledge graph + neural persona (Digital Twin) adaptation |
| **Local-First** | Keys and data never leave your device except to the AI providers you choose |

### OpenWorker CLI

```bash
openworker chat        # Start a worker session with the swarm
openworker run "job"   # Run a one-off worker job
openworker jobs        # Manage scheduled automated jobs
openworker policy show # Inspect tool-use policy (allow / deny / require-approval)
openworker vault       # Manage encrypted credentials
openworker reach       # Configure and health-check reach channels
openworker soi         # Inspect the simulated organoid intelligence state
openworker daemon      # Run the resident worker service
```

The full OpenWorker harness lives in [`suite/`](suite/) and integrates directly with the S-AI engine core.

---

## Supported Devices & Platforms

| Platform | Architecture | Min RAM | Install Method | Status |
|----------|-------------|---------|----------------|--------|
| **Windows** | x64 | 2 GB | [Standalone .exe](#2-windows--standalone-exe) / [MSI Installer](#3-windows--msi-installer) / npm | ✅ |
| **Windows** | ARM64 | 2 GB | npm / standalone .exe | ✅ |
| **macOS** | Intel (x64) | 2 GB | [Standalone binary](#4-macos) / npm | ✅ |
| **macOS** | Apple Silicon (ARM64) | 2 GB | [Standalone binary](#4-macos) / npm | ✅ |
| **Linux** | x64 | 2 GB | [Standalone binary](#5-linux) / npm / Docker | ✅ |
| **Linux** | ARM64 | 2 GB | [Standalone binary](#6-linux-arm64-raspberry-pi-aws-graviton) / npm | ✅ |
| **Linux** | ARMv7 (RPi 3/4/5) | 2 GB | npm | ✅ |
| **Android** | ARM64 | 2 GB | [APK](#8-android--apk) / [Termux](#9-android--termux) / PWA | ✅ |
| **Docker** | x64 / ARM64 | 2 GB | [Docker Compose](#7-docker) | ✅ |
| **Raspberry Pi** | ARM64 / ARMv7 | 2 GB | npm / standalone binary | ✅ |
| **Chrome OS** | x64 / ARM64 | 2 GB | Linux (Crostini) / PWA | ✅ |
| **Any browser** | any | — | [PWA (home-screen install)](#11-pwa-any-browser-any-os) | ✅ |

### Minimum Requirements

- **CPU:** Any 64-bit processor (ARM or x86). 32-bit systems not supported.
- **RAM:** 2 GB minimum (CLI). **4 GB recommended** when running the dashboard, MCP servers, skills, and local models together.
- **Disk:** 50 MB for core install. 200 MB with all build artifacts.
- **Network:** Optional. Required only for AI provider calls. Fully offline with local Ollama models.
- **OS:** Windows 10+, macOS 12+, Ubuntu 20.04+ / Debian 11+, Android 10+, any Linux with Node.js 18+.

---

## Installation Methods

### 1. npm (All Platforms)

The recommended installation method. Works on Windows, macOS, Linux, and Android (Termux).

```bash
# Global install (recommended)
npm install -g @saikarun/s-ai@latest

# Or run directly without installing
npx @saikarun/s-ai ask "What are the pros and cons of microservices?"

# First-time setup
s-ai setup       # Interactive setup wizard — configure providers, API keys, preferences
s-ai serve       # Start web dashboard at http://localhost:3000
```

### 2. Windows — Standalone .exe

No Node.js required. Download the single-file executable:

```bash
# Download from GitHub Releases
# https://github.com/karun99/s-ai-update/releases/latest

# Or build from source
npm run build:exe
# Output: build/dist/s-ai.exe
```

### 3. Windows — MSI Installer

Full Windows Installer with Start Menu shortcuts, PATH setup, and uninstall support:

```bash
# Build the MSI (requires WiX Toolset)
npm run build:msi
# Output: build/dist/s-ai-setup.msi
```

### 4. macOS

Standalone binary for Intel and Apple Silicon:

```bash
# Build from source
npm run build:exe
# Output: build/dist/s-ai-macos (Intel) or s-ai-macos-arm64 (Apple Silicon)

# Or use npm
npm install -g @saikarun/s-ai@latest
```

### 5. Linux

Standalone binary or package manager:

```bash
# Standalone binary
npm run build:exe
# Output: build/dist/s-ai-linux (x64) or s-ai-linux-arm64 (ARM64)

# Or use npm
npm install -g @saikarun/s-ai@latest

# Make executable
chmod +x build/dist/s-ai-linux
./build/dist/s-ai-linux ask "Hello"
```

### 6. Linux ARM64 (Raspberry Pi, AWS Graviton)

```bash
npm install -g @saikarun/s-ai@latest
# Or build standalone binary
npm run build:exe
# Output: build/dist/s-ai-linux-arm64
```

### 7. Docker

```bash
# Quick start
cp .env.example .env      # add your API keys
docker compose up -d --build
# Dashboard: http://localhost:3000

# Or build manually
docker build -t s-ai .
docker run -p 3000:3000 --env-file .env s-ai
```

### 8. Android — APK

Native Android app package:

```bash
# Build APK (requires Android SDK)
npm run build:apk
# Output: build/dist/s-ai.apk

# Install on device
adb install build/dist/s-ai.apk
```

### 9. Android — Termux

Full CLI experience on Android via Termux terminal:

```bash
# Install Termux from F-Droid (not Play Store)
pkg install nodejs
npm install -g @saikarun/s-ai@latest
s-ai setup
s-ai serve
```

### 10. Android — PWA

Install the dashboard as a home-screen app from any Android browser:

1. Open `http://<your-device-ip>:3000` in Chrome
2. Tap the **"Add to Home Screen"** banner
3. The app installs as a standalone PWA

### 11. PWA (Any Browser, Any OS)

The dashboard is a Progressive Web App. Install it from any modern browser:

1. Navigate to the dashboard URL
2. Click the install icon in the address bar (or use browser menu)
3. The app installs with offline support and native feel

### 12. Install from Source

```bash
git clone https://github.com/karun99/s-ai-update.git
cd s-ai-update
npm install            # postinstall builds dist/ automatically
```

### 13. Raspberry Pi (ARMv7 / ARM64)

Optimized for Raspberry Pi 3, 4, and 5:

```bash
# On Raspberry Pi OS
sudo apt install nodejs npm
npm install -g @saikarun/s-ai@latest
s-ai setup
s-ai serve
```

### 14. Docker Compose (Production)

```yaml
# docker-compose.yml (included in repo)
services:
  s-ai:
    build: .
    ports:
      - "3000:3000"
    env_file: .env
    volumes:
      - ~/.openworker:/root/.openworker
    restart: unless-stopped
```

## What's in v6.1

| Feature | Status |
|---------|--------|
| **Integrated OpenWorker harness** (daemon, jobs, reach, vault, policy) | **New in 6.1** |
| **Security hardening** (SSRF, sandboxing, auth, rate limit, secure executor) | **New in 6.1** |
| **Security CI** (gitleaks, OSV-Scanner, govulncheck, Semgrep, npm audit) | **New in 6.1** |
| **Dependabot** across all sub-projects & ecosystems | **New in 6.1** |
| 6-agent swarm with bias-reduced consensus | Done |
| **Execution Layer** (policy-gated tool execution) | **New in 6.0** |
| **7-agent swarm** (added Action Planner) | **New in 6.0** |
| **Tool Registry** (15+ tools with risk levels) | **New in 6.0** |
| **Execution Engine** (plan → approve → execute → audit) | **New in 6.0** |
| **Daemon mode** (headless service with scheduled jobs) | **New in 6.0** |
| **Audit log** (JSONL audit trail for all actions) | **New in 6.0** |
| Neural mapping (Digital Twin persona) | Done |
| 20+ AI provider support | Done |
| crawl4ai web scraping | Done |
| MCP server + client integration | Done |
| Knowledge graph persistence | Done |
| AI Engine (prompt-to-app builder) | Done |
| Web dashboard with 4 themes | Done |
| **MCP Builder** (resource-efficient templates) | **New in 5.1** |
| **Skill Creator** (customizable modular skills) | **New in 5.1** |
| **Research Mapper** (Paperscape-style arXiv citation graph) | **New in 5.1** |
| **Study Buddy** (AI tutoring, quizzes, multi-mode mentoring) | **New in 5.1** |
| **Bhashini Multilingual AI** (translation, TTS, ASR) | **New in 5.1** |
| **AI Studio** (video generation) | **New** |
| **Approval Modal** (policy-gated tool approval in dashboard) | **New in 5.1** |
| **Multi-platform builds** (Windows, macOS, Linux, Android, Docker) | **New in 5.1** |

---

## MCP Builder

Resource-efficient MCP server creation with pre-built templates. Each template is optimized for minimal memory footprint — ideal for edge devices, mobile, and low-resource environments.

```bash
# List available templates
s-ai engine mcp "list templates"

# Build from a template
s-ai engine mcp "Build a web search MCP server"

# Build from natural language
s-ai engine mcp "MCP server for bird call identification with 3 tools"
```

### Available Templates

| Template | Tools | Memory | Use Case |
|----------|-------|--------|----------|
| `data-api` | 5 | 8KB | CRUD operations on structured data |
| `web-search` | 3 | 4KB | Web search and content extraction |
| `file-system` | 4 | 2KB | Safe file operations with sandboxing |
| `ai-proxy` | 3 | 16KB | Multi-provider AI proxy |
| `knowledge-base` | 4 | 32KB | RAG-style document management |

### Programmatic Usage

```typescript
import { getMcpBuilder } from '@saikarun/s-ai';

const builder = getMcpBuilder({ lightweight: true });

// Build from template with customizations
const code = builder.buildFromTemplate('web-search', {
  name: 'my-search-server',
  removeTools: ['summarize'],
  addTools: [{ name: 'news', description: 'Search news', parameters: {} }],
});

// Memory-efficient — 4KB footprint
console.log(builder.getMemoryEstimate('web-search')); // 4096

// Build minimal server
const minimal = builder.buildMinimal('ping', [
  { name: 'ping', description: 'Health check', parameters: {} },
]);
```

### REST API

```
GET  /api/mcp-builder/templates    — List all templates with memory estimates
POST /api/mcp-builder/build        — Build MCP server from template or prompt
```

---

## Skill Creator

Customizable skill creation with modular composition. Skills can be created from templates, customized with additional tools, and hot-plugged into running swarms.

```bash
# List skill templates
s-ai engine skill "list templates"

# Create from template
s-ai engine skill "Build a data pipeline skill with extract, transform, load"

# Create from natural language
s-ai engine skill "Code review assistant with generate, review, refactor, explain"
```

### Available Skill Templates

| Template | Tools | Memory | Use Case |
|----------|-------|--------|----------|
| `api-wrapper` | 2 | 4KB | REST API wrapper with auth |
| `data-pipeline` | 4 | 8KB | ETL pipeline operations |
| `chat-agent` | 4 | 12KB | Customizable chat with persona & memory |
| `code-assistant` | 4 | 8KB | Code generation, review, refactoring |
| `notification-hub` | 2 | 4KB | Multi-channel notifications |

### Programmatic Usage

```typescript
import { getSkillCreator } from '@saikarun/s-ai';

const creator = getSkillCreator({ lightweight: true });

// Build from template
const skill = creator.buildFromTemplate('chat-agent', {
  name: 'ornith-assistant',
  description: 'Ornithology research assistant',
  addTools: [{
    name: 'identify_species',
    description: 'Identify bird species from description',
    inputSchema: { description: { type: 'string' } },
    handler: 'async ({ description }) => { ... }',
  }],
});

// Save to disk
creator.saveSkill('ornith-assistant', skill.skillJson, skill.indexCode);

// Memory estimate: 12KB
console.log(creator.getMemoryEstimate('chat-agent')); // 12288
```

### REST API

```
GET  /api/skill-creator/templates    — List all templates with memory estimates
POST /api/skill-creator/build        — Build skill from template or prompt
```

---

## Study Buddy

AI-powered tutoring system with gamified learning, quiz generation, and multi-mode mentoring. The Study Buddy evolves as you learn — from "Dunce Twin" (Lv. 1) to "Royal Scholar" (Lv. 50).

### Modes

| Mode | Description |
|------|-------------|
| **Teach the Bot** | Teach AI by answering quiz questions. Earn XP, level up, and evolve your avatar. |
| **Study Mentor** | Get help with homework, explanations, career guidance, resume review, references, or project pitches. |
| **Summary** | Export your session as PDF, PPTX, or audio. |

### Mentor Sub-Modes

| Sub-Mode | Use Case |
|----------|----------|
| Homework | Step-by-step homework help |
| Explain | Topic breakdown with analogies |
| Career | Career path guidance |
| Resume | Resume review and improvement |
| References | APA/MLA/Chicago citation formatting |
| Pitch | Project pitch deck generation |

### MCP Tools

```
generate_quiz    — Generate a quiz question from a knowledge base
check_answer     — Check if a user answer is correct
get_evolution    — Get the current study buddy evolution stage
format_references — Format academic references in APA/MLA/Chicago
generate_pitch   — Generate a structured project pitch
```

### Dashboard

Access the Study Buddy at `http://localhost:3000/study-buddy.html` after starting the dashboard.

---

## Research Mapper

Paperscape-style arXiv research paper search, citation graph visualization, and swarm analysis. Search papers, build citation networks, and analyze research trends interactively.

### Features

- **Paper Search**: Query arXiv by keyword, author, or category
- **Citation Graph**: Build force-directed citation networks between papers
- **Category Filter**: Browse 15+ arXiv categories (cs.AI, physics, math, etc.)
- **Swarm Analysis**: Use the 6-agent swarm to analyze paper contributions and methodology
- **Interactive Dashboard**: Drag, zoom, and click to explore the research landscape

### MCP Tools

```
search_papers     — Search arXiv for papers by query, category, or author
build_graph       — Build a citation graph from arXiv paper IDs
get_paper         — Fetch detailed paper information by arXiv ID
list_categories   — List popular arXiv research categories
```

### Dashboard

Access the Research Mapper at `http://localhost:3000/research-mapper.html` after starting the dashboard.

### Programmatic Usage

```typescript
import { searchArxiv, buildCitationGraph } from '@saikarun/s-ai/arxiv';

const result = await searchArxiv('cat:cs.AI AND transformer', 0, 25);
const graph = buildCitationGraph(result.papers);
console.log(`${graph.nodes.length} papers, ${graph.edges.length} citation links`);
```

---

## Multi-Platform Builds

S-AI can be built as a standalone executable for every major platform. See [`build/`](build/) for full documentation.

| Platform | Artifact | Command |
|----------|----------|---------|
| Windows x64 | `s-ai.exe` | `npm run build:exe` |
| Windows x64 | `s-ai-setup.msi` | `npm run build:msi` |
| Linux x64 | `s-ai-linux` | `npm run build:exe` |
| Linux ARM64 | `s-ai-linux-arm64` | `npm run build:exe` |
| macOS x64 | `s-ai-macos` | `npm run build:exe` |
| macOS ARM64 | `s-ai-macos-arm64` | `npm run build:exe` |
| Android | `s-ai.apk` | `npm run build:apk` |
| Docker | `s-ai:latest` | `npm run build:docker` |

### Build All Platforms

```bash
npm run build:all    # Build everything (requires toolchains)
bash build/scripts/build-exe.sh    # Just executables
bash build/scripts/build-apk.sh    # Just Android APK
bash build/scripts/build-docker.sh # Just Docker
```

### CI/CD

GitHub Actions (`.github/workflows/build.yml`) automatically builds all platforms on push to `main` or version tags. Releases are created with all artifacts attached.

---

## Case Study: Ornith 1.5

[**Ornith 1.5**](docs/case-study-ornith-1.5.md) demonstrates S-AI deployed across 12 field stations in the Western Ghats for real-time avian ecology monitoring. Key results:

- **Survey cycle**: 4-6 months → 2-3 weeks
- **Species ID accuracy**: 78% → 94.2%
- **Hardware**: Raspberry Pi 5 (4GB) on solar power, $300/station
- **Memory footprint**: 68KB total (MCP servers + skills)
- **Connectivity**: Zero (fully offline with local Llama 3.2 3B)

Read the full case study: [`docs/case-study-ornith-1.5.md`](docs/case-study-ornith-1.5.md)

---

## CLI Commands

```
Core:        s-ai ask | setup | serve | daemon | status | help
Execution:   s-ai tools | plan | execute | approve | deny | audit
Neural:      s-ai persona set | show | clear | node | profiles
Swarm:       s-ai swarm status | reset | agents
Graph:       s-ai graph query | stats | store
Research:    s-ai research search | map | graph
Bhashini:    s-ai bhashini translate | status | pipelines
Web:         s-ai crawl | search
MCP:         s-ai mcp serve | tools | servers
Providers:   s-ai provider list | set | test | models | model
Skills:      s-ai skill list | install | remove
AI Engine:   s-ai engine build | skill | mcp | swarm | list | ui
Config:      s-ai config | get | set | init | setup
```

## Supported Providers

OpenRouter (100+ models), OpenAI, Anthropic, Google AI, Ollama (local), Nvidia, Cohere, Grok (xAI), Kimi, Pi, Together AI, Fireworks AI, AWS Bedrock, Claude on AWS, Vertex AI, Azure Foundry, KoboldCPP, Oobabooga, MLC LLM, OpenAI-Compatible, **Bhashini (multilingual)**.

## Programmatic Usage

```typescript
import { Swarm, NeuralMap, getNeuralMap, ExecutionEngine, listToolMeta, searchArxiv, buildCitationGraph, getBhashiniProvider } from '@saikarun/s-ai';

// Neural mapping
const neuralMap = getNeuralMap();
neuralMap.setProfile({ name: 'Alice', bio: 'Senior architect' });

// Swarm with execution planning
const swarm = new Swarm();
swarm.setPersonaContext(neuralMap.buildPersonaContext());
const result = await swarm.run('Should we use microservices?');
console.log(result.executionPlan); // Actions proposed by the swarm

// Execution Engine
const execEngine = new ExecutionEngine({ autoApproveLowRisk: true });
const plan = execEngine.createPlan(
  [{ tool: 'readFile', params: { path: '/tmp/data.json' }, reason: 'Load data' }],
  'Read data file', 0.9, 2, 1500
);
const report = await execEngine.executePlan(plan, async (tool, params) => {
  return await runTool(tool, params);
});

// Tool Registry
const tools = listToolMeta();
tools.forEach(t => console.log(`${t.name}: ${t.riskLevel} (${t.category})`));

// Research Mapper
const arxivResult = await searchArxiv('quantum machine learning', 0, 10);
const graph = buildCitationGraph(arxivResult.papers);

// Bhashini translation
const bhashini = getBhashiniProvider();
const translated = await bhashini.translate('Hello', 'en', 'hi');

// MCP Builder (resource-efficient)
import { getMcpBuilder } from '@saikarun/s-ai';
const mcpBuilder = getMcpBuilder({ lightweight: true });
const serverCode = mcpBuilder.buildFromTemplate('web-search', { name: 'my-search' });

// Skill Creator (customizable)
import { getSkillCreator } from '@saikarun/s-ai';
const skillCreator = getSkillCreator({ lightweight: true });
const skill = skillCreator.buildFromTemplate('chat-agent', { name: 'my-agent' });
```

## Package Exports

```typescript
// Core
import { Swarm } from '@saikarun/s-ai/swarm';
import { Agent } from '@saikarun/s-ai/agent';
import { NeuralMap, getNeuralMap } from '@saikarun/s-ai/neural';
import { getConfig } from '@saikarun/s-ai/config';
import { createProvider } from '@saikarun/s-ai/providers';
import { KnowledgeGraph } from '@saikarun/s-ai/graph';
import { CrawlEngine } from '@saikarun/s-ai/crawl';
import { createSwarmMcpServer } from '@saikarun/s-ai/mcp';
import { getMcpClientManager } from '@saikarun/s-ai/mcp/client';

// Execution Layer (v6.0)
import { ExecutionEngine } from '@saikarun/s-ai/execution';
import { getToolMeta, listToolMeta, getToolsByRisk } from '@saikarun/s-ai/execution/registry';
import type { ActionProposal, ExecutionPlan, RiskLevel } from '@saikarun/s-ai/execution/types';

// Research Mapper (v5.1)
import { searchArxiv, buildCitationGraph } from '@saikarun/s-ai/arxiv';

// Bhashini Multilingual AI (v5.1)
import { getBhashiniProvider, BhashiniProvider } from '@saikarun/s-ai/bhashini';
import { getBhashiniTools } from '@saikarun/s-ai/bhashini/tools';
```

## Environment Variables

`OPENROUTER_API_KEY` | `OPENAI_API_KEY` | `ANTHROPIC_API_KEY` | `GOOGLE_API_KEY` | `OLLAMA_BASE_URL` | `NVIDIA_API_KEY` | `AWS_BEDROCK_REGION` | `AWS_ACCESS_KEY_ID` | `AWS_SECRET_ACCESS_KEY` | `AWS_SESSION_TOKEN` | `CLAUDE_AWS_API_KEY` | `VERTEX_AI_PROJECT_ID` | `VERTEX_AI_REGION` | `VERTEX_AI_ACCESS_TOKEN` | `FOUNDRY_RESOURCE` | `FOUNDRY_API_KEY` | `TOGETHER_API_KEY` | `FIREWORKS_API_KEY` | `COHERE_API_KEY` | `GROK_API_KEY` | `KIMI_API_KEY` | `PI_API_KEY` | `OPENAI_COMPATIBLE_BASE_URL` | `OPENAI_COMPATIBLE_API_KEY` | `SAI_PRIMARY_PROVIDER` | `BHASHINI_API_KEY` | `BHASHINI_USER_ID` | `BHASHINI_PIPELINE_ID`

## Documentation

- [Build System](build/README.md) — Multi-platform build instructions
- [Ornith 1.5 Case Study](docs/case-study-ornith-1.5.md) — Edge deployment case study
- [Docker Guide](Dockerfile) — Container deployment
- [API Reference](src/server.ts) — REST API endpoints

## License

MIT — Copyright (c) 2026 Sai Karun Nandipati 

See [LICENSE](LICENSE) for the full text.
