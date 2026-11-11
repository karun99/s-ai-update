import { z } from 'zod';
const REGISTRY = new Map();
const ZOD_SCHEMAS = new Map();
function registerTool(meta) {
    REGISTRY.set(meta.name, meta);
    ZOD_SCHEMAS.set(meta.name, buildZodSchema(meta.params));
}
function buildZodSchema(params) {
    const shape = {};
    for (const [key, def] of Object.entries(params)) {
        let field;
        switch (def.type) {
            case 'string':
                field = z.string();
                break;
            case 'number':
                field = z.number();
                break;
            case 'boolean':
                field = z.boolean();
                break;
            case 'object':
                field = z.record(z.string(), z.unknown());
                break;
            case 'array':
                field = z.array(z.unknown());
                break;
            default: field = z.unknown();
        }
        if (def.enum)
            field = z.enum(def.enum);
        shape[key] = def.required ? field : field.optional();
    }
    return z.object(shape);
}
export function getToolMeta(name) {
    return REGISTRY.get(name);
}
export function getToolSchema(name) {
    return ZOD_SCHEMAS.get(name);
}
export function validateToolParams(name, params) {
    const schema = ZOD_SCHEMAS.get(name);
    if (!schema)
        return { valid: false, error: `Unknown tool: ${name}` };
    try {
        schema.parse(params);
        return { valid: true };
    }
    catch (err) {
        return { valid: false, error: err.message };
    }
}
export function listToolMeta() {
    return [...REGISTRY.values()];
}
export function getToolsByRisk(level) {
    return [...REGISTRY.values()].filter(t => t.riskLevel === level);
}
export function getToolsByCategory(cat) {
    return [...REGISTRY.values()].filter(t => t.category === cat);
}
export function getRiskForTool(name) {
    return REGISTRY.get(name)?.riskLevel ?? 'high';
}
registerTool({
    name: 'readFile',
    description: 'Read a file from the filesystem',
    riskLevel: 'low',
    category: 'filesystem',
    reversible: false,
    requiresApproval: false,
    params: { path: { type: 'string', description: 'File path to read', required: true } }
});
registerTool({
    name: 'writeFile',
    description: 'Write content to a file',
    riskLevel: 'medium',
    category: 'filesystem',
    reversible: true,
    requiresApproval: true,
    params: {
        path: { type: 'string', description: 'File path to write', required: true },
        content: { type: 'string', description: 'Content to write', required: true }
    }
});
registerTool({
    name: 'listDir',
    description: 'List files and directories in a path',
    riskLevel: 'low',
    category: 'filesystem',
    reversible: false,
    requiresApproval: false,
    params: { path: { type: 'string', description: 'Directory path', required: true } }
});
registerTool({
    name: 'searchFiles',
    description: 'Search for files matching a pattern',
    riskLevel: 'low',
    category: 'filesystem',
    reversible: false,
    requiresApproval: false,
    params: {
        path: { type: 'string', description: 'Root directory', required: true },
        pattern: { type: 'string', description: 'Filename pattern', required: true },
        maxResults: { type: 'number', description: 'Max results', default: 20 }
    }
});
registerTool({
    name: 'execShell',
    description: 'Execute a shell command',
    riskLevel: 'high',
    category: 'execution',
    reversible: false,
    requiresApproval: true,
    params: {
        command: { type: 'string', description: 'Shell command to execute', required: true },
        cwd: { type: 'string', description: 'Working directory' },
        timeout: { type: 'number', description: 'Timeout in ms', default: 30000 }
    }
});
registerTool({
    name: 'httpRequest',
    description: 'Make an HTTP request (GET, POST, PUT, DELETE, PATCH)',
    riskLevel: 'medium',
    category: 'network',
    reversible: false,
    requiresApproval: true,
    params: {
        url: { type: 'string', description: 'Target URL', required: true },
        method: { type: 'string', description: 'HTTP method', default: 'GET', enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] },
        headers: { type: 'object', description: 'Request headers' },
        body: { type: 'string', description: 'Request body (JSON string)' },
        timeout: { type: 'number', description: 'Timeout in ms', default: 15000 }
    }
});
registerTool({
    name: 'sendEmail',
    description: 'Send an email via SMTP or configured provider',
    riskLevel: 'high',
    category: 'communication',
    reversible: false,
    requiresApproval: true,
    params: {
        to: { type: 'string', description: 'Recipient email address', required: true },
        subject: { type: 'string', description: 'Email subject', required: true },
        body: { type: 'string', description: 'Email body (plain text or HTML)', required: true },
        cc: { type: 'string', description: 'CC addresses (comma-separated)' },
        bcc: { type: 'string', description: 'BCC addresses (comma-separated)' }
    }
});
registerTool({
    name: 'calendarEvent',
    description: 'Create or update a calendar event',
    riskLevel: 'medium',
    category: 'calendar',
    reversible: true,
    requiresApproval: true,
    rateLimit: 10,
    params: {
        title: { type: 'string', description: 'Event title', required: true },
        start: { type: 'string', description: 'Start time (ISO 8601)', required: true },
        end: { type: 'string', description: 'End time (ISO 8601)' },
        description: { type: 'string', description: 'Event description' },
        location: { type: 'string', description: 'Event location' }
    }
});
registerTool({
    name: 'notify',
    description: 'Send a desktop or webhook notification',
    riskLevel: 'low',
    category: 'notification',
    reversible: false,
    requiresApproval: false,
    rateLimit: 30,
    params: {
        title: { type: 'string', description: 'Notification title', required: true },
        message: { type: 'string', description: 'Notification message', required: true },
        webhook: { type: 'string', description: 'Webhook URL (optional, sends via system notification if omitted)' },
        urgency: { type: 'string', description: 'Urgency level', default: 'normal', enum: ['low', 'normal', 'high', 'critical'] }
    }
});
registerTool({
    name: 'crawlWeb',
    description: 'Crawl web pages and extract content',
    riskLevel: 'low',
    category: 'research',
    reversible: false,
    requiresApproval: false,
    params: {
        urls: { type: 'array', description: 'URLs to crawl', required: true },
        query: { type: 'string', description: 'Search query instead of URLs' }
    }
});
registerTool({
    name: 'searchArxiv',
    description: 'Search arXiv papers and build citation graph',
    riskLevel: 'low',
    category: 'research',
    reversible: false,
    requiresApproval: false,
    params: {
        query: { type: 'string', description: 'Search query', required: true },
        maxResults: { type: 'number', description: 'Max results', default: 10 }
    }
});
registerTool({
    name: 'swarmQuery',
    description: 'Query the multi-agent swarm for analysis',
    riskLevel: 'low',
    category: 'data',
    reversible: false,
    requiresApproval: false,
    params: {
        question: { type: 'string', description: 'Question to ask the swarm', required: true },
        maxRounds: { type: 'number', description: 'Max reasoning rounds', default: 2 }
    }
});
registerTool({
    name: 'graphStore',
    description: 'Store information in the knowledge graph',
    riskLevel: 'low',
    category: 'data',
    reversible: true,
    requiresApproval: false,
    params: {
        type: { type: 'string', description: 'Node type', required: true },
        label: { type: 'string', description: 'Node label', required: true },
        content: { type: 'string', description: 'Node content' }
    }
});
registerTool({
    name: 'graphQuery',
    description: 'Query the knowledge graph',
    riskLevel: 'low',
    category: 'data',
    reversible: false,
    requiresApproval: false,
    params: {
        query: { type: 'string', description: 'Search query', required: true }
    }
});
registerTool({
    name: 'webhook',
    description: 'Send data to an external webhook endpoint',
    riskLevel: 'medium',
    category: 'network',
    reversible: false,
    requiresApproval: true,
    params: {
        url: { type: 'string', description: 'Webhook URL', required: true },
        payload: { type: 'object', description: 'JSON payload to send', required: true },
        method: { type: 'string', description: 'HTTP method', default: 'POST', enum: ['POST', 'PUT'] },
        headers: { type: 'object', description: 'Custom headers' }
    }
});
//# sourceMappingURL=registry.js.map