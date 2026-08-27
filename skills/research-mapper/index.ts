import { z } from 'zod';

const ARXIV_API = 'http://export.arxiv.org/api/query';

function parseArxivId(url: string): string {
  const m = url.match(/arxiv\.org\/(?:abs|pdf)\/(.+?)(?:v\d+)?(?:\.pdf)?$/);
  return m ? m[1] : url.replace(/^http:/, 'https:');
}

function parseArxivResponse(xml: string): any[] {
  const papers: any[] = [];
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
  let entryMatch;
  while ((entryMatch = entryRegex.exec(xml)) !== null) {
    const entry = entryMatch[1];
    const id = (entry.match(/<id>([^<]+)<\/id>/) || [])[1] || '';
    const arxivId = parseArxivId(id);
    const title = (entry.match(/<title>([^<]+)<\/title>/) || [])[1] || '';
    const summary = (entry.match(/<summary>([\s\S]*?)<\/summary>/) || [])[1] || '';
    const published = (entry.match(/<published>([^<]+)<\/published>/) || [])[1] || '';
    const authors: string[] = [];
    const authorRegex = /<author>[\s\S]*?<name>([^<]+)<\/name>[\s\S]*?<\/author>/g;
    let am;
    while ((am = authorRegex.exec(entry)) !== null) authors.push(am[1].trim());
    const categories: string[] = [];
    const catRegex = /<category[^>]*term="([^"]+)"/g;
    let cm;
    while ((cm = catRegex.exec(entry)) !== null) categories.push(cm[1]);
    const references: string[] = [];
    const refRegex = /<arxiv:reference[^>]*href="([^"]+)"/g;
    let rm;
    while ((rm = refRegex.exec(entry)) !== null) references.push(rm[1]);
    papers.push({
      id: arxivId, arxivId,
      title: title.replace(/\s+/g, ' ').trim(),
      authors,
      abstract: summary.replace(/\s+/g, ' ').trim(),
      categories,
      published,
      year: published.slice(0, 4),
      pdfLink: `https://arxiv.org/pdf/${arxivId}`,
      absLink: `https://arxiv.org/abs/${arxivId}`,
      citationCount: 0,
      references,
      citations: []
    });
  }
  return papers;
}

function buildCitationGraph(papers: any[]): { nodes: any[]; edges: any[] } {
  const idSet = new Set(papers.map(p => p.arxivId));
  const nodes = papers.map(p => ({
    id: p.arxivId,
    label: p.title.slice(0, 60),
    title: p.title,
    arxivId: p.arxivId,
    authors: p.authors.slice(0, 3).join(', '),
    year: p.year,
    categories: p.categories,
    citationCount: p.citationCount,
    abstract: p.abstract.slice(0, 300),
    absLink: p.absLink,
    pdfLink: p.pdfLink,
    size: Math.max(5, Math.min(30, 5 + Math.log2(p.citationCount + 1) * 3))
  }));
  const edges: any[] = [];
  const edgeSet = new Set<string>();
  for (const p of papers) {
    for (const ref of p.references) {
      const refId = parseArxivId(ref);
      if (idSet.has(refId)) {
        const key = `${p.arxivId}|${refId}`;
        if (!edgeSet.has(key)) {
          edgeSet.add(key);
          edges.push({ source: p.arxivId, target: refId, weight: 1 });
        }
      }
    }
  }
  return { nodes, edges };
}

function register(mcp: any): void {
  mcp.tool(
    'search_papers',
    'Search arXiv for research papers by query, category, or author. Returns structured paper data with titles, authors, abstracts, categories, and links.',
    {
      query: z.string().describe('Search query (e.g. "quantum computing", "author:Smith", "cat:cs.AI")'),
      maxResults: z.number().optional().default(25).describe('Maximum number of results (1-50)')
    },
    async ({ query, maxResults }: { query: string; maxResults?: number }) => {
      const limit = Math.min(Math.max(1, maxResults ?? 25), 50);
      const params = new URLSearchParams({
        search_query: query,
        start: '0',
        max_results: String(limit),
        sortBy: 'relevance',
        sortOrder: 'descending'
      });
      try {
        const resp = await fetch(`${ARXIV_API}?${params}`, {
          headers: { 'User-Agent': 'S-AI/5.1 (Research Mapper Skill)' }
        });
        if (!resp.ok) {
          return { content: [{ type: 'text' as const, text: `arXiv API error ${resp.status}: ${await resp.text()}` }] };
        }
        const xml = await resp.text();
        const papers = parseArxivResponse(xml);
        const totalMatch = xml.match(/<opensearch:totalResults[^>]*>(\d+)<\/opensearch:totalResults>/);
        const total = totalMatch ? parseInt(totalMatch[1]) : papers.length;

        const categories = [...new Set(papers.flatMap(p => p.categories))].sort();
        const summary = papers.map((p, i) =>
          `[${i + 1}] ${p.title}\n    Authors: ${p.authors.join(', ')}\n    Categories: ${p.categories.join(', ')}\n    Published: ${p.published.slice(0, 10)}\n    ${p.absLink}`
        ).join('\n\n');

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              totalResults: total,
              returned: papers.length,
              categories,
              papers,
              graph: buildCitationGraph(papers)
            }, null, 2)
          }]
        };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Error searching arXiv: ${err instanceof Error ? err.message : String(err)}` }] };
      }
    }
  );

  mcp.tool(
    'build_graph',
    'Build a citation graph from a list of arXiv paper IDs. Returns nodes and edges for visualization.',
    {
      arxivIds: z.array(z.string()).describe('List of arXiv paper IDs (e.g. ["2301.00001", "2302.00002"])')
    },
    async ({ arxivIds }: { arxivIds: string[] }) => {
      if (!arxivIds.length) {
        return { content: [{ type: 'text' as const, text: 'Error: provide at least one arXiv ID' }] };
      }
      const query = arxivIds.map(id => `id:${id}`).join('+OR+');
      const params = new URLSearchParams({
        search_query: query,
        start: '0',
        max_results: String(Math.min(arxivIds.length, 50)),
        sortBy: 'relevance',
        sortOrder: 'descending'
      });
      try {
        const resp = await fetch(`${ARXIV_API}?${params}`, {
          headers: { 'User-Agent': 'S-AI/5.1 (Research Mapper Skill)' }
        });
        if (!resp.ok) {
          return { content: [{ type: 'text' as const, text: `arXiv API error ${resp.status}` }] };
        }
        const xml = await resp.text();
        const papers = parseArxivResponse(xml);
        const graph = buildCitationGraph(papers);

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              paperCount: papers.length,
              nodeCount: graph.nodes.length,
              edgeCount: graph.edges.length,
              graph
            }, null, 2)
          }]
        };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Error building graph: ${err instanceof Error ? err.message : String(err)}` }] };
      }
    }
  );

  mcp.tool(
    'get_paper',
    'Fetch detailed information about a specific arXiv paper by its ID.',
    {
      arxivId: z.string().describe('arXiv paper ID (e.g. "2301.00001")')
    },
    async ({ arxivId }: { arxivId: string }) => {
      const params = new URLSearchParams({
        search_query: `id:${arxivId}`,
        start: '0',
        max_results: '1',
        sortBy: 'relevance',
        sortOrder: 'descending'
      });
      try {
        const resp = await fetch(`${ARXIV_API}?${params}`, {
          headers: { 'User-Agent': 'S-AI/5.1 (Research Mapper Skill)' }
        });
        if (!resp.ok) {
          return { content: [{ type: 'text' as const, text: `arXiv API error ${resp.status}` }] };
        }
        const xml = await resp.text();
        const papers = parseArxivResponse(xml);
        if (!papers.length) {
          return { content: [{ type: 'text' as const, text: `Paper "${arxivId}" not found on arXiv.` }] };
        }
        const p = papers[0];
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              title: p.title,
              authors: p.authors,
              abstract: p.abstract,
              categories: p.categories,
              published: p.published,
              updated: p.updated,
              arxivId: p.arxivId,
              absLink: p.absLink,
              pdfLink: p.pdfLink,
              references: p.references
            }, null, 2)
          }]
        };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Error fetching paper: ${err instanceof Error ? err.message : String(err)}` }] };
      }
    }
  );

  mcp.tool(
    'list_categories',
    'List popular arXiv research categories with descriptions.',
    {},
    async () => {
      const cats = [
        { code: 'cs.AI', name: 'Artificial Intelligence', desc: 'Machine learning, NLP, knowledge representation' },
        { code: 'cs.CL', name: 'Computation and Language', desc: 'NLP, computational linguistics, text mining' },
        { code: 'cs.CV', name: 'Computer Vision', desc: 'Image recognition, object detection, video analysis' },
        { code: 'cs.LG', name: 'Machine Learning', desc: 'Supervised/unsupervised learning, deep learning' },
        { code: 'cs.RO', name: 'Robotics', desc: 'Robot planning, control, manipulation' },
        { code: 'physics', name: 'Physics', desc: 'All physics sub-disciplines' },
        { code: 'math', name: 'Mathematics', desc: 'Pure and applied mathematics' },
        { code: 'q-bio', name: 'Quantitative Biology', desc: 'Computational biology, bioinformatics' },
        { code: 'stat', name: 'Statistics', desc: 'Statistical theory, methods, and applications' },
        { code: 'astro-ph', name: 'Astrophysics', desc: 'Cosmology, galactic dynamics, stellar physics' },
        { code: 'cond-mat', name: 'Condensed Matter', desc: 'Materials science, superconductivity, quantum phases' },
        { code: 'quant-ph', name: 'Quantum Physics', desc: 'Quantum computing, quantum information, quantum mechanics' },
        { code: 'hep-th', name: 'High Energy Physics - Theory', desc: 'String theory, quantum field theory, gravity' },
        { code: 'gr-qc', name: 'General Relativity', desc: 'Gravitational waves, black holes, cosmology' },
        { code: 'econ', name: 'Economics', desc: 'Economic theory, econometrics, computational economics' }
      ];
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ categories: cats, usage: 'Use cat:CODE in search queries (e.g. "cat:cs.AI AND transformer")' }, null, 2)
        }]
      };
    }
  );

  mcp.prompt(
    'research_topic',
    'Walk through exploring a research topic on arXiv',
    {
      topic: z.string().describe('Research topic to explore').optional()
    },
    ({ topic }: { topic?: string }) => ({
      messages: [{
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: topic
            ? `Search arXiv for recent papers on "${topic}". Show the top results, build a citation graph, and highlight key themes.`
            : 'I want to explore a research area on arXiv. What topic are you interested in? I can search papers, build citation maps, and analyze trends.'
        }
      }]
    })
  );
}

export { register, buildCitationGraph, parseArxivResponse };
