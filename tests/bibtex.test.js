import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCiteKey, rewriteCiteKey, constructBibtex, inferEntryType, parseBibtexMeta, getField } from '../src/resolver/bibtex.js';

test('makeCiteKey produces author+year+word', () => {
  assert.equal(
    makeCiteKey({ firstAuthorFamily: 'Vaswani', year: 2017, title: 'Attention Is All You Need' }),
    'vaswani2017attention',
  );
  assert.equal(makeCiteKey({ authors: ['Jane Doe'], year: 2020, title: 'On Things' }), 'doe2020things');
});

test('makeCiteKey ascii-folds and handles missing fields', () => {
  assert.equal(makeCiteKey({ firstAuthorFamily: 'Müller', year: 2019, title: 'Über' }), 'muller2019uber');
  assert.equal(makeCiteKey({ title: 'Nothing' }), 'anonndnothing');
});

test('rewriteCiteKey replaces ugly DataCite keys', () => {
  const raw = `@misc{https://doi.org/10.48550/arxiv.1706.03762,\n  title = {X},\n}`;
  const out = rewriteCiteKey(raw, { firstAuthorFamily: 'Vaswani', year: 2017, title: 'Attention' });
  assert.match(out, /^@misc\{vaswani2017attention,/);
});

test('constructBibtex builds a parseable entry', () => {
  const bib = constructBibtex({
    firstAuthorFamily: 'Vaswani',
    authors: ['Ashish Vaswani', 'Noam Shazeer'],
    year: 2017,
    title: 'Attention Is All You Need',
    venue: 'Proceedings of NeurIPS',
    doi: '10.48550/arXiv.1706.03762',
  });
  assert.match(bib, /^@inproceedings\{vaswani2017attention,/);
  assert.match(bib, /author\s+= \{Ashish Vaswani and Noam Shazeer\}/);
  assert.match(bib, /booktitle\s+= \{Proceedings of NeurIPS\}/);
  assert.match(bib, /doi\s+= \{10\.48550/);
});

test('getField balances nested braces', () => {
  const bib = '@article{x, title = {Hello {World} Foo}, author = {A and B}, year = {2017}}';
  assert.equal(getField(bib, 'title'), 'Hello {World} Foo');
  assert.equal(getField(bib, 'author'), 'A and B');
  assert.equal(getField(bib, 'year'), '2017');
});

test('parseBibtexMeta extracts family, year, title from DataCite output', () => {
  const bib = [
    '@misc{https://doi.org/10.48550/arxiv.1706.03762,',
    '  doi = {10.48550/ARXIV.1706.03762},',
    '  author = {Vaswani, Ashish and Shazeer, Noam and Parmar, Niki},',
    '  title = {Attention Is All You Need},',
    '  year = {2017},',
    '}',
  ].join('\n');
  const meta = parseBibtexMeta(bib);
  assert.equal(meta.firstAuthorFamily, 'Vaswani');
  assert.equal(meta.year, 2017);
  assert.equal(meta.title, 'Attention Is All You Need');
  assert.equal(meta.authors.length, 3);
});

test('parseBibtexMeta handles "First Last" author order', () => {
  const meta = parseBibtexMeta('@inproceedings{x, author={Ashish Vaswani and Noam Shazeer}, title={T}, year={2020}}');
  assert.equal(meta.firstAuthorFamily, 'Vaswani');
});

test('inferEntryType picks sensible types', () => {
  assert.equal(inferEntryType({ venue: 'Proceedings of NeurIPS' }), 'inproceedings');
  assert.equal(inferEntryType({ venue: 'Journal of ML Research' }), 'article');
  assert.equal(inferEntryType({}), 'misc');
});
