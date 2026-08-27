import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { getMcpConfig } from '../config.js';

interface McpServerConfig {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

class McpClientManager {
  clients: Map<string, Client>;
  tools: Map<string, { server: string; name: string; description?: string; [key: string]: unknown }>;

  constructor() {
    this.clients = new Map();
    this.tools = new Map();
  }

  async connectToServer(serverConfig: McpServerConfig): Promise<Client | null> {
    const { name, command, args = [], env = {} } = serverConfig;
    if (this.clients.has(name)) return this.clients.get(name)!;
    try {
      const transport = new StdioClientTransport({ command, args, env: { ...process.env, ...env } as Record<string, string> });
      const client = new Client({ name: `S-AI Client`, version: '2.0.0' });
      await client.connect(transport);
      this.clients.set(name, client);
      const { tools } = await client.listTools();
      for (const tool of tools) {
        this.tools.set(`${name}:${tool.name}`, { server: name, ...tool });
      }
      return client;
    } catch (err: any) {
      console.error(`Failed to connect to MCP server "${name}":`, err.message);
      return null;
    }
  }

  async callTool(serverName: string, toolName: string, args: Record<string, unknown>): Promise<unknown> {
    const client = this.clients.get(serverName);
    if (!client) throw new Error(`MCP server "${serverName}" not connected`);
    return await client.callTool({ name: toolName, arguments: args });
  }

  async disconnectAll(): Promise<void> {
    for (const [name, client] of this.clients) {
      try { await client.close(); } catch {}
    }
    this.clients.clear();
    this.tools.clear();
  }

  listAllTools(): Array<{ key: string; server: string; name: string; description?: string; [key: string]: unknown }> {
    return [...this.tools.entries()].map(([key, tool]) => ({ key, ...tool }));
  }
  listConnectedServers(): string[] { return [...this.clients.keys()]; }

  async connectAll(): Promise<void> {
    const config = getMcpConfig();
    if (!config.enabled || !config.servers) return;
    for (const server of config.servers) {
      await this.connectToServer(server);
    }
  }
}

let _manager: McpClientManager | null = null;
function getMcpClientManager(): McpClientManager {
  if (!_manager) _manager = new McpClientManager();
  return _manager;
}

export { McpClientManager, getMcpClientManager };
