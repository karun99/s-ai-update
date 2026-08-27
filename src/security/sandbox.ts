import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';

const WORKSPACE_ROOT = join(homedir(), '.s-ai', 'workspace');

const DENY_PATTERNS = [
  '**/.ssh/**',
  '**/.aws/**',
  '**/.config/**',
  '**/.gnupg/**',
  '**/.env',
  '**/.env.*',
  '**/credentials',
  '**/secrets',
  '**/*.key',
  '**/*.pem',
  '**/*.p12',
  '**/*.pfx',
];

const SAFE_ROOTS = [
  WORKSPACE_ROOT,
  join(homedir(), '.s-ai', 'data'),
  join(process.cwd(), '.s-ai'),
];

function isPathInSandbox(targetPath: string): { safe: boolean; reason?: string } {
  const resolved = resolve(targetPath);

  for (const root of SAFE_ROOTS) {
    const normalizedRoot = resolve(root);
    if (resolved === normalizedRoot || resolved.startsWith(normalizedRoot + '/')) {
      const relativePath = resolved.slice(normalizedRoot.length + 1);
      for (const pattern of DENY_PATTERNS) {
        if (matchesGlob(relativePath, pattern)) {
          return { safe: false, reason: `Path matches deny pattern: ${pattern}` };
        }
      }
      return { safe: true };
    }
  }

  return { safe: false, reason: `Path ${resolved} is outside allowed roots: ${SAFE_ROOTS.join(', ')}` };
}

function matchesGlob(path: string, pattern: string): boolean {
  const patternParts = pattern.split('/');
  const pathParts = path.split('/');

  let pi = 0;
  for (let pp = 0; pp < patternParts.length; pp++) {
    const segment = patternParts[pp];

    if (segment === '**') {
      if (pp === patternParts.length - 1) return true;
      const rest = patternParts.slice(pp + 1);
      for (let i = pi; i <= pathParts.length - rest.length; i++) {
        if (matchesGlobParts(pathParts.slice(i), rest)) return true;
      }
      return false;
    }

    if (pi >= pathParts.length) return false;

    if (segment === '*') {
      pi++;
      continue;
    }

    if (segment.includes('*')) {
      const regexStr = '^' + segment.replace(/\./g, '\\.').replace(/\*/g, '[^/]*') + '$';
      if (!new RegExp(regexStr).test(pathParts[pi])) return false;
      pi++;
      continue;
    }

    if (pathParts[pi] !== segment) return false;
    pi++;
  }

  return pi === pathParts.length;
}

function matchesGlobParts(pathParts: string[], patternParts: string[]): boolean {
  let pi = 0;
  for (let pp = 0; pp < patternParts.length; pp++) {
    const segment = patternParts[pp];
    if (segment === '**') {
      if (pp === patternParts.length - 1) return true;
      const rest = patternParts.slice(pp + 1);
      for (let i = pi; i <= pathParts.length - rest.length; i++) {
        if (matchesGlobParts(pathParts.slice(i), rest)) return true;
      }
      return false;
    }
    if (pi >= pathParts.length) return false;
    if (segment === '*') { pi++; continue; }
    if (segment.includes('*')) {
      const regexStr = '^' + segment.replace(/\./g, '\\.').replace(/\*/g, '[^/]*') + '$';
      if (!new RegExp(regexStr).test(pathParts[pi])) return false;
      pi++;
      continue;
    }
    if (pathParts[pi] !== segment) return false;
    pi++;
  }
  return pi === pathParts.length;
}

const DANGEROUS_COMMANDS = new Set([
  'rm', 'rmdir', 'shred', 'mkfs', 'dd',
  'nc', 'ncat', 'netcat',
  'python', 'python3', 'perl', 'ruby', 'lua', 'php',
  'deno', 'bun',
  'svn', 'hg',
  'docker', 'podman', 'kubectl',
  'sudo', 'su', 'doas', 'nsenter',
  'mount', 'umount', 'chroot',
  'chmod', 'chown', 'chgrp',
  'iptables', 'nftables', 'firewall-cmd',
  'systemctl', 'service',
  'crontab', 'at',
  'ssh', 'scp', 'sftp', 'rsync',
  'base64', 'xxd', 'od',
  'eval', 'exec',
  'curl', 'wget',
]);

const SAFE_COMMANDS = new Set([
  'ls', 'cat', 'head', 'tail', 'grep', 'find', 'wc', 'sort', 'uniq', 'diff',
  'echo', 'printf', 'date', 'pwd', 'whoami', 'hostname',
  'tsc', 'eslint', 'prettier',
  'git',
  'node', 'npm', 'npx', 'yarn', 'pnpm',
]);

interface ShellSandboxConfig {
  mode: 'safe' | 'restricted' | 'developer' | 'full';
  allowedCommands?: string[];
  deniedCommands?: string[];
  maxTimeout?: number;
  workingDirectory?: string;
}

function validateShellCommand(
  command: string,
  config: ShellSandboxConfig = { mode: 'safe' }
): { allowed: boolean; reason?: string } {
  if (config.mode === 'full') return { allowed: true };

  const trimmed = command.trim();
  const baseCommand = trimmed.split(/\s+/)[0]?.split('/').pop()?.split('|')[0];

  if (!baseCommand) return { allowed: false, reason: 'Empty command' };

  if (config.mode === 'safe') {
    if (DANGEROUS_COMMANDS.has(baseCommand)) {
      return { allowed: false, reason: `Command '${baseCommand}' is blocked in safe mode` };
    }
  }

  if (config.mode === 'restricted') {
    if (config.allowedCommands && !config.allowedCommands.includes(baseCommand)) {
      return { allowed: false, reason: `Command '${baseCommand}' not in allowlist` };
    }
    if (config.deniedCommands?.includes(baseCommand)) {
      return { allowed: false, reason: `Command '${baseCommand}' is denied` };
    }
  }

  if (trimmed.includes('&&') || trimmed.includes('||') || trimmed.includes(';')) {
    if (config.mode === 'safe' || config.mode === 'restricted') {
      const parts = trimmed.split(/&&|\|\||;/);
      for (const part of parts) {
        const subBase = part.trim().split(/\s+/)[0]?.split('/').pop();
        if (subBase && DANGEROUS_COMMANDS.has(subBase)) {
          return { allowed: false, reason: `Chained command '${subBase}' is blocked` };
        }
      }
    }
  }

  if (config.mode === 'safe' || config.mode === 'restricted') {
    if (trimmed.includes('`') || trimmed.includes('$(')) {
      return { allowed: false, reason: 'Command substitution is blocked' };
    }
    if (/>\s*\//.test(trimmed) || />>\s*\//.test(trimmed)) {
      return { allowed: false, reason: 'Redirect to absolute path is blocked' };
    }
  }

  return { allowed: true };
}

function validateWorkingDirectory(cwd: string): { safe: boolean; reason?: string } {
  return isPathInSandbox(cwd);
}

function createFileHash(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

export {
  isPathInSandbox,
  validateShellCommand,
  validateWorkingDirectory,
  createFileHash,
  WORKSPACE_ROOT,
  SAFE_ROOTS,
  DENY_PATTERNS,
  DANGEROUS_COMMANDS,
  SAFE_COMMANDS,
};
export type { ShellSandboxConfig };
