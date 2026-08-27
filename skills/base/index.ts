import { z } from 'zod';
import { join } from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { getDataDir } from '../../src/config.js';

function register(mcp: any, skill: any): void {
  mcp.tool(
    'memory_search',
    'Search the knowledge graph for relevant information',
    { query: z.string().describe('The search query') },
    async ({ query }: { query: string }) => {
      try {
        const { queryGraph } = await import('../../src/memory/graphify.js');
        const results = queryGraph(query);
        return { content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }] };
      } catch (err: any) {
        return { content: [{ type: 'text' as const, text: `Search error: ${err.message}` }] };
      }
    }
  );

  mcp.tool(
    'knowledge_add',
    'Add new knowledge to the knowledge base',
    { content: z.string().describe('The knowledge content to add') },
    async ({ content }: { content: string }) => {
      try {
        const dataDir = getDataDir();
        const kbFile = join(dataDir, 'knowledge.txt');
        if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
        const existing = existsSync(kbFile) ? readFileSync(kbFile, 'utf8') : '';
        writeFileSync(kbFile, existing + '\n' + content);
        return { content: [{ type: 'text' as const, text: 'Knowledge added successfully.' }] };
      } catch (err: any) {
        return { content: [{ type: 'text' as const, text: `Error: ${err.message}` }] };
      }
    }
  );
}

export { register };
