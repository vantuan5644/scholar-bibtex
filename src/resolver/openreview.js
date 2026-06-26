// OpenReview adapter — ICLR/NeurIPS/COLM/workshop papers and many ML preprints,
// often with no Crossref DOI. Uniquely, every paper note carries a ready-made
// `_bibtex` field, so no content-negotiation round-trip is needed.
//
// Caveat (verified live): `/notes/search` returns a mix of papers, reviews, and
// replies and its relevance is weak (token/substring, not ranked). We filter to
// paper notes and rely on the shared title-similarity ranker — junk simply ranks
// low and gets trimmed. parseOpenReviewNote is pure (tested).
import { arxivIdFromPdf } from './arxiv.js';

const API = 'https://api2.openreview.net';

/** Unwrap an OpenReview v2 content value ({value: …} or bare). */
export function orVal(content, key) {
  const v = content?.[key];
  return v && typeof v === 'object' ? v.value : v;
}

function unwrapBibtex(content) {
  const b = content?._bibtex;
  return b && typeof b === 'object' ? b.value : b;
}

/** Is this note a paper (vs a review/reply)? Papers have id===forum and a _bibtex. */
export function isPaperNote(note = {}) {
  if (!note.id || note.id !== note.forum) return false;
  if (!orVal(note.content, 'title')) return false;
  return Boolean(unwrapBibtex(note.content));
}

/** Pull the 4-digit year out of a prebuilt `_bibtex` block. */
export function yearFromBibtex(bibtex) {
  const m = String(bibtex || '').match(/\byear\s*=\s*[\{"]?(\d{4})/i);
  return m ? Number(m[1]) : null;
}

/**
 * Convert an OpenReview note into a normalized candidate.
 * When the note's pdf links to arXiv, cross-link via the DataCite DOI so this
 * candidate dedupes with the arXiv/Crossref sources in mergeAndRank.
 */
export function parseOpenReviewNote(note = {}, { includeBib = true } = {}) {
  const c = note.content || {};
  const title = orVal(c, 'title') || '';
  const authors = orVal(c, 'authors') || [];
  const families = authors.map((n) => String(n).trim().split(/\s+/).pop()).filter(Boolean);
  const venue = orVal(c, 'venue') || null;
  const venueid = orVal(c, 'venueid') || null;
  const forum = note.id || note.forum;
  const bibtex = unwrapBibtex(c);
  const pdfArxiv = arxivIdFromPdf(orVal(c, 'pdf'));

  return {
    title,
    authors,
    authorFamilies: families,
    firstAuthorFamily: families[0] || '',
    year: yearFromBibtex(bibtex),
    venue,
    venueid,
    doi: pdfArxiv ? `10.48550/arXiv.${pdfArxiv}` : null,
    arxivId: pdfArxiv || null,
    openreviewForum: forum,
    citedBy: 0,
    type: null,
    source: 'openreview',
    ...(includeBib && bibtex ? { openreviewBibtex: bibtex } : {}),
  };
}

/** OpenReview note search, filtered to papers. Retries once on 429. */
export async function searchOpenReview(title, { rows = 5, signal } = {}) {
  const doFetch = () => {
    const url = new URL(`${API}/notes/search`);
    url.searchParams.set('query', title);
    // Over-fetch then filter (reviews/replies outnumber papers); trim after.
    url.searchParams.set('limit', '12');
    return fetch(url, { signal, headers: { Accept: 'application/json' } });
  };
  let res = await doFetch();
  if (res.status === 429) {
    await new Promise((r) => setTimeout(r, 1500));
    res = await doFetch();
  }
  if (!res.ok) throw new Error(`OpenReview search failed (${res.status})`);
  const data = await res.json();
  const papers = (data.notes || []).filter(isPaperNote);
  return papers.slice(0, rows).map((n) => parseOpenReviewNote(n));
}

/** Fetch the paper note (with _bibtex) for an OpenReview forum/note id. */
export async function fetchOpenReviewNoteByForum(forum, { signal } = {}) {
  const url = new URL(`${API}/notes`);
  url.searchParams.set('id', forum);
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`OpenReview forum fetch failed (${res.status})`);
  const data = await res.json();
  const note = (data.notes || [])[0];
  if (!note) throw new Error('OpenReview note not found');
  return parseOpenReviewNote(note);
}
