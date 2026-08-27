import { getChannels, type Channel, type ChannelCheck } from './channels.js';

export interface ReachResult {
  name: string;
  description: string;
  status: ChannelCheck;
  backends: string[];
  active_backend: string | null;
  tier: number;
}

export function doctor(config?: Record<string, any>): ReachResult[] {
  const channels = getChannels();
  const results: ReachResult[] = [];

  for (const ch of channels) {
    try {
      const check = ch.check(config);
      results.push({
        name: ch.name,
        description: ch.description,
        status: check,
        backends: ch.backends,
        active_backend: ch.active_backend,
        tier: ch.tier,
      });
    } catch (err: any) {
      results.push({
        name: ch.name,
        description: ch.description,
        status: { status: 'error', message: `Check failed: ${err.message}` },
        backends: ch.backends,
        active_backend: null,
        tier: ch.tier,
      });
    }
  }

  return results;
}

export function formatReport(results: ReachResult[]): string {
  const lines: string[] = [];
  const ok = results.filter(r => r.status.status === 'ok').length;
  const total = results.length;

  lines.push('╔═══════════════════════════════════════════════╗');
  lines.push('║      S-AI Reach — Internet Channel Status    ║');
  lines.push('╚═══════════════════════════════════════════════╝');
  lines.push('');
  lines.push(`  ✅ = Active    ⚠️ = Needs Setup    ❌ = Not Available`);
  lines.push('');

  const tier0 = results.filter(r => r.tier === 0);
  const tier1 = results.filter(r => r.tier === 1);
  const tier2 = results.filter(r => r.tier === 2);

  if (tier0.length) {
    lines.push('  Zero-Config Channels:');
    for (const r of tier0) {
      const icon = r.status.status === 'ok' ? '✅' : r.status.status === 'warn' ? '⚠️' : '❌';
      const active = r.active_backend ? ` (${r.active_backend})` : '';
      lines.push(`    ${icon} ${r.description}${active}`);
      lines.push(`       ${r.status.message}`);
    }
    lines.push('');
  }

  if (tier1.length) {
    const active = tier1.filter(r => r.status.status === 'ok');
    const inactive = tier1.filter(r => r.status.status !== 'ok');
    if (active.length) {
      lines.push('  Optional (Active):');
      for (const r of active) {
        lines.push(`    ✅ ${r.description} (${r.active_backend})`);
        lines.push(`       ${r.status.message}`);
      }
      lines.push('');
    }
    if (inactive.length) {
      lines.push('  Optional (Needs Setup):');
      for (const r of inactive) {
        lines.push(`    ⚠️ ${r.description}`);
        lines.push(`       ${r.status.message}`);
      }
      lines.push('');
    }
  }

  if (tier2.length) {
    lines.push('  Advanced (Manual Setup):');
    for (const r of tier2) {
      const icon = r.status.status === 'ok' ? '✅' : '⚠️';
      lines.push(`    ${icon} ${r.description} — ${r.status.message}`);
    }
    lines.push('');
  }

  const pct = total > 0 ? Math.round((ok / total) * 100) : 0;
  lines.push(`  ${ok}/${total} channels active (${pct}%)`);
  lines.push('');

  return lines.join('\n');
}

export function doctorToJson(results: ReachResult[]): string {
  const map: Record<string, any> = {};
  for (const r of results) {
    map[r.name] = {
      name: r.description,
      status: r.status.status,
      message: r.status.message,
      backends: r.backends,
      active_backend: r.active_backend,
      tier: r.tier,
    };
  }
  return JSON.stringify(map, null, 2);
}
