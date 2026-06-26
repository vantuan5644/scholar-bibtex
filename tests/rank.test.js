import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeTitle,
  asciiFold,
} from '../src/resolver/text.js';
import {
  similarity,
  tokenJaccard,
  levenshtein,
  mergeAndRank,
} from '../src/resolver/rank.js';

test('normalizeTitle folds diacritics, punctuation, case', () => {
  assert.equal(normalizeTitle('Café—Résumé!'), 'cafe resume');
  assert.equal(normalizeTitle('A B  C'), 'a b c');
  assert.equal(asciiFold('Žluťoučký'), 'Zlutoucky');
});

test('similarity is 1.0 for normalized-equal titles', () => {
  assert.equal(similarity('Attention Is All You Need', 'attention is all you need'), 1);
  assert.equal(similarity('Café-résumé', 'cafe resume'), 1);
});

test('similarity is high for reordered/extra words', () => {
  assert.ok(similarity('Attention Is All You Need', 'Is Attention All You Need') > 0.8);
});

test('similarity is low for unrelated titles', () => {
  assert.ok(similarity('Attention Is All You Need', 'Graph Neural Networks Survey') < 0.4);
});

test('tokenJaccard and levenshtein basics', () => {
  assert.equal(tokenJaccard('a b c', 'a b c'), 1);
  assert.equal(tokenJaccard('a b c', 'd e f'), 0);
  assert.equal(levenshtein('kitten', 'sitting'), 3);
});

test('mergeAndRank dedupes by DOI and boosts cross-source agreement', () => {
  const query = 'Attention Is All You Need';
  const buckets = [
    {
      source: 'crossref',
      items: [
        { title: 'Attention Is All You Need', authors: ['Vaswani'], year: 2017, doi: '10.48550/arXiv.1706.03762' },
      ],
    },
    {
      source: 'openalex',
      items: [
        { title: 'Attention Is All You Need', authors: ['Vaswani'], year: 2017, doi: '10.48550/arXiv.1706.03762' },
        { title: 'Is Attention All You Need?', authors: ['Mineault'], year: 2025, doi: '10.1007/978-3-031-84300-6_13' },
      ],
    },
  ];
  const ranked = mergeAndRank(query, buckets, { topN: 3 });
  assert.equal(ranked[0].doi, '10.48550/arXiv.1706.03762');
  assert.ok(ranked[0].sources.length === 2);
  assert.ok(ranked[0].score > ranked[1].score);
  // The same paper from two sources is a single deduped record.
  assert.equal(ranked.length, 2);
});

test('mergeAndRank dedupes DOI-less records by normalized title + year', () => {
  const buckets = [
    {
      source: 'dblp',
      items: [{ title: 'Some CS Paper', authors: ['Doe'], year: 2020, dblpKey: 'conf/x/Doe20' }],
    },
    {
      source: 'dblp',
      items: [{ title: 'Some CS Paper', authors: ['Doe'], year: 2020, dblpKey: 'conf/x/Doe20' }],
    },
  ];
  const ranked = mergeAndRank('Some CS Paper', buckets);
  assert.equal(ranked.length, 1);
});

test('citation tiebreak: among near-tied same-title candidates, the more-cited one wins', () => {
  // Two different DOIs, identical title (so identical similarity < 1.0 against a
  // slightly-different query). Only the citation boost should separate them.
  const query = 'survey of graph neural networks';
  const buckets = [
    { source: 'crossref', items: [{ title: 'A Survey of Graph Neural Networks', authors: ['A'], year: 2020, doi: '10.1/low', citedBy: 0 }] },
    { source: 'openalex', items: [{ title: 'A Survey of Graph Neural Networks', authors: ['B'], year: 2020, doi: '10.1/high', citedBy: 5000 }] },
  ];
  const ranked = mergeAndRank(query, buckets);
  assert.equal(ranked[0].doi, '10.1/high');
});

test('citation tiebreak: a low-similarity highly-cited paper never leapfrogs a clear match', () => {
  const query = 'survey of graph neural networks';
  const buckets = [
    { source: 'crossref', items: [{ title: 'A Survey of Graph Neural Networks', authors: ['A'], year: 2020, doi: '10.1/match', citedBy: 0 }] },
    { source: 'openalex', items: [{ title: 'Quantum Computing Breakthroughs', authors: ['B'], year: 2024, doi: '10.1/quantum', citedBy: 1000000 }] },
  ];
  const ranked = mergeAndRank(query, buckets);
  assert.equal(ranked[0].doi, '10.1/match');
});
