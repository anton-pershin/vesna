import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_MARKDOWN_BYTES,
  readMarkdownFile,
  validateArticleUrl,
  validateMarkdownFile,
} from '../public/modules/input.js';

const encoder = new TextEncoder();
const file = (name, bytes) => ({
  name,
  size: bytes.byteLength,
  arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
});

test('article input accepts absolute HTTP and HTTPS URLs', () => {
  assert.equal(validateArticleUrl(' https://example.test/story '), 'https://example.test/story');
  assert.equal(validateArticleUrl('http://example.test'), 'http://example.test/');
});

test('article input rejects malformed, unsupported, and credentialed URLs', () => {
  for (const value of ['', 'example.test/story', 'ftp://example.test/a', 'file:///tmp/a', 'javascript:alert(1)', 'https://user:secret@example.test/']) {
    assert.throws(() => validateArticleUrl(value), TypeError, value);
  }
});

test('Markdown input accepts both extensions and the exact size limit', async () => {
  const markdown = file('notes.MARKDOWN', encoder.encode('# Notes\n\nText'));
  assert.equal(await readMarkdownFile(markdown), '# Notes\n\nText');
  const md = file('notes.md', encoder.encode('Text'));
  assert.equal(validateMarkdownFile(md), md);
  assert.equal(validateMarkdownFile({ name: 'limit.md', size: MAX_MARKDOWN_BYTES }).size, MAX_MARKDOWN_BYTES);
});

test('Markdown input rejects unsupported, empty, oversized, and invalid UTF-8 files', async (t) => {
  const cases = [
    { name: 'unsupported extension', value: file('notes.txt', encoder.encode('text')), error: /\.md or \.markdown/ },
    { name: 'empty', value: file('empty.md', new Uint8Array()), error: /empty/ },
    { name: 'whitespace only', value: file('blank.md', encoder.encode(' \n')), error: /empty/ },
    { name: 'oversized', value: { name: 'large.md', size: MAX_MARKDOWN_BYTES + 1 }, error: /1 MiB/ },
    { name: 'invalid UTF-8', value: file('invalid.md', new Uint8Array([0xc3, 0x28])), error: /valid UTF-8/ },
  ];
  for (const { name, value, error } of cases) {
    await t.test(name, async () => {
      if (name === 'oversized') assert.throws(() => validateMarkdownFile(value), error);
      else await assert.rejects(readMarkdownFile(value), error);
    });
  }
});
