import { getKnowledgeGraph } from './graph.js';

function queryGraph(query: string, graphDir?: string) {
  const graph = getKnowledgeGraph(graphDir);
  return graph.query(query);
}

function storeInGraph(type: string, label: string, data: Record<string, unknown>, graphDir?: string): string {
  const graph = getKnowledgeGraph(graphDir);
  return graph.addNode(type, label, data);
}

export { queryGraph, storeInGraph };
