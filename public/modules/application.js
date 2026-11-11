import { isPreparing } from './views.js';

function upsert(items, item) {
  const result = items.filter((candidate) => candidate.id !== item.id);
  result.push(item);
  return result;
}

export class ApplicationController {
  constructor({
    api,
    onChange = () => {},
    pollIntervalMs = 3000,
    setIntervalImpl = globalThis.setInterval,
    clearIntervalImpl = globalThis.clearInterval,
  }) {
    this.api = api;
    this.onChange = onChange;
    this.pollIntervalMs = pollIntervalMs;
    this.setIntervalImpl = setIntervalImpl;
    this.clearIntervalImpl = clearIntervalImpl;
    this.authenticated = false;
    this.items = [];
    this.selected = null;
    this.error = null;
    this.pollTimer = null;
    this.refreshPromise = null;
    this.openSequence = 0;
  }

  snapshot() {
    return {
      authenticated: this.authenticated,
      items: [...this.items],
      selected: this.selected,
      error: this.error,
      polling: this.pollTimer !== null,
    };
  }

  emit(reason) {
    this.onChange(this.snapshot(), reason);
  }

  clearPrivateState() {
    this.stopPolling();
    this.openSequence += 1;
    this.authenticated = false;
    this.items = [];
    this.selected = null;
  }

  handleError(error, reason = 'error') {
    if (error?.status === 401) {
      this.clearPrivateState();
      this.error = 'Your session has expired. Sign in again.';
      this.emit('session-expired');
      return;
    }
    this.error = error?.message || 'The request failed';
    this.emit(reason);
  }

  async restoreSession() {
    try {
      const session = await this.api.session();
      if (session?.authenticated !== true) {
        const error = new Error('Authentication required');
        error.status = 401;
        throw error;
      }
      this.authenticated = true;
      this.error = null;
      this.emit('sign-in');
      await this.refreshLibrary();
      return true;
    } catch (error) {
      if (error?.status === 401) {
        this.clearPrivateState();
        this.error = null;
        this.emit('signed-out');
        return false;
      }
      this.handleError(error, 'session-error');
      return false;
    }
  }

  async signIn(password) {
    try {
      await this.api.signIn(password);
      this.authenticated = true;
      this.error = null;
      this.emit('sign-in');
      await this.refreshLibrary();
    } catch (error) {
      if (error?.status === 401) {
        this.clearPrivateState();
        this.error = error.message || 'Sign-in failed';
        this.emit('sign-in-error');
      } else {
        this.handleError(error, 'sign-in-error');
      }
      throw error;
    }
  }

  async signOut() {
    try {
      await this.api.signOut();
    } finally {
      this.clearPrivateState();
      this.error = null;
      this.emit('signed-out');
    }
  }

  async refreshLibrary() {
    if (!this.authenticated) return;
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = (async () => {
      try {
        const items = await this.api.listItems();
        this.items = items;
        let detailError = null;
        if (this.selected) {
          const selectedId = this.selected.item.id;
          try {
            this.selected = await this.api.getItem(selectedId);
          } catch (error) {
            if (error?.status === 401) throw error;
            detailError = error?.message || 'Could not refresh the selected item';
          }
        }
        this.error = detailError;
        this.syncPolling();
        this.emit('library');
      } catch (error) {
        this.handleError(error, 'library-error');
      } finally {
        this.refreshPromise = null;
        this.syncPolling();
      }
    })();
    return this.refreshPromise;
  }

  async openItem(itemId) {
    const sequence = ++this.openSequence;
    try {
      const detail = await this.api.getItem(itemId);
      if (sequence !== this.openSequence || !this.authenticated) return null;
      this.selected = detail;
      this.error = null;
      this.emit('item');
      this.syncPolling();
      return detail;
    } catch (error) {
      this.handleError(error, 'item-error');
      throw error;
    }
  }

  closeItem() {
    this.openSequence += 1;
    this.selected = null;
    this.error = null;
    this.emit('close-item');
    this.syncPolling();
  }

  async submitArticle(url) {
    try {
      const item = await this.api.submitArticle(url);
      this.items = upsert(this.items, item);
      this.error = null;
      this.emit('submitted');
      this.syncPolling();
      await this.refreshLibrary();
      return item;
    } catch (error) {
      this.handleError(error, 'submission-error');
      throw error;
    }
  }

  async uploadMarkdown(file) {
    try {
      const item = await this.api.uploadMarkdown(file);
      this.items = upsert(this.items, item);
      this.error = null;
      this.emit('submitted');
      this.syncPolling();
      await this.refreshLibrary();
      return item;
    } catch (error) {
      this.handleError(error, 'submission-error');
      throw error;
    }
  }

  async retry(itemId) {
    try {
      const item = await this.api.retry(itemId);
      this.items = upsert(this.items, item);
      if (this.selected?.item.id === item.id) {
        this.selected = { ...this.selected, item };
      }
      this.error = null;
      this.emit('retry');
      this.syncPolling();
      await this.refreshLibrary();
      return item;
    } catch (error) {
      this.handleError(error, 'retry-error');
      throw error;
    }
  }

  needsPolling() {
    return this.items.some(isPreparing) || isPreparing(this.selected?.item);
  }

  syncPolling() {
    if (!this.authenticated || !this.needsPolling()) {
      this.stopPolling();
      return;
    }
    if (this.pollTimer !== null) return;
    this.pollTimer = this.setIntervalImpl(() => {
      this.refreshLibrary().catch(() => {});
    }, this.pollIntervalMs);
  }

  stopPolling() {
    if (this.pollTimer === null) return;
    this.clearIntervalImpl(this.pollTimer);
    this.pollTimer = null;
  }
}
