import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { getGraphDir, hashContent } from '../config.js';
class KnowledgeGraph {
    graphDir;
    graphFile;
    graph;
    constructor(graphDir) {
        this.graphDir = graphDir || getGraphDir();
        this.graphFile = join(this.graphDir, 'graph.json');
        this.graph = this._load();
    }
    _load() {
        if (!existsSync(this.graphDir))
            mkdirSync(this.graphDir, { recursive: true });
        if (existsSync(this.graphFile)) {
            try {
                return JSON.parse(readFileSync(this.graphFile, 'utf8'));
            }
            catch { }
        }
        return { version: '2.0.0', nodes: [], edges: [], indexes: { byType: {}, byLabel: {} }, metadata: { createdAt: new Date().toISOString(), nodeCount: 0, edgeCount: 0 } };
    }
    _save() {
        this.graph.metadata.nodeCount = this.graph.nodes.length;
        this.graph.metadata.edgeCount = this.graph.edges.length;
        this.graph.metadata.updatedAt = new Date().toISOString();
        writeFileSync(this.graphFile, JSON.stringify(this.graph, null, 2));
    }
    addNode(type, label, data = {}) {
        const id = hashContent(`${type}:${label}:${Date.now()}`);
        const existing = this.graph.nodes.find(n => n.type === type && n.label === label);
        if (existing)
            return existing.id;
        const node = { id, type, label, ...data, createdAt: new Date().toISOString() };
        this.graph.nodes.push(node);
        if (!this.graph.indexes.byType[type])
            this.graph.indexes.byType[type] = [];
        this.graph.indexes.byType[type].push(id);
        this.graph.indexes.byLabel[label] = id;
        this._save();
        return id;
    }
    addEdge(sourceId, targetId, relation, weight = 1) {
        const exists = this.graph.edges.some(e => e.source === sourceId && e.target === targetId && e.relation === relation);
        if (exists)
            return;
        this.graph.edges.push({ id: hashContent(`${sourceId}:${targetId}:${relation}`), source: sourceId, target: targetId, relation, weight, createdAt: new Date().toISOString() });
        this._save();
    }
    getNode(id) { return this.graph.nodes.find(n => n.id === id); }
    getEdges(nodeId) { return this.graph.edges.filter(e => e.source === nodeId || e.target === nodeId); }
    query(question) {
        const tokens = question.toLowerCase().split(/\s+/).filter(t => t.length > 2);
        const scores = new Map();
        for (const node of this.graph.nodes) {
            let score = 0;
            const labelTokens = (node.label || '').toLowerCase().split(/\s+/);
            for (const token of tokens) {
                if (labelTokens.some(lt => lt.includes(token)))
                    score += 3;
                if ((node.content || '').toLowerCase().includes(token))
                    score += 1;
            }
            if (score > 0)
                scores.set(node.id, score);
        }
        return [...scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([id, score]) => ({ ...this.getNode(id), score, edges: this.getEdges(id).slice(0, 5) }));
    }
    addConversation(userMsg, aiReply) {
        const ts = new Date().toISOString();
        const userId = this.addNode('user_message', userMsg.slice(0, 100), { content: userMsg, timestamp: ts });
        const aiId = this.addNode('ai_reply', aiReply.slice(0, 100), { content: aiReply, timestamp: ts });
        this.addEdge(userId, aiId, 'replied_to');
        const keywords = userMsg.toLowerCase().split(/\s+/).filter(w => w.length > 4).slice(0, 5);
        for (const kw of keywords) {
            const kwId = this.addNode('keyword', kw);
            this.addEdge(userId, kwId, 'contains_keyword');
            this.addEdge(aiId, kwId, 'about_keyword');
        }
    }
    getStats() {
        return { nodes: this.graph.nodes.length, edges: this.graph.edges.length, types: Object.keys(this.graph.indexes.byType), version: this.graph.version };
    }
    getHistory(limit = 50) {
        const conversations = this.graph.nodes.filter(n => n.type === 'user_message' || n.type === 'ai_reply');
        conversations.sort((a, b) => {
            const aTime = a.timestamp ? new Date(a.timestamp).getTime() : 0;
            const bTime = b.timestamp ? new Date(b.timestamp).getTime() : 0;
            return bTime - aTime;
        });
        return conversations.slice(0, limit).map(n => ({
            role: n.type === 'user_message' ? 'user' : 'assistant',
            content: n.content || n.label,
            timestamp: n.timestamp
        }));
    }
}
let _instance = null;
function getKnowledgeGraph(graphDir) {
    if (!_instance)
        _instance = new KnowledgeGraph(graphDir);
    return _instance;
}
export { KnowledgeGraph, getKnowledgeGraph };
//# sourceMappingURL=graph.js.map