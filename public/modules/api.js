function identifier(value, label) {
  if (typeof value !== 'string' || !value) throw new TypeError(`${label} is required`);
  return encodeURIComponent(value);
}

function itemPath(itemId) {
  return `/api/items/${identifier(itemId, 'item ID')}`;
}

function versionPath(itemId, version, artifact) {
  return `${itemPath(itemId)}/versions/${identifier(version, 'prepared version')}/${artifact}`;
}

async function errorDetail(response) {
  try {
    const body = await response.json();
    if (body && typeof body.detail === 'string' && body.detail) return body.detail;
  } catch {
    // Non-JSON failures still receive a safe, useful status message.
  }
  return `Request failed (${response.status})`;
}

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export class VesnaApi {
  constructor({ fetchImpl = globalThis.fetch, FormDataImpl = globalThis.FormData } = {}) {
    if (typeof fetchImpl !== 'function') throw new TypeError('fetch is required');
    this.fetchImpl = fetchImpl;
    this.FormDataImpl = FormDataImpl;
  }

  async request(path, options = {}) {
    const headers = new Headers({ Accept: 'application/json', ...options.headers });
    const response = await this.fetchImpl(path, {
      cache: 'no-store',
      credentials: 'same-origin',
      ...options,
      headers,
    });
    if (response.status === 204) return null;
    if (!response.ok) throw new ApiError(await errorDetail(response), response.status);
    try {
      return await response.json();
    } catch {
      throw new ApiError('The server returned an invalid response', response.status);
    }
  }

  signIn(password) {
    return this.request('/api/auth/sign-in', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
  }

  signOut() {
    return this.request('/api/auth/sign-out', { method: 'POST' });
  }

  session() {
    return this.request('/api/auth/session');
  }

  async listItems() {
    const result = await this.request('/api/items');
    if (!result || !Array.isArray(result.items)) throw new ApiError('Invalid library response', 200);
    return result.items;
  }

  submitArticle(url) {
    return this.request('/api/items/article', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
  }

  uploadMarkdown(file) {
    if (typeof this.FormDataImpl !== 'function') throw new TypeError('FormData is unavailable');
    const body = new this.FormDataImpl();
    body.append('file', file);
    return this.request('/api/items/markdown', { method: 'POST', body });
  }

  getItem(itemId) {
    return this.request(itemPath(itemId));
  }

  retry(itemId) {
    return this.request(`${itemPath(itemId)}/retry`, { method: 'POST' });
  }

  sourceUrl(itemId) {
    return `${itemPath(itemId)}/source`;
  }

  textUrl(itemId, version) {
    return versionPath(itemId, version, 'text');
  }

  timingsUrl(itemId, version) {
    return versionPath(itemId, version, 'timings');
  }

  audioUrl(itemId, version) {
    return versionPath(itemId, version, 'audio');
  }

  getText(itemId, version) {
    return this.request(this.textUrl(itemId, version));
  }

  getTimings(itemId, version) {
    return this.request(this.timingsUrl(itemId, version));
  }

  async getSourceText(itemId) {
    const response = await this.fetchImpl(this.sourceUrl(itemId), {
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { Accept: 'text/plain' },
    });
    if (!response.ok) throw new ApiError(await errorDetail(response), response.status);
    return response.text();
  }
}
