/**
 * Tab inside a callout keeps the `>` marker where it is.
 *
 * Before this, `indentWithTab` inserted at the start of the line, so every
 * Tab moved `> body` to the right; four Tabs turned the line into an indented
 * code block and the callout lost its body.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { calloutIndentEdit } from './callout-indent.ts';

const apply = (content: string, edit: { from: number; to: number; insert: string }) =>
  content.slice(0, edit.from) + edit.insert + content.slice(edit.to);

test('Tab indents a callout body line after the `>` marker', () => {
  const doc = '> [!note]\n> body';
  const caret = doc.indexOf('body') + 2;
  const edit = calloutIndentEdit(doc, caret, false);
  assert.ok(edit?.changed);
  assert.equal(apply(doc, edit), '> [!note]\n>   body');
  assert.equal(edit.sel, caret + 2);
});

test('Tab on a callout list item nests it without moving the marker', () => {
  const doc = '> [!todo]\n> - [ ] task';
  const edit = calloutIndentEdit(doc, doc.length, false);
  assert.ok(edit?.changed);
  assert.equal(apply(doc, edit), '> [!todo]\n>   - [ ] task');
});

test('a second Tab on a lone list item keeps indenting the content', () => {
  const once = '> [!todo]\n>   - [ ] task';
  const edit = calloutIndentEdit(once, once.length, false);
  assert.ok(edit?.changed);
  assert.equal(apply(once, edit), '> [!todo]\n>     - [ ] task');
});

test('Shift+Tab undoes the one step a lone list item took', () => {
  const once = '> [!todo]\n>   - [ ] task';
  const edit = calloutIndentEdit(once, once.length, true);
  assert.ok(edit?.changed);
  assert.equal(apply(once, edit), '> [!todo]\n> - [ ] task');
});

test('the second of two items nests under the first', () => {
  const doc = '> [!todo]\n> - [ ] one\n> - [ ] two';
  const edit = calloutIndentEdit(doc, doc.length, false);
  assert.ok(edit?.changed);
  assert.equal(apply(doc, edit), '> [!todo]\n> - [ ] one\n>   - [ ] two');
});

test('repeated Tab on a nested item keeps indenting, marker stays', () => {
  const doc = '> [!todo]\n> - [ ] one\n>   - [ ] two';
  const edit = calloutIndentEdit(doc, doc.length, false);
  assert.ok(edit?.changed);
  assert.equal(apply(doc, edit), '> [!todo]\n> - [ ] one\n>     - [ ] two');
});

test('Shift+Tab lifts a nested item back to its sibling', () => {
  const doc = '> [!todo]\n> - [ ] one\n>   - [ ] two';
  const edit = calloutIndentEdit(doc, doc.length, true);
  assert.ok(edit?.changed);
  assert.equal(apply(doc, edit), '> [!todo]\n> - [ ] one\n> - [ ] two');
});

test('Shift+Tab removes the indent it added', () => {
  const indented = '> [!note]\n>   body';
  const edit = calloutIndentEdit(indented, indented.indexOf('body'), true);
  assert.ok(edit?.changed);
  assert.equal(apply(indented, edit), '> [!note]\n> body');
});

test('Shift+Tab with nothing to remove falls through', () => {
  const doc = '> [!note]\n> body';
  assert.equal(calloutIndentEdit(doc, doc.indexOf('body'), true), null);
});

test('the callout header consumes Tab without moving the marker', () => {
  const doc = '> [!note] Title\n> body';
  const edit = calloutIndentEdit(doc, doc.indexOf('[!note]'), false);
  assert.ok(edit);
  assert.equal(edit.changed, false);
  assert.equal(apply(doc, edit), doc);
});

test('a plain blockquote is not a callout', () => {
  const doc = '> just a quote';
  assert.equal(calloutIndentEdit(doc, 4, false), null);
});

test('a quote that only contains a callout later is left alone', () => {
  const doc = '> intro\n> [!note]\n> body';
  assert.equal(calloutIndentEdit(doc, doc.indexOf('body'), false), null);
});

test('ordinary text is left alone', () => {
  assert.equal(calloutIndentEdit('plain text', 3, false), null);
});

test('an indented callout keeps its marker column', () => {
  const doc = '  > [!note]\n  > body';
  const edit = calloutIndentEdit(doc, doc.length, false);
  assert.ok(edit?.changed);
  assert.equal(apply(doc, edit), '  > [!note]\n  >   body');
});

test('list nesting inside an indented callout keeps the marker column', () => {
  const doc = '  > [!todo]\n  > - one\n  > - two';
  const edit = calloutIndentEdit(doc, doc.length, false);
  assert.ok(edit?.changed);
  assert.equal(apply(doc, edit), '  > [!todo]\n  > - one\n  >   - two');
});

test('a caret before the indentation point does not jump', () => {
  const doc = '> [!note]\n> body';
  const edit = calloutIndentEdit(doc, doc.indexOf('> body') + 1, false);
  assert.ok(edit?.changed);
  assert.equal(edit.sel, doc.indexOf('> body') + 1);
});

test('a line already pushed out of the callout still keeps its marker', () => {
  // Five leading spaces are past Markdown's three-space quote limit, so the
  // line no longer renders as part of the callout — but Tab must not shove
  // the `>` further right either (that is how it got there).
  const doc = '> [!note]\n> body\n     > escaped';
  const edit = calloutIndentEdit(doc, doc.indexOf('escaped'), false);
  assert.ok(edit?.changed);
  assert.equal(apply(doc, edit), '> [!note]\n> body\n     >   escaped');
});
