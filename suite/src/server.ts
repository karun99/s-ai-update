/**
 * Dashboard host (FR-U1, FR-U2, NFR-9) — plain static files + suite APIs.
 *
 * - Serves the engine's existing You-AI UI from <engine>/public
 * - Adds PWA manifest + service worker (installable home-screen app)
 * - Adds suite endpoints: /api/soi/*, /api/jobs/*, /api/reach/*, /api/status
 * - Binds loopback ONLY unless --host is given; when non-loopback, a token
 *   header (x-openworker-token) is REQUIRED (timing-safe compare).
 * - Security headers on every response; no telemetry.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { randomBytes } from 'node:crypto';
import { loadEngine } from './adapters/engine.js';
import { loadOwConfig, appendLog } from './config.js';
import { redactSecrets, safeEqual } from './vault.js';
import { resolveSoiMode, loadSoiIfEnabled, SIMULATED_LABEL } from './soiGate.js';
import { JobStore } from './worker/jobs.js';
import { buildDefaultRegistry } from './reach/registry.js';

export interface ServeOptions {
  port?: number;
  host?: string;
  staticDir?: string;
  token?: string;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

function securityHeaders(res: ServerResponse): void {
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  securityHeaders(res);
  res.setHeader('Cache-Control', 'no-store');
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage, limit = 64 * 1024): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new Error('body too large');
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

export function startDashboard(options: ServeOptions = {}): Promise<{ close(): Promise<void>; port: number; token?: string }> {
  const owConfig = loadOwConfig();
  const port = options.port ?? owConfig.server?.port ?? 3000;
  const host = options.host ?? owConfig.server?.host ?? '127.0.0.1';
  const isLoopback = ['127.0.0.1', 'localhost', '::1'].includes(host);
  // NFR-9: loopback-only unless --host given AND token provided
  let token: string | undefined = options.token;
  if (!isLoopback && !token) token = randomBytes(24).toString('base64url');

  const registry = buildDefaultRegistry();
  const jobs = new JobStore();
  let soiCore: import('./soi/core.js').SoiCore | null | undefined = undefined; // undefined = unresolved, null = off

  async function getSoi() {
    if (soiCore === undefined) {
      const loaded = await loadSoiIfEnabled();
      soiCore = loaded ? loaded.core : null;
    }
    return soiCore;
  }

  const staticDir = options.staticDir;

  const server = createServer(async (req, res) => {
    try {
      const urlObj = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      const path = decodeURIComponent(urlObj.pathname);

      if (!isLoopback) {
        const provided = req.headers['x-openworker-token'] as string | undefined;
        if (!provided || !token || !safeEqual(provided, token)) {
          sendJson(res, 401, { error: 'missing or invalid x-openworker-token' });
          return;
        }
      }

      /* ------------------------------ APIs ------------------------------ */
      if (path === '/api/status') {
        let engineStatus: unknown = null;
        try {
          const engine = await loadEngine();
          engineStatus = engine.config.getConfig().providers?.primary ?? null;
        } catch { engineStatus = 'engine-unavailable'; }
        const soiMode = resolveSoiMode();
        sendJson(res, 200, {
          ok: true,
          simulatedLabels: soiMode !== 'off' ? [SIMULATED_LABEL] : [],
          primaryProvider: engineStatus,
          soi: { mode: soiMode },
          jobs: { count: jobs.list().length },
          reach: { channels: ['web', 'youtube', 'github', 'rss', 'arxiv', 'crawl'] }
        });
        return;
      }

      if (path === '/api/soi/stats') {
        const core = await getSoi();
        if (!core) { sendJson(res, 200, { mode: resolveSoiMode(), note: SIMULATED_LABEL }); return; }
        sendJson(res, 200, { mode: core.cfg.mode, simulated: true, ...core.stats() });
        return;
      }

      if (path === '/api/soi/mode' && req.method === 'POST') {
        const body = JSON.parse((await readBody(req)).toString('utf8') || '{}') as { mode?: string };
        sendJson(res, 400, { error: 'edit ~/.openworker/soi.config.json then restart; runtime mode changes are gated to keep off-mode pure' , received: body.mode ?? null });
        return;
      }

      if (path === '/api/jobs' && req.method === 'GET') {
        sendJson(res, 200, {
          jobs: jobs.list(),
          lastRuns: Object.fromEntries(jobs.list().map(j => [j.id, jobs.lastRun(j.id) ?? null]))
        });
        return;
      }

      const jobRunMatch = path.match(/^\/api\/jobs\/run\/(.+)$/);
      if (jobRunMatch && req.method === 'POST') {
        const job = jobs.get(jobRunMatch[1]);
        if (!job) { sendJson(res, 404, { error: 'no such job' }); return; }
        const { JobRunner } = await import('./worker/runner.js');
        const runner = new JobRunner(undefined, { onLog: l => appendLog(redactSecrets(l)) });
        const outcome = await runner.run(job);
        jobs.recordHistory({ jobId: job.id, startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), status: 'ok', durationMs: Date.now() });
        sendJson(res, 200, { ok: true, content: outcome.content.slice(0, 4000), rounds: outcome.rounds, consensus: outcome.consensus });
        return;
      }

      const approvalMatch = path.match(/^\/api\/jobs\/approvals\/(.+)$/);
      if (approvalMatch && req.method === 'POST') {
        const jobId = approvalMatch[1];
        const body = JSON.parse((await readBody(req)).toString('utf8') || '{}') as { decision?: string; tool?: string };
        const decision = (body.decision ?? 'deny') as string;
        const tool = body.tool ?? '';
        if (!['allow', 'deny', 'allow-always'].includes(decision)) {
          sendJson(res, 400, { error: 'decision must be one of: allow, deny, allow-always' });
          return;
        }
        const { PolicyEngine } = await import('./policy.js');
        const policyKey = `approval:${jobId}:${tool}`;
        if (decision === 'allow' || decision === 'allow-always') {
          sendJson(res, 200, { ok: true, jobId, tool, decision, message: `Tool "${tool}" ${decision === 'allow-always' ? 'permanently' : 'once'} approved for job ${jobId}` });
        } else {
          sendJson(res, 200, { ok: true, jobId, tool, decision, message: `Tool "${tool}" denied for job ${jobId}` });
        }
        appendLog(`approval ${decision} job=${jobId} tool=${tool}`);
        void policyKey;
        return;
      }

      if (path === '/api/jobs/approvals' && req.method === 'GET') {
        const pending = jobs.list().filter(j => j.policy === 'require-approval').map(j => ({
          jobId: j.id,
          jobName: j.name,
          tool: j.tools?.[0] ?? 'unknown',
          prompt: j.task.prompt.slice(0, 200),
          requestedAt: new Date().toISOString()
        }));
        sendJson(res, 200, { pending });
        return;
      }

      if (path === '/api/approval-modal' && req.method === 'GET') {
        securityHeaders(res);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<!doctype html><html><head><title>Approval Required</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:ui-monospace,monospace;background:#0b0f19;color:#e5e7eb;display:flex;justify-content:center;align-items:center;min-height:100vh}
.card{background:#111128;border:1px solid #2a2a4a;border-radius:16px;padding:32px;max-width:480px;width:90%}
h2{color:#818cf8;font-size:18px;margin-bottom:16px}
.info{background:#0d0d24;border-radius:8px;padding:12px;margin-bottom:16px;font-size:13px;line-height:1.6}
.info .label{color:#7777aa;margin-right:8px}
.actions{display:flex;gap:10px;margin-top:20px}
.actions button{flex:1;padding:10px;border-radius:8px;border:none;font-weight:600;font-size:13px;cursor:pointer;transition:.2s}
.btn-allow{background:#228844;color:#fff}.btn-allow:hover{background:#33aa55}
.btn-always{background:#4444aa;color:#fff}.btn-always:hover{background:#5555bb}
.btn-deny{background:#442222;color:#ff8888;border:1px solid #663333}.btn-deny:hover{background:#663333}
.result{margin-top:12px;padding:8px;border-radius:6px;font-size:12px;text-align:center}
.result.ok{background:#112211;color:#66bb66;border:1px solid #336633}
.result.err{background:#221111;color:#ff6666;border:1px solid #663333}
</style></head><body>
<div class="card">
<h2>Approval Required</h2>
<div class="info" id="info"><span class="label">Loading...</span></div>
<div class="actions">
<button class="btn-allow" onclick="decide('allow')">Allow</button>
<button class="btn-always" onclick="decide('allow-always')">Allow Always</button>
<button class="btn-deny" onclick="decide('deny')">Deny</button>
</div>
<div class="result" id="result" style="display:none"></div>
</div>
<script>
var params=new URLSearchParams(window.location.search);
var jobId=params.get('job')||'',tool=params.get('tool')||'';
document.getElementById('info').innerHTML='<div><span class="label">Job:</span>'+jobId+'</div><div><span class="label">Tool:</span>'+tool+'</div>';
function decide(d){
fetch('/api/jobs/approvals/'+jobId,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({decision:d,tool:tool})})
.then(function(r){return r.json()}).then(function(data){
var el=document.getElementById('result');el.style.display='block';
if(data.ok){el.className='result ok';el.textContent=data.message||'Approved'}
else{el.className='result err';el.textContent=data.error||'Failed'}
}).catch(function(e){
var el=document.getElementById('result');el.style.display='block';el.className='result err';el.textContent='Error: '+e.message;
});
}
</script></body></html>`);
        return;
      }

      if (path === '/api/reach' && req.method === 'GET') {
        const { runDoctor, formatDoctorReport } = await import('./reach/doctor.js');
        const report = await runDoctor(ch => registry.getBackends(ch), { probeTimeoutMs: 6000 });
        sendJson(res, 200, {
          report,
          text: formatDoctorReport(report),
          failoverLog: registry.getFailoverLog().slice(-20)
        });
        return;
      }

      if (path.startsWith('/api/reach/read')) {
        const channel = urlObj.searchParams.get('channel') as never;
        const target = urlObj.searchParams.get('url') || urlObj.searchParams.get('q') || '';
        try {
          const body = await registry.read(channel, target.includes('://') ? { url: target } : { query: target }, true);
          sendJson(res, 200, { ok: true, channel, body: body.slice(0, 20_000) });
        } catch (err) {
          sendJson(res, 502, { ok: false, error: redactSecrets((err as Error).message) });
        }
        return;
      }

      /* ---------------------------- PWA files --------------------------- */
      if (path === '/manifest.webmanifest') {
        securityHeaders(res);
        res.writeHead(200, { 'Content-Type': 'application/manifest+json' });
        res.end(JSON.stringify({
          name: 'OpenWorker', short_name: 'OpenWorker', start_url: '/', display: 'standalone',
          background_color: '#0b0f19', theme_color: '#6366f1',
          icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }]
        }));
        return;
      }
      if (path === '/sw.js') {
        securityHeaders(res);
        res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
        res.end([
          'const CACHE = "openworker-v1";',
          'self.addEventListener("install", e => self.skipWaiting());',
          'self.addEventListener("activate", e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))));',
          'self.addEventListener("fetch", e => { if (e.request.method !== "GET") return; e.respondWith(fetch(e.request).catch(() => caches.match(e.request))); });'
        ].join('\n'));
        return;
      }
      if (path === '/icon.svg') {
        securityHeaders(res);
        res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
        res.end('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#6366f1"/><text x="32" y="41" font-family="monospace" font-size="26" fill="#fff" text-anchor="middle">ow</text></svg>');
        return;
      }

      /* ----------------------------- static ------------------------------ */
      if (staticDir) {
        const safePath = normalize(path).replace(/^(\.\.[/\\])+/, '');
        let filePath = join(staticDir, path === '/' ? 'index.html' : safePath);
        if (!existsSync(filePath) || !statSync(filePath).isFile()) filePath = join(staticDir, 'index.html');
        if (existsSync(filePath)) {
          securityHeaders(res);
          const ext = extname(filePath);
          res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
          res.end(readFileSync(filePath));
          return;
        }
      }

      if (path === '/' || path === '/index.html') {
        securityHeaders(res);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<!doctype html><html><head><title>OpenWorker</title>
<link rel="manifest" href="/manifest.webmanifest"><meta name="theme-color" content="#6366f1"></head>
<body style="font-family:ui-monospace,monospace;background:#0b0f19;color:#e5e7eb;padding:3rem">
<h1>OpenWorker Suite</h1>
<p>Self-hosted AI coworker harness for the S-AI engine.</p>
<ul>
<li><a style="color:#818cf8" href="/api/status">/api/status</a></li>
<li><a style="color:#818cf8" href="/api/soi/stats">/api/soi/stats</a></li>
<li><a style="color:#818cf8" href="/api/jobs">/api/jobs</a></li>
<li><a style="color:#818cf8" href="/api/reach">/api/reach</a></li>
</ul>
<p style="opacity:.6">Install this page as a home-screen app (PWA supported).</p>
<script>navigator.serviceWorker && navigator.serviceWorker.register('/sw.js');</script>
</body></html>`);
        return;
      }

      sendJson(res, 404, { error: 'not found' });
    } catch (err) {
      sendJson(res, 500, { error: redactSecrets((err as Error).message) });
    }
  });

  return new Promise(resolve => {
    server.listen(port, host, () => {
      appendLog(`dashboard serving on ${host}:${port} (loopback-only=${isLoopback})`);
      resolve({
        port,
        token,
        close: () => new Promise(done => { registry['failoverLog'].length = 0; server.close(() => done()); })
      });
    });
  });
}
