// Input classification (Step A of the resolver pipeline).
// Pure functions — fully unit-tested, no network, no chrome APIs.

// Crossref-style DOI. \b keeps us off partial matches inside larger tokens.
const DOI_RE = /\b10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+/i;
// Modern arXiv id: YYMM.NNNNN (with optional version), e.g. 1706.03762 or 2407.15516v2.
const ARXIV_NEW_RE = /\b\d{4}\.\d{4,5}(?:v\d+)?\b/;
// Explicit "arXiv: ..." prefix (covers pastes that include the label).
const ARXIV_PREFIX_RE = /arxiv\s*[:=]\s*([A-Za-z0-9./-]+(?:v\d+)?)/i;

/** Strip wrappers/protocol/trailing punctuation from a raw DOI string. */
export function cleanDoi(doi) {
  return String(doi ?? '')
    .trim()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '')
    .replace(/[.,;})\]"']+$/, '')
    .trim();
}

/** Pull the first DOI out of arbitrary text. */
export function extractDoi(text) {
  const m = String(text ?? '').match(DOI_RE);
  return m ? cleanDoi(m[0]) : null;
}

/** Normalize a raw arXiv id (strip label, URL, .pdf, trailing junk). */
export function cleanArxiv(id) {
  return String(id ?? '')
    .trim()
    .replace(/^arxiv\s*[:=]\s*/i, '')
    .replace(/^https?:\/\/(?:www\.)?arxiv\.org\/(?:abs|pdf|ftp\/arxiv\/papers)\/?/i, '')
    .replace(/\.pdf$/i, '')
    .replace(/[},)\]"']+$/, '')
    .trim();
}

/** Pull the first arXiv id out of arbitrary text (prefix-labelled or bare). */
export function extractArxiv(text) {
  const s = String(text ?? '');
  const prefixed = s.match(ARXIV_PREFIX_RE);
  if (prefixed) {
    const id = cleanArxiv(prefixed[1]);
    if (id) return id;
  }
  const bare = s.match(ARXIV_NEW_RE);
  return bare ? cleanArxiv(bare[0]) : null;
}

/** Map an arXiv id to its DataCite DOI (used for exact content-negotiation). */
export function arxivToDoi(id) {
  // DataCite DOIs use the unversioned id (10.48550/arXiv.2407.15516, no v2).
  const base = cleanArxiv(id).replace(/v\d+$/i, '');
  return `10.48550/arXiv.${base}`;
}

/**
 * Classify a user/surface input into one of: empty | doi | arxiv | url | title.
 * Order matters: DOI > arXiv > URL(embedded doi/arxiv) > title search.
 */
export function classifyInput(text) {
  const t = String(text ?? '').trim();
  if (!t) return { type: 'empty' };

  const doi = extractDoi(t);
  if (doi) return { type: 'doi', doi };

  const arxiv = extractArxiv(t);
  if (arxiv) return { type: 'arxiv', arxiv, doi: arxivToDoi(arxiv) };

  if (/^https?:\/\//i.test(t)) {
    try {
      const u = new URL(t);
      // OpenReview forum/pdf URLs → exact path via the note id.
      if (/^(www\.)?openreview\.net$/i.test(u.hostname)) {
        const fid = u.searchParams.get('id') || u.searchParams.get('forum')
          || u.pathname.match(/^\/forum\/([^/?#]+)/)?.[1];
        if (fid) return { type: 'openreview', forum: fid };
        return { type: 'url', url: t };
      }
      // CVF Open Access paper/PDF URLs → exact path via the page's BibTeX block.
      const isCvf = /^openaccess\.thecvf\.com$/i.test(u.hostname)
        || (/^(?:www\.)?cv-foundation\.org$/i.test(u.hostname) && /^\/openaccess\//i.test(u.pathname));
      if (isCvf) return { type: 'thecvf', url: t };
      const hay = `${u.pathname} ${u.search} ${u.hash}`;
      const uDoi = extractDoi(hay);
      if (uDoi) return { type: 'doi', doi: uDoi };
      const uArxiv = extractArxiv(hay);
      if (uArxiv) return { type: 'arxiv', arxiv: uArxiv, doi: arxivToDoi(uArxiv) };
      return { type: 'url', url: t };
    } catch {
      return { type: 'url', url: t };
    }
  }

  return { type: 'title', title: t };
}
