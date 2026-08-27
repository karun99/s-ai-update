import { z } from 'zod';
import { getMcpBuilder } from './builder.js';

let _registered = false;

function register(mcp: any, _skill: any): void {
  if (_registered) return;
  _registered = true;

  const builder = getMcpBuilder();

  mcp.tool('mcp_list_templates',
    'List available MCP server templates (data-api, web-search, file-system, ai-proxy, knowledge-base)',
    {},
    async () => {
      const templates = builder.getTemplates();
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(templates.map(t => ({
            id: t.id,
            name: t.name,
            description: t.description,
            category: t.category,
            tools: t.tools.length,
            memoryKB: Math.ceil(t.memoryBytes / 1024),
          })), null, 2)
        }]
      };
    }
  );

  mcp.tool('mcp_build',
    'Build an MCP server from a template with customizations. Returns runnable server code.',
    {
      template: z.string().describe('Template ID (data-api, web-search, file-system, ai-proxy, knowledge-base) or a natural language prompt'),
      name: z.string().optional().describe('Custom server name'),
      description: z.string().optional().describe('Custom description'),
      addTools: z.array(z.object({
        name: z.string(),
        description: z.string(),
      })).optional().describe('Additional tools to add'),
      removeTools: z.array(z.string()).optional().describe('Tool names to remove from template'),
      lightweight: z.boolean().optional().default(true).describe('Use minimal memory footprint'),
    },
    async ({ template, name, description, addTools, removeTools, lightweight }: {
      template: string;
      name?: string;
      description?: string;
      addTools?: Array<{ name: string; description: string }>;
      removeTools?: string[];
      lightweight?: boolean;
    }) => {
      let code: string;
      const isTemplate = builder.getTemplate(template);

      if (isTemplate) {
        code = builder.buildFromTemplate(template, {
          name,
          description,
          addTools: addTools?.map(t => ({
            name: t.name,
            description: t.description,
            parameters: { input: { type: 'string', description: 'Input' } },
          })),
          removeTools,
        });
      } else {
        code = builder.buildMinimal(name || 'custom-mcp', addTools || [
          { name: 'process', description: 'Process input data' },
          { name: 'query', description: 'Query data' },
        ]);
      }

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            success: true,
            template: isTemplate ? template : 'custom',
            lightweight,
            code,
          }, null, 2)
        }]
      };
    }
  );

  mcp.tool('mcp_build_prompt',
    'Build an MCP server from a natural language description',
    {
      prompt: z.string().describe('Natural language description of the MCP server'),
    },
    async ({ prompt }: { prompt: string }) => {
      const code = builder.buildFromPrompt(prompt);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ success: true, code }, null, 2)
        }]
      };
    }
  );

  mcp.tool('mcp_memory_estimate',
    'Estimate memory usage for an MCP server template',
    {
      template: z.string().describe('Template ID to estimate'),
    },
    async ({ template }: { template: string }) => {
      const memKB = builder.getMemoryEstimate(template);
      const totalKB = builder.getTotalMemoryEstimate();
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            template,
            memoryKB: memKB,
            totalTemplatesKB: totalKB,
            recommendation: memKB < 16 ? 'Lightweight — suitable for low-resource environments' :
                           memKB < 64 ? 'Moderate — standard deployment' :
                           'Heavy — consider reducing tools for edge devices',
          }, null, 2)
        }]
      };
    }
  );

  mcp.prompt('mcp_architect',
    'Design an MCP server for a specific use case',
    { useCase: z.string().describe('The use case for the MCP server') },
    ({ useCase }: { useCase: string }) => ({
      messages: [{
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: `Design an MCP server for: ${useCase}. Consider: what tools are needed? What resources should be exposed? Keep it resource-efficient for edge deployment.`
        }
      }]
    })
  );
}

export { register };
