export const MAX_MARKDOWN_BYTES = 1024 * 1024;

export function validateArticleUrl(value) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError('Enter an article URL');
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new TypeError('Enter a valid absolute article URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TypeError('Only public HTTP and HTTPS article URLs are supported');
  }
  if (!url.hostname || url.username || url.password) {
    throw new TypeError('Enter a public article URL without embedded credentials');
  }
  return url.href;
}

export function validateMarkdownFile(file) {
  if (!file || typeof file.name !== 'string' || !/\.(md|markdown)$/i.test(file.name)) {
    throw new TypeError('Choose a .md or .markdown file');
  }
  if (!Number.isSafeInteger(file.size) || file.size < 1) {
    throw new TypeError('The Markdown file is empty');
  }
  if (file.size > MAX_MARKDOWN_BYTES) {
    throw new TypeError('The Markdown file must be no larger than 1 MiB');
  }
  return file;
}

export async function readMarkdownFile(file) {
  validateMarkdownFile(file);
  if (typeof file.arrayBuffer !== 'function') throw new TypeError('The file cannot be read');
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
  } catch {
    throw new TypeError('The Markdown file must contain valid UTF-8 text');
  }
  if (!text.trim()) throw new TypeError('The Markdown file is empty');
  return text;
}
