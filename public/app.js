import { VesnaApi } from '/modules/api.js';
import { ApplicationController } from '/modules/application.js';
import { readMarkdownFile, validateArticleUrl } from '/modules/input.js';
import { PlaybackController, PlaybackRestoreGuard, restorePlaybackState } from '/modules/player.js';
import { PlaybackBarController } from '/modules/playback-bar.js';
import { validatePreparedVersion } from '/modules/prepared.js';
import { SeekBarController } from '/modules/seekbar.js';
import { ItemPlaybackStateStore } from '/modules/storage.js';
import { registerMediaSession, updateMediaSession } from '/modules/media-session.js';
import {
  itemSource,
  itemTitle,
  renderLibrary,
  renderParagraphs,
  setArticleLink,
  setCurrentParagraph,
  stateLabel,
} from '/modules/views.js';

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}

export function startApplication() {
  const $ = (id) => document.getElementById(id);
  const audio = $('audio');
  const api = new VesnaApi();
  const stateStore = new ItemPlaybackStateStore(localStorage);
  const deletedItems = new Set();
  let current = null;
  let player = null;
  let seekbarController = null;
  let restoringPlaybackState = false;
  let nativeSeekTarget = null;
  let playbackLoadSequence = 0;
  let sourceLoadSequence = 0;
  let loadedSourceItem = null;
  let renderedItemId = null;
  let loadingPlaybackKey = null;
  let renderedLibrarySignature = null;
  let observedGeneration = -1;

  function setPlaybackStatus(message) {
    $('playback-status').textContent = message;
  }

  function teardownPlayback() {
    playbackLoadSequence += 1;
    loadingPlaybackKey = null;
    current = null;
    player?.destroy();
    seekbarController?.destroy();
    player = null;
    seekbarController = null;
    restoringPlaybackState = false;
    nativeSeekTarget = null;
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    $('seekbar').value = '0';
    $('seekbar').max = '0';
    $('seekbar').disabled = true;
    $('previous').disabled = true;
    $('next').disabled = true;
    $('speed').disabled = true;
    playbackBar.setEnabled(false);
    $('position').textContent = '0:00 / 0:00';
    $('speed').value = '1';
    setPlaybackStatus('');
    setCurrentParagraph($('reader'), null);
  }

  function updatePosition() {
    if (!current || !Number.isFinite(audio.currentTime)) return;
    const duration = Number.isFinite(audio.duration) && audio.duration > 0
      ? audio.duration
      : current.duration;
    $('seekbar').max = String(Math.max(0, Math.floor(duration)));
    $('position').textContent = `${formatTime(audio.currentTime)} / ${formatTime(duration)}`;
  }

  function saveState() {
    if (
      restoringPlaybackState || current?.restoreGuard.blocked || !current || !player ||
      deletedItems.has(current.item.id) || !Number.isFinite(audio.currentTime)
    ) return;
    try {
      stateStore.save({
        itemId: current.item.id,
        version: current.version,
        position: audio.currentTime,
        speed: audio.playbackRate,
      });
    } catch (error) {
      setPlaybackStatus(`Playback position could not be saved: ${error.message}`);
    }
    if (Number.isFinite(audio.duration)) {
      updateMediaSession(navigator.mediaSession, {
        duration: audio.duration,
        position: audio.currentTime,
        rate: audio.playbackRate,
      });
    }
  }

  async function replacePlaybackPosition(operation) {
    if (!current || !player) throw new Error('Prepared audio is not loaded');
    nativeSeekTarget = null;
    const active = current;
    const result = await active.restoreGuard.replace(operation);
    if (current === active) saveState();
    return result;
  }

  function playbackError(action, error) {
    setPlaybackStatus(`${action}: ${error.message}`);
  }

  const playbackBar = new PlaybackBarController({
    audio,
    button: $('play-pause'),
    onToggle: async () => {
      if (!player) return;
      if (audio.paused || audio.ended) await player.play();
      else player.pause();
    },
    onError: (error) => playbackError('Playback error', error),
  });

  async function loadPrepared(item) {
    const key = JSON.stringify([item.id, item.version]);
    if (current?.key === key || loadingPlaybackKey === key) return;
    teardownPlayback();
    const sequence = playbackLoadSequence;
    loadingPlaybackKey = key;
    $('player').hidden = false;
    setPlaybackStatus('Loading prepared audio…');
    renderParagraphs($('reader'), [], { ready: false, onSelect: selectParagraph });

    try {
      const [textResult, timingResult] = await Promise.all([
        api.getText(item.id, item.version),
        api.getTimings(item.id, item.version),
      ]);
      if (sequence !== playbackLoadSequence) return;
      const prepared = validatePreparedVersion(textResult, timingResult, item.version);
      const restoreGuard = new PlaybackRestoreGuard();
      loadingPlaybackKey = null;
      current = {
        key,
        item,
        version: item.version,
        duration: prepared.duration,
        restoreGuard,
      };
      audio.playbackRate = 1;
      audio.src = api.audioUrl(item.id, item.version);
      renderParagraphs($('reader'), prepared.paragraphs, {
        ready: true,
        onSelect: selectParagraph,
      });
      player = new PlaybackController(audio, prepared.timings, (id) => {
        if (!current) return;
        setCurrentParagraph($('reader'), id, { autoScroll: $('autoscroll').checked });
        saveState();
      });
      $('seekbar').disabled = false;
      $('previous').disabled = false;
      $('next').disabled = false;
      $('speed').disabled = false;
      playbackBar.setEnabled(true);
      const seekbarPlayer = {
        seek: (position) => replacePlaybackPosition(() => player.seek(position)),
      };
      seekbarController = new SeekBarController($('seekbar'), audio, seekbarPlayer, (position) => {
        $('position').textContent = `${formatTime(position)} / ${formatTime(audio.duration || prepared.duration)}`;
      }, (error) => playbackError('Seek error', error));
      $('seekbar').max = String(Math.floor(prepared.duration));

      const mediaSessionPlayer = {
        play: () => player.play(),
        pause: () => player.pause(),
        seek: (position) => replacePlaybackPosition(() => player.seek(position)),
        seekBy: (offset) => replacePlaybackPosition(() => player.seekBy(offset)),
      };
      registerMediaSession(navigator.mediaSession, mediaSessionPlayer, {
        title: itemTitle(item),
        artist: 'Vesna',
        album: item.kind === 'markdown' ? 'Markdown library' : 'Article library',
      });

      let saved = null;
      let statusMessage = 'Ready to play.';
      try {
        saved = stateStore.load(item.id, item.version);
      } catch {
        statusMessage = 'Saved playback is unavailable. Starting from the beginning.';
      }
      if (saved && !deletedItems.has(item.id)) {
        $('speed').value = String(saved.speed);
        try {
          await restorePlaybackState(player, saved, (restoring) => {
            restoringPlaybackState = restoring;
          });
          if (sequence !== playbackLoadSequence) return;
          seekbarController.syncFromAudio();
          updatePosition();
          statusMessage = 'Resumed where you left off.';
        } catch {
          if (sequence !== playbackLoadSequence) return;
          restoreGuard.fail(saved);
          seekbarController.syncFromAudio();
          updatePosition();
          statusMessage = 'The saved position could not be restored. Your last saved position is preserved.';
        }
      }
      if (sequence === playbackLoadSequence) setPlaybackStatus(statusMessage);
    } catch (error) {
      if (sequence !== playbackLoadSequence) return;
      if (error?.status === 401) {
        controller.handleError(error);
        return;
      }
      teardownPlayback();
      $('player').hidden = true;
      const detail = controller.selected;
      renderParagraphs($('reader'), detail?.paragraphs || [], {
        ready: false,
        onSelect: selectParagraph,
      });
      $('app-error').hidden = false;
      $('app-error').textContent = 'Prepared audio could not be loaded. Check your connection and try again.';
    }
  }

  async function loadMarkdownSource(detail) {
    const { item } = detail;
    if (item.kind !== 'markdown' || !detail.source_available) {
      loadedSourceItem = null;
      sourceLoadSequence += 1;
      $('source-text').textContent = '';
      return;
    }
    if (loadedSourceItem === item.id) return;
    loadedSourceItem = item.id;
    const sequence = ++sourceLoadSequence;
    $('source-text').textContent = 'Loading original Markdown…';
    try {
      const source = await api.getSourceText(item.id);
      if (sequence !== sourceLoadSequence || controller.selected?.item.id !== item.id) return;
      $('source-text').textContent = source;
    } catch (error) {
      if (sequence !== sourceLoadSequence) return;
      loadedSourceItem = null;
      if (error?.status === 401) {
        controller.handleError(error);
        return;
      }
      $('source-text').textContent = `Original Markdown could not be loaded: ${error.message}`;
    }
  }

  function selectParagraph(id) {
    if (!player) return;
    replacePlaybackPosition(() => player.playFromParagraph(id))
      .catch((error) => playbackError('Playback error', error));
  }

  function renderSelected(detail, deletion = null) {
    if (!detail) {
      teardownPlayback();
      renderedItemId = null;
      loadedSourceItem = null;
      sourceLoadSequence += 1;
      $('reader').replaceChildren();
      $('source-text').textContent = '';
      $('article-link').removeAttribute('href');
      $('source-download').removeAttribute('href');
      $('player').hidden = true;
      return;
    }
    const { item } = detail;
    const itemChanged = renderedItemId !== item.id;
    if (itemChanged) {
      renderedItemId = item.id;
      loadedSourceItem = null;
      $('source-panel').open = false;
      $('item-menu').open = false;
      $('playback-settings').open = false;
    }
    $('item-title').textContent = itemTitle(item);
    $('item-kind').textContent = item.kind === 'markdown' ? 'Markdown' : 'Article';
    $('item-state').textContent = stateLabel(item.state);
    $('item-state').dataset.state = item.state;
    $('item-source').textContent = item.kind === 'markdown' ? 'Markdown document' : 'Public article';
    $('source-detail').textContent = itemSource(item);
    $('item-error').hidden = item.state !== 'failed';
    $('item-error').textContent = item.state === 'failed'
      ? (item.error || 'Preparation failed. Retry when you are ready.')
      : '';
    $('retry').hidden = item.state !== 'failed';
    setArticleLink($('article-link'), item.kind === 'article' ? item.source_url : null);

    const sourceAvailable = item.kind === 'markdown' && detail.source_available;
    $('markdown-source').hidden = !sourceAvailable;
    if (sourceAvailable) {
      $('source-download').href = api.sourceUrl(item.id);
      $('source-download').download = item.filename || 'original.md';
    } else {
      $('source-download').removeAttribute('href');
    }

    const playable = typeof item.version === 'string' && Boolean(item.version);
    $('reader-help').textContent = playable
      ? 'Select a paragraph to play from that point.'
      : 'Listening text is available while Vesna prepares this item.';
    const key = playable ? JSON.stringify([item.id, item.version]) : null;
    if (!playable) {
      teardownPlayback();
      $('player').hidden = true;
      renderParagraphs($('reader'), detail.paragraphs || [], {
        ready: false,
        onSelect: selectParagraph,
      });
    } else if (!deletion && current?.key !== key) {
      $('player').hidden = false;
      loadPrepared(item).catch((error) => playbackError('Playback error', error));
    } else {
      $('player').hidden = !current;
    }
    if (!deletion && $('source-panel').open) {
      loadMarkdownSource(detail).catch((error) => {
        $('source-text').textContent = `Original Markdown could not be loaded: ${error.message}`;
      });
    }
  }

  function clearPrivateViews() {
    teardownPlayback();
    renderedLibrarySignature = null;
    renderedItemId = null;
    loadedSourceItem = null;
    sourceLoadSequence += 1;
    $('library').replaceChildren();
    $('reader').replaceChildren();
    $('source-text').textContent = '';
    $('article-link').removeAttribute('href');
    $('source-download').removeAttribute('href');
    $('password').value = '';
    $('article-form').reset();
    $('markdown-form').reset();
    $('selected-file').hidden = true;
    if ($('delete-dialog').open) $('delete-dialog').close();
    $('player').hidden = true;
  }

  function focusHeading(reason) {
    if (reason === 'input') $('add-heading').focus({ preventScroll: true });
    if (['close-input', 'close-item', 'deleted'].includes(reason)) {
      $('library-heading').focus({ preventScroll: true });
    }
    if (['signed-out', 'session-expired'].includes(reason)) {
      $('password').focus({ preventScroll: true });
    }
  }

  const controller = new ApplicationController({
    api,
    onDeleteConfirmed(itemId) {
      deletedItems.add(itemId);
      stateStore.removeItem(itemId);
    },
    onChange(state, reason) {
      if (state.generation !== observedGeneration) {
        observedGeneration = state.generation;
        playbackLoadSequence += 1;
        sourceLoadSequence += 1;
        loadingPlaybackKey = null;
        loadedSourceItem = null;
      }
      if (reason === 'signed-out' || reason === 'session-expired') clearPrivateViews();

      $('auth-view').hidden = state.authenticated;
      $('application-view').hidden = !state.authenticated;
      $('sign-out').hidden = !state.authenticated;
      $('library-view').hidden = !state.authenticated || state.screen !== 'library';
      $('input-view').hidden = !state.authenticated || state.screen !== 'input';
      $('item-view').hidden = !state.authenticated || state.screen !== 'reader';
      $('app-error').hidden = !state.error && !state.cleanupWarning;
      $('app-error').textContent = state.error || state.cleanupWarning || '';
      $('submit-article').disabled = state.submitting;
      $('upload-markdown').disabled = state.submitting;
      $('select-article').disabled = state.submitting;
      $('select-markdown').disabled = state.submitting;

      if (reason === 'sign-in-required') $('app-status').textContent = '';
      else if (reason === 'signed-out') $('app-status').textContent = 'Signed out.';
      else if (reason === 'session-expired') $('app-status').textContent = 'Sign in again to continue.';
      else if (reason === 'sign-in') $('app-status').textContent = 'Loading your library…';
      else if (reason === 'submitted') $('app-status').textContent = 'Submitted. Preparation continues while you do other things.';
      else if (reason === 'retry') $('app-status').textContent = 'Retry started for the same item.';
      else if (reason === 'deleted') $('app-status').textContent = 'Item deleted.';
      else if (reason === 'delete-pending') $('app-status').textContent = 'Deleting item…';
      else if (reason === 'delete-error') $('app-status').textContent = '';
      else if (reason === 'playback-error') $('app-status').textContent = '';
      else $('app-status').textContent = '';

      if (state.authenticated) {
        const librarySignature = JSON.stringify(state.items);
        if (librarySignature !== renderedLibrarySignature) {
          renderLibrary($('library'), state.items, { onOpen: openItem, onRetry: retryItem });
          renderedLibrarySignature = librarySignature;
        }
        $('library-count').textContent = `${state.items.length} ${state.items.length === 1 ? 'item' : 'items'}`;
        $('library-empty').hidden = state.items.length > 0;
        renderSelected(state.selected, state.deletion);
        if (state.deletion) {
          $('delete-error').hidden = !state.error;
          $('delete-error').textContent = state.error || '';
          $('confirm-delete').disabled = state.deletion.status === 'pending';
        }
      }
      focusHeading(reason);
    },
  });

  async function openItem(itemId) {
    try {
      const detail = await controller.openItem(itemId);
      if (!detail) return;
      $('item-title').focus({ preventScroll: true });
      $('item-view').scrollIntoView({ block: 'start' });
    } catch {
      // The controller displays a safe API error.
    }
  }

  async function retryItem(itemId) {
    try {
      await controller.retry(itemId);
    } catch {
      // The controller displays a safe API error.
    }
  }

  $('sign-in-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    $('sign-in').disabled = true;
    const password = $('password').value;
    $('password').value = '';
    try {
      await controller.signIn(password);
      $('add-content').focus();
    } catch {
      $('password').focus();
    } finally {
      $('password').value = '';
      $('sign-in').disabled = false;
    }
  });

  $('sign-out').addEventListener('click', async () => {
    $('sign-out').disabled = true;
    try {
      await controller.signOut();
    } catch {
      $('app-error').hidden = false;
      $('app-error').textContent = 'Server sign-out failed. Private content was cleared from this screen.';
    } finally {
      $('sign-out').disabled = false;
    }
  });

  function showInput() {
    controller.showInput();
  }
  $('add-content').addEventListener('click', showInput);
  $('empty-add').addEventListener('click', showInput);
  $('close-input').addEventListener('click', () => controller.closeInput());

  function selectInput(kind) {
    const article = kind === 'article';
    $('article-panel').hidden = !article;
    $('markdown-panel').hidden = article;
    $('select-article').setAttribute('aria-pressed', String(article));
    $('select-markdown').setAttribute('aria-pressed', String(!article));
  }
  $('select-article').addEventListener('click', () => selectInput('article'));
  $('select-markdown').addEventListener('click', () => selectInput('markdown'));

  $('article-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    $('submit-article').disabled = true;
    try {
      const url = validateArticleUrl($('article-url').value);
      const item = await controller.submitArticle(url);
      if (!item) return;
      $('article-form').reset();
      await openItem(item.id);
    } catch (error) {
      $('app-error').hidden = false;
      $('app-error').textContent = error.message;
    } finally {
      $('submit-article').disabled = false;
    }
  });

  $('markdown-file').addEventListener('change', () => {
    const file = $('markdown-file').files?.[0];
    $('selected-file').hidden = !file;
    $('selected-file').textContent = file
      ? `${file.name} · ${Math.max(1, Math.ceil(file.size / 1024))} KB · ready to upload`
      : '';
  });

  $('markdown-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    $('upload-markdown').disabled = true;
    try {
      const file = $('markdown-file').files?.[0];
      await readMarkdownFile(file);
      const item = await controller.uploadMarkdown(file);
      if (!item) return;
      $('markdown-form').reset();
      $('selected-file').hidden = true;
      await openItem(item.id);
    } catch (error) {
      $('app-error').hidden = false;
      $('app-error').textContent = error.message;
    } finally {
      $('upload-markdown').disabled = false;
    }
  });

  $('refresh').addEventListener('click', () => controller.refreshLibrary());
  $('close-item').addEventListener('click', () => controller.closeItem());
  $('source-panel').addEventListener('toggle', () => {
    if ($('source-panel').open && controller.selected && !controller.deletion) {
      loadMarkdownSource(controller.selected).catch((error) => {
        $('source-text').textContent = `Original Markdown could not be loaded: ${error.message}`;
      });
    }
  });
  $('close-source').addEventListener('click', () => {
    $('source-panel').open = false;
    $('source-panel').querySelector('summary').focus({ preventScroll: true });
  });
  $('retry').addEventListener('click', () => {
    if (controller.selected) retryItem(controller.selected.item.id);
  });

  $('previous').addEventListener('click', () => {
    if (!player) return;
    replacePlaybackPosition(() => player.previousParagraph())
      .catch((error) => playbackError('Seek error', error));
  });
  $('next').addEventListener('click', () => {
    if (!player) return;
    replacePlaybackPosition(() => player.nextParagraph())
      .catch((error) => playbackError('Seek error', error));
  });
  $('speed').addEventListener('change', (event) => {
    if (!player) return;
    try {
      player.setSpeed(Number(event.target.value));
      saveState();
    } catch (error) {
      playbackError('Speed error', error);
    }
  });

  $('delete-item').addEventListener('click', () => {
    if (!controller.selected) return;
    $('item-menu').open = false;
    $('delete-item-name').textContent = itemTitle(controller.selected.item);
    $('delete-error').hidden = true;
    $('confirm-delete').disabled = false;
    $('delete-dialog').showModal();
    $('cancel-delete').focus();
  });
  $('cancel-delete').addEventListener('click', () => $('delete-dialog').close());
  $('delete-dialog').addEventListener('close', () => {
    if (controller.selected) $('item-menu').querySelector('summary').focus({ preventScroll: true });
  });
  $('confirm-delete').addEventListener('click', async () => {
    if (!controller.selected) return;
    audio.pause();
    try {
      await controller.deleteItem(controller.selected.item.id);
      if ($('delete-dialog').open) $('delete-dialog').close();
    } catch {
      $('confirm-delete').disabled = false;
    }
  });

  audio.addEventListener('timeupdate', saveState);
  audio.addEventListener('timeupdate', updatePosition);
  audio.addEventListener('seeking', () => {
    if (restoringPlaybackState || player?.pendingSeekCount > 0) nativeSeekTarget = null;
    else nativeSeekTarget = audio.currentTime;
    updatePosition();
  });
  audio.addEventListener('seeked', () => {
    if (nativeSeekTarget !== null && current) {
      const target = nativeSeekTarget;
      nativeSeekTarget = null;
      if (!current.restoreGuard.completeNativeSeek(target, audio.currentTime)) {
        setPlaybackStatus('Seeking did not reach the requested position. Your saved position is preserved.');
        return;
      }
    }
    saveState();
  });
  audio.addEventListener('error', () => {
    nativeSeekTarget = null;
    if (current && !restoringPlaybackState) {
      setPlaybackStatus('Audio playback failed. Check your connection and try again.');
    }
  });
  audio.addEventListener('durationchange', updatePosition);
  audio.addEventListener('pause', saveState);
  audio.addEventListener('loadedmetadata', () => { saveState(); updatePosition(); });
  window.addEventListener('pagehide', saveState);

  async function showBuildVersion() {
    try {
      const commit = await api.build();
      $('build-version').textContent = commit.slice(0, 8);
    } catch {
      $('build-version').textContent = 'M4';
    }
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      $('app-status').textContent = 'Offline application launch is unavailable. Online features still work.';
    });
  }
  showBuildVersion();
  controller.restoreSession();
  return { controller, playbackBar };
}

if (typeof document !== 'undefined') startApplication();
