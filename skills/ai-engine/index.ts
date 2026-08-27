import { z } from 'zod';
import { AiEngine } from './engine.js';

let _engine: AiEngine | null = null;

function getEngine(provider?: any): AiEngine {
  if (!_engine) _engine = new AiEngine(provider);
  return _engine;
}

function register(mcp: any, skill: any): void {
  mcp.tool('build_app', 'Generate a complete AI app from a text prompt. Returns app definition, HTML, and preview.',
    { prompt: z.string().describe('Description of the app to build') },
    async ({ prompt }: { prompt: string }) => {
      const engine = getEngine();
      const result = await engine.buildApp(prompt);
      return { content: [{ type: 'text' as const, text: JSON.stringify({ id: result.id, name: (result.definition as any).brand?.name, icon: (result.definition as any).brand?.icon, htmlLength: (result as any).html?.length, definition: result.definition }, null, 2) }] };
    }
  );

  mcp.tool('build_skill', 'Generate a new S-AI skill from a natural language description.',
    { prompt: z.string().describe('Description of the skill to create') },
    async ({ prompt }: { prompt: string }) => {
      const engine = getEngine();
      const result = await engine.buildSkill(prompt);
      return { content: [{ type: 'text' as const, text: JSON.stringify({ id: result.id, name: (result.definition as any).name, code: (result as any).code }, null, 2) }] };
    }
  );

  mcp.tool('build_mcp_server', 'Generate an MCP server configuration and code from a description.',
    { prompt: z.string().describe('Description of the MCP server to create') },
    async ({ prompt }: { prompt: string }) => {
      const engine = getEngine();
      const result = await engine.buildMcpServer(prompt);
      return { content: [{ type: 'text' as const, text: JSON.stringify({ id: result.id, name: (result.definition as any).name, tools: (result.definition as any).tools, code: (result as any).code }, null, 2) }] };
    }
  );

  mcp.tool('build_swarm', 'Generate a multi-agent swarm configuration from a description.',
    { prompt: z.string().describe('Description of the swarm to create') },
    async ({ prompt }: { prompt: string }) => {
      const engine = getEngine();
      const result = await engine.buildSwarm(prompt);
      return { content: [{ type: 'text' as const, text: JSON.stringify({ id: result.id, name: (result.definition as any).name, agents: (result.config as any).agents.map((a: any) => a.id), config: result.config }, null, 2) }] };
    }
  );

  mcp.tool('list_builds', 'List all previously built apps, skills, and MCP servers.', {}, async () => {
    const engine = getEngine();
    const outputs = engine.listOutputs();
    return { content: [{ type: 'text' as const, text: JSON.stringify(outputs.map(o => ({ id: o.id, type: o.id.split('_')[0], name: (o.definition as any)?.name || (o.definition as any)?.brand?.name, createdAt: o.createdAt })), null, 2) }] };
  });

  mcp.prompt('app_builder', 'Walk through building a custom AI app',
    { idea: z.string().describe('The app idea') },
    ({ idea }: { idea: string }) => ({ messages: [{ role: 'user', content: { type: 'text' as const, text: `Help me build this AI app: ${idea}. What features should it have? What persona? What knowledge base?` } }] })
  );

  mcp.prompt('swarm_architect', 'Design a multi-agent swarm for a specific task',
    { task: z.string().describe('The task the swarm should handle') },
    ({ task }: { task: string }) => ({ messages: [{ role: 'user', content: { type: 'text' as const, text: `Design a multi-agent swarm to handle: ${task}. What agents are needed? How should they coordinate?` } }] })
  );
}

export { register, getEngine, AiEngine };
