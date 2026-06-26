// Step D — rank & merge. Pure functions, unit-tested.
import { normalizeTitle } from './text.js';
import { cleanDoi } from './classify.js';

/** Tokenize a normalized string into a Set of lowercase word tokens. */
export function tokenize(s) {
  return new Set(normalizeTitle(s).split(' ').filter(Boolean));
}

/** Token-set Jaccard similarity in [0,1]. */
export function tokenJaccard(a, b) {
  const A = tokenize(a);
  const B = tokenize(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  const union = A.size + B.size - inter;
  return union ? inter / union : 0;
}

/** Classic iterative Levenshtein edit distance. */
export function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

/**
 * Title similarity in [0,1]. Normalized-exact = 1.0; otherwise a 50/50 blend
 * of token-Jaccard (robust to reordering / extra words) and a normalized
 * Levenshtein ratio (robust to small typos, sensitive to word order). Blending
 * avoids ties where two papers share the same word set in a different order.
 */
export function similarity(a, b) {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const j = tokenJaccard(na, nb);
  const lev = 1 - levenshtein(na, nb) / Math.max(na.length, nb.length);
  return 0.5 * j + 0.5 * lev;
}

const doiKey = (d) => (d ? cleanDoi(d).toLowerCase() : '');

/**
 * Merge per-source result lists into a deduped, ranked candidate list.
 *
 * @param {string} query - original title/query to score against
 * @param {{source: string, items: object[]}[]} sourceBuckets
 * @param {object} [opts]
 * @param {number} [opts.topN=3]
 * @returns {object[]} ranked candidates, best first (each has `.score`, `.sources`)
 */
export function mergeAndRank(query, sourceBuckets, { topN = 3 } = {}) {
  const byKey = new Map();

  for (const { source, items } of sourceBuckets) {
    if (!Array.isArray(items)) continue;
    for (const it of items) {
      if (!it || !normalizeTitle(it.title)) continue;
      const key = doiKey(it.doi) || `${normalizeTitle(it.title)}|${it.year || ''}`;
      let rec = byKey.get(key);
      if (!rec) {
        rec = { ...it, sources: [] };
        byKey.set(key, rec);
      }
      if (!rec.sources.includes(source)) rec.sources.push(source);
      // Backfill any missing fields from agreeing sources.
      for (const f of ['doi', 'year', 'venue', 'type', 'dblpKey']) {
        if (!rec[f] && it[f]) rec[f] = it[f];
      }
      // For citation counts, keep the max across agreeing sources (different
      // sources report different tallies for the same DOI).
      if ((Number(it.citedBy) || 0) > (Number(rec.citedBy) || 0)) rec.citedBy = it.citedBy;
      if ((!rec.authors || !rec.authors.length) && it.authors?.length) rec.authors = it.authors;
      if (!rec.firstAuthorFamily && it.firstAuthorFamily) rec.firstAuthorFamily = it.firstAuthorFamily;
      if (!rec.authorFamilies && it.authorFamilies) rec.authorFamilies = it.authorFamilies;
    }
  }

  const ranked = [...byKey.values()].map((rec) => {
    const base = similarity(query, rec.title);
    // Small boost when ≥2 independent sources agree — but never enough to push
    // a wrong paper above a near-perfect single match.
    const agreement = Math.min(0.12, (rec.sources.length - 1) * 0.06);
    return { ...rec, score: Math.min(1, base + agreement) };
  });

  // Citation tiebreak: among near-tied candidates, favor the more-cited work.
  // Capped at +0.03 so it only re-orders true ties (same/duplicate title) and can
  // never lift a similarity-loser above a clear winner. Sources without citation
  // counts (arXiv, OpenReview) contribute 0 and are unaffected.
  const maxCited = ranked.reduce((mx, r) => Math.max(mx, Number(r.citedBy) || 0), 0);
  if (maxCited > 0) {
    const denom = Math.log2(1 + maxCited);
    for (const r of ranked) {
      const c = Number(r.citedBy) || 0;
      if (c > 0) r.score = Math.min(1, r.score + (0.03 * Math.log2(1 + c)) / denom);
    }
  }

  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.sources.length !== a.sources.length) return b.sources.length - a.sources.length;
    return (b.year || 0) - (a.year || 0);
  });

  return ranked.slice(0, topN);
}
