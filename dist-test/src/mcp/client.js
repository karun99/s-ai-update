import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { getMcpConfig } from '../config.js';
class McpClientManager {
    clients;
    tools;
    constructor() {
        this.clients = new Map();
        this.tools = new Map();
    }
    async connectToServer(serverConfig) {
        const { name, command, args = [], env = {} } = serverConfig;
        if (this.clients.has(name))
            return this.clients.get(name);
        try {
            const transport = new StdioClientTransport({ command, args, env: { ...process.env, ...env } });
            const client = new Client({ name: `S-AI Client`, version: '2.0.0' });
            await client.connect(transport);
            this.clients.set(name, client);
            const { tools } = await client.listTools();
            for (const tool of tools) {
                this.tools.set(`${name}:${tool.name}`, { server: name, ...tool });
            }
            return client;
        }
        catch (err) {
            console.error(`Failed to connect to MCP server "${name}":`, err.message);
            return null;
        }
    }
    async callTool(serverName, toolName, args) {
        const client = this.clients.get(serverName);
        if (!client)
            throw new Error(`MCP server "${serverName}" not connected`);
        return await client.callTool({ name: toolName, arguments: args });
    }
    async disconnectAll() {
        for (const [name, client] of this.clients) {
            try {
                await client.close();
            }
            catch { }
        }
        this.clients.clear();
        this.tools.clear();
    }
    listAllTools() {
        return [...this.tools.entries()].map(([key, tool]) => ({ key, ...tool }));
    }
    listConnectedServers() { return [...this.clients.keys()]; }
    async connectAll() {
        const config = getMcpConfig();
        if (!config.enabled || !config.servers)
            return;
        for (const server of config.servers) {
            await this.connectToServer(server);
        }
    }
}
let _manager = null;
function getMcpClientManager() {
    if (!_manager)
        _manager = new McpClientManager();
    return _manager;
}
export { McpClientManager, getMcpClientManager };
//# sourceMappingURL=client.js.map