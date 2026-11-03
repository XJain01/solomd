import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyAnnotation, parseAnnotations } from './annotations.ts';

test('parses a highlight and an optional note', () => {
  const doc = '前 ==重点== 后\n下一行 ==引用==^{为什么} 结束\n';
  const anns = parseAnnotations(doc);
  assert.equal(anns.length, 2);
  assert.equal(anns[0].text, '重点');
  assert.equal(anns[0].comment, '');
  assert.equal(anns[0].line, 1);
  assert.equal(anns[1].text, '引用');
  assert.equal(anns[1].comment, '为什么');
  assert.equal(anns[1].line, 2);
  assert.equal(doc.slice(anns[1].commentFrom!, anns[1].commentTo!), '为什么');
});

test('ignores highlights inside fences and inline code', () => {
  const doc = '代码 `==no==`\n```\n==nope==\n```\n==yes==\n';
  const anns = parseAnnotations(doc);
  assert.deepEqual(anns.map((a) => a.text), ['yes']);
});

test('annotate wraps a selection and parks the caret in the note', () => {
  const edit = applyAnnotation('说重点', 1, 3);
  assert.ok(edit);
  assert.equal(edit!.insert, '==重点==^{}');
  const next = '说' + edit!.insert;
  assert.equal(next[edit!.selFrom], '}');
  assert.equal(next.slice(edit!.selFrom - 1, edit!.selFrom), '{');
});

test('annotate on an existing highlight adds the note instead of nesting', () => {
  const doc = '见==此处==。';
  const edit = applyAnnotation(doc, 3, 5);
  assert.equal(edit!.insert, '^{}');
  assert.equal(doc.slice(0, edit!.from) + edit!.insert + doc.slice(edit!.to), '见==此处==^{}。');
});
