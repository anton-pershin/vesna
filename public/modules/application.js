import { isPreparing } from './views.js';

function upsert(items, item) {
  const result = items.filter((candidate) => candidate.id !== item.id);
  result.push(item);
  return result;
}

function deletionError(error) {
  if (error?.status === 404) {
    return 'Item not found on the server. Deletion cleanup cannot be confirmed.';
  }
  if (error?.status === 500) return 'Item could not be deleted. The item is unchanged. Try again.';
  if (error?.status === 503) return 'Item deletion is not complete. Try again to finish cleanup.';
  if (error?.status === 403) return 'Deletion was not allowed. Try again.';
  return 'Deletion could not be confirmed. Try again.';
}

export class ApplicationController {
  constructor({
    api,
    onChange = () => {},
    onDeleteConfirmed = () => {},
    pollIntervalMs = 3000,
    setIntervalImpl = globalThis.setInterval,
    clearIntervalImpl = globalThis.clearInterval,
  }) {
    this.api = api;
    this.onChange = onChange;
    this.onDeleteConfirmed = onDeleteConfirmed;
    this.pollIntervalMs = pollIntervalMs;
    this.setIntervalImpl = (callback, interval) => setIntervalImpl.call(globalThis, callback, interval);
    this.clearIntervalImpl = (id) => clearIntervalImpl.call(globalThis, id);
    this.authenticated = false;
    this.screen = 'sign-in';
    this.items = [];
    this.selected = null;
    this.deletion = null;
    this.lastDeletedItemId = null;
    this.error = null;
    this.cleanupWarning = null;
    this.pollTimer = null;
    this.refreshPromise = null;
    this.refreshGeneration = null;
    this.submissionPromise = null;
    this.submissionKey = null;
    this.openSequence = 0;
    this.pendingOpenItemId = null;
    this.operationGeneration = 0;
    this.authEpoch = 0;
    this.deleteSequence = 0;
    this.deleteAttempts = new Map();
    this.deletionPromise = null;
  }

  snapshot() {
    return {
      authenticated: this.authenticated,
      screen: this.screen,
      items: [...this.items],
      selected: this.selected,
      deletion: this.deletion ? { ...this.deletion } : null,
      lastDeletedItemId: this.lastDeletedItemId,
      generation: this.operationGeneration,
      error: this.error,
      cleanupWarning: this.cleanupWarning,
      submitting: this.submissionPromise !== null,
      polling: this.pollTimer !== null,
    };
  }

  emit(reason) {
    this.onChange(this.snapshot(), reason);
  }

  clearPrivateState() {
    this.stopPolling();
    this.openSequence += 1;
    this.pendingOpenItemId = null;
    this.operationGeneration += 1;
    this.authEpoch += 1;
    this.authenticated = false;
    this.screen = 'sign-in';
    this.items = [];
    this.selected = null;
    this.deletion = null;
    this.deletionPromise = null;
    this.lastDeletedItemId = null;
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
      this.screen = 'library';
      this.operationGeneration += 1;
      this.authEpoch += 1;
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
      this.screen = 'library';
      this.operationGeneration += 1;
      this.authEpoch += 1;
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

  showInput() {
    if (!this.authenticated) return;
    this.operationGeneration += 1;
    this.screen = 'input';
    this.error = null;
    this.emit('input');
  }

  closeInput() {
    if (!this.authenticated) return;
    this.operationGeneration += 1;
    this.screen = 'library';
    this.error = null;
    this.emit('close-input');
    this.syncPolling();
  }

  async openItem(itemId) {
    const sequence = ++this.openSequence;
    const generation = ++this.operationGeneration;
    this.pendingOpenItemId = itemId;
    this.deletion = null;
    this.selected = null;
    this.screen = 'reader';
    this.error = null;
    this.emit('item-loading');
    try {
      const detail = await this.api.getItem(itemId);
      if (
        sequence !== this.openSequence || generation !== this.operationGeneration ||
        !this.authenticated
      ) return null;
      this.pendingOpenItemId = null;
      this.selected = detail;
      this.error = null;
      this.emit('item');
      this.syncPolling();
      return detail;
    } catch (error) {
      if (sequence !== this.openSequence || generation !== this.operationGeneration) return null;
      this.pendingOpenItemId = null;
      this.handleError(error, 'item-error');
      throw error;
    }
  }

  closeItem() {
    const reconcile = Boolean(this.deletion);
    this.openSequence += 1;
    this.pendingOpenItemId = null;
    this.operationGeneration += 1;
    this.selected = null;
    this.deletion = null;
    this.screen = 'library';
    this.error = null;
    this.emit('close-item');
    this.syncPolling();
    if (reconcile) this.refreshLibrary().catch(() => {});
  }

  async refreshLibrary() {
    if (!this.authenticated || this.deletion?.status === 'pending') return;
    const generation = this.operationGeneration;
    if (this.refreshPromise && this.refreshGeneration === generation) return this.refreshPromise;
    const operation = (async () => {
      try {
        const items = await this.api.listItems();
        if (generation !== this.operationGeneration || !this.authenticated) return;
        let selected = null;
        let detailError = null;
        if (this.selected && !this.deletion) {
          const selectedId = this.selected.item.id;
          try {
            selected = await this.api.getItem(selectedId);
          } catch (error) {
            if (error?.status === 401) throw error;
            detailError = error?.message || 'Could not refresh the selected item';
          }
          if (generation !== this.operationGeneration || !this.authenticated) return;
        }
        this.items = items;
        if (selected) this.selected = selected;
        this.error = detailError;
        this.syncPolling();
        this.emit('library');
      } catch (error) {
        if (generation !== this.operationGeneration) return;
        this.handleError(error, 'library-error');
      } finally {
        if (this.refreshPromise === operation) {
          this.refreshPromise = null;
          this.refreshGeneration = null;
          this.syncPolling();
        }
      }
    })();
    this.refreshPromise = operation;
    this.refreshGeneration = generation;
    return operation;
  }

  submitArticle(url) {
    return this.submit(url, () => this.api.submitArticle(url));
  }

  uploadMarkdown(file) {
    return this.submit(file, () => this.api.uploadMarkdown(file));
  }

  submit(key, operation) {
    if (this.submissionPromise) {
      if (this.submissionKey === key) return this.submissionPromise;
      const error = new Error('Another submission is already in progress');
      this.error = error.message;
      this.emit('submission-error');
      return Promise.reject(error);
    }
    const submission = (async () => {
      try {
        const item = await operation();
        if (!this.authenticated) return null;
        this.items = upsert(this.items, item);
        this.error = null;
        this.emit('submitted');
        this.syncPolling();
        await this.refreshLibrary();
        return item;
      } catch (error) {
        this.handleError(error, 'submission-error');
        throw error;
      } finally {
        if (this.submissionPromise === submission) {
          this.submissionPromise = null;
          this.submissionKey = null;
          this.emit('submission-settled');
        }
      }
    })();
    this.submissionPromise = submission;
    this.submissionKey = key;
    this.emit('submission-pending');
    return submission;
  }

  async retry(itemId) {
    const generation = ++this.operationGeneration;
    try {
      const item = await this.api.retry(itemId);
      if (generation !== this.operationGeneration || !this.authenticated) return null;
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
      if (generation !== this.operationGeneration) return null;
      this.handleError(error, 'retry-error');
      throw error;
    }
  }

  deleteItem(itemId) {
    if (!this.authenticated) return Promise.reject(new Error('Authentication required'));
    if (this.deletion?.status === 'pending' && this.deletion.itemId === itemId) {
      return this.deletionPromise;
    }
    const attempt = ++this.deleteSequence;
    this.deleteAttempts.set(itemId, attempt);
    this.operationGeneration += 1;
    const generation = this.operationGeneration;
    const authEpoch = this.authEpoch;
    this.deletion = { itemId, status: 'pending', error: null };
    this.error = null;
    this.cleanupWarning = null;
    this.stopPolling();
    this.emit('delete-pending');
    const operation = (async () => {
      try {
        await this.api.deleteItem(itemId);
        try {
          await this.onDeleteConfirmed(itemId);
        } catch {
          if (authEpoch === this.authEpoch) {
            this.cleanupWarning = 'The item was deleted, but its local playback state could not be cleared.';
          }
        }
        if (
          this.deleteAttempts.get(itemId) !== attempt || authEpoch !== this.authEpoch ||
          !this.authenticated
        ) return;
        this.items = this.items.filter((candidate) => candidate.id !== itemId);
        this.lastDeletedItemId = itemId;
        this.deletion = null;
        this.error = null;
        if (
          this.selected?.item.id === itemId ||
          (this.screen === 'reader' && !this.selected && this.pendingOpenItemId === itemId)
        ) {
          this.pendingOpenItemId = null;
          this.selected = null;
          this.screen = 'library';
          this.operationGeneration += 1;
          this.emit('deleted');
        } else {
          this.emit('library');
        }
        this.syncPolling();
      } catch (error) {
        if (
          this.deleteAttempts.get(itemId) !== attempt || authEpoch !== this.authEpoch ||
          !this.authenticated
        ) return;
        if (error?.status === 401) {
          this.handleError(error, 'session-expired');
          throw error;
        }
        if (error?.status === 404 || error?.status === 503) {
          this.items = this.items.filter((candidate) => candidate.id !== itemId);
        }
        const readerContext = generation === this.operationGeneration &&
          this.screen === 'reader' && this.selected?.item.id === itemId;
        this.deletion = readerContext
          ? {
            itemId,
            status: error?.status === 500 || error?.status === 403 ? 'failed' : 'uncertain',
            error: deletionError(error),
          }
          : null;
        this.error = deletionError(error);
        this.emit('delete-error');
        this.syncPolling();
        throw error;
      } finally {
        if (this.deletionPromise === operation) this.deletionPromise = null;
      }
    })();
    this.deletionPromise = operation;
    return operation;
  }

  needsPolling() {
    return this.items.some(isPreparing) || isPreparing(this.selected?.item);
  }

  syncPolling() {
    if (
      !this.authenticated || !this.needsPolling() || this.deletion ||
      this.screen === 'input'
    ) {
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
