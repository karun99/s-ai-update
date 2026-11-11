import { getKnowledgeGraph } from './graph.js';
function queryGraph(query, graphDir) {
    const graph = getKnowledgeGraph(graphDir);
    return graph.query(query);
}
function storeInGraph(type, label, data, graphDir) {
    const graph = getKnowledgeGraph(graphDir);
    return graph.addNode(type, label, data);
}
export { queryGraph, storeInGraph };
//# sourceMappingURL=graphify.js.map