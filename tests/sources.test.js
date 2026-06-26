import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArxivEntry, parseArxivFeed, arxivIdFromUrl, arxivIdFromPdf } from '../src/resolver/arxiv.js';
import { parseOpenReviewNote, isPaperNote, yearFromBibtex } from '../src/resolver/openreview.js';
import {
  parseCvfHtml,
  bibtexFromCvfHtml,
  cvfHtmlUrl,
  isCvfUrl,
  extractCvfUrl,
} from '../src/resolver/thecvf.js';
import { parseCrossrefItem } from '../src/resolver/crossref.js';
import { parseOpenAlexItem } from '../src/resolver/openalex.js';
import { parseS2Item } from '../src/resolver/semanticscholar.js';

// --- arXiv ------------------------------------------------------------------
const ARXIV_ENTRY = `
<entry>
  <id>http://arxiv.org/abs/1706.03762v7</id>
  <published>2017-06-12T13:00:00Z</published>
  <title>Attention Is All You Need</title>
  <author><name>Ashish Vaswani</name></author>
  <author><name>Noam Shazeer</name></author>
  <summary>The dominant sequence transduction models…</summary>
</entry>`;

test('arxivIdFromUrl / arxivIdFromPdf strip versions', () => {
  assert.equal(arxivIdFromUrl('http://arxiv.org/abs/1706.03762v7'), '1706.03762');
  assert.equal(arxivIdFromPdf('http://arxiv.org/pdf/2401.00001v1'), '2401.00001');
  assert.equal(arxivIdFromUrl('not a link'), null);
});

test('parseArxivEntry maps an Atom entry to a candidate with a DataCite DOI', () => {
  const c = parseArxivEntry(ARXIV_ENTRY);
  assert.equal(c.title, 'Attention Is All You Need');
  assert.equal(c.arxivId, '1706.03762');
  assert.equal(c.doi, '10.48550/arXiv.1706.03762');
  assert.equal(c.year, 2017);
  assert.deepEqual(c.authors, ['Ashish Vaswani', 'Noam Shazeer']);
  assert.equal(c.firstAuthorFamily, 'Vaswani');
  assert.equal(c.source, 'arxiv');
  assert.equal(c.citedBy, 0);
});

test('parseArxivFeed extracts all entries', () => {
  const feed = `<feed>${ARXIV_ENTRY}${ARXIV_ENTRY}</feed>`;
  assert.equal(parseArxivFeed(feed).length, 2);
  assert.equal(parseArxivFeed('').length, 0);
});

// --- OpenReview -------------------------------------------------------------
const OR_PAPER = {
  id: 'ABC123',
  forum: 'ABC123',
  content: {
    title: { value: 'Some Paper' },
    authors: { value: ['Jane Doe', 'John Smith'] },
    venue: { value: 'ICLR 2024 Poster' },
    venueid: { value: 'ICLR.cc/2024/Conference' },
    pdf: { value: 'http://arxiv.org/pdf/2401.00001v1' },
    _bibtex: { value: '@inproceedings{doe2024some,\n title={Some Paper},\n year={2024},\n}' },
  },
};

test('yearFromBibtex reads a 4-digit year', () => {
  assert.equal(yearFromBibtex('@inproceedings{x, year={2024}}'), 2024);
  assert.equal(yearFromBibtex('@misc{x, year = "2019"}'), 2019);
  assert.equal(yearFromBibtex('no year here'), null);
});

test('parseOpenReviewNote unwraps v2 values and cross-links an arXiv DOI', () => {
  const c = parseOpenReviewNote(OR_PAPER);
  assert.equal(c.title, 'Some Paper');
  assert.deepEqual(c.authors, ['Jane Doe', 'John Smith']);
  assert.equal(c.firstAuthorFamily, 'Doe');
  assert.equal(c.year, 2024); // from _bibtex
  assert.equal(c.venue, 'ICLR 2024 Poster');
  assert.equal(c.doi, '10.48550/arXiv.2401.00001');
  assert.equal(c.openreviewForum, 'ABC123');
  assert.equal(c.source, 'openreview');
  assert.match(c.openreviewBibtex, /^@inproceedings\{doe2024some/);
});

test('parseOpenReviewNote without an arXiv pdf has no DOI', () => {
  const c = parseOpenReviewNote({ ...OR_PAPER, content: { ...OR_PAPER.content, pdf: { value: '/local.pdf' } } });
  assert.equal(c.doi, null);
  assert.equal(c.arxivId, null);
});

test('isPaperNote rejects reviews and bib-less notes', () => {
  assert.equal(isPaperNote(OR_PAPER), true);
  // A review: id !== forum
  assert.equal(isPaperNote({ ...OR_PAPER, id: 'REV1', forum: 'ABC123' }), false);
  // forum===id but no _bibtex
  const noBib = { ...OR_PAPER, content: { ...OR_PAPER.content } };
  delete noBib.content._bibtex;
  assert.equal(isPaperNote(noBib), false);
});

// --- thecvf (CVF Open Access) -----------------------------------------------
// Legacy page layout (2016–2019): `<div class="bibref">` with <br> line breaks.
const CVF_OLD = `<html><head>
<meta name="citation_title" content="Deep Residual Learning for Image Recognition">
</head><body>
<div class="bibref">
@InProceedings{He_2016_CVPR,<br>
author = {He, Kaiming and Zhang, Xiangyu and Ren, Shaoqing and Sun, Jian},<br>
title = {Deep Residual Learning for Image Recognition},<br>
booktitle = {Proceedings of the IEEE Conference on Computer Vision and Pattern Recognition (CVPR)},<br>
month = {June},<br>
year = {2016}<br>
}
</div></body></html>`;

// Modern page layout (2020+): `<div class="bibref pre-white-space">` with newlines.
const CVF_NEW = `<div class="bibref pre-white-space">@InProceedings{Yang_2023_CVPR,
    author    = {Yang, Jingkang and Loy, Chen Change &amp; Liu, Ziwei},
    title     = {Panoptic Video Scene Graph Generation},
    booktitle = {Proceedings of the IEEE/CVF Conference on Computer Vision and Pattern Recognition (CVPR)},
    month     = {June},
    year      = {2023},
    pages     = {18675-18685}
}</div>`;

test('bibtexFromCvfHtml extracts both page layouts and decodes entities', () => {
  const a = bibtexFromCvfHtml(CVF_OLD);
  assert.match(a, /^@InProceedings\{He_2016_CVPR,/);
  assert.ok(!a.includes('<br>'), 'br tags stripped');
  assert.match(a, /year = \{2016\}/);
  const b = bibtexFromCvfHtml(CVF_NEW);
  assert.match(b, /Loy, Chen Change & Liu/); // &amp; decoded
  assert.equal(bibtexFromCvfHtml('<p>no bibref here</p>'), '');
});

test('parseCvfHtml builds a candidate carrying the canonical BibTeX', () => {
  const c = parseCvfHtml(CVF_OLD, 'https://openaccess.thecvf.com/content_cvpr_2016/html/He_X_CVPR_2016_paper.html');
  assert.equal(c.title, 'Deep Residual Learning for Image Recognition');
  assert.deepEqual(c.authors, ['Kaiming He', 'Xiangyu Zhang', 'Shaoqing Ren', 'Jian Sun']);
  assert.deepEqual(c.authorFamilies, ['He', 'Zhang', 'Ren', 'Sun']);
  assert.equal(c.firstAuthorFamily, 'He');
  assert.equal(c.year, 2016);
  assert.match(c.venue, /Computer Vision and Pattern Recognition/);
  assert.equal(c.doi, null);
  assert.equal(c.source, 'thecvf');
  assert.equal(c.type, 'inproceedings');
  assert.match(c.thecvfBibtex, /^@InProceedings\{He_2016_CVPR,/);
});

test('parseCvfHtml throws when no BibTeX block is present', () => {
  assert.throws(() => parseCvfHtml('<html><body>nothing</body></html>'), /No BibTeX/);
});

test('cvfHtmlUrl maps PDF links to their HTML page and drops query/hash', () => {
  assert.equal(
    cvfHtmlUrl('https://openaccess.thecvf.com/content/CVPR2023/papers/Yang_X_CVPR_2023_paper.pdf'),
    'https://openaccess.thecvf.com/content/CVPR2023/html/Yang_X_CVPR_2023_paper.html',
  );
  const html = 'https://openaccess.thecvf.com/content/CVPR2023/html/Yang_X_CVPR_2023_paper.html';
  assert.equal(cvfHtmlUrl(html + '?foo=1#bar'), html);
});

test('isCvfUrl / extractCvfUrl recognize live and legacy hosts', () => {
  assert.equal(isCvfUrl('https://openaccess.thecvf.com/content/CVPR2023/html/X.html'), true);
  assert.equal(isCvfUrl('https://www.cv-foundation.org/openaccess/content_cvpr_2016/papers/X.pdf'), true);
  assert.equal(isCvfUrl('https://example.com/thecvf'), false);
  assert.equal(
    extractCvfUrl('[PDF] openaccess.thecvf.com — see https://openaccess.thecvf.com/content/CVPR2023/papers/X.pdf here'),
    'https://openaccess.thecvf.com/content/CVPR2023/papers/X.pdf',
  );
});

// --- citedBy propagation from existing adapters -----------------------------
test('parseCrossrefItem carries is-referenced-by-count', () => {
  const c = parseCrossrefItem({ DOI: '10.1/x', title: ['T'], 'is-referenced-by-count': 42 });
  assert.equal(c.citedBy, 42);
  assert.equal(parseCrossrefItem({ DOI: '10.1/y', title: ['T'] }).citedBy, 0);
});

test('parseOpenAlexItem carries cited_by_count', () => {
  const c = parseOpenAlexItem({ title: 'T', cited_by_count: 7 });
  assert.equal(c.citedBy, 7);
});

test('parseS2Item carries citationCount', () => {
  const c = parseS2Item({ title: 'T', authors: [], citationCount: 99 });
  assert.equal(c.citedBy, 99);
});
