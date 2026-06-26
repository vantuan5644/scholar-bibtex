import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyInput,
  extractDoi,
  extractArxiv,
  cleanDoi,
  arxivToDoi,
} from '../src/resolver/classify.js';

test('classifyInput detects bare DOIs', () => {
  assert.deepEqual(classifyInput('10.1000/xyz123'), { type: 'doi', doi: '10.1000/xyz123' });
  assert.equal(classifyInput('see 10.48550/arXiv.1706.03762 for details').type, 'doi');
});

test('extractDoi strips wrappers and trailing punctuation', () => {
  assert.equal(extractDoi('https://doi.org/10.1000/abc.'), '10.1000/abc');
  assert.equal(extractDoi('doi: 10.1109/5.771073,'), '10.1109/5.771073');
  assert.equal(cleanDoi('https://dx.doi.org/10.1234/FOO'), '10.1234/FOO');
});

test('classifyInput maps arXiv ids to DOIs', () => {
  assert.deepEqual(classifyInput('1706.03762'), {
    type: 'arxiv',
    arxiv: '1706.03762',
    doi: '10.48550/arXiv.1706.03762',
  });
  assert.deepEqual(classifyInput('arXiv:2407.15516v2').type, 'arxiv');
  assert.equal(classifyInput('arXiv:2407.15516v2').doi, '10.48550/arXiv.2407.15516');
});

test('extractArxiv handles prefix, bare, and URL forms', () => {
  assert.equal(extractArxiv('see arxiv:2301.00234 for more'), '2301.00234');
  assert.equal(extractArxiv('2407.15516v2'), '2407.15516v2');
});

test('arxivToDoi is stable', () => {
  assert.equal(arxivToDoi('1706.03762'), '10.48550/arXiv.1706.03762');
});

test('classifyInput extracts DOI/arXiv from URLs', () => {
  assert.equal(classifyInput('https://doi.org/10.1038/nature12373').type, 'doi');
  assert.equal(classifyInput('https://arxiv.org/abs/1706.03762').type, 'arxiv');
  assert.equal(classifyInput('https://arxiv.org/pdf/2407.15516').type, 'arxiv');
});

test('classifyInput treats URLs without ids as url, plain text as title', () => {
  assert.equal(classifyInput('https://example.com/some/page').type, 'url');
  const t = classifyInput('Attention Is All You Need');
  assert.equal(t.type, 'title');
  assert.equal(t.title, 'Attention Is All You Need');
});

test('classifyInput handles empty input', () => {
  assert.equal(classifyInput('').type, 'empty');
  assert.equal(classifyInput('   ').type, 'empty');
});

test('DOI takes precedence over arXiv (avoids 10.x being eaten)', () => {
  assert.equal(classifyInput('10.48550/arXiv.1706.03762').type, 'doi');
});

test('classifyInput detects OpenReview forum URLs', () => {
  assert.deepEqual(classifyInput('https://openreview.net/forum?id=TyFrPOKYXw'), {
    type: 'openreview',
    forum: 'TyFrPOKYXw',
  });
  // ?id= on other paths (e.g. /pdf) also works
  assert.equal(classifyInput('https://openreview.net/pdf?id=TyFrPOKYXw').type, 'openreview');
  // path-style
  assert.equal(classifyInput('https://openreview.net/forum/TyFrPOKYXw').forum, 'TyFrPOKYXw');
  // bare forum URL (no id) stays a generic url
  assert.equal(classifyInput('https://openreview.net/').type, 'url');
  // www prefix handled
  assert.equal(classifyInput('https://www.openreview.net/forum?id=AAA').type, 'openreview');
});

test('classifyInput detects CVF Open Access URLs', () => {
  assert.deepEqual(
    classifyInput('https://openaccess.thecvf.com/content/CVPR2023/html/Yang_X_CVPR_2023_paper.html'),
    { type: 'thecvf', url: 'https://openaccess.thecvf.com/content/CVPR2023/html/Yang_X_CVPR_2023_paper.html' },
  );
  // a PDF link (no DOI/arXiv in the path) still routes to the CVF exact path
  assert.equal(
    classifyInput('https://openaccess.thecvf.com/content/CVPR2023/papers/Yang_X_CVPR_2023_paper.pdf').type,
    'thecvf',
  );
  // legacy host only counts under /openaccess/
  assert.equal(
    classifyInput('https://www.cv-foundation.org/openaccess/content_cvpr_2016/papers/He_X_CVPR_2016_paper.pdf').type,
    'thecvf',
  );
  assert.equal(classifyInput('https://cv-foundation.org/about.html').type, 'url');
});
