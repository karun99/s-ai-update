import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { getGraphDir, hashContent } from '../config.js';

interface GraphNode {
  id: string;
  type: string;
  label: string;
  content?: string;
  timestamp?: string;
  [key: string]: unknown;
}

interface GraphEdge {
  id: string;
  source: string;
  target: string;
  relation: string;
  weight: number;
  createdAt: string;
}

interface GraphData {
  version: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  indexes: { byType: Record<string, string[]>; byLabel: Record<string, string> };
  metadata: { createdAt: string; nodeCount: number; edgeCount: number; updatedAt?: string };
}

interface QueryResult extends GraphNode {
  score: number;
  edges: GraphEdge[];
}

interface GraphStats {
  nodes: number;
  edges: number;
  types: string[];
  version: string;
}

class KnowledgeGraph {
  graphDir: string;
  graphFile: string;
  graph: GraphData;

  constructor(graphDir?: string) {
    this.graphDir = graphDir || getGraphDir();
    this.graphFile = join(this.graphDir, 'graph.json');
    this.graph = this._load();
  }

  _load(): GraphData {
    if (!existsSync(this.graphDir)) mkdirSync(this.graphDir, { recursive: true });
    if (existsSync(this.graphFile)) {
      try { return JSON.parse(readFileSync(this.graphFile, 'utf8')); } catch {}
    }
    return { version: '2.0.0', nodes: [], edges: [], indexes: { byType: {}, byLabel: {} }, metadata: { createdAt: new Date().toISOString(), nodeCount: 0, edgeCount: 0 } };
  }

  _save(): void {
    this.graph.metadata.nodeCount = this.graph.nodes.length;
    this.graph.metadata.edgeCount = this.graph.edges.length;
    this.graph.metadata.updatedAt = new Date().toISOString();
    writeFileSync(this.graphFile, JSON.stringify(this.graph, null, 2));
  }

  addNode(type: string, label: string, data: Record<string, unknown> = {}): string {
    const id = hashContent(`${type}:${label}:${Date.now()}`);
    const existing = this.graph.nodes.find(n => n.type === type && n.label === label);
    if (existing) return existing.id;
    const node: GraphNode = { id, type, label, ...data, createdAt: new Date().toISOString() };
    this.graph.nodes.push(node);
    if (!this.graph.indexes.byType[type]) this.graph.indexes.byType[type] = [];
    this.graph.indexes.byType[type].push(id);
    this.graph.indexes.byLabel[label] = id;
    this._save();
    return id;
  }

  addEdge(sourceId: string, targetId: string, relation: string, weight: number = 1): void {
    const exists = this.graph.edges.some(e => e.source === sourceId && e.target === targetId && e.relation === relation);
    if (exists) return;
    this.graph.edges.push({ id: hashContent(`${sourceId}:${targetId}:${relation}`), source: sourceId, target: targetId, relation, weight, createdAt: new Date().toISOString() });
    this._save();
  }

  getNode(id: string): GraphNode | undefined { return this.graph.nodes.find(n => n.id === id); }
  getEdges(nodeId: string): GraphEdge[] { return this.graph.edges.filter(e => e.source === nodeId || e.target === nodeId); }

  query(question: string): QueryResult[] {
    const tokens = question.toLowerCase().split(/\s+/).filter(t => t.length > 2);
    const scores = new Map<string, number>();
    for (const node of this.graph.nodes) {
      let score = 0;
      const labelTokens = (node.label || '').toLowerCase().split(/\s+/);
      for (const token of tokens) {
        if (labelTokens.some(lt => lt.includes(token))) score += 3;
        if ((node.content || '').toLowerCase().includes(token)) score += 1;
      }
      if (score > 0) scores.set(node.id, score);
    }
    return [...scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([id, score]) => ({ ...this.getNode(id)!, score, edges: this.getEdges(id).slice(0, 5) }));
  }

  addConversation(userMsg: string, aiReply: string): void {
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

  getStats(): GraphStats {
    return { nodes: this.graph.nodes.length, edges: this.graph.edges.length, types: Object.keys(this.graph.indexes.byType), version: this.graph.version };
  }

  getHistory(limit: number = 50): Array<{ role: string; content: string; timestamp?: string }> {
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

let _instance: KnowledgeGraph | null = null;
function getKnowledgeGraph(graphDir?: string): KnowledgeGraph {
  if (!_instance) _instance = new KnowledgeGraph(graphDir);
  return _instance;
}

export { KnowledgeGraph, getKnowledgeGraph };
export type { GraphNode, GraphEdge, GraphData, QueryResult, GraphStats };
