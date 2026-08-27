import { z } from 'zod';

interface McpTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  tools: Array<{ name: string; description: string; parameters: Record<string, unknown> }>;
  resources: Array<{ uri: string; name: string; description: string }>;
  prompts: Array<{ name: string; description: string }>;
  memoryBytes: number;
}

interface McpBuilderOptions {
  maxTools?: number;
  enableCache?: boolean;
  templateDir?: string;
  lightweight?: boolean;
}

const TEMPLATES: McpTemplate[] = [
  {
    id: 'data-api',
    name: 'Data API Server',
    description: 'REST-like MCP server for CRUD operations on structured data',
    category: 'data',
    tools: [
      { name: 'create', description: 'Create a new record', parameters: { type: z.string().describe('Record type'), data: z.string().describe('JSON data') } },
      { name: 'read', description: 'Read a record by ID', parameters: { id: z.string().describe('Record ID') } },
      { name: 'update', description: 'Update a record', parameters: { id: z.string().describe('Record ID'), data: z.string().describe('JSON data') } },
      { name: 'delete', description: 'Delete a record', parameters: { id: z.string().describe('Record ID') } },
      { name: 'query', description: 'Query records with filters', parameters: { type: z.string().describe('Record type'), filter: z.string().optional().describe('JSON filter') } },
    ],
    resources: [{ uri: 'data://records', name: 'Records', description: 'All stored records' }],
    prompts: [{ name: 'help', description: 'Get help with data operations' }],
    memoryBytes: 8192,
  },
  {
    id: 'web-search',
    name: 'Web Search Server',
    description: 'MCP server for web search and content extraction',
    category: 'search',
    tools: [
      { name: 'search', description: 'Search the web', parameters: { query: z.string().describe('Search query'), maxResults: z.number().optional().default(5) } },
      { name: 'fetch', description: 'Fetch and extract content from URL', parameters: { url: z.string().describe('URL to fetch') } },
      { name: 'summarize', description: 'Summarize URL content', parameters: { url: z.string().describe('URL to summarize'), maxLength: z.number().optional().default(500) } },
    ],
    resources: [{ uri: 'web://search', name: 'Search Index', description: 'Recent search results cache' }],
    prompts: [{ name: 'research', description: 'Research a topic using web search' }],
    memoryBytes: 4096,
  },
  {
    id: 'file-system',
    name: 'File System Server',
    description: 'MCP server for safe file system operations with path sandboxing',
    category: 'utility',
    tools: [
      { name: 'read_file', description: 'Read file contents', parameters: { path: z.string().describe('File path (sandboxed)') } },
      { name: 'write_file', description: 'Write file contents', parameters: { path: z.string().describe('File path'), content: z.string().describe('File content') } },
      { name: 'list_dir', description: 'List directory contents', parameters: { path: z.string().describe('Directory path') } },
      { name: 'search_files', description: 'Search files by name pattern', parameters: { pattern: z.string().describe('Glob pattern'), root: z.string().optional().default('.') } },
    ],
    resources: [{ uri: 'fs://workspace', name: 'Workspace', description: 'Workspace directory listing' }],
    prompts: [{ name: 'explore', description: 'Explore the file system' }],
    memoryBytes: 2048,
  },
  {
    id: 'ai-proxy',
    name: 'AI Proxy Server',
    description: 'MCP server that proxies requests to multiple AI providers',
    category: 'ai',
    tools: [
      { name: 'complete', description: 'Text completion', parameters: { prompt: z.string().describe('Prompt'), model: z.string().optional().describe('Model ID'), maxTokens: z.number().optional().default(1024) } },
      { name: 'chat', description: 'Chat completion', parameters: { messages: z.string().describe('JSON array of messages'), model: z.string().optional() } },
      { name: 'embed', description: 'Generate embeddings', parameters: { text: z.string().describe('Text to embed') } },
    ],
    resources: [{ uri: 'ai://models', name: 'Models', description: 'Available AI models' }],
    prompts: [{ name: 'generate', description: 'Generate AI content' }],
    memoryBytes: 16384,
  },
  {
    id: 'knowledge-base',
    name: 'Knowledge Base Server',
    description: 'MCP server for RAG-style knowledge management with vector search',
    category: 'data',
    tools: [
      { name: 'ingest', description: 'Ingest document into knowledge base', parameters: { content: z.string().describe('Document content'), metadata: z.string().optional().describe('JSON metadata') } },
      { name: 'search', description: 'Semantic search', parameters: { query: z.string().describe('Search query'), topK: z.number().optional().default(5) } },
      { name: 'get', description: 'Get document by ID', parameters: { id: z.string().describe('Document ID') } },
      { name: 'delete', description: 'Delete document', parameters: { id: z.string().describe('Document ID') } },
    ],
    resources: [{ uri: 'kb://stats', name: 'Knowledge Stats', description: 'Knowledge base statistics' }],
    prompts: [{ name: 'ingest_doc', description: 'Help ingest a document' }],
    memoryBytes: 32768,
  },
];

class McpBuilder {
  private options: McpBuilderOptions;
  private templateCache: Map<string, McpTemplate>;
  private outputCache: Map<string, string>;

  constructor(options: McpBuilderOptions = {}) {
    this.options = {
      maxTools: options.maxTools ?? 20,
      enableCache: options.enableCache ?? true,
      templateDir: options.templateDir,
      lightweight: options.lightweight ?? true,
    };
    this.templateCache = new Map();
    this.outputCache = new Map();
    this._loadTemplates();
  }

  private _loadTemplates(): void {
    for (const t of TEMPLATES) {
      this.templateCache.set(t.id, t);
    }
  }

  getTemplates(): McpTemplate[] {
    return Array.from(this.templateCache.values());
  }

  getTemplate(id: string): McpTemplate | undefined {
    return this.templateCache.get(id);
  }

  listByCategory(category: string): McpTemplate[] {
    return this.getTemplates().filter(t => t.category === category);
  }

  buildFromTemplate(templateId: string, customizations?: {
    name?: string;
    description?: string;
    addTools?: McpTemplate['tools'];
    removeTools?: string[];
    addResources?: McpTemplate['resources'];
    addPrompts?: McpTemplate['prompts'];
  }): string {
    const cacheKey = `${templateId}:${JSON.stringify(customizations || {})}`;
    if (this.options.enableCache && this.outputCache.has(cacheKey)) {
      return this.outputCache.get(cacheKey)!;
    }

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
    if (tools.length > this.options.maxTools) {
      tools = tools.slice(0, this.options.maxTools);
    }

    const resources = [...(template.resources || []), ...(customizations?.addResources || [])];
    const prompts = [...(template.prompts || []), ...(customizations?.addPrompts || [])];

    const code = this._generateCode(name, description, tools, resources, prompts);

    if (this.options.enableCache) {
      this.outputCache.set(cacheKey, code);
    }

    return code;
  }

  buildFromPrompt(prompt: string): string {
    const parsed = this._parsePrompt(prompt);
    return this.buildFromTemplate(parsed.templateId || 'data-api', {
      name: parsed.name,
      description: parsed.description,
      addTools: parsed.extraTools,
    });
  }

  buildMinimal(name: string, tools: Array<{ name: string; description: string }>): string {
    const toolDefs = tools.map(t => ({
      name: t.name,
      description: t.description,
      parameters: { input: { type: 'string', description: 'Input data' } },
    }));

    return this._generateCode(
      name,
      `Minimal MCP server: ${name}`,
      toolDefs,
      [],
      []
    );
  }

  private _parsePrompt(prompt: string): {
    templateId?: string;
    name?: string;
    description?: string;
    extraTools?: McpTemplate['tools'];
  } {
    const lower = prompt.toLowerCase();
    let templateId: string | undefined;

    if (lower.includes('search') || lower.includes('web') || lower.includes('crawl')) templateId = 'web-search';
    else if (lower.includes('file') || lower.includes('directory') || lower.includes('folder')) templateId = 'file-system';
    else if (lower.includes('ai') || lower.includes('llm') || lower.includes('model') || lower.includes('gpt')) templateId = 'ai-proxy';
    else if (lower.includes('knowledge') || lower.includes('rag') || lower.includes('document')) templateId = 'knowledge-base';
    else templateId = 'data-api';

    const nameMatch = prompt.match(/(?:create|build|make)\s+(?:a|an)\s+([^.]+?)(?:\s+that|\s+for|\s+with|\.|$)/i);
    const name = nameMatch ? nameMatch[1].trim() : undefined;

    return { templateId, name, description: prompt.substring(0, 200) };
  }

  private _generateCode(
    name: string,
    description: string,
    tools: McpTemplate['tools'],
    resources: McpTemplate['resources'],
    prompts: McpTemplate['prompts']
  ): string {
    const toolDefs = tools.map(t => {
      const paramsStr = JSON.stringify(t.parameters, null, 2);
      return `  mcp.tool('${t.name}', '${t.description.replace(/'/g, "\\'")}', ${paramsStr}, async (args) => {
    return { content: [{ type: 'text', text: JSON.stringify({ tool: '${t.name}', result: args }, null, 2) }] };
  });`;
    }).join('\n\n');

    const resourceDefs = resources.map(r => {
      return `  mcp.resource('${r.name}', '${r.uri}', { description: '${r.description}' }, async () => {
    return { contents: [{ uri: '${r.uri}', text: JSON.stringify({ status: 'ok', resource: '${r.name}' }), mimeType: 'application/json' }] };
  });`;
    }).join('\n\n');

    const promptDefs = prompts.map(p => {
      return `  mcp.prompt('${p.name}', '${p.description}', { input: z.string().describe('Input') }, ({ input }) => ({ messages: [{ role: 'user', content: { type: 'text', text: input } }] }));`;
    }).join('\n\n');

    const memKB = Math.ceil((tools.length * 1024 + resources.length * 512 + prompts.length * 256) / 1024);

    return `import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

// S-AI MCP Builder v5.1 — Generated Server
// Name: ${name}
// Description: ${description}
// Tools: ${tools.length} | Resources: ${resources.length} | Prompts: ${prompts.length}
// Est. Memory: ~${memKB}KB

function createServer() {
  const mcp = new McpServer({ name: '${name.replace(/'/g, "\\'")}', version: '1.0.0' });

${toolDefs}

${resourceDefs}

${promptDefs}

  return mcp;
}

async function main() {
  const mcp = createServer();
  const transport = new StdioServerTransport();
  await mcp.connect(transport);
}

main().catch(console.error);

export { createServer };
`;
  }

  clearCache(): void {
    this.outputCache.clear();
  }

  getMemoryEstimate(templateId: string): number {
    const t = this.templateCache.get(templateId);
    return t ? t.memoryBytes : 4096;
  }

  getTotalMemoryEstimate(): number {
    return this.getTemplates().reduce((sum, t) => sum + t.memoryBytes, 0);
  }
}

let _instance: McpBuilder | null = null;

function getMcpBuilder(options?: McpBuilderOptions): McpBuilder {
  if (!_instance) _instance = new McpBuilder(options);
  return _instance;
}

export { McpBuilder, getMcpBuilder, TEMPLATES };
export type { McpTemplate, McpBuilderOptions };
