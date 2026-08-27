import { z } from 'zod';
import { getSkillCreator } from './creator.js';

let _registered = false;

function register(mcp: any, _skill: any): void {
  if (_registered) return;
  _registered = true;

  const creator = getSkillCreator();

  mcp.tool('skill_list_templates',
    'List available skill templates (api-wrapper, data-pipeline, chat-agent, code-assistant, notification-hub)',
    {},
    async () => {
      const templates = creator.getTemplates();
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

  mcp.tool('skill_create',
    'Create a new skill from a template with full customization',
    {
      template: z.string().describe('Template ID (api-wrapper, data-pipeline, chat-agent, code-assistant, notification-hub) or a natural language prompt'),
      name: z.string().optional().describe('Custom skill name'),
      description: z.string().optional().describe('Custom description'),
      addTools: z.array(z.object({
        name: z.string(),
        description: z.string(),
      })).optional().describe('Additional tools to include'),
      removeTools: z.array(z.string()).optional().describe('Tool names to exclude from template'),
      dependencies: z.array(z.string()).optional().describe('NPM dependencies needed'),
      save: z.boolean().optional().default(false).describe('Save the skill to disk'),
    },
    async ({ template, name, description, addTools, removeTools, dependencies, save }: {
      template: string;
      name?: string;
      description?: string;
      addTools?: Array<{ name: string; description: string }>;
      removeTools?: string[];
      dependencies?: string[];
      save?: boolean;
    }) => {
      const isTemplate = creator.getTemplate(template);
      let result: { skillJson: string; indexCode: string };

      if (isTemplate) {
        result = creator.buildFromTemplate(template, {
          name,
          description,
          addTools: addTools?.map(t => ({
            name: t.name,
            description: t.description,
            inputSchema: { input: { type: 'string', description: 'Input' } },
            handler: 'async ({ input }) => ({ content: [{ type: "text", text: JSON.stringify({ tool: "' + t.name + '", input }) }] })',
          })),
          removeTools,
          dependencies,
        });
      } else {
        result = creator.buildMinimal(name || 'custom-skill', (addTools || []).map(t => ({
          name: t.name,
          description: t.description,
          handler: 'async ({ input }) => ({ content: [{ type: "text", text: JSON.stringify({ tool: "' + t.name + '", input }) }] })',
        })));
      }

      let savedPath: string | null = null;
      if (save) {
        const skillId = name?.toLowerCase().replace(/\s+/g, '-') || (isTemplate ? template : 'custom-skill');
        savedPath = creator.saveSkill(skillId, result.skillJson, result.indexCode);
      }

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            success: true,
            template: isTemplate ? template : 'custom',
            name: name || template,
            skillJson: JSON.parse(result.skillJson),
            codePreview: result.indexCode.substring(0, 500) + '...',
            codeFull: result.indexCode,
            savedTo: savedPath,
          }, null, 2)
        }]
      };
    }
  );

  mcp.tool('skill_create_prompt',
    'Create a skill from a natural language description',
    {
      prompt: z.string().describe('Natural language description of the skill'),
      save: z.boolean().optional().default(false).describe('Save the skill to disk'),
    },
    async ({ prompt, save }: { prompt: string; save?: boolean }) => {
      const result = creator.buildFromPrompt(prompt);
      let savedPath: string | null = null;

      if (save) {
        const skillJson = JSON.parse(result.skillJson);
        savedPath = creator.saveSkill(skillJson.name, result.skillJson, result.indexCode);
      }

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            success: true,
            skillJson: JSON.parse(result.skillJson),
            codeFull: result.indexCode,
            savedTo: savedPath,
          }, null, 2)
        }]
      };
    }
  );

  mcp.tool('skill_list_installed',
    'List all installed skills',
    {},
    async () => {
      const installed = creator.listInstalled();
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ installed, count: installed.length }, null, 2)
        }]
      };
    }
  );

  mcp.tool('skill_memory_estimate',
    'Estimate memory usage for a skill template',
    {
      template: z.string().describe('Template ID to estimate'),
    },
    async ({ template }: { template: string }) => {
      const memKB = creator.getMemoryEstimate(template);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            template,
            memoryKB: memKB,
            recommendation: memKB < 8 ? 'Ultra-lightweight — ideal for mobile/edge' :
                           memKB < 16 ? 'Lightweight — suitable for low-resource environments' :
                           memKB < 64 ? 'Moderate — standard deployment' :
                           'Heavy — consider reducing tools for constrained devices',
          }, null, 2)
        }]
      };
    }
  );

  mcp.tool('skill_categories',
    'List all skill categories',
    {},
    async () => {
      const categories = creator.getCategories();
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ categories }, null, 2)
        }]
      };
    }
  );

  mcp.prompt('skill_architect',
    'Design a custom skill for a specific use case',
    { useCase: z.string().describe('The use case for the skill') },
    ({ useCase }: { useCase: string }) => ({
      messages: [{
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: `Design a custom skill for: ${useCase}. What tools should it expose? What resources? Keep it lightweight and composable.`
        }
      }]
    })
  );
}

export { register };
