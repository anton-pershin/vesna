const STATE_LABELS = {
  accepted: 'Accepted',
  preparing: 'Preparing',
  ready: 'Ready',
  failed: 'Failed',
};

export function isPreparing(item) {
  return item?.state === 'accepted' || item?.state === 'preparing';
}

export function itemTitle(item) {
  return item.title || (item.kind === 'markdown' ? 'Markdown item' : 'Article item');
}

export function itemSource(item) {
  return item.kind === 'markdown'
    ? `Uploaded file: ${item.filename || 'Markdown file'}`
    : `Article: ${item.source_url || 'URL pending'}`;
}

export function stateLabel(state) {
  return STATE_LABELS[state] || 'Unknown';
}

function makeElement(documentImpl, tag, className, text) {
  const element = documentImpl.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

export function renderLibrary(container, items, {
  onOpen,
  onRetry,
  documentImpl = globalThis.document,
} = {}) {
  const children = items.map((item) => {
    const entry = makeElement(documentImpl, 'li', 'library-item');
    entry.dataset.itemId = item.id;

    const open = makeElement(documentImpl, 'button', 'item-open', itemTitle(item));
    open.type = 'button';
    open.setAttribute('aria-label', `Open ${itemTitle(item)}`);
    open.addEventListener('click', () => onOpen(item.id));

    const source = makeElement(documentImpl, 'p', 'item-source', itemSource(item));
    const status = makeElement(documentImpl, 'p', 'item-state', `Status: ${stateLabel(item.state)}`);
    status.dataset.state = item.state;
    entry.append(open, source, status);

    if (item.state === 'ready') {
      entry.append(makeElement(documentImpl, 'p', 'ready-note', 'Prepared for listening'));
    }
    if (item.state === 'failed') {
      entry.append(makeElement(
        documentImpl,
        'p',
        'item-error',
        item.error || 'Preparation failed. You can retry this item.',
      ));
      const retry = makeElement(documentImpl, 'button', 'secondary', 'Retry preparation');
      retry.type = 'button';
      retry.addEventListener('click', () => onRetry(item.id));
      entry.append(retry);
    }
    return entry;
  });
  container.replaceChildren(...children);
}

export function renderParagraphs(container, paragraphs, {
  ready,
  onSelect,
  documentImpl = globalThis.document,
} = {}) {
  const children = paragraphs.map((paragraph, index) => {
    const entry = makeElement(documentImpl, 'li');
    entry.dataset.paragraphId = paragraph.id;
    const marker = makeElement(documentImpl, 'span', 'current-marker', '▶ Current paragraph');
    marker.hidden = true;
    const button = makeElement(documentImpl, 'button', 'paragraph-button', paragraph.text);
    button.type = 'button';
    button.disabled = !ready;
    button.setAttribute('aria-label', ready
      ? `Play from paragraph ${index + 1}`
      : `Paragraph ${index + 1}; playback is not ready`);
    button.setAttribute('aria-current', 'false');
    if (ready) button.addEventListener('click', () => onSelect(paragraph.id));
    entry.append(marker, button);
    return entry;
  });
  container.replaceChildren(...children);
}

export function setCurrentParagraph(container, id, { autoScroll = false } = {}) {
  for (const entry of Array.from(container.children)) {
    const current = entry.dataset.paragraphId === id;
    entry.classList.toggle('current', current);
    const button = entry.querySelector('button');
    const marker = entry.querySelector('.current-marker');
    button?.setAttribute('aria-current', current ? 'true' : 'false');
    if (marker) marker.hidden = !current;
    if (current && autoScroll) entry.scrollIntoView({ block: 'nearest' });
  }
}

export function setArticleLink(anchor, value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('unsupported');
    if (url.username || url.password) throw new Error('credentialed URL');
    anchor.href = url.href;
    anchor.hidden = false;
  } catch {
    anchor.hidden = true;
    anchor.removeAttribute('href');
  }
}
