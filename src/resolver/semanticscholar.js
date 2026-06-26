// Semantic Scholar adapter — used as a fallback source and a BibTeX provider.
const API = 'https://api.semanticscholar.org/graph/v1';

/** Convert a Semantic Scholar paper into a normalized candidate. */
export function parseS2Item(r = {}) {
  const authors = (r.authors || []).map((a) => a.name).filter(Boolean);
  const families = authors.map((n) => n.trim().split(/\s+/).pop()).filter(Boolean);
  return {
    title: r.title || '',
    authors,
    authorFamilies: families,
    firstAuthorFamily: families[0] || '',
    year: r.year || null,
    venue: r.venue || r.publicationVenue?.name || null,
    doi: r.externalIds?.DOI || null,
    type: null,
    citedBy: Number(r.citationCount) || 0,
    source: 'semanticscholar',
  };
}

/** Semantic Scholar paper search. */
export async function searchS2(title, { rows = 5, signal } = {}) {
  const url = new URL(`${API}/paper/search`);
  url.searchParams.set('query', title);
  url.searchParams.set('limit', String(rows));
  url.searchParams.set('fields', 'title,authors,year,venue,externalIds,publicationVenue,citationCount');
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Semantic Scholar search failed (${res.status})`);
  const data = await res.json();
  return (data?.data || []).map(parseS2Item);
}

/** Fetch a BibTeX string via Semantic Scholar's citationStyles (by DOI). */
export async function fetchS2BibtexByDoi(doi, { signal } = {}) {
  const clean = String(doi).replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '');
  const url = new URL(`${API}/paper/DOI:${clean}`);
  url.searchParams.set('fields', 'citationStyles');
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Semantic Scholar bib failed (${res.status})`);
  const data = await res.json();
  const b = data?.citationStyles?.bibtex;
  if (!b || !b.trim().startsWith('@')) throw new Error('Semantic Scholar returned no BibTeX');
  return b;
}
