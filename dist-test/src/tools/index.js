import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { isPathInSandbox, WORKSPACE_ROOT, SAFE_ROOTS, DENY_PATTERNS } from '../security/sandbox.js';
const TOOLS = {
    readFile: {
        name: 'readFile',
        description: 'Read a file from the filesystem',
        parameters: { path: { type: 'string', description: 'File path to read' } },
        async execute({ path }) {
            if (!path)
                return { error: 'path is required' };
            const check = isPathInSandbox(path);
            if (!check.safe)
                return { error: `Access denied: ${check.reason}` };
            if (!existsSync(path))
                return { error: `File not found: ${path}` };
            const content = readFileSync(path, 'utf8');
            return { content, path, size: content.length };
        }
    },
    writeFile: {
        name: 'writeFile',
        description: 'Write content to a file',
        parameters: {
            path: { type: 'string', description: 'File path to write' },
            content: { type: 'string', description: 'Content to write' }
        },
        async execute({ path, content }) {
            if (!path)
                return { error: 'path is required' };
            if (!content && content !== '')
                return { error: 'content is required' };
            const check = isPathInSandbox(path);
            if (!check.safe)
                return { error: `Access denied: ${check.reason}` };
            const dir = join(path, '..');
            if (!existsSync(dir))
                mkdirSync(dir, { recursive: true });
            writeFileSync(path, content);
            return { success: true, path, bytesWritten: content.length };
        }
    },
    listDir: {
        name: 'listDir',
        description: 'List files and directories in a path',
        parameters: { path: { type: 'string', description: 'Directory path' } },
        async execute({ path }) {
            if (!path)
                return { error: 'path is required' };
            const check = isPathInSandbox(path);
            if (!check.safe)
                return { error: `Access denied: ${check.reason}` };
            if (!existsSync(path))
                return { error: `Directory not found: ${path}` };
            const entries = readdirSync(path, { withFileTypes: true }).map(e => ({
                name: e.name, type: e.isDirectory() ? 'directory' : 'file',
                path: join(path, e.name)
            }));
            return { entries, count: entries.length };
        }
    },
    searchFiles: {
        name: 'searchFiles',
        description: 'Search for files matching a pattern',
        parameters: {
            path: { type: 'string', description: 'Root directory' },
            pattern: { type: 'string', description: 'Filename pattern (simple string match)' },
            maxResults: { type: 'number', description: 'Max results', default: 20 }
        },
        async execute({ path, pattern, maxResults = 20 }) {
            if (!path)
                return { error: 'path is required' };
            if (!pattern)
                return { error: 'pattern is required' };
            const check = isPathInSandbox(path);
            if (!check.safe)
                return { error: `Access denied: ${check.reason}` };
            if (!existsSync(path))
                return { error: `Directory not found: ${path}` };
            const results = [];
            function walk(dir) {
                if (results.length >= maxResults)
                    return;
                try {
                    for (const entry of readdirSync(dir, { withFileTypes: true })) {
                        if (results.length >= maxResults)
                            return;
                        if (entry.name.startsWith('.') || entry.name === 'node_modules')
                            continue;
                        const fullPath = join(dir, entry.name);
                        if (entry.isDirectory())
                            walk(fullPath);
                        else if (entry.name.toLowerCase().includes(pattern.toLowerCase()))
                            results.push(fullPath);
                    }
                }
                catch { }
            }
            walk(path);
            return { results, count: results.length };
        }
    }
};
function getTool(name) { return TOOLS[name]; }
function listTools() { return Object.values(TOOLS).map(t => ({ name: t.name, description: t.description })); }
async function runTool(name, params) {
    const tool = TOOLS[name];
    if (!tool)
        return { error: `Unknown tool: ${name}` };
    return await tool.execute(params);
}
export { TOOLS, getTool, listTools, runTool, WORKSPACE_ROOT, SAFE_ROOTS, DENY_PATTERNS };
//# sourceMappingURL=index.js.map