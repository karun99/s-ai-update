/**
 * openworker CLI (FR-C2) — arg parsing -> dispatch into engine exports.
 *
 * Command surface parity with s-ai v5.1 (ask, serve, swarm, persona, graph,
 * crawl, search, mcp, provider, skill, engine, research, bhashini, study) is
 * achieved by delegating those to the engine binary found via the adapter;
 * suite-native commands are handled locally: reach, jobs, soi, import,
 * update, config, policy, status, help, version.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { findEngineRoot, loadEngine } from './adapters/engine.js';
import { getRouter, parseModelId } from './adapters/routing.js';
import {
  loadOwConfig, updateOwConfig, migrateFromSAi, openworkerDir,
  getArtifactsRoot, appendLog
} from './config.js';
import { redactSecrets, setSecret, listSecrets } from './vault.js';
import { PolicyEngine } from './policy.js';

const VERSION = '0.1.0';

export interface CliResult { code: number; }

function print(text: string): void { process.stdout.write(text + '\n'); }
function err(text: string): void { process.stderr.write(text + '\n'); }

const HELP = `
OpenWorker Suite v${VERSION} — self-hosted AI coworker harness for the S-AI engine.

Core:      openworker ask "..." [--model provider:model] [--direct] [--json]
           openworker serve [--port N] [--host H]
           openworker status | help | version
Swarm:     openworker swarm status | agents
Persona:   openworker persona show | set '{"name":"Alice"}' | clear
Graph:     openworker graph query "..." | stats | store type label content
Providers: openworker provider list | set <name> | route <provider:model> "..."
Reach v2:  openworker reach doctor | read <channel> <url|query>
Jobs:      openworker jobs add "<cron>" --name N --prompt "..." | jobs list | jobs run | jobs watch
Policy:    openworker policy show | mode allow-all|deny-list|require-approval
SOI:       openworker soi status | stats | feed | consolidate | checkpoint | reset
           (simulated organoid intelligence — off by default; see ~/.openworker/soi.config.json)
Import:    openworker import s-ai
Update:    openworker update --check | --apply
Config:    openworker config get [key] | set key value | path
Vault:     openworker vault set KEY VALUE | get KEY | list
Artifacts: openworker artifacts dir

Engine commands (delegated to s-ai): crawl search mcp skill engine research bhashini study setup
`;

/* ------------------------------- passthrough ------------------------------ */

async function delegateToEngine(args: string[]): Promise<CliResult> {
  const root = findEngineRoot();
  const bin = root ? join(root, 'bin', 'you-ai.js') : null;
  if (!bin || !existsSync(bin)) {
    err('engine CLI not found — set OPENWORKER_ENGINE_PATH or install @saikarun/s-ai');
    return { code: 1 };
  }
  await new Promise<void>(resolve => {
    const child = spawn(process.execPath, [bin, ...args], { stdio: 'inherit' });
    child.on('exit', () => resolve());
    child.on('error', e => { err(redactSecrets(e.message)); resolve(); });
  });
  return { code: 0 };
}

/* --------------------------------- ask ------------------------------------ */

async function cmdAsk(args: string[]): Promise<CliResult> {
  let model: string | undefined; let direct = false; let json = false; const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--model') model = args[++i];
    else if (args[i] === '--direct') direct = true;
    else if (args[i] === '--json') json = true;
    else rest.push(args[i]);
  }
  const prompt = rest.join(' ').trim();
  if (!prompt) { err('usage: openworker ask "..." [--model provider:model]'); return { code: 1 }; }
  if (model) parseModelId(model); // validate early

  // SOI passive hook (FR-S2/S3): one Duet cycle per conversation turn.
  const { resolveSoiMode, loadSoiIfEnabled } = await import('./soiGate.js');
  const soiMode = resolveSoiMode();
  let soi: Awaited<ReturnType<typeof loadSoiIfEnabled>> = null;
  if (soiMode !== 'off') soi = await loadSoiIfEnabled();

  try {
    if (soi) await soi.core.ingest(prompt, 'USER');

    const { JobRunner } = await import('./worker/runner.js');
    const runner = new JobRunner();
    let output = '';
    if (direct) {
      for await (const token of runner.askDirect(prompt, model)) {
        output += token;
        process.stdout.write(token);
      }
      process.stdout.write('\n');
    } else {
      const swarm = await runner.buildSwarm(model?.split(':')[0]);
      const result = await swarm.run(prompt);
      output = result.content;
      print(output);
      if (!json && result.consensus > 0) print(`\n[swarm] rounds=${result.rounds} consensus=${result.consensus.toFixed(2)} elapsed=${result.elapsed}ms`);
      swarm.reset();
    }

    if (soi) {
      const signals = await soi.core.ingest(output, 'AGENT');
      print(`\nsoi: ${JSON.stringify(signals)}  (${soi.signalsLabel})`);
      await maybeAutoConsolidate(soi.core);
    }
    appendLog(`ask ok len=${output.length}`);
    return { code: 0 };
  } catch (e) {
    err(`ask failed: ${redactSecrets((e as Error).message)}`);
    return { code: 1 };
  }
}

async function maybeAutoConsolidate(core: import('./soi/core.js').SoiCore): Promise<void> {
  const traces = core.consolidate();
  if (!traces.length) return;
  try {
    const engine = await loadEngine();
    const { applyToGraph } = await import('./soi/consolidate.js');
    const sink = new engine.graph.KnowledgeGraph(join(openworkerDir(), 'graph'));
    applyToGraph(sink, traces);
  } catch { /* consolidation is best-effort in passive mode */ }
}

/* --------------------------------- status --------------------------------- */

async function cmdStatus(): Promise<CliResult> {
  const cfg = loadOwConfig();
  print('OpenWorker Suite status');
  print('='.repeat(48));
  print(`data dir       ${openworkerDir()}`);
  print(`server         ${cfg.server.host}:${cfg.server.port}`);
  print(`policy         ${cfg.policy.default}`);
  const { resolveSoiMode } = await import('./soiGate.js');
  const soiMode = resolveSoiMode();
  print(`soi            ${soiMode}${soiMode !== 'off' ? ' (simulated)' : ''}`);
  try {
    const root = findEngineRoot();
    print(`engine         ${root ? root : '@saikarun/s-ai (npm)'}`);
    const engine = await loadEngine();
    const providers = engine.providers.listProviders();
    print(`providers      ${providers.length} available, primary=${cfg.providers.primary ?? 'default'}`);
  } catch (e) {
    print(`engine         unavailable (${redactSecrets((e as Error).message)})`);
  }
  const { JobStore } = await import('./worker/jobs.js');
  const store = new JobStore();
  const jobList = store.list();
  print(`jobs           ${jobList.length} defined`);
  for (const j of jobList.slice(0, 8)) {
    const last = store.lastRun(j.id);
    print(`  - ${j.name} [${j.trigger.type}${j.trigger.cron ? ' ' + j.trigger.cron : ''}] last=${last ? last.status : 'never'}`);
  }
  print(`vault entries  ${listSecrets().length}`);
  return { code: 0 };
}

/* --------------------------------- reach ---------------------------------- */

async function cmdReach(args: string[]): Promise<CliResult> {
  const sub = args[0];
  const { buildDefaultRegistry } = await import('./reach/registry.js');
  const registry = buildDefaultRegistry();
  if (sub === 'doctor' || !sub) {
    const { runDoctor, formatDoctorReport } = await import('./reach/doctor.js');
    const report = await runDoctor(ch => registry.getBackends(ch));
    print(formatDoctorReport(report));
    return { code: report.tier0BrokenChannels.length ? 1 : 0 };
  }
  if (sub === 'read') {
    const channel = args[1]; const target = args.slice(2).join(' ');
    try {
      const body = await registry.read(channel as never, target.includes('://') ? { url: target } : { query: target });
      print(body);
      return { code: 0 };
    } catch (e) {
      err(`read failed: ${redactSecrets((e as Error).message)}`);
      return { code: 1 };
    }
  }
  err('usage: openworker reach doctor | read <channel> <url|query>');
  return { code: 1 };
}

/* ---------------------------------- jobs ---------------------------------- */

async function cmdJobs(args: string[]): Promise<CliResult> {
  const { JobStore, watchJobs } = await import('./worker/jobs.js');
  const { writeArtifacts } = await import('./worker/artifacts.js');
  const store = new JobStore();
  const sub = args[0];

  if (sub === 'add') {
    const cron = args[1];
    let name = `job-${Date.now().toString(36)}`; let prompt = ''; let model: string | undefined; let tools: string[] = [];
    for (let i = 2; i < args.length; i++) {
      if (args[i] === '--name') name = args[++i];
      else if (args[i] === '--prompt') prompt = args[++i];
      else if (args[i] === '--model') model = args[++i];
      else if (args[i] === '--tools') tools = (args[++i] || '').split(',').filter(Boolean);
    }
    if (!cron || !prompt) { err('usage: openworker jobs add "<cron>" --name N --prompt "..." [--model p:m] [--tools a,b]'); return { code: 1 }; }
    const job = store.add({ name, trigger: { type: 'schedule', cron }, task: { prompt, model }, tools, policy: loadOwConfig().policy.default });
    print(`added ${job.id} "${job.name}" (${job.trigger.cron})`);
    return { code: 0 };
  }
  if (sub === 'list') {
    const all = store.list();
    if (!all.length) print('no jobs defined — add one with: openworker jobs add "0 9 * * Mon" --name standup --prompt "..."');
    for (const j of all) print(`${j.id}  ${j.name.padEnd(20)} ${j.trigger.type}${j.trigger.cron ? ' ' + j.trigger.cron : ''}  policy=${j.policy}`);
    return { code: 0 };
  }
  if (sub === 'remove') {
    const removed = store.remove(args[1]);
    print(removed ? 'removed' : 'not found');
    return { code: removed ? 0 : 1 };
  }
  if (sub === 'run') {
    const job = store.get(args[1]);
    if (!job) { err('no such job'); return { code: 1 }; }
    const { JobRunner } = await import('./worker/runner.js');
    const runner = new JobRunner(undefined, { onLog: l => print(l) });
    const outcome = await runner.run(job);
    const artifacts = writeArtifacts(getArtifactsRoot(), job.id, job.name, outcome.content, ['md']);
    store.recordHistory({ jobId: job.id, startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), status: 'ok', artifacts: artifacts.map(a => a.path), durationMs: Date.now() });
    print(outcome.content);
    print(`\n[artifact] ${artifacts[0]?.path}`);
    return { code: 0 };
  }
  if (sub === 'watch') {
    print('watching schedules — Ctrl+C to stop (fires only while this process lives)');
    const { JobRunner } = await import('./worker/runner.js');
    const runner = new JobRunner();
    await watchJobs(store, async job => {
      print(`[${new Date().toISOString()}] firing ${job.name}`);
      const outcome = await runner.run(job);
      writeArtifacts(getArtifactsRoot(), job.id, job.name, outcome.content, ['md']);
      store.recordHistory({ jobId: job.id, startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), status: 'ok' });
    });
    return { code: 0 };
  }
  err('usage: openworker jobs add|list|run|watch|remove');
  return { code: 1 };
}

/* ---------------------------------- SOI ----------------------------------- */

async function cmdSoi(args: string[]): Promise<CliResult> {
  const { resolveSoiMode, SIMULATED_LABEL } = await import('./soiGate.js');
  const mode = resolveSoiMode();
  const sub = args[0];
  if (!sub || sub === 'status') {
    print(`SOI mode: ${mode}`);
    print(SIMULATED_LABEL);
    if (mode === 'off') print('enable by creating ~/.openworker/soi.config.json with {"mode":"passive"}');
    return { code: 0 };
  }
  if (mode === 'off' && sub !== 'status') {
    err('SOI is off — create ~/.openworker/soi.config.json first ({"mode":"passive"})');
    return { code: 1 };
  }
  const loaded = await import('./soiGate.js');
  const soi = await loaded.loadSoiIfEnabled();
  if (!soi) { err('failed to load SOI core'); return { code: 1 }; }
  switch (sub) {
    case 'stats': {
      const s = soi.core.stats();
      print(JSON.stringify({ ...s, simulated: true }, null, 2));
      return { code: 0 };
    }
    case 'feed': {
      const text = args.slice(1).join(' ') || 'The quick brown fox jumps over the lazy dog. Novel quantum entanglement paradigms emerge weekly.';
      for (let turn = 0; turn < 3; turn++) {
        const signals = await soi.core.ingest(text, 'USER');
        print(`turn ${turn + 1}: ${JSON.stringify(signals)}`);
      }
      print(SIMULATED_LABEL);
      return { code: 0 };
    }
    case 'consolidate': {
      const traces = soi.core.consolidate();
      const { extractTraces } = await import('./soi/consolidate.js');
      print(`extracted ${extractTraces(traces).length} trace(s)`);
      try {
        const engine = await loadEngine();
        const { applyToGraph } = await import('./soi/consolidate.js');
        const sink = new engine.graph.KnowledgeGraph(join(openworkerDir(), 'graph'));
        const ids = applyToGraph(sink, traces);
        print(`knowledge graph nodes upserted: ${ids.length}`);
      } catch (e) {
        err(`graph sink unavailable: ${redactSecrets((e as Error).message)}`);
      }
      return { code: 0 };
    }
    case 'checkpoint': {
      await soi.core.checkpoint();
      print('checkpoint written (AES-256-GCM, rolling 3)');
      return { code: 0 };
    }
    case 'reset': {
      soi.core.reset();
      print('reservoir reset');
      return { code: 0 };
    }
    default:
      err('usage: openworker soi status|stats|feed|consolidate|checkpoint|reset');
      return { code: 1 };
  }
}

/* ------------------------------ misc commands ----------------------------- */

async function cmdImport(_args: string[]): Promise<CliResult> {
  const report = await migrateFromSAi();
  print('migration from ~/.s-ai (copy-forward, source never deleted)');
  print(`  config migrated : ${report.configMigrated}`);
  print(`  keys to vault   : ${report.keysMovedToVault.map(k => k.provider).join(', ') || '(none)'}`);
  print(`  graph copied    : ${report.graphCopied}`);
  for (const note of report.notes) print(`  note            : ${note}`);
  return { code: 0 };
}

async function cmdUpdate(args: string[]): Promise<CliResult> {
  const u = await import('./update.js');
  if (args.includes('--apply')) {
    err('--apply requires a configured feed URL with signed releases (FR-D3)');
    return { code: 1 };
  }
  try {
    const { feed } = await u.fetchFeed(u.DEFAULT_FEED_URL);
    const check = u.evaluateUpdate(feed);
    print(`current ${check.currentVersion}; latest stable ${check.latestStable?.version ?? '-'}; latest next ${check.latestNext?.version ?? '-'}`);
    print(check.upToDate ? 'up to date' : `update available: ${check.latestStable?.version}`);
    return { code: 0 };
  } catch (e) {
    err(`feed unavailable: ${redactSecrets((e as Error).message)}`);
    return { code: 1 };
  }
}

async function cmdProvider(args: string[]): Promise<CliResult> {
  const sub = args[0];
  const router = await getRouterSafe();
  if (!router) { err('engine unavailable'); return { code: 1 }; }
  if (sub === 'list' || !sub) {
    const cfg = loadOwConfig();
    for (const p of await router.listProviders()) print(`${p}${cfg.providers.primary === p ? '  (primary)' : ''}`);
    return { code: 0 };
  }
  if (sub === 'set') {
    updateOwConfig({ providers: { primary: args[1] } });
    print(`primary provider set to ${args[1]} (~/.openworker/config.json)`);
    return { code: 0 };
  }
  if (sub === 'route') {
    const id = args[1]; const prompt = args.slice(2).join(' ');
    try {
      const out = await (await getRouterSafe())!.complete(id, { messages: [{ role: 'user', content: prompt }] });
      print(out.choices[0].message.content);
      return { code: 0 };
    } catch (e) {
      err(`route failed: ${redactSecrets((e as Error).message)}`);
      return { code: 1 };
    }
  }
  err('usage: openworker provider list | set <name> | route <provider:model> "..."');
  return { code: 1 };
}

async function getRouterSafe(): Promise<import('./adapters/routing.js').Router | null> {
  try {
    const { getRouter } = await import('./adapters/routing.js');
    return getRouter();
  } catch { return null; }
}

async function cmdVault(args: string[]): Promise<CliResult> {
  const sub = args[0];
  if (sub === 'set') { setSecret(args[1], args[2]); print(`stored ${args[1]} (value hidden)`); return { code: 0 }; }
  if (sub === 'get') {
    const { getSecret } = await import('./vault.js');
    const v = getSecret(args[1]);
    if (v === null) { err('not found'); return { code: 1 }; }
    print(v);
    return { code: 0 };
  }
  if (sub === 'list') { for (const e of listSecrets()) print(e.key); return { code: 0 }; }
  err('usage: openworker vault set KEY VALUE | get KEY | list');
  return { code: 1 };
}

async function cmdServe(args: string[]): Promise<CliResult> {
  let port: number | undefined; let host: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port') port = parseInt(args[++i], 10);
    else if (args[i] === '--host') host = args[++i];
  }
  const root = findEngineRoot();
  const staticDir = root ? join(root, 'public') : undefined;
  const { startDashboard } = await import('./server.js');
  const instance = await startDashboard({ port, host, staticDir });
  print(`dashboard http://127.0.0.1:${instance.port}`);
  if (instance.token) print(`non-loopback binding active; required header: x-openworker-token: ${instance.token}`);
  print('Ctrl+C to stop');
  return new Promise(() => { /* serve until signal */ });
}

async function cmdGraph(args: string[]): Promise<CliResult> {
  try {
    const engine = await loadEngine();
    const sink = new engine.graph.KnowledgeGraph(join(openworkerDir(), 'graph'));
    const sub = args[0];
    if (sub === 'stats') { print(JSON.stringify(sink.getStats(), null, 2)); return { code: 0 }; }
    if (sub === 'query') {
      const results = sink.query(args.slice(1).join(' '));
      for (const r of results) print(`(${r.score.toFixed(1)}) [${r.type}] ${r.label}`);
      return { code: 0 };
    }
    if (sub === 'store') {
      const [, type, label, ...content] = args;
      const id = sink.addNode(type, label, { content: content.join(' ') });
      print(id);
      return { code: 0 };
    }
    err('usage: openworker graph query|stats|store');
    return { code: 1 };
  } catch (e) {
    err(redactSecrets((e as Error).message));
    return { code: 1 };
  }
}

async function cmdPersona(args: string[]): Promise<CliResult> {
  try {
    const engine = await loadEngine();
    const neural = engine.neural.getNeuralMap();
    const sub = args[0];
    if (sub === 'show' || !sub) {
      const profile = neural.getProfile();
      print(profile ? JSON.stringify(profile, null, 2) : 'no persona profile stored');
      return { code: 0 };
    }
    if (sub === 'set') {
      const data = JSON.parse(args.slice(1).join(' '));
      neural.setProfile(data);
      print('persona updated');
      return { code: 0 };
    }
    if (sub === 'clear') { neural.clearProfile(); print('persona cleared'); return { code: 0 }; }
    return { code: 1 };
  } catch (e) {
    err(redactSecrets((e as Error).message));
    return { code: 1 };
  }
}

async function cmdPolicy(args: string[]): Promise<CliResult> {
  const cfg = loadOwConfig();
  const sub = args[0];
  if ((sub === 'mode' || sub === 'set') && ['allow-all', 'deny-list', 'require-approval'].includes(args[1])) {
    updateOwConfig({ policy: { default: args[1] as never } });
    print(`default policy -> ${args[1]}`);
    return { code: 0 };
  }
  print(`default policy: ${cfg.policy.default}`);
  print('destructive tools default to require-approval; catastrophic flags always denied');
  const engine = new PolicyEngine({ mode: cfg.policy.default }, () => 'deny');
  const demo = engine.decide('writeFile', { path: '/tmp/demo.txt' });
  print(`example decide(writeFile): allowed=${demo.allowed} approval=${demo.requiresApproval} (${demo.reason})`);
  return { code: 0 };
}

async function cmdConfig(args: string[]): Promise<CliResult> {
  const cfgPath = join(openworkerDir(), 'config.json');
  const sub = args[0];
  if (sub === 'path') { print(cfgPath); return { code: 0 }; }
  if (sub === 'get') {
    const cfg = loadOwConfig() as unknown as Record<string, unknown>;
    const value = args[1] ? cfg[args[1]] : cfg;
    print(JSON.stringify(value, null, 2));
    return { code: 0 };
  }
  if (sub === 'set') {
    const key = args[1]; const raw = args.slice(2).join(' ');
    let value: unknown = raw;
    try { value = JSON.parse(raw); } catch { /* keep string */ }
    updateOwConfig({ [key]: value });
    print(`${key} = ${raw}`);
    return { code: 0 };
  }
  err('usage: openworker config get [key] | set <key> <value> | path');
  return { code: 1 };
}

/* ------------------------------- dispatcher ------------------------------- */

const ENGINE_DELEGATED = new Set(['crawl', 'search', 'mcp', 'skill', 'engine', 'research', 'bhashini', 'study', 'setup']);

export async function runCli(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') { print(HELP); return 0; }
  if (cmd === 'version' || cmd === '--version') { print(`openworker ${VERSION}`); return 0; }
  appendLog(`cmd ${cmd}`);

  switch (cmd) {
    case 'ask': return (await cmdAsk(rest)).code;
    case 'serve': return (await cmdServe(rest)).code;
    case 'status': return (await cmdStatus()).code;
    case 'reach': return (await cmdReach(rest)).code;
    case 'jobs': return (await cmdJobs(rest)).code;
    case 'soi': return (await cmdSoi(rest)).code;
    case 'import': return (await cmdImport(rest)).code;
    case 'update': return (await cmdUpdate(rest)).code;
    case 'provider': return (await cmdProvider(rest)).code;
    case 'vault': return (await cmdVault(rest)).code;
    case 'graph': return (await cmdGraph(rest)).code;
    case 'persona': return (await cmdPersona(rest)).code;
    case 'policy': return (await cmdPolicy(rest)).code;
    case 'config': return (await cmdConfig(rest)).code;
    case 'artifacts': print(getArtifactsRoot()); return 0;
    default:
      if (ENGINE_DELEGATED.has(cmd)) return (await delegateToEngine([cmd, ...rest])).code;
      err(`unknown command: ${cmd}\n`);
      print(HELP);
      return 1;
  }
}
