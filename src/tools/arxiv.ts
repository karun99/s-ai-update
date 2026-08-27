interface ArxivPaper {
  id: string;
  arxivId: string;
  title: string;
  authors: string[];
  abstract: string;
  categories: string[];
  published: string;
  updated: string;
  doi?: string;
  pdfLink: string;
  absLink: string;
  citationCount: number;
  references: string[];
  citations: string[];
}

interface ArxivSearchResult {
  papers: ArxivPaper[];
  totalResults: number;
  startIndex: number;
  itemsPerPage: number;
}

function parseArxivId(url: string): string {
  const m = url.match(/arxiv\.org\/(?:abs|pdf)\/(.+?)(?:v\d+)?(?:\.pdf)?$/);
  return m ? m[1] : url.replace(/^http:/, 'https:');
}

function parseArxivResponse(xml: string): ArxivPaper[] {
  const papers: ArxivPaper[] = [];
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
  let entryMatch;
  while ((entryMatch = entryRegex.exec(xml)) !== null) {
    const entry = entryMatch[1];
    const id = (entry.match(/<id>([^<]+)<\/id>/) || [])[1] || '';
    const arxivId = parseArxivId(id);
    const title = (entry.match(/<title>([^<]+)<\/title>/) || [])[1] || '';
    const summary = (entry.match(/<summary>([^<]+)<\/summary>/) || [])[1] || '';
    const published = (entry.match(/<published>([^<]+)<\/published>/) || [])[1] || '';
    const updated = (entry.match(/<updated>([^<]+)<\/updated>/) || [])[1] || '';
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

    const doiMatch = entry.match(/<arxiv:doi>([^<]+)<\/arxiv:doi>/);
    const doi = doiMatch ? doiMatch[1] : undefined;

    papers.push({
      id: arxivId,
      arxivId,
      title: title.replace(/\s+/g, ' ').trim(),
      authors,
      abstract: summary.replace(/\s+/g, ' ').trim(),
      categories,
      published,
      updated,
      doi,
      pdfLink: `https://arxiv.org/pdf/${arxivId}`,
      absLink: `https://arxiv.org/abs/${arxivId}`,
      citationCount: 0,
      references,
      citations: []
    });
  }
  return papers;
}

async function searchArxiv(query: string, start: number = 0, maxResults: number = 25): Promise<ArxivSearchResult> {
  const params = new URLSearchParams({
    search_query: query,
    start: String(start),
    max_results: String(maxResults),
    sortBy: 'relevance',
    sortOrder: 'descending'
  });
  const resp = await fetch(`http://export.arxiv.org/api/query?${params}`, {
    headers: { 'User-Agent': 'S-AI/5.0 (Research Mapper)' }
  });
  if (!resp.ok) throw new Error(`arXiv API ${resp.status}: ${await resp.text()}`);
  const xml = await resp.text();
  const papers = parseArxivResponse(xml);
  const totalMatch = xml.match(/<opensearch:totalResults[^>]*>(\d+)<\/opensearch:totalResults>/);
  const startMatch = xml.match(/<opensearch:startIndex[^>]*>(\d+)<\/opensearch:startIndex>/);
  const perPageMatch = xml.match(/<opensearch:itemsPerPage[^>]*>(\d+)<\/opensearch:itemsPerPage>/);
  return {
    papers,
    totalResults: totalMatch ? parseInt(totalMatch[1]) : papers.length,
    startIndex: startMatch ? parseInt(startMatch[1]) : start,
    itemsPerPage: perPageMatch ? parseInt(perPageMatch[1]) : maxResults
  };
}

async function fetchPaperDetails(arxivId: string): Promise<ArxivPaper | null> {
  try {
    const result = await searchArxiv(`id:${arxivId}`, 0, 1);
    return result.papers[0] || null;
  } catch { return null; }
}

async function fetchPaperDetailsBulk(arxivIds: string[]): Promise<ArxivPaper[]> {
  if (arxivIds.length === 0) return [];
  const query = arxivIds.map(id => `id:${id}`).join('+OR+');
  try {
    const result = await searchArxiv(query, 0, Math.min(arxivIds.length, 50));
    return result.papers;
  } catch { return []; }
}

function buildCitationGraph(papers: ArxivPaper[]): { nodes: any[]; edges: any[] } {
  const idSet = new Set(papers.map(p => p.arxivId));
  const nodes = papers.map(p => ({
    id: p.arxivId,
    label: p.title.slice(0, 60),
    title: p.title,
    arxivId: p.arxivId,
    authors: p.authors.slice(0, 3).join(', '),
    year: p.published.slice(0, 4),
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

export { searchArxiv, fetchPaperDetails, fetchPaperDetailsBulk, buildCitationGraph, parseArxivId };
export type { ArxivPaper, ArxivSearchResult };
