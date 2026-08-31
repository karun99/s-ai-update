# S-AI Security Policy — Real-Time Code Integrity & Implementability

**Status:** Active
**Applies to:** `karun99/s-ai-update` (and `karun99/s-ai`)
**Model:** Adaptive Cyber-Immunity Security Workflow — `Detect → Analyse → Validate → Respond → Record → Update → Learn → Adapt`

This policy defines how **code integrity is maintained in real time** throughout the development lifecycle and how the code is kept **implementable** (deployable and verifiable) at all times. It complements the dependency-focused policy and the GitHub security controls already enabled on the repository.

---

## 1. Real-Time Code Integrity

Code integrity is the guarantee that every change merged into `main` is authored by a trusted contributor, reviewed, validated by automated checks, and free of known vulnerabilities before it ships. This is enforced continuously — not as a one-time audit.

### 1.1 Integrity Gates (every pull request)

Every commit must pass the full gate before merging:

| Gate | Mechanism | What it enforces |
|------|-----------|------------------|
| **Provenance** | Signed / verified commits; trusted committer | The change is from an authenticated, authorized author |
| **Static analysis** | ESLint + `tsc --noEmit` (CI `validate`) | Type safety and code-style correctness |
| **Build** | `npm run build` | The code compiles to a runnable artifact |
| **Tests** | `npm test` (Node test runner) | Behaviour is correct and regression-free |
| **Secret scanning** | GitHub secret scanning + gitleaks in CI | No credentials/secrets in the diff |
| **Vulnerability scan** | OSV-Scanner, npm audit, Semgrep, govulncheck | No known-vulnerable dependency is introduced |
| **Supply-chain review** | Dependabot + dependency review | Transitive dependency changes are inspected |
| **Human review** | Branch protection (required reviews) | An independent human approves before merge |

### 1.2 Branch Protection

`main` is protected and changes may not be pushed directly. Merges require:
- At least one approved review.
- All required status checks (build, type-check, lint, tests, security scans) to pass.
- No direct pushes; all changes land via pull request.

### 1.3 Immutable Audit Trail (Record)

Every change that reaches `main` carries a persistent, verifiable record:
- Commit identity (author + signature).
- Full diff (unchanged history).
- CI run logs and scan results tied to the commit hash.
- Correlated dependency/security alert status.

This is the system's **immune memory**: past findings and their resolution remain auditable and can inform future detection.

---

## 2. Implementability (Deployability & Verifiability)

Code is only trustworthy if it can be built, deployed, and verified reproducibly. S-AI keeps the codebase implementable through the following.

### 2.1 Reproducible Build

```bash
npm ci            # deterministic, lockfile-pinned install
npm run build     # TypeScript -> dist/ (tsc)
npm run validate  # tsc --noEmit type check
npm run test      # unit/integration test suite
```

A clean build from a fresh checkout must succeed before any release or deployment is accepted.

### 2.2 Deployment Targets

- **Local / self-hosted:** `npm install -g @saikarun/s-ai && s-ai setup && s-ai serve`
- **Docker:** `docker compose up -d --build` (see `Dockerfile` / `docker-compose.yml`)
- **Vercel (serverless):** see [Vercel Deployment](#3-vercel-deployment) below.

### 2.3 Verification After Deploy

After any deployment, run the built-in health checks to confirm integrity at runtime:

```bash
curl -s https://<deployment-url>/health          # -> {"status":"ok",...}
curl -s https://<deployment-url>/api/status      # version, providers, features
```

A green `/health` and `/api/status` indicate the deployed artifact is the same verified build that passed CI.

---

## 3. Vercel Deployment

S-AI is deployable to Vercel via the CLI using an existing Vercel login:

```bash
vercel login                      # CLI auth (token stored under ~/.local/share/com.vercel.cli)
vercel link                       # link the repo to a Vercel project (team/project name)
npm run build                     # must run before deploy (api/index.js imports dist/)
vercel --prod                     # production deploy
```

### 3.1 Runtime Model

Everything is served through a single Node.js serverless function:

- `api/index.js` — mounts the full Express app (`createServer({ listen: false, root: process.cwd() })`) so the static dashboard **and** all `/api/*` routes behave exactly as `s-ai serve`.
- `vercel.json` — routes `/(.*)` to the function, sets `maxDuration` and hardening headers.
- `public/` is served by the app via `express.static`, identical to local run.

### 3.2 Configuration (environment variables)

The deployment is fully configurable via Vercel environment variables — no code change required:

| Variable | Purpose | Example |
|----------|---------|---------|
| `SAI_API_KEY` | Deterministic bearer token for protected routes (configurable auth) | `change-me` |
| `SAI_AUTH_MODE` | `off` disables auth (public demo); unset keeps auth | `off` |
| `SAI_DATA_DIR` | Writable path for state (graph/persona); **ephemeral in serverless** | `/var/data/s-ai` |
| `OPENROUTER_API_KEY` (et al.) | AI provider keys driving the swarm / dashboard | `sk-...` |
| `SAI_PRIMARY_PROVIDER` | Active provider (default `openrouter`) | `openrouter` |

> **Serverless caveat:** state written under `SAI_DATA_DIR` does **not** persist across function invocations. For durable memory (knowledge graph, personas, AI-engine artifacts) in production, mount a durable store and point `SAI_DATA_DIR` at it, or connect the affected routes to an external database. API keys are stored on Vercel and never committed to the repository.

### 3.3 Configurability guarantees

- **No hard-coded credentials.** All keys come from environment variables.
- **Auth is optional and operator-chosen** (`SAI_AUTH_MODE` / `SAI_API_KEY`).
- **Build-then-deploy** ordering is enforced so `dist/` is always present for the function.

---

## 4. Continuous Learning Cycle

Real-time integrity is sustained by the same adaptive loop used for dependencies:

```
Detect → Analyse → Validate → Respond → Record → Learn → Adapt
```

- **Detect:** CI + Dependabot + code/secret scanning continuously watch the codebase.
- **Validate:** every change passes the integrity gate before merge.
- **Record:** commits, CI logs, and scan results form the audit trail / immune memory.
- **Adapt:** newly discovered vulnerability patterns update Dependabot and scanning policy for the next cycle.

---

## 5. Safety Controls

- Least-privilege service accounts / tokens.
- No auto-merge; human approval gate required.
- Sealed credentials injected only via environment / secret manager.
- Rollback: every change is a separate, revertible commit; deployments keep prior production URLs.
- Rate limiting + audit logging on the server layer.
- Emergency shutdown of the public deployment is possible by rotating/deleting the project's env vars or secrets.

---

## 6. Scope & Limitations

This policy substantially raises code integrity and implementability but does **not** guarantee absolute security. It is a research-level, biological-immunity-inspired implementation. Report vulnerabilities via [GitHub Security Advisories](https://github.com/karun99/s-ai-update/security/advisories/new); provide security fixes for the latest major version within the SLA defined in `.github/SECURITY.md`.

---

See also: [`.github/SECURITY.md`](.github/SECURITY.md) (disclosure policy), [`.github/dependabot.yml`](.github/dependabot.yml) (dependency policy), [`docs/SECURITY-INTEGRATION.md`](docs/SECURITY-INTEGRATION.md) (server security integration), [`.env.vercel.example`](.env.vercel.example) (deployment configuration).
