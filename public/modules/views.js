const STATE_LABELS = {
  accepted: 'Accepted',
  preparing: 'Preparing…',
  ready: 'Ready to listen',
  failed: 'Preparation failed',
};

const STATE_ICONS = {
  accepted: 'clock',
  preparing: 'clock',
  ready: 'check',
  failed: 'alert',
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

function makeIcon(documentImpl, name, className = '') {
  const svg = documentImpl.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('aria-hidden', 'true');
  if (className) svg.setAttribute('class', className);
  const use = documentImpl.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#icon-${name}`);
  svg.append(use);
  return svg;
}

function sourceSummary(item) {
  if (item.kind === 'markdown') return `Markdown · ${item.filename || 'Markdown file'}`;
  try {
    return `Article · ${new URL(item.source_url).hostname}`;
  } catch {
    return 'Article · public source';
  }
}

function makeStateBadge(documentImpl, state) {
  const badge = makeElement(documentImpl, 'span', 'state-badge');
  badge.dataset.state = state;
  badge.append(
    makeIcon(documentImpl, STATE_ICONS[state] || 'clock'),
    makeElement(documentImpl, 'span', '', stateLabel(state)),
  );
  return badge;
}

export function renderLibrary(container, items, {
  onOpen,
  onRetry,
  documentImpl = globalThis.document,
} = {}) {
  const activeElement = documentImpl.activeElement;
  const focusedItemId = activeElement?.dataset.itemId;
  const focusedAction = activeElement?.dataset.libraryAction;
  const children = items.map((item) => {
    const entry = makeElement(documentImpl, 'li', 'library-item');
    entry.dataset.itemId = item.id;

    const open = makeElement(documentImpl, 'button', 'item-open');
    open.type = 'button';
    open.dataset.itemId = item.id;
    open.dataset.libraryAction = 'open';
    open.setAttribute('aria-label', `Open ${itemTitle(item)}`);
    open.addEventListener('click', () => onOpen(item.id));

    const kind = makeElement(documentImpl, 'span', 'kind-icon');
    kind.setAttribute('aria-hidden', 'true');
    if (item.kind === 'markdown') kind.textContent = 'M↓';
    else kind.append(makeIcon(documentImpl, 'doc'));

    const copy = makeElement(documentImpl, 'span', 'item-copy');
    copy.append(
      makeElement(documentImpl, 'span', 'item-title', itemTitle(item)),
      makeElement(documentImpl, 'span', 'item-source', sourceSummary(item)),
    );
    const state = makeElement(documentImpl, 'span', 'item-state');
    state.append(makeStateBadge(documentImpl, item.state));
    copy.append(state);
    open.append(kind, copy, makeIcon(documentImpl, 'chevron', 'chevron'));
    entry.append(open);

    if (item.state === 'failed') {
      const retryRow = makeElement(documentImpl, 'div', 'retry-row');
      retryRow.append(makeElement(documentImpl, 'span', 'retry-note', 'Your saved item is unchanged.'));
      const retry = makeElement(documentImpl, 'button', 'secondary-button', 'Retry');
      retry.type = 'button';
      retry.dataset.itemId = item.id;
      retry.dataset.libraryAction = 'retry';
      retry.setAttribute('aria-label', `Retry preparation for ${itemTitle(item)}`);
      retry.addEventListener('click', () => onRetry(item.id));
      retryRow.append(retry);
      entry.append(retryRow);
    }
    return entry;
  });
  container.replaceChildren(...children);
  if (focusedItemId && focusedAction) {
    const entry = children.find((candidate) => candidate.dataset.itemId === focusedItemId);
    const target = focusedAction === 'retry'
      ? (entry?.querySelector('.secondary-button') || entry?.querySelector('button'))
      : entry?.querySelector('button');
    target?.focus({ preventScroll: true });
  }
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
