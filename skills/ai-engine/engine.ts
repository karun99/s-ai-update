import { writeFileSync, unlinkSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getDataDir } from '../../src/config.js';

import { McpBuilder, getMcpBuilder } from '../mcp-builder/builder.js';
import { SkillCreator, getSkillCreator } from '../skill-creator/creator.js';

interface AppBrand {
  name: string;
  subtitle: string;
  icon: string;
  accentColor: string;
}

interface AppDefinition {
  name: string;
  brand: AppBrand;
  description: string;
  persona: Record<string, unknown>;
  agents: Record<string, unknown>;
  api: Record<string, unknown>;
  features: Record<string, unknown>;
  security: Record<string, unknown>;
  customNodes: unknown[];
}

interface SkillDefinition {
  name: string;
  description: string;
  version: string;
  category: string;
  tools: Array<{ name: string; description: string }>;
  systemPrompt: string;
  knowledgeBase: string;
  dependencies: string[];
}

interface McpToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

interface McpDefinition {
  name: string;
  description: string;
  version: string;
  tools: McpToolDef[];
  resources: Array<{ uri: string; name: string; description: string }>;
  prompts: Array<{ name: string; description: string }>;
}

interface SwarmAgentDef {
  id: string;
  name: string;
  role: string;
  description: string;
}

interface SwarmDefinition {
  name: string;
  description: string;
  agents: SwarmAgentDef[];
  consensusThreshold: number;
  maxRounds: number;
  biasReduction: boolean;
}

interface EngineOutput {
  id: string;
  definition: AppDefinition | SkillDefinition | McpDefinition | SwarmDefinition;
  html?: string;
  code?: string;
  config?: Record<string, unknown>;
  createdAt: string;
}

class AiEngine {
  provider: any;
  dataDir: string;
  mcpBuilder: McpBuilder;
  skillCreator: SkillCreator;

  constructor(provider?: any) {
    this.provider = provider;
    this.dataDir = join(getDataDir(), 'ai-engine');
    if (!existsSync(this.dataDir)) mkdirSync(this.dataDir, { recursive: true });
    this.mcpBuilder = getMcpBuilder({ lightweight: true, enableCache: true });
    this.skillCreator = getSkillCreator({ lightweight: true, enableHotReload: false });
  }

  async buildApp(prompt: string): Promise<EngineOutput> {
    const def = this._promptToAppDef(prompt);
    const html = this._generateAppHTML(def);
    const id = `app_${Date.now()}`;
    const output: EngineOutput = { id, definition: def, html, createdAt: new Date().toISOString() };
    this._saveOutput(id, output);
    return output;
  }

  async buildSkill(prompt: string): Promise<EngineOutput> {
    const skillDef = this._promptToSkillDef(prompt);
    const code = this._generateSkillCode(skillDef);
    const id = `skill_${Date.now()}`;
    const output: EngineOutput = { id, definition: skillDef, code, createdAt: new Date().toISOString() };
    this._saveOutput(id, output);
    return output;
  }

  async buildMcpServer(prompt: string): Promise<EngineOutput> {
    const mcpDef = this._promptToMcpDef(prompt);
    const code = this._generateMcpCode(mcpDef);
    const id = `mcp_${Date.now()}`;
    const output: EngineOutput = { id, definition: mcpDef, code, createdAt: new Date().toISOString() };
    this._saveOutput(id, output);
    return output;
  }

  async buildMcpFromTemplate(templateId: string, customizations?: {
    name?: string;
    description?: string;
    addTools?: Array<{ name: string; description: string }>;
    removeTools?: string[];
  }): Promise<{ code: string; template: string; memoryKB: number }> {
    const code = this.mcpBuilder.buildFromTemplate(templateId, {
      name: customizations?.name,
      description: customizations?.description,
      addTools: customizations?.addTools?.map(t => ({
        name: t.name,
        description: t.description,
        parameters: { input: { type: 'string', description: 'Input' } },
      })),
      removeTools: customizations?.removeTools,
    });
    const memKB = this.mcpBuilder.getMemoryEstimate(templateId);
    return { code, template: templateId, memoryKB: memKB };
  }

  async buildSkillFromTemplate(templateId: string, customizations?: {
    name?: string;
    description?: string;
    addTools?: Array<{ name: string; description: string }>;
    removeTools?: string[];
  }): Promise<{ skillJson: string; indexCode: string; template: string; memoryKB: number }> {
    const result = this.skillCreator.buildFromTemplate(templateId, {
      name: customizations?.name,
      description: customizations?.description,
      addTools: customizations?.addTools?.map(t => ({
        name: t.name,
        description: t.description,
        inputSchema: { input: { type: 'string', description: 'Input' } },
        handler: `async ({ input }) => ({ content: [{ type: "text", text: JSON.stringify({ tool: "${t.name}", input }) }] })`,
      })),
      removeTools: customizations?.removeTools,
    });
    const memKB = this.skillCreator.getMemoryEstimate(templateId);
    return { ...result, template: templateId, memoryKB: memKB };
  }

  getMcpTemplates() { return this.mcpBuilder.getTemplates(); }
  getSkillTemplates() { return this.skillCreator.getTemplates(); }

  async buildSwarm(prompt: string): Promise<EngineOutput> {
    const swarmDef = this._promptToSwarmDef(prompt);
    const config = this._generateSwarmConfig(swarmDef);
    const id = `swarm_${Date.now()}`;
    const output: EngineOutput = { id, definition: swarmDef, config, createdAt: new Date().toISOString() };
    this._saveOutput(id, output);
    return output;
  }

  async generateWithLlm(prompt: string, systemPrompt: string): Promise<string | null> {
    if (!this.provider) return null;
    try {
      const result = await this.provider.complete([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt }
      ], { temperature: 0.3, maxTokens: 4096 });
      return result.content;
    } catch {
      return null;
    }
  }

  _promptToAppDef(prompt: string): AppDefinition {
    const lower = prompt.toLowerCase();
    const def: AppDefinition = {
      name: 'My AI App',
      brand: { name: 'My AI App', subtitle: 'Intelligent Assistant', icon: '\u{1F916}', accentColor: '#7c6df0' },
      description: prompt.substring(0, 300),
      persona: { name: 'Assistant', title: 'AI Guide', tone: 'professional', expertise: ['AI', 'Automation'], systemPrompt: 'You are a helpful AI assistant.' },
      agents: {
        knowledgeLearner: { enabled: true, knowledgeBase: '' },
        webSearch: { enabled: true },
        dataAnalyst: { enabled: true, model: 'gpt-4', temperature: 0.7, maxTokens: 2048 },
        contentValidator: { enabled: true, strictness: 'medium', checkInjection: true, checkBias: true },
        answeringAgent: { enabled: true, temperature: 0.5, maxTokens: 1024 }
      },
      api: { provider: 'openrouter', deployment: 'saas', model: 'gpt-3.5-turbo' },
      features: { voiceInput: false, voiceOutput: false, themeToggle: true, accentColorPicker: true, adminPanel: true, commands: [], skills: [] },
      security: { encryption: 'AES-256-GCM', csp: true, xssProtection: true },
      customNodes: []
    };

    const nameMatch = prompt.match(/(?:create|build|make)\s+(?:a|an)\s+([^.]+?)(?:\s+app|\s+for|\s+that|\s+with|\.|$)/i);
    if (nameMatch) { def.brand.name = nameMatch[1].trim(); def.name = def.brand.name; }

    const personaMatch = prompt.match(/(?:persona|called|named)\s+["']?([A-Za-z][A-Za-z0-9\s]+?)(?:["']|\s+with|\s+and|\s+\.|$)/i);
    if (personaMatch) (def.persona as any).name = personaMatch[1].trim();

    if (lower.includes('friendly')) (def.persona as any).tone = 'friendly';
    else if (lower.includes('technical')) (def.persona as any).tone = 'technical';
    else if (lower.includes('casual')) (def.persona as any).tone = 'casual';

    const colorMatch = prompt.match(/(?:color|accent)\s*[#:]?\s*([#][0-9a-f]{6}|[#][0-9a-f]{3}|[a-z]+)/i);
    if (colorMatch) {
      const color = colorMatch[1];
      if (color.startsWith('#')) def.brand.accentColor = color;
      else { const cm: Record<string, string> = { blue: '#3b82f6', red: '#ef4444', green: '#22c55e', purple: '#8b5cf6', orange: '#f97316', pink: '#ec4899', teal: '#14b8a6' }; if (cm[color]) def.brand.accentColor = cm[color]; }
    }

    if (lower.includes('medical') || lower.includes('health')) def.brand.icon = '\u{1F3E5}';
    else if (lower.includes('flashcard') || lower.includes('study') || lower.includes('learn')) def.brand.icon = '\u{1F4DA}';
    else if (lower.includes('code') || lower.includes('programming')) def.brand.icon = '\u{1F4BB}';
    else if (lower.includes('finance') || lower.includes('bank')) def.brand.icon = '\u{1F4B0}';
    else if (lower.includes('music') || lower.includes('audio')) def.brand.icon = '\u{1F3B5}';
    else if (lower.includes('game')) def.brand.icon = '\u{1F3AE}';
    else if (lower.includes('research') || lower.includes('academic')) def.brand.icon = '\u{1F52C}';
    else if (lower.includes('marketing') || lower.includes('brand')) def.brand.icon = '\u{1F4E3}';
    else if (lower.includes('fitness') || lower.includes('health')) def.brand.icon = '\u{1F4AA}';
    else if (lower.includes('recipe') || lower.includes('cook')) def.brand.icon = '\u{1F373}';

    if (lower.includes('tutor') || lower.includes('teach')) (def.persona as any).systemPrompt = 'You are a patient and encouraging tutor. Guide students to discover solutions.';
    else if (lower.includes('medical')) (def.persona as any).systemPrompt = 'You are a knowledgeable medical assistant. Always include a medical disclaimer.';
    else if (lower.includes('code') || lower.includes('programming')) (def.persona as any).systemPrompt = 'You are an expert programming mentor. Write clean, well-documented code.';
    else if (lower.includes('research')) (def.persona as any).systemPrompt = 'You are a research assistant. Maintain academic rigor and cite sources.';
    else if (lower.includes('marketing')) (def.persona as any).systemPrompt = 'You are a branding and marketing strategist.';
    else if (lower.includes('fitness')) (def.persona as any).systemPrompt = 'You are a fitness coach. Provide safe, evidence-based exercise and nutrition advice.';
    else if (lower.includes('recipe') || lower.includes('cook')) (def.persona as any).systemPrompt = 'You are a professional chef. Share recipes with clear instructions and tips.';

    if (lower.includes('voice') || lower.includes('speak') || lower.includes('speech')) { (def.features as any).voiceInput = true; (def.features as any).voiceOutput = true; }
    if (lower.includes('3d') || lower.includes('avatar')) (def.features as any).threeJsAvatar = true;

    if (lower.includes('medical')) (def.persona as any).expertise = ['Medicine', 'Anatomy', 'Health'];
    else if (lower.includes('code')) (def.persona as any).expertise = ['Programming', 'Algorithms', 'Software Engineering'];
    else if (lower.includes('finance')) (def.persona as any).expertise = ['Finance', 'Economics', 'Investment'];
    else if (lower.includes('research')) (def.persona as any).expertise = ['Research', 'Analysis', 'Academic Writing'];
    else if (lower.includes('marketing')) (def.persona as any).expertise = ['Marketing', 'Branding', 'Strategy'];
    else if (lower.includes('fitness')) (def.persona as any).expertise = ['Fitness', 'Nutrition', 'Exercise Science'];
    else if (lower.includes('recipe') || lower.includes('cook')) (def.persona as any).expertise = ['Cooking', 'Recipe Development', 'Food Science'];

    return def;
  }

  _promptToSkillDef(prompt: string): SkillDefinition {
    const lower = prompt.toLowerCase();
    return {
      name: this._extractName(prompt, 'skill'),
      description: prompt.substring(0, 200),
      version: '1.0.0',
      category: lower.includes('search') ? 'search' : lower.includes('data') ? 'data' : lower.includes('code') ? 'code' : 'utility',
      tools: [{ name: 'execute', description: `Execute the ${this._extractName(prompt, 'skill')} skill` }],
      systemPrompt: `You are a specialized skill agent. ${prompt}`,
      knowledgeBase: '',
      dependencies: []
    };
  }

  _promptToMcpDef(prompt: string): McpDefinition {
    const lower = prompt.toLowerCase();
    const tools: McpToolDef[] = [];
    const toolMatches = prompt.match(/(?:tool|function|action)s?\s*[:]\s*([^.]+)/gi);
    if (toolMatches) {
      for (const m of toolMatches) {
        const name = m.replace(/(?:tool|function|action)s?\s*[:]\s*/i, '').trim().split(/\s+/)[0].toLowerCase().replace(/[^a-z0-9]/g, '_');
        tools.push({ name, description: m.trim(), parameters: {} });
      }
    }
    if (tools.length === 0) {
      tools.push({ name: 'process', description: `Process data for ${this._extractName(prompt, 'mcp')}`, parameters: { input: { type: 'string', description: 'Input data' } } });
      tools.push({ name: 'query', description: `Query ${this._extractName(prompt, 'mcp')} data`, parameters: { query: { type: 'string', description: 'Search query' } } });
    }
    const mcpName = this._extractName(prompt, 'mcp');
    return {
      name: mcpName + '-server',
      description: prompt.substring(0, 200),
      version: '1.0.0',
      tools,
      resources: [{ uri: `${mcpName.toLowerCase()}://data`, name: 'Data', description: `${mcpName} data resource` }],
      prompts: [{ name: 'help', description: `Get help with ${mcpName}` }]
    };
  }

  _promptToSwarmDef(prompt: string): SwarmDefinition {
    const lower = prompt.toLowerCase();
    const agents: SwarmAgentDef[] = [];
    agents.push({ id: 'orchestrator', name: 'Orchestrator', role: 'orchestrator', description: 'Coordinates all agents' });

    if (lower.includes('research') || lower.includes('search') || lower.includes('web') || lower.includes('crawl')) {
      agents.push({ id: 'researcher', name: 'Researcher', role: 'researcher', description: 'Gathers information from web and knowledge base' });
    }
    if (lower.includes('analyz') || lower.includes('data') || lower.includes('pattern')) {
      agents.push({ id: 'analyst', name: 'Analyst', role: 'analyst', description: 'Analyzes data and identifies patterns' });
    }
    if (lower.includes('critic') || lower.includes('review') || lower.includes('bias') || lower.includes('quality')) {
      agents.push({ id: 'critic', name: 'Critic', role: 'critic', description: 'Reviews outputs for quality and bias' });
    }
    if (lower.includes('code') || lower.includes('program') || lower.includes('develop')) {
      agents.push({ id: 'coder', name: 'Coder', role: 'coder', description: 'Writes and reviews code' });
    }
    if (lower.includes('writ') || lower.includes('content') || lower.includes('copy')) {
      agents.push({ id: 'writer', name: 'Writer', role: 'writer', description: 'Creates written content' });
    }
    if (agents.length <= 2) {
      agents.push({ id: 'analyst', name: 'Analyst', role: 'analyst', description: 'Provides analysis' });
      agents.push({ id: 'critic', name: 'Critic', role: 'critic', description: 'Reviews for quality' });
    }
    agents.push({ id: 'synthesizer', name: 'Synthesizer', role: 'synthesizer', description: 'Combines all agent outputs' });

    return {
      name: this._extractName(prompt, 'swarm'),
      description: prompt.substring(0, 300),
      agents,
      consensusThreshold: 0.7,
      maxRounds: 3,
      biasReduction: lower.includes('bias') || lower.includes('fair') || lower.includes('balance')
    };
  }

  _extractName(prompt: string, suffix: string): string {
    const match = prompt.match(/(?:create|build|make)\s+(?:a|an)\s+([^.]+?)(?:\s+that|\s+for|\s+with|\.|$)/i);
    if (match) return match[1].trim().replace(/\s+/g, '-').toLowerCase();
    return `my-${suffix}`;
  }

  _generateAppHTML(def: AppDefinition): string {
    const a = def.brand.accentColor || '#7c6df0';
    const icon = def.brand.icon || '\u{1F916}';
    const name = def.brand.name || 'AI App';
    const pname = (def.persona as any)?.name || 'Assistant';
    const kb = ((def.agents as any)?.knowledgeLearner?.knowledgeBase || '').replace(/"/g, '&quot;');

    return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${name}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',system-ui,sans-serif;background:#f8f9fc;color:#1a1a2e;transition:background .3s;padding:20px;min-height:100vh}
body.dark{background:#0e0e1a;color:#e8e8f0}
.container{max-width:900px;margin:0 auto}
.header{display:flex;align-items:center;gap:16px;padding-bottom:20px;border-bottom:2px solid ${a};margin-bottom:24px;flex-wrap:wrap}
.header h1{font-size:28px}
.accent{color:${a}}
.header-actions{margin-left:auto;display:flex;gap:10px;align-items:center}
.btn{padding:8px 16px;border-radius:8px;border:none;font-weight:500;cursor:pointer;transition:.2s;background:#e0e0e8;color:#1a1a2e}
.btn-primary{background:${a};color:#fff}
.btn-primary:hover{opacity:.85}
.chat-box{background:#fff;border-radius:16px;padding:20px;box-shadow:0 4px 24px rgba(0,0,0,.06);border:1px solid #e8e8f0;transition:background .3s}
body.dark .chat-box{background:#1a1a2e;border-color:#2a2a42}
.message{display:flex;gap:12px;margin-bottom:16px;padding:12px 16px;border-radius:12px;background:#f0f0f8;transition:background .3s}
body.dark .message{background:#14142a}
.message.user{background:${a}20;border-left:4px solid ${a}}
.message .avatar{font-size:24px;flex-shrink:0}
.message .content{flex:1}
.input-area{display:flex;gap:10px;margin-top:16px;padding-top:16px;border-top:1px solid #e8e8f0}
body.dark .input-area{border-color:#2a2a42}
.input-area input{flex:1;padding:10px 14px;border-radius:8px;border:1px solid #d0d0d8;background:#f8f8fc;font-family:inherit;transition:.2s}
body.dark .input-area input{background:#0e0e1e;border-color:#3a3a52;color:#e8e8f0}
.input-area input:focus{outline:none;border-color:${a}}
.badge{font-size:12px;padding:2px 12px;border-radius:12px;background:#e8e8f0}
body.dark .badge{background:#2a2a42}
.footer{margin-top:20px;font-size:12px;color:#9a9ab0;text-align:center}
.toggle-label{display:flex;align-items:center;gap:6px;cursor:pointer}
.toggle-label input{display:none}
.toggle-slider{width:40px;height:22px;background:#ccc;border-radius:20px;position:relative;transition:.3s;flex-shrink:0}
.toggle-slider::before{content:'';position:absolute;width:16px;height:16px;background:#fff;border-radius:50%;top:3px;left:3px;transition:.3s}
.toggle-label input:checked+.toggle-slider{background:${a}}
.toggle-label input:checked+.toggle-slider::before{transform:translateX(18px)}
</style></head>
<body>
<div class="container">
<div class="header"><h1><span class="accent">${icon}</span> ${name}</h1>
<div class="header-actions"><label class="toggle-label"><input type="checkbox" id="themeToggle"><span class="toggle-slider"></span><span style="font-size:13px">\u{1F313}</span></label></div></div>
<div class="chat-box" id="chatBox">
<div class="message bot"><div class="avatar">${icon}</div><div class="content"><strong>${pname}</strong><p style="margin-top:4px">Hello! I'm your AI assistant. How can I help you today?</p></div></div>
<div class="input-area"><input type="text" id="chatInput" placeholder="Ask me anything..."><button class="btn btn-primary" id="sendBtn">\u25B6</button></div>
</div>
<div class="footer"><span class="badge">\u{1F512} AES-256</span> \u00B7 Built with S-AI</div>
</div>
<script>
var ci=document.getElementById('chatInput'),sb=document.getElementById('sendBtn'),cb=document.getElementById('chatBox'),tt=document.getElementById('themeToggle');
function am(r,t){var d=document.createElement('div');d.className='message '+r;var av=r==='user'?'\\u{1F9D1}':'${icon}',nm=r==='user'?'You':'${pname}';d.innerHTML='<div class="avatar">'+av+'</div><div class="content"><strong>'+nm+'</strong><p style="margin-top:4px">'+t+'</p></div>';cb.insertBefore(d,cb.querySelector('.input-area'));}
function hs(){var t=ci.value.trim();if(!t)return;am('user',t);ci.value='';setTimeout(function(){var kb="${kb}";var lines=kb.split('\\n').filter(function(l){return l.trim()});var resp="That's a great question! Let me think about that...";var lw=t.toLowerCase();for(var i=0;i<lines.length;i++){if(lines[i].toLowerCase().indexOf(lw.split(' ')[0])!==-1){resp=lines[i];break;}}if(resp==="That's a great question! Let me think about that...")resp="I don't have that in my knowledge base yet. Try asking about something else.";am('bot',resp);},600);}
sb.addEventListener('click',hs);ci.addEventListener('keydown',function(e){if(e.key==='Enter')hs();});
if(tt)tt.addEventListener('change',function(){document.body.classList.toggle('dark');});
</script></body></html>`;
  }

  _generateSkillCode(skillDef: SkillDefinition): string {
    return `import { z } from 'zod';

const SKILL_DEF = ${JSON.stringify(skillDef, null, 2)};

function register(mcp) {
  mcp.tool(
    '${skillDef.tools[0]?.name || 'execute'}',
    '${skillDef.description}',
    { input: z.string().describe('Input data') },
    async ({ input }) => {
      return { content: [{ type: 'text', text: '[${skillDef.name}] Processed: ' + input }] };
    }
  );
}

export { register, SKILL_DEF };
`;
  }

  _generateMcpCode(mcpDef: McpDefinition): string {
    const toolDefs = mcpDef.tools.map(t =>
      `  mcp.tool('${t.name}', '${t.description}', ${JSON.stringify(t.parameters || {})}, async (args) => {
    return { content: [{ type: 'text', text: '[${mcpDef.name}:${t.name}] Result: ' + JSON.stringify(args) }] };
  });`
    ).join('\n\n');

    const resourceDefs = (mcpDef.resources || []).map(r =>
      `  mcp.resource('${r.uri}', '${r.name}', '${r.description}', async () => {
    return { contents: [{ uri: '${r.uri}', text: JSON.stringify({ status: 'ok', resource: '${r.name}' }), mimeType: 'application/json' }] };
  });`
    ).join('\n\n');

    return `import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const MCP_DEF = ${JSON.stringify(mcpDef, null, 2)};

function createMcpServer() {
  const mcp = new McpServer({ name: '${mcpDef.name}', version: '${mcpDef.version}' });

${toolDefs}

${resourceDefs}

  return mcp;
}

async function startStdio() {
  const mcp = createMcpServer();
  const transport = new StdioServerTransport();
  await mcp.connect(transport);
}

export { createMcpServer, startStdio };
`;
  }

  _generateSwarmConfig(swarmDef: SwarmDefinition): Record<string, unknown> {
    return {
      name: swarmDef.name,
      description: swarmDef.description,
      agents: swarmDef.agents.map(a => ({
        id: a.id,
        name: a.name,
        role: a.role,
        systemPrompt: `You are ${a.name}, a ${a.role} agent. ${a.description}`,
        temperature: a.role === 'orchestrator' ? 0.3 : a.role === 'critic' ? 0.6 : 0.7,
        maxTokens: 1024
      })),
      swarm: {
        consensusThreshold: swarmDef.consensusThreshold,
        maxRounds: swarmDef.maxRounds,
        biasReduction: swarmDef.biasReduction
      }
    };
  }

  _saveOutput(id: string, output: EngineOutput): void {
    const file = join(this.dataDir, `${id}.json`);
    writeFileSync(file, JSON.stringify(output, null, 2));
  }

  listOutputs(): EngineOutput[] {
    if (!existsSync(this.dataDir)) return [];
    return readdirSync(this.dataDir)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        try { return JSON.parse(readFileSync(join(this.dataDir, f), 'utf8')); }
        catch { return null; }
      })
      .filter(Boolean)
      .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  getOutput(id: string): EngineOutput | null {
    const file = join(this.dataDir, `${id}.json`);
    if (!existsSync(file)) return null;
    try { return JSON.parse(readFileSync(file, 'utf8')); }
    catch { return null; }
  }

  deleteOutput(id: string): void {
    const file = join(this.dataDir, `${id}.json`);
    if (existsSync(file)) unlinkSync(file);
  }
}

export { AiEngine };
export type { AppDefinition, SkillDefinition, McpDefinition, SwarmDefinition, EngineOutput };
