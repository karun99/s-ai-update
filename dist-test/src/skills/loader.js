import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SKILLS_DIR = join(__dirname, '..', '..', 'skills');
class SkillLoader {
    skills = new Map();
    scan() {
        this.skills.clear();
        if (!existsSync(SKILLS_DIR))
            return [];
        const dirs = readdirSync(SKILLS_DIR, { withFileTypes: true }).filter(d => d.isDirectory());
        for (const dir of dirs) {
            const manifestPath = join(SKILLS_DIR, dir.name, 'skill.json');
            if (existsSync(manifestPath)) {
                try {
                    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
                    const skill = { ...manifest, path: join(SKILLS_DIR, dir.name) };
                    this.skills.set(manifest.name, skill);
                }
                catch (err) {
                    console.error(`Failed to load skill ${dir.name}:`, err);
                }
            }
        }
        return Array.from(this.skills.values());
    }
    list() {
        return Array.from(this.skills.values());
    }
    get(name) {
        return this.skills.get(name);
    }
    getAllTools() {
        const tools = [];
        for (const skill of this.skills.values()) {
            if (skill.tools) {
                for (const tool of skill.tools) {
                    tools.push({ ...tool, skill: skill.name });
                }
            }
        }
        return tools;
    }
    getAllPrompts() {
        const prompts = [];
        for (const skill of this.skills.values()) {
            if (skill.prompts) {
                for (const prompt of skill.prompts) {
                    prompts.push({ ...prompt, skill: skill.name });
                }
            }
        }
        return prompts;
    }
    getAllResources() {
        const resources = [];
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
let _loader = null;
function getSkillLoader() {
    if (!_loader) {
        _loader = new SkillLoader();
        _loader.scan();
    }
    return _loader;
}
export { SkillLoader, getSkillLoader };
//# sourceMappingURL=loader.js.map