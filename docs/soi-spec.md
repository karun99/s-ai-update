# SOI — Simulated Organoid Intelligence (Technical Specification)

| | |
|---|---|
| **Module** | `suite/src/soi/*` |
| **Spec version** | 1.0 |
| **Status** | DRAFT — pending owner validation (M0 gate) |
| **Personified-intelligence reference** | Duet — Digital Twin Technology (`nsktech994/Duet--Digital-Twin-Technology`) |
| **Related** | [srs.md](../srs.md) §3.4 · [docs/architecture.md](architecture.md) |

---

## 1. What SOI Is (and Is Not)

SOI is a **software-only simulation** of organoid-inspired neural dynamics whose
macro-organization implements **personified intelligence** using the owner's **Duet
Protocol**: every cognition cycle runs three specialized streams —

```
[[PRIMARY]]  executive / action-oriented stream   (immediate persona reaction)
[[META]]     reflective / perception-delta stream  (why the persona sees it this way)
[[RESPONSE]] expressive / clone stream            (final in-character output)
```

In SOI these become three functionally specialized neuron pools inside one sparse
reservoir. The pools are seeded from the twin's persona (OKF persona vector + Duet
Cognitive Profile), so two different twins produce measurably different dynamics from
identical input. That difference — not any claim of consciousness — is the product feature.

**Explicit non-goals:** biological computation, sentience claims, real-time animation of
"awareness". All UI surfaces that expose SOI data must carry the label *"simulated"*.
This is bio-inspired engineering (reservoir computing / liquid state machines), nothing more.

## 2. Biology-to-Simulation Mapping

| Biological concept | SOI implementation | Cost driver |
|---|---|---|
| Organoid with regional specialization | One sparse reservoir split into 3 pools (P/M/E) + cross-pool association edges | edge count |
| Neuron (excitatory/inhibitory) | Leaky integrate-and-fire unit, adaptive threshold, 2-tick refractory | 1 Float32 state each |
| Synapse | Sparse CSR weight array, Float32 | dominant memory cost |
| Sensory input | Token → 3 hash bins → spike train into Primary pool ingress | negligible |
| Axonal delay (P→M copy) | Fixed 10-tick ring buffer of pool ingress vectors | small ring |
| Cognition / readout | Pool mean firing rates over sliding window → decoded signals | negligible |
| Hebbian learning | STDP on excitatory edges only, clipped weights | touched-edge work |
| Homeostasis | Per-neuron threshold drift toward 5 Hz target | negligible |
| Sleep / consolidation | Offline pass folding high-salience traces into knowledge graph + persona weights | bounded batch |

## 3. Architecture

```
                 prompt / agent message (text)
                            │
                   ┌────────▼────────┐
                   │  Encoder        │  hash-bin spike trains (deterministic)
                   └────────┬────────┘
        t0                  │
   ┌─────────────┐   ┌──────▼───────┐   delay 10t   ┌──────────────┐
   │ POOL P      │──▶│ POOL M       │◀──────────────│ ingress ring │
   │ (primary)   │   │ (meta)       │               └──────────────┘
   └──────┬──────┘   └──────┬───────┘
          │  assoc. edges   │
          └───────┬─────────┘
             ┌────▼─────┐
             │ POOL E   │   expressive (clone)
             └────┬─────┘
                  │ sliding-window rates
        ┌─────────▼──────────┐
        │ Decoder            │→ confidence · novelty · bias_anomaly ·
        └─────────┬──────────┘  salience · persona_drift
                  │
     ┌────────────┼─────────────────┐
     ▼            ▼                 ▼
 Orchestrator  Critic           Synthesizer      (swarm hooks, srs §3.4)
 routing hint  anomaly flag     salience/tone
                                    │
                        consolidate (weekly/"sleep")
                                    ▼
                     Knowledge Graph + Neural Mapping weights
```

### 3.1 Duet coupling (personification)
1. **Seeding.** On twin creation/import, the Duet Cognitive Profile (worldview, bias,
   linguistic-pattern analysis) is embedded to a 64-d persona vector; pool bias currents and
   initial edge gains are derived from it (`seedPersona(vec)`). Re-seeding resets plasticity,
   never the graph.
2. **Cycle semantics.** A conversation turn = one Duet cycle: P reacts (fast ingress),
   M reflects (delayed ingress + P readout), E integrates both. The decoder emits
   `persona_drift` = distance between current P/M rate ratio and the ratio recorded at seed
   time — the measurable fingerprint of *this* twin.
3. **Transparency.** When SOI is enabled, swarm outputs may attach a `soi` header showing
   decoded signals; the textual `[[PRIMARY]]/[[META]]/[[RESPONSE]]` display remains the
   engine's Duet rendering (geminiService-style), not produced by SOI. SOI modulates;
   it does not speak.

## 4. Algorithms (concrete)

Sim tick = 2 ms virtual. Default cycle = 64 ticks per turn, computed in 8-tick slices
(event-loop safe).

```
LIF:        v[i] += (v[i] * (1 - 1/tau)) + I_syn[i] - theta[i]
spike:      if v[i] >= theta[i]: spike, v[i]=v_reset, refractory=2
theta homeo: theta[i] += eta_h * (rate_i - 5 Hz)          eta_h = 1e-4
STDP:       dw = A+ * exp(-dt/tau_p)   if pre before post    A+ = 0.010
            dw = -A- * exp(-dt/tau_m)  if post before pre   A- = 0.008
            clip w to [0, wmax=1.0]; inhibitory edges fixed
Encoding:   token -> h1,h2,h3 = xxhash32(seed,k)*3 mod N_in; spikes at t, t+2, t+4
Readout:    r_pool = mean(spikes)/window; signals normalized against seed baseline z-scores
Novelty:    ||r_M - r_M_baseline|| ; Confidence: r_E stability across last 2 cycles
Bias flag:  sustained r_M/r_P ratio deviation beyond k=2.5 sigma -> bias_anomaly=true
```

Constants live in `soi.config.json`; all math in plain TypeScript on typed arrays.
No dependencies. Core target ≤ 700 LOC excluding tests.

## 5. Configuration

```jsonc
// ~/.openworker/soi.config.json  (created on first enable; absent = module never loads)
{
  "mode": "off",                    // off | passive | active   (default off, srs FR-S2)
  "neurons": { "primary": 2730, "meta": 2730, "expressive": 2732 },
  "connectivity": 0.005,            // edge probability, small-world rewiring p=0.05
  "tick_ms": 2, "cycle_ticks": 64, "slice_ticks": 8,
  "stdp": { "ap": 0.010, "am": 0.008, "taup": 10, "taum": 10 },
  "consolidate": { "every_hours": 168, "max_traces": 500 },
  "seed": 0                         // 0 => derive deterministic seed from twin id
}
```

## 6. Public Surface

```ts
export interface SoiSignals {
  confidence: number; novelty: number; bias_anomaly: boolean;
  salience: number; persona_drift: number;
}
export declare class SoiCore {
  constructor(cfg: SoiConfig, twinId: string);
  static load(dir: string): SoiCore;              // lazy; throws if mode==='off'
  ingest(text: string, role: 'USER'|'AGENT'): SoiSignals;   // one Duet cycle
  consolidate(): SoiTrace[];                      // fold traces -> engine graph sink
  checkpoint(): Promise<void>; reset(): void; stats(): SoiStats;
}
```

CLI: `openworker soi status | feed | stats | consolidate | reset`
HTTP (dashboard): `GET /api/soi/stats`, `POST /api/soi/mode`.

## 7. Resource Budgets (hard gates — CI-enforced)

| Config | Neurons | Synapses (~0.5%) | Steady RSS | Step (64t) | Consolidation |
|---|---|---|---|---|---|
| **default** | 8,192 | ~330k | **≤ 6 MB** | **≤ 5 ms** | ≤ 300 ms |
| large | 32,768 | ~1.3M | ≤ 22 MB | ≤ 18 ms | ≤ 900 ms |
| refused | >102,400 | — | loader exits unless `--unsafe-i-understand` | | |

- `mode:"off"` ⇒ zero cost: dynamic `import()` guarded, module never evaluated.
- Passive mode computes exactly one cycle per conversation turn; no timers, no polling.
- Active mode adds per-cycle modulation only; still no background loop.
- Android/Termux: identical defaults verified on 4 GB RAM devices.

## 8. Persistence & Security

- `state.bin`: header magic `SOI1`, u32 version, seed, tick counters, then raw
  Float32/Int32 arrays (CSR indptr/indices/data + voltages + thresholds).
- Checkpoints (rolling 3) AES-256-GCM encrypted under OKF key material, SHA-256 integrity
  (same scheme as vault, srs FR-K1).
- Traces passed to the knowledge graph are text summaries + salience scores; no raw
  conversation content leaves the local store.

## 9. Testing Strategy

| Test | Assertion |
|---|---|
| Golden determinism (NFR-13) | fixed seed + fixed transcript ⇒ SHA-256 of final state byte-identical across platforms |
| Signal sanity | repeated identical turns drive novelty toward 0; injected novel terms spike novelty > 2σ |
| Budget gate (CI) | RSS and slice-latency probes fail build when exceeded (§7 rows) |
| Duet fingerprint | two personas seeded from distinct profiles ⇒ persona_drift distributions separable on fixed corpus |
| Off-mode purity | `soi.config.json` absent ⇒ `suite/src/soi` never appears in module load trace |

## 10. Implementation Plan (M4)

1. `encode.ts`, `lif.ts`, `stdp.ts` — pure functions + unit vectors (2 d).
2. `core.ts` — pools, CSR builder, cycle scheduler, slices (2 d).
3. `duet.ts` — persona seeding from Cognitive Profile/OKF vector; fingerprint baseline (1 d).
4. `consolidate.ts` — trace extraction → engine graph adapter (1 d).
5. CLI/dashboard surfaces + persistence + encryption (2 d).
6. CI gates + golden fixtures (1 d).
