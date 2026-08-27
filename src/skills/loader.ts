import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SKILLS_DIR = join(__dirname, '..', '..', 'skills');

interface SkillManifest {
  name: string;
  version: string;
  description?: string;
  author?: string;
  main?: string;
  tools?: Array<{ name: string; description: string }>;
  prompts?: Array<{ name: string; description: string }>;
  resources?: Array<{ uri: string; name: string; description: string }>;
}

interface LoadedSkill extends SkillManifest {
  path: string;
  entry?: any;
}

class SkillLoader {
  private skills: Map<string, LoadedSkill> = new Map();

  scan(): LoadedSkill[] {
    this.skills.clear();
    if (!existsSync(SKILLS_DIR)) return [];

    const dirs = readdirSync(SKILLS_DIR, { withFileTypes: true }).filter(d => d.isDirectory());
    for (const dir of dirs) {
      const manifestPath = join(SKILLS_DIR, dir.name, 'skill.json');
      if (existsSync(manifestPath)) {
        try {
          const manifest: SkillManifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
          const skill: LoadedSkill = { ...manifest, path: join(SKILLS_DIR, dir.name) };
          this.skills.set(manifest.name, skill);
        } catch (err) {
          console.error(`Failed to load skill ${dir.name}:`, err);
        }
      }
    }
    return Array.from(this.skills.values());
  }

  list(): LoadedSkill[] {
    return Array.from(this.skills.values());
  }

  get(name: string): LoadedSkill | undefined {
    return this.skills.get(name);
  }

  getAllTools(): Array<{ name: string; description: string; skill: string }> {
    const tools: Array<{ name: string; description: string; skill: string }> = [];
    for (const skill of this.skills.values()) {
      if (skill.tools) {
        for (const tool of skill.tools) {
          tools.push({ ...tool, skill: skill.name });
        }
      }
    }
    return tools;
  }

  getAllPrompts(): Array<{ name: string; description: string; skill: string }> {
    const prompts: Array<{ name: string; description: string; skill: string }> = [];
    for (const skill of this.skills.values()) {
      if (skill.prompts) {
        for (const prompt of skill.prompts) {
          prompts.push({ ...prompt, skill: skill.name });
        }
      }
    }
    return prompts;
  }

  getAllResources(): Array<{ uri: string; name: string; description: string; skill: string }> {
    const resources: Array<{ uri: string; name: string; description: string; skill: string }> = [];
    for (const skill of this.skills.values()) {
      if (skill.resources) {
        for (const resource of skill.resources) {
          resources.push({ ...resource, skill: skill.name });
        }
      }
    }
    return resources;
  }
}

let _loader: SkillLoader | null = null;
function getSkillLoader(): SkillLoader {
  if (!_loader) {
    _loader = new SkillLoader();
    _loader.scan();
  }
  return _loader;
}

export { SkillLoader, getSkillLoader };
export type { SkillManifest, LoadedSkill };
