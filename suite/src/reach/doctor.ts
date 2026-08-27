/**
 * Reach doctor (FR-R2) — actively probes every backend of every channel,
 * prints the active matrix with fix prescriptions, and exits non-zero when a
 * tier-0 channel is fully broken.
 */
import type { Backend, ChannelName, ProbeResult } from './registry.js';

export interface DoctorRow {
  channel: ChannelName;
  backendId: string;
  label: string;
  tier: 0 | 1 | 2;
  ok: boolean;
  detail?: string;
  prescription?: string;
}

export interface DoctorReport {
  rows: DoctorRow[];
  tier0BrokenChannels: ChannelName[];
  healthyAtLeastOne: Record<ChannelName, boolean>;
}

const CHANNEL_ORDER: Array<[ChannelName, string]> = [
  ['web', 'Any web page'],
  ['youtube', 'YouTube transcripts'],
  ['github', 'GitHub repositories'],
  ['rss', 'RSS/Atom feeds'],
  ['arxiv', 'arXiv papers'],
  ['crawl', 'Direct crawling']
];

export async function runDoctor(
  getBackends: (channel: ChannelName) => Backend[],
  opts: { probeTimeoutMs?: number; channels?: ChannelName[] } = {}
): Promise<DoctorReport> {
  const timeoutMs = opts.probeTimeoutMs ?? 12_000;
  const channels = opts.channels ?? CHANNEL_ORDER.map(([c]) => c);
  const rows: DoctorRow[] = [];

  for (const channel of channels) {
    const backends = getBackends(channel);
    if (!backends.length) {
      rows.push({ channel, backendId: '-', label: '(no backends registered)', tier: 0, ok: false, prescription: 'register a backend for this channel' });
      continue;
    }
    await Promise.all(backends.map(async backend => {
      let result: ProbeResult;
      try {
        result = await Promise.race([
          backend.probe(),
          new Promise<ProbeResult>((_, reject) => setTimeout(() => reject(new Error(`probe timed out after ${timeoutMs}ms`)), timeoutMs))
        ]);
      } catch (err) {
        result = { ok: false, detail: (err as Error).message, prescription: 'check network connectivity or reinstall the backend tool' };
      }
      rows.push({
        channel,
        backendId: backend.id,
        label: backend.label,
        tier: backend.tier,
        ok: Boolean(result.ok),
        detail: result.detail,
        prescription: result.ok ? undefined : result.prescription || 'no fix prescribed'
      });
    }));
  }

  const tier0BrokenChannels: ChannelName[] = [];
  const healthyAtLeastOne = {} as Record<ChannelName, boolean>;
  for (const channel of channels) {
    const channelRows = rows.filter(r => r.channel === channel);
    const anyOk = channelRows.some(r => r.ok);
    healthyAtLeastOne[channel] = anyOk;
    const hasTier0 = channelRows.some(r => r.tier === 0);
    if (!anyOk && (hasTier0 || channelRows.length > 0)) tier0BrokenChannels.push(channel);
  }

  return { rows, tier0BrokenChannels, healthyAtLeastOne };
}

export function formatDoctorReport(report: DoctorReport): string {
  const lines: string[] = [];
  lines.push('OpenWorker reach doctor');
  lines.push('='.repeat(56));
  let currentChannel = '';
  for (const row of report.rows) {
    if (row.channel !== currentChannel) {
      currentChannel = row.channel;
      const state = report.healthyAtLeastOne[currentChannel]
        ? 'ok'
        : 'BROKEN';
      lines.push('');
      lines.push(`${currentChannel} [${state}]`);
    }
    const icon = row.ok ? '+' : '-';
    lines.push(`  ${icon} ${row.backendId.padEnd(14)} t${row.tier} ${row.label}${row.detail ? ` (${row.detail})` : ''}`);
    if (!row.ok && row.prescription && row.prescription !== 'no fix prescribed') {
      lines.push(`      fix: ${row.prescription}`);
    }
  }
  lines.push('');
  if (report.tier0BrokenChannels.length === 0) {
    lines.push('All channels have at least one working backend.');
  } else {
    lines.push(`Tier-0 broken channels: ${report.tier0BrokenChannels.join(', ')}`);
    lines.push('Exit code will be 1. Apply the fixes above, then re-run.');
  }
  return lines.join('\n');
}
