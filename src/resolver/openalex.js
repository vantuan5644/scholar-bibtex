// OpenAlex adapter. parseOpenAlexItem is pure (tested); searchOpenAlex hits network.
const API = 'https://api.openalex.org/works';

/** Convert an OpenAlex `works` result into a normalized candidate. */
export function parseOpenAlexItem(r = {}) {
  const auth = (r.authorships || []).map((a) => ({
    display: a.author?.display_name || a.raw_author_name || '',
    raw: a.raw_author_name || a.author?.display_name || '',
  }));
  const families = auth
    .map((a) => a.raw.trim().split(/[\s,]+/).pop())
    .filter(Boolean);
  return {
    title: r.title || r.display_name || '',
    authors: auth.map((a) => a.display).filter(Boolean),
    authorFamilies: families,
    firstAuthorFamily: families[0] || '',
    year: r.publication_year || null,
    venue: r.primary_location?.source?.display_name || null,
    doi: r.doi
      ? String(r.doi).replace(/^https?:\/\/doi\.org\//i, '')
      : r.ids?.doi || null,
    type: r.type_crossref || r.type || null,
    citedBy: Number(r.cited_by_count) || 0,
    source: 'openalex',
  };
}

/** Full-text `search`; highly relevant for well-known titles. */
export async function searchOpenAlex(title, { rows = 5, signal, mailto } = {}) {
  const url = new URL(API);
  url.searchParams.set('search', title);
  url.searchParams.set('per-page', String(rows));
  url.searchParams.set(
    'select',
    'id,doi,title,authorships,publication_year,primary_location,type,type_crossref,ids,cited_by_count',
  );
  if (mailto) url.searchParams.set('mailto', mailto);
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`OpenAlex search failed (${res.status})`);
  const data = await res.json();
  return (data?.results || []).map(parseOpenAlexItem);
}
