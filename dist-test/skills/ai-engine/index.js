import { z } from 'zod';
import { AiEngine } from './engine.js';
let _engine = null;
function getEngine(provider) {
    if (!_engine)
        _engine = new AiEngine(provider);
    return _engine;
}
function register(mcp, skill) {
    mcp.tool('build_app', 'Generate a complete AI app from a text prompt. Returns app definition, HTML, and preview.', { prompt: z.string().describe('Description of the app to build') }, async ({ prompt }) => {
        const engine = getEngine();
        const result = await engine.buildApp(prompt);
        return { content: [{ type: 'text', text: JSON.stringify({ id: result.id, name: result.definition.brand?.name, icon: result.definition.brand?.icon, htmlLength: result.html?.length, definition: result.definition }, null, 2) }] };
    });
    mcp.tool('build_skill', 'Generate a new S-AI skill from a natural language description.', { prompt: z.string().describe('Description of the skill to create') }, async ({ prompt }) => {
        const engine = getEngine();
        const result = await engine.buildSkill(prompt);
        return { content: [{ type: 'text', text: JSON.stringify({ id: result.id, name: result.definition.name, code: result.code }, null, 2) }] };
    });
    mcp.tool('build_mcp_server', 'Generate an MCP server configuration and code from a description.', { prompt: z.string().describe('Description of the MCP server to create') }, async ({ prompt }) => {
        const engine = getEngine();
        const result = await engine.buildMcpServer(prompt);
        return { content: [{ type: 'text', text: JSON.stringify({ id: result.id, name: result.definition.name, tools: result.definition.tools, code: result.code }, null, 2) }] };
    });
    mcp.tool('build_swarm', 'Generate a multi-agent swarm configuration from a description.', { prompt: z.string().describe('Description of the swarm to create') }, async ({ prompt }) => {
        const engine = getEngine();
        const result = await engine.buildSwarm(prompt);
        return { content: [{ type: 'text', text: JSON.stringify({ id: result.id, name: result.definition.name, agents: result.config.agents.map((a) => a.id), config: result.config }, null, 2) }] };
    });
    mcp.tool('list_builds', 'List all previously built apps, skills, and MCP servers.', {}, async () => {
        const engine = getEngine();
        const outputs = engine.listOutputs();
        return { content: [{ type: 'text', text: JSON.stringify(outputs.map(o => ({ id: o.id, type: o.id.split('_')[0], name: o.definition?.name || o.definition?.brand?.name, createdAt: o.createdAt })), null, 2) }] };
    });
    mcp.prompt('app_builder', 'Walk through building a custom AI app', { idea: z.string().describe('The app idea') }, ({ idea }) => ({ messages: [{ role: 'user', content: { type: 'text', text: `Help me build this AI app: ${idea}. What features should it have? What persona? What knowledge base?` } }] }));
    mcp.prompt('swarm_architect', 'Design a multi-agent swarm for a specific task', { task: z.string().describe('The task the swarm should handle') }, ({ task }) => ({ messages: [{ role: 'user', content: { type: 'text', text: `Design a multi-agent swarm to handle: ${task}. What agents are needed? How should they coordinate?` } }] }));
}
export { register, getEngine, AiEngine };
//# sourceMappingURL=index.js.map