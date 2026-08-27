import { z } from 'zod';
import { writeFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { getDataDir } from '../../src/config.js';

interface SkillTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  tools: Array<{
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    handler: string;
  }>;
  prompts: Array<{ name: string; description: string; template: string }>;
  resources: Array<{ uri: string; name: string; description: string }>;
  dependencies: string[];
  memoryBytes: number;
}

interface SkillCreatorOptions {
  maxTools?: number;
  outputDir?: string;
  enableHotReload?: boolean;
  lightweight?: boolean;
  customCategories?: string[];
}

const SKILL_TEMPLATES: SkillTemplate[] = [
  {
    id: 'api-wrapper',
    name: 'API Wrapper Skill',
    description: 'Wraps any REST API as an MCP-compatible skill with authentication',
    category: 'integration',
    tools: [
      {
        name: 'api_request',
        description: 'Make an authenticated API request',
        inputSchema: { method: z.string().describe('HTTP method'), endpoint: z.string().describe('API endpoint'), body: z.string().optional().describe('Request body (JSON)') },
        handler: 'async ({ method, endpoint, body }) => { return { content: [{ type: "text", text: "API " + method + " " + endpoint }] }; }',
      },
      {
        name: 'api_health',
        description: 'Check API health/status',
        inputSchema: {},
        handler: 'async () => { return { content: [{ type: "text", text: "API healthy" }] }; }',
      },
    ],
    prompts: [{ name: 'api_help', description: 'Get help with API operations', template: 'Help me use the API: {input}' }],
    resources: [{ uri: 'skill://api/status', name: 'API Status', description: 'Current API connection status' }],
    dependencies: [],
    memoryBytes: 4096,
  },
  {
    id: 'data-pipeline',
    name: 'Data Pipeline Skill',
    description: 'ETL pipeline: extract, transform, load data between sources',
    category: 'data',
    tools: [
      {
        name: 'extract',
        description: 'Extract data from a source',
        inputSchema: { source: z.string().describe('Source URI or path'), format: z.string().optional().default('json') },
        handler: 'async ({ source, format }) => { return { content: [{ type: "text", text: "Extracted from " + source }] }; }',
      },
      {
        name: 'transform',
        description: 'Apply transformation to data',
        inputSchema: { data: z.string().describe('Input data'), rules: z.string().describe('Transformation rules (JSON)') },
        handler: 'async ({ data, rules }) => { return { content: [{ type: "text", text: "Transformed data" }] }; }',
      },
      {
        name: 'load',
        description: 'Load data to a destination',
        inputSchema: { data: z.string().describe('Data to load'), destination: z.string().describe('Destination URI') },
        handler: 'async ({ data, destination }) => { return { content: [{ type: "text", text: "Loaded to " + destination }] }; }',
      },
      {
        name: 'pipeline_run',
        description: 'Run a full extract-transform-load pipeline',
        inputSchema: { source: z.string(), destination: z.string(), transformations: z.string().optional() },
        handler: 'async (args) => { return { content: [{ type: "text", text: "Pipeline complete" }] }; }',
      },
    ],
    prompts: [{ name: 'pipeline_design', description: 'Design a data pipeline', template: 'Design a data pipeline: {input}' }],
    resources: [{ uri: 'skill://pipeline/stats', name: 'Pipeline Stats', description: 'Pipeline execution statistics' }],
    dependencies: [],
    memoryBytes: 8192,
  },
  {
    id: 'chat-agent',
    name: 'Chat Agent Skill',
    description: 'Customizable chat agent with persona, memory, and tool use',
    category: 'ai',
    tools: [
      {
        name: 'chat',
        description: 'Send a message to the agent',
        inputSchema: { message: z.string().describe('User message'), context: z.string().optional().describe('Additional context') },
        handler: 'async ({ message, context }) => { return { content: [{ type: "text", text: "Agent response to: " + message }] }; }',
      },
      {
        name: 'set_persona',
        description: 'Set the agent persona',
        inputSchema: { name: z.string().describe('Persona name'), systemPrompt: z.string().describe('System prompt') },
        handler: 'async ({ name, systemPrompt }) => { return { content: [{ type: "text", text: "Persona set: " + name }] }; }',
      },
      {
        name: 'memory_add',
        description: 'Add information to agent memory',
        inputSchema: { key: z.string().describe('Memory key'), value: z.string().describe('Memory value') },
        handler: 'async ({ key, value }) => { return { content: [{ type: "text", text: "Memory stored: " + key }] }; }',
      },
      {
        name: 'memory_search',
        description: 'Search agent memory',
        inputSchema: { query: z.string().describe('Search query') },
        handler: 'async ({ query }) => { return { content: [{ type: "text", text: "Memory search: " + query }] }; }',
      },
    ],
    prompts: [{ name: 'agent_chat', description: 'Chat with the agent', template: '{input}' }],
    resources: [{ uri: 'skill://agent/memory', name: 'Agent Memory', description: 'Agent conversation memory' }],
    dependencies: [],
    memoryBytes: 12288,
  },
  {
    id: 'code-assistant',
    name: 'Code Assistant Skill',
    description: 'Code generation, review, and refactoring assistant',
    category: 'code',
    tools: [
      {
        name: 'generate',
        description: 'Generate code from a description',
        inputSchema: { description: z.string().describe('What to generate'), language: z.string().optional().default('typescript') },
        handler: 'async ({ description, language }) => { return { content: [{ type: "text", text: "Generated " + language + " code" }] }; }',
      },
      {
        name: 'review',
        description: 'Review code for issues',
        inputSchema: { code: z.string().describe('Code to review'), language: z.string().optional() },
        handler: 'async ({ code }) => { return { content: [{ type: "text", text: "Code review complete" }] }; }',
      },
      {
        name: 'refactor',
        description: 'Refactor code',
        inputSchema: { code: z.string().describe('Code to refactor'), goal: z.string().describe('Refactoring goal') },
        handler: 'async ({ code, goal }) => { return { content: [{ type: "text", text: "Refactored: " + goal }] }; }',
      },
      {
        name: 'explain',
        description: 'Explain code',
        inputSchema: { code: z.string().describe('Code to explain') },
        handler: 'async ({ code }) => { return { content: [{ type: "text", text: "Code explanation" }] }; }',
      },
    ],
    prompts: [{ name: 'code_help', description: 'Get coding help', template: 'Help me with this code: {input}' }],
    resources: [{ uri: 'skill://code/history', name: 'Code History', description: 'Recent code operations' }],
    dependencies: [],
    memoryBytes: 8192,
  },
  {
    id: 'notification-hub',
    name: 'Notification Hub Skill',
    description: 'Multi-channel notifications: email, webhook, push, SMS',
    category: 'integration',
    tools: [
      {
        name: 'send',
        description: 'Send a notification',
        inputSchema: { channel: z.string().describe('Channel: email, webhook, push, sms'), title: z.string(), body: z.string(), target: z.string().optional() },
        handler: 'async ({ channel, title }) => { return { content: [{ type: "text", text: "Sent via " + channel + ": " + title }] }; }',
      },
      {
        name: 'list_channels',
        description: 'List configured notification channels',
        inputSchema: {},
        handler: 'async () => { return { content: [{ type: "text", text: "Channels: email, webhook, push" }] }; }',
      },
    ],
    prompts: [{ name: 'notify', description: 'Send a notification', template: 'Send notification: {input}' }],
    resources: [{ uri: 'skill://notify/history', name: 'Notification History', description: 'Recent notifications' }],
    dependencies: [],
    memoryBytes: 4096,
  },
];

class SkillCreator {
  private options: SkillCreatorOptions;
  private templateCache: Map<string, SkillTemplate>;
  private outputDir: string;

  constructor(options: SkillCreatorOptions = {}) {
    this.options = {
      maxTools: options.maxTools ?? 15,
      outputDir: options.outputDir ?? join(getDataDir(), 'skills'),
      enableHotReload: options.enableHotReload ?? false,
      lightweight: options.lightweight ?? true,
      customCategories: options.customCategories ?? [],
    };
    this.outputDir = this.options.outputDir!;
    this.templateCache = new Map();
    this._loadTemplates();
    if (!existsSync(this.outputDir)) mkdirSync(this.outputDir, { recursive: true });
  }

  private _loadTemplates(): void {
    for (const t of SKILL_TEMPLATES) {
      this.templateCache.set(t.id, t);
    }
  }

  getTemplates(): SkillTemplate[] {
    return Array.from(this.templateCache.values());
  }

  getTemplate(id: string): SkillTemplate | undefined {
    return this.templateCache.get(id);
  }

  listByCategory(category: string): SkillTemplate[] {
    return this.getTemplates().filter(t => t.category === category);
  }

  getCategories(): string[] {
    const cats = new Set(this.getTemplates().map(t => t.category));
    if (this.options.customCategories) this.options.customCategories.forEach(c => cats.add(c));
    return Array.from(cats);
  }

  buildFromTemplate(templateId: string, customizations?: {
    name?: string;
    description?: string;
    addTools?: Array<{ name: string; description: string; inputSchema: Record<string, unknown>; handler: string }>;
    removeTools?: string[];
    addPrompts?: SkillTemplate['prompts'];
    addResources?: SkillTemplate['resources'];
    dependencies?: string[];
  }): { skillJson: string; indexCode: string } {
    const template = this.templateCache.get(templateId);
    if (!template) throw new Error(`Template not found: ${templateId}`);

    const name = customizations?.name || template.name;
    const description = customizations?.description || template.description;

    let tools = [...template.tools];
    if (customizations?.removeTools) {
      tools = tools.filter(t => !customizations.removeTools!.includes(t.name));
    }
    if (customizations?.addTools) {
      tools = [...tools, ...customizations.addTools];
    }
    if (tools.length > this.options.maxTools!) {
      tools = tools.slice(0, this.options.maxTools!);
    }

    const prompts = [...template.prompts, ...(customizations?.addPrompts || [])];
    const resources = [...template.resources, ...(customizations?.addResources || [])];
    const deps = [...template.dependencies, ...(customizations?.dependencies || [])];

    const skillJson = JSON.stringify({
      name: name.toLowerCase().replace(/\s+/g, '-'),
      version: '1.0.0',
      description,
      author: 's-ai-engine',
      main: 'index.js',
      category: template.category,
      tools: tools.map(t => ({ name: t.name, description: t.description })),
      prompts: prompts.map(p => ({ name: p.name, description: p.description })),
      resources,
      dependencies: deps,
    }, null, 2);

    const indexCode = this._generateSkillCode(name, description, tools, prompts, resources);

    return { skillJson, indexCode };
  }

  buildFromPrompt(prompt: string): { skillJson: string; indexCode: string } {
    const parsed = this._parsePrompt(prompt);
    return this.buildFromTemplate(parsed.templateId || 'api-wrapper', {
      name: parsed.name,
      description: parsed.description,
      addTools: parsed.extraTools,
    });
  }

  buildMinimal(name: string, tools: Array<{ name: string; description: string; handler: string }>): { skillJson: string; indexCode: string } {
    const toolDefs = tools.map(t => ({
      name: t.name,
      description: t.description,
      inputSchema: { input: { type: 'string', description: 'Input data' } },
      handler: t.handler,
    }));

    return this.buildFromTemplate('api-wrapper', { name, addTools: toolDefs });
  }

  saveSkill(id: string, skillJson: string, indexCode: string): string {
    const skillDir = join(this.outputDir, id);
    if (!existsSync(skillDir)) mkdirSync(skillDir, { recursive: true });

    writeFileSync(join(skillDir, 'skill.json'), skillJson);
    writeFileSync(join(skillDir, 'index.ts'), indexCode);

    return skillDir;
  }

  listInstalled(): string[] {
    if (!existsSync(this.outputDir)) return [];
    return readdirSync(this.outputDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);
  }

  getMemoryEstimate(templateId: string): number {
    const t = this.templateCache.get(templateId);
    return t ? t.memoryBytes : 4096;
  }

  private _parsePrompt(prompt: string): {
    templateId?: string;
    name?: string;
    description?: string;
    extraTools?: SkillTemplate['tools'];
  } {
    const lower = prompt.toLowerCase();
    let templateId: string | undefined;

    if (lower.includes('api') || lower.includes('rest') || lower.includes('http') || lower.includes('endpoint')) templateId = 'api-wrapper';
    else if (lower.includes('pipeline') || lower.includes('etl') || lower.includes('transform') || lower.includes('ingest')) templateId = 'data-pipeline';
    else if (lower.includes('chat') || lower.includes('agent') || lower.includes('persona') || lower.includes('conversation')) templateId = 'chat-agent';
    else if (lower.includes('code') || lower.includes('program') || lower.includes('develop') || lower.includes('review')) templateId = 'code-assistant';
    else if (lower.includes('notif') || lower.includes('alert') || lower.includes('email') || lower.includes('webhook')) templateId = 'notification-hub';
    else templateId = 'api-wrapper';

    const nameMatch = prompt.match(/(?:create|build|make)\s+(?:a|an)\s+([^.]+?)(?:\s+that|\s+for|\s+with|\.|$)/i);
    const name = nameMatch ? nameMatch[1].trim() : undefined;

    return { templateId, name, description: prompt.substring(0, 200) };
  }

  private _generateSkillCode(
    name: string,
    description: string,
    tools: SkillTemplate['tools'],
    prompts: SkillTemplate['prompts'],
    resources: SkillTemplate['resources']
  ): string {
    const toolRegistrations = tools.map(t => {
      const paramsStr = JSON.stringify(t.inputSchema, null, 4);
      return `  mcp.tool('${t.name}', '${t.description.replace(/'/g, "\\'")}', ${paramsStr}, ${t.handler});`;
    }).join('\n\n');

    const promptRegistrations = prompts.map(p => {
      return `  mcp.prompt('${p.name}', '${p.description}', { input: z.string().describe('Input') }, ({ input }) => ({ messages: [{ role: 'user', content: { type: 'text', text: \`${p.template}\` } }] }));`;
    }).join('\n\n');

    const resourceRegistrations = resources.map(r => {
      return `  mcp.resource('${r.name}', '${r.uri}', { description: '${r.description}' }, async () => ({ contents: [{ uri: '${r.uri}', text: JSON.stringify({ status: 'ok' }), mimeType: 'application/json' }] }));`;
    }).join('\n\n');

    const memKB = Math.ceil((tools.length * 1024 + prompts.length * 256 + resources.length * 256) / 1024);

    return `import { z } from 'zod';

// S-AI Skill Creator v5.1 — Generated Skill
// Name: ${name}
// Description: ${description}
// Tools: ${tools.length} | Prompts: ${prompts.length} | Resources: ${resources.length}
// Est. Memory: ~${memKB}KB

function register(mcp, skill) {

${toolRegistrations}

${promptRegistrations}

${resourceRegistrations}

}

export { register };
`;
  }
}

let _instance: SkillCreator | null = null;

function getSkillCreator(options?: SkillCreatorOptions): SkillCreator {
  if (!_instance) _instance = new SkillCreator(options);
  return _instance;
}

export { SkillCreator, getSkillCreator, SKILL_TEMPLATES };
export type { SkillTemplate, SkillCreatorOptions };
