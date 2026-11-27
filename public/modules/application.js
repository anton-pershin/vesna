import { isPreparing } from './views.js';

function isNetworkFailure(error) {
  return error instanceof TypeError || error?.name === 'TypeError';
}

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
    downloads = null,
    onChange = () => {},
    onDeleteConfirmed = () => {},
    pollIntervalMs = 3000,
    setIntervalImpl = globalThis.setInterval,
    clearIntervalImpl = globalThis.clearInterval,
  }) {
    this.api = api;
    this.downloads = downloads;
    this.onChange = onChange;
    this.onDeleteConfirmed = onDeleteConfirmed;
    this.pollIntervalMs = pollIntervalMs;
    this.setIntervalImpl = (callback, interval) => setIntervalImpl.call(globalThis, callback, interval);
    this.clearIntervalImpl = (id) => clearIntervalImpl.call(globalThis, id);
    this.authenticated = false;
    this.offline = false;
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
    this.downloadPromises = new Map();
  }

  snapshot() {
    return {
      authenticated: this.authenticated,
      offline: this.offline,
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
    this.offline = false;
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
      this.offline = false;
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
        this.emit('sign-in-required');
        return false;
      }
      if (this.downloads && isNetworkFailure(error)) return this.restoreOffline();
      this.handleError(error, 'session-error');
      return false;
    }
  }

  async restoreOffline() {
    this.stopPolling();
    let items;
    try {
      items = await this.downloads.list();
    } catch {
      this.clearPrivateState();
      this.error = 'Offline downloads could not be read. Connect to the Internet to sign in.';
      this.emit('offline-error');
      return false;
    }
    this.operationGeneration += 1;
    this.authEpoch += 1;
    this.selected = null;
    this.deletion = null;
    this.error = null;
    if (items.length === 0) {
      this.clearPrivateState();
      this.error = 'No offline downloads are available. Connect to the Internet to sign in.';
      this.emit('offline-unavailable');
      return false;
    }
    this.authenticated = true;
    this.offline = true;
    this.screen = 'library';
    this.items = items;
    this.emit('offline-library');
    return true;
  }

  async signIn(password) {
    try {
      await this.api.signIn(password);
      this.authenticated = true;
      this.offline = false;
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
      if (!this.offline) await this.api.signOut();
    } finally {
      this.clearPrivateState();
      this.error = null;
      this.emit('signed-out');
    }
  }

  showInput() {
    if (!this.authenticated || this.offline) return;
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
      const detail = this.offline
        ? await this.downloads.get(itemId)
        : await this.api.getItem(itemId);
      if (
        sequence !== this.openSequence || generation !== this.operationGeneration ||
        !this.authenticated
      ) return null;
      const download = this.items.find((candidate) => candidate.id === itemId)?.download;
      if (download) detail.item = { ...detail.item, download };
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
    if (this.offline) return this.refreshOfflineLibrary();
    const generation = this.operationGeneration;
    if (this.refreshPromise && this.refreshGeneration === generation) return this.refreshPromise;
    const operation = (async () => {
      try {
        const serverItems = await this.api.listItems();
        if (generation !== this.operationGeneration || !this.authenticated) return;
        const items = this.downloads ? await this.downloads.reconcile(serverItems) : serverItems;
        if (generation !== this.operationGeneration || !this.authenticated) return;
        let selected = null;
        let detailError = null;
        if (this.selected && !this.deletion) {
          const selectedId = this.selected.item.id;
          try {
            selected = await this.api.getItem(selectedId);
            const download = items.find((candidate) => candidate.id === selectedId)?.download;
            if (download) selected.item = { ...selected.item, download };
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

  async refreshOfflineLibrary() {
    const generation = this.operationGeneration;
    try {
      const items = await this.downloads.list();
      if (generation !== this.operationGeneration || !this.offline) return;
      this.items = items;
      if (this.selected) {
        const selectedId = this.selected.item.id;
        try {
          this.selected = await this.downloads.get(selectedId);
        } catch {
          this.selected = null;
          this.screen = 'library';
        }
      }
      this.error = items.some((item) => item.download?.status === 'lost')
        ? 'Some offline data is missing. Connect to the Internet and download it again.'
        : null;
      this.emit('library');
    } catch (error) {
      if (generation === this.operationGeneration) this.handleError(error, 'library-error');
    }
  }

  updateDownload(itemId, download) {
    this.items = this.items.map((item) => item.id === itemId ? { ...item, download } : item);
    if (this.selected?.item.id === itemId) {
      this.selected = { ...this.selected, item: { ...this.selected.item, download } };
    }
  }

  downloadItem(itemId) {
    if (!this.authenticated || this.offline || !this.downloads) {
      return Promise.reject(new Error('Connect to the Internet to download this item.'));
    }
    if (this.downloadPromises.has(itemId)) return this.downloadPromises.get(itemId);
    const current = this.selected?.item.id === itemId
      ? this.selected.item
      : this.items.find((item) => item.id === itemId);
    if (!current?.version || current.state !== 'ready') {
      return Promise.reject(new Error('This item is not ready to download.'));
    }
    const authEpoch = this.authEpoch;
    this.updateDownload(itemId, {
      ...current.download, status: 'downloading', version: current.version, message: 'Preparing download…',
    });
    this.error = null;
    this.emit('download-pending');
    const operation = (async () => {
      try {
        const result = await this.downloads.download(current, {
          onProgress: ({ completed, total }) => {
            if (authEpoch !== this.authEpoch) return;
            this.updateDownload(itemId, {
              ...current.download,
              status: 'downloading',
              version: current.version,
              message: `Downloading prepared data… ${completed}/${total}`,
            });
            this.emit('download-progress');
          },
        });
        if (authEpoch !== this.authEpoch) return result;
        this.updateDownload(itemId, { ...result.download, warning: result.warning });
        this.error = result.warning;
        this.emit('download-complete');
        return result;
      } catch (error) {
        if (authEpoch !== this.authEpoch) throw error;
        if (error?.status === 401) {
          this.handleError(error);
        } else {
          this.updateDownload(itemId, {
            ...current.download,
            status: 'failed',
            version: current.download?.version || current.version,
            message: error.message,
          });
          this.error = `Download failed. ${error.message}`;
          this.emit('download-error');
        }
        throw error;
      } finally {
        this.downloadPromises.delete(itemId);
      }
    })();
    this.downloadPromises.set(itemId, operation);
    return operation;
  }

  async removeDownload(itemId) {
    if (!this.authenticated || !this.downloads || this.downloadPromises.has(itemId)) {
      throw new Error('This download cannot be removed now.');
    }
    const authEpoch = this.authEpoch;
    await this.downloads.remove(itemId);
    if (authEpoch !== this.authEpoch) return;
    if (this.offline) {
      this.items = this.items.filter((item) => item.id !== itemId);
      if (this.selected?.item.id === itemId) {
        this.selected = null;
        this.screen = 'library';
        this.operationGeneration += 1;
      }
    } else {
      this.updateDownload(itemId, { status: 'not-downloaded' });
    }
    this.error = null;
    this.emit('download-removed');
  }

  submitArticle(url) {
    return this.submit(url, () => this.api.submitArticle(url));
  }

  uploadMarkdown(file) {
    return this.submit(file, () => this.api.uploadMarkdown(file));
  }

  submit(key, operation) {
    if (!this.authenticated || this.offline) {
      return Promise.reject(new Error('Connect to the Internet to add content.'));
    }
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
    if (!this.authenticated || this.offline) throw new Error('Connect to the Internet to retry preparation.');
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
    if (!this.authenticated || this.offline) {
      return Promise.reject(new Error('Connect to the Internet to delete the server item.'));
    }
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
            this.cleanupWarning = 'The item was deleted, but its local playback or download data could not be fully cleared.';
          }
        }
        if (
          this.deleteAttempts.get(itemId) !== attempt || authEpoch !== this.authEpoch ||
          !this.authenticated
        ) return;
        this.deleteAttempts.delete(itemId);
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
      !this.authenticated || this.offline || !this.needsPolling() || this.deletion ||
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
