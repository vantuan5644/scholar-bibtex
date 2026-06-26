import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCrossrefItem } from '../src/resolver/crossref.js';
import { parseOpenAlexItem } from '../src/resolver/openalex.js';
import { parseDblpHit } from '../src/resolver/dblp.js';
import { parseS2Item } from '../src/resolver/semanticscholar.js';

test('parseCrossrefItem maps fields to a normalized candidate', () => {
  const c = parseCrossrefItem({
    DOI: '10.48550/arXiv.1706.03762',
    title: ['Attention Is All You Need'],
    author: [{ given: 'Ashish', family: 'Vaswani' }],
    'published-online': { 'date-parts': [[2017]] },
    'container-title': ['CoRR'],
    type: 'posted-content',
  });
  assert.equal(c.title, 'Attention Is All You Need');
  assert.deepEqual(c.authors, ['Ashish Vaswani']);
  assert.equal(c.firstAuthorFamily, 'Vaswani');
  assert.equal(c.year, 2017);
  assert.equal(c.venue, 'CoRR');
  assert.equal(c.source, 'crossref');
});

test('parseOpenAlexItem strips doi URL prefix and reads primary_location', () => {
  const c = parseOpenAlexItem({
    title: 'Attention Is All You Need',
    doi: 'https://doi.org/10.48550/arXiv.1706.03762',
    publication_year: 2017,
    primary_location: { source: { display_name: 'arXiv.org' } },
    authorships: [{ author: { display_name: 'Ashish Vaswani' }, raw_author_name: 'Ashish Vaswani' }],
    type_crossref: 'article',
  });
  assert.equal(c.doi, '10.48550/arXiv.1706.03762');
  assert.equal(c.venue, 'arXiv.org');
  assert.equal(c.firstAuthorFamily, 'Vaswani');
  assert.equal(c.source, 'openalex');
});

test('parseDblpHit handles single-author (non-array) form', () => {
  const c = parseDblpHit({
    info: {
      title: 'Some Paper.',
      authors: { author: { text: 'Jane Doe' } },
      year: '2020',
      venue: 'ICML',
      doi: '10.000/x',
      key: 'conf/icml/Doe20',
      type: 'Conference and Workshop Papers',
    },
  });
  assert.deepEqual(c.authors, ['Jane Doe']);
  assert.equal(c.firstAuthorFamily, 'Doe');
  assert.equal(c.year, 2020);
  assert.equal(c.dblpKey, 'conf/icml/Doe20');
  assert.equal(c.title, 'Some Paper'); // trailing dot stripped
});

test('parseS2Item maps externalIds.DOI', () => {
  const c = parseS2Item({
    title: 'A Paper',
    authors: [{ name: 'Jane Doe' }],
    year: 2021,
    venue: 'NeurIPS',
    externalIds: { DOI: '10.1/abc' },
  });
  assert.equal(c.doi, '10.1/abc');
  assert.equal(c.firstAuthorFamily, 'Doe');
  assert.equal(c.source, 'semanticscholar');
});
