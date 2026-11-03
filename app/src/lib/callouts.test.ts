import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calloutEndLine, calloutSnippet, parseCalloutMarker } from './callouts.ts';
import { renderMarkdown } from './markdown.ts';

test('parses type, fold, and custom title', () => {
  assert.equal(parseCalloutMarker('[!NOTE]')?.canonical, 'note');
  assert.equal(parseCalloutMarker('[!NOTE]')?.fold, 'none');
  assert.equal(parseCalloutMarker('[!tldr]')?.canonical, 'abstract');
  assert.equal(parseCalloutMarker('[!tldr]')?.title, 'TLDR');
  const folded = parseCalloutMarker('[!faq]- Collapsed');
  assert.equal(folded?.canonical, 'question');
  assert.equal(folded?.fold, 'closed');
  assert.equal(folded?.title, 'Collapsed');
  assert.equal(parseCalloutMarker('[!tip]+')?.fold, 'open');
  assert.equal(parseCalloutMarker('[!nope]')?.canonical, 'note');
  assert.equal(parseCalloutMarker('[!nope]')?.title, 'Nope');
  assert.equal(parseCalloutMarker('not a callout'), null);
});

test('callout block stops at a line without >', () => {
  const lines = ['> [!warning] Look', '> first', '> > [!note]', '> > nested', '', 'after'];
  assert.equal(calloutEndLine(lines, 0), 3);
  assert.equal(calloutEndLine(lines, 1), null);
});

test('info callout uses an svg icon and keeps body lines in one paragraph', () => {
  const html = renderMarkdown('> [!info] 阿斯顿发斯蒂芬\n> 阿斯顿发斯蒂芬\n> 撒旦法水电费\n');
  assert.match(html, /md-callout--info/);
  assert.match(html, /<svg/);
  assert.doesNotMatch(html, /md-callout__icon[^<]*>ℹ/);
  assert.equal((html.match(/<p[\s>]/g) || []).length, 1);
});

test('preview renders a foldable callout with a custom title', () => {
  const html = renderMarkdown('> [!warning]- Watch\n> Do not\n');
  assert.match(html, /md-callout--warning/);
  assert.match(html, /<details/);
  assert.doesNotMatch(html, /\sopen[\s>]/);
  assert.match(html, /Watch/);
  assert.match(html, /Do not/);
  assert.doesNotMatch(html, /\[!warning\]/);
});

test('expanded fold and unknown type', () => {
  const open = renderMarkdown('> [!tip]+ Hint\n> Body\n');
  assert.match(open, /<details[^>]*open/);
  assert.match(open, /md-callout--tip/);
  const unknown = renderMarkdown('> [!custom]\n> Hi\n');
  assert.match(unknown, /md-callout--note/);
  assert.match(unknown, />Custom</);
});

test('insert snippet wraps the selection', () => {
  assert.match(calloutSnippet(''), /> \[!note\]/);
  assert.match(calloutSnippet(''), /\$\|\$/);
  assert.equal(calloutSnippet('one\ntwo'), '\n> [!note]\n> one\n> two\n');
});
