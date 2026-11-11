import { VesnaApi } from '/modules/api.js';
import { ApplicationController } from '/modules/application.js';
import { readMarkdownFile, validateArticleUrl } from '/modules/input.js';
import { PlaybackController, PlaybackRestoreGuard, restorePlaybackState } from '/modules/player.js';
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

function formatRanges(ranges) {
  if (!ranges) return 'none';
  const result = [];
  for (let index = 0; index < ranges.length; index += 1) {
    result.push(`${ranges.start(index).toFixed(1)}-${ranges.end(index).toFixed(1)}`);
  }
  return result.join(', ') || 'none';
}

export function startApplication() {
  const $ = (id) => document.getElementById(id);
  const audio = $('audio');
  const api = new VesnaApi();
  const stateStore = new ItemPlaybackStateStore(localStorage);
  let current = null;
  let player = null;
  let seekbarController = null;
  let restoringPlaybackState = false;
  let nativeSeekTarget = null;
  let playbackLoadSequence = 0;
  let sourceLoadSequence = 0;
  let loadedSourceItem = null;
  let loadingPlaybackKey = null;
  let renderedLibrarySignature = null;

  function setPlaybackStatus(message) {
    $('playback-status').textContent = message;
  }

  function teardownPlayback() {
    playbackLoadSequence += 1;
    loadingPlaybackKey = null;
    current = null;
    player = null;
    seekbarController = null;
    restoringPlaybackState = false;
    nativeSeekTarget = null;
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    $('seekbar').value = '0';
    $('seekbar').max = '0';
    $('position').textContent = '0:00 / 0:00';
    $('speed').value = '1';
    setCurrentParagraph($('reader'), null);
  }

  function describeAudioState() {
    return `Media state: readyState=${audio.readyState}, duration=${audio.duration}, seeking=${audio.seeking}, seekable=${formatRanges(audio.seekable)}, buffered=${formatRanges(audio.buffered)}, error=${audio.error?.code ?? 'none'}.`;
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
      !Number.isFinite(audio.currentTime)
    ) return;
    try {
      stateStore.save({
        itemId: current.item.id,
        version: current.version,
        position: audio.currentTime,
        speed: audio.playbackRate,
      });
    } catch (error) {
      setPlaybackStatus(`Playback state could not be saved: ${error.message}`);
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

  async function loadPrepared(item) {
    const key = JSON.stringify([item.id, item.version]);
    if (current?.key === key || loadingPlaybackKey === key) return;
    teardownPlayback();
    const sequence = playbackLoadSequence;
    loadingPlaybackKey = key;
    $('player').hidden = false;
    setPlaybackStatus('Loading prepared text, timings, and audio…');
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
      let statusMessage = `Prepared version ${item.version} is ready. No saved position; starting at 0 seconds at 1×.`;
      try {
        saved = stateStore.load(item.id, item.version);
      } catch (error) {
        statusMessage = `Saved playback state is unavailable: ${error.message}. Starting at 0 seconds at 1×.`;
      }
      if (saved) {
        $('speed').value = String(saved.speed);
        try {
          const restoredPosition = await restorePlaybackState(player, saved, (restoring) => {
            restoringPlaybackState = restoring;
          });
          if (sequence !== playbackLoadSequence) return;
          seekbarController.syncFromAudio();
          updatePosition();
          statusMessage = `Restored actual audio position ${Math.floor(restoredPosition)} seconds at ${saved.speed}× for this prepared version.`;
        } catch (error) {
          if (sequence !== playbackLoadSequence) return;
          restoreGuard.fail(saved);
          seekbarController.syncFromAudio();
          updatePosition();
          statusMessage = `Restore failed: saved position ${Math.floor(saved.position)} seconds, actual audio position ${Math.floor(audio.currentTime)} seconds at ${saved.speed}×. ${error.message}. The last valid saved position is preserved. ${describeAudioState()}`;
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
      $('player').hidden = false;
      setPlaybackStatus(`Prepared playback could not be loaded: ${error.message}`);
      const detail = controller.selected;
      renderParagraphs($('reader'), detail?.paragraphs || [], {
        ready: false,
        onSelect: selectParagraph,
      });
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
    replacePlaybackPosition(() => player.playFromParagraph(id))
      .catch((error) => playbackError('Playback error', error));
  }

  function renderSelected(detail) {
    if (!detail) {
      teardownPlayback();
      loadedSourceItem = null;
      sourceLoadSequence += 1;
      $('item-view').hidden = true;
      $('reader').replaceChildren();
      $('source-text').textContent = '';
      $('article-link').removeAttribute('href');
      $('source-download').removeAttribute('href');
      return;
    }
    const { item } = detail;
    $('item-view').hidden = false;
    $('item-title').textContent = itemTitle(item);
    $('item-state').textContent = `Preparation status: ${stateLabel(item.state)}`;
    $('item-state').dataset.state = item.state;
    $('item-source').textContent = itemSource(item);
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

    const ready = item.state === 'ready' && typeof item.version === 'string' && item.version;
    $('reader-help').textContent = ready
      ? 'Select a paragraph to play from that point. The current paragraph is labelled and highlighted.'
      : 'Listening text is available for source inspection. Playback becomes available only when preparation is ready.';
    $('player').hidden = !ready && !current;
    if (!ready) {
      teardownPlayback();
      $('player').hidden = true;
      renderParagraphs($('reader'), detail.paragraphs || [], {
        ready: false,
        onSelect: selectParagraph,
      });
    }
    loadMarkdownSource(detail).catch((error) => {
      $('source-text').textContent = `Original Markdown could not be loaded: ${error.message}`;
    });
    if (ready) {
      const key = JSON.stringify([item.id, item.version]);
      if (current?.key !== key) loadPrepared(item).catch((error) => playbackError('Playback error', error));
    }
  }

  function clearPrivateViews() {
    teardownPlayback();
    renderedLibrarySignature = null;
    loadedSourceItem = null;
    sourceLoadSequence += 1;
    $('library').replaceChildren();
    $('reader').replaceChildren();
    $('item-view').hidden = true;
    $('item-title').textContent = '';
    $('item-source').textContent = '';
    $('source-text').textContent = '';
    $('article-link').removeAttribute('href');
    $('source-download').removeAttribute('href');
    $('password').value = '';
    $('article-form').reset();
    $('markdown-form').reset();
  }

  const controller = new ApplicationController({
    api,
    onChange(state, reason) {
      $('auth-view').hidden = state.authenticated;
      $('application-view').hidden = !state.authenticated;
      $('sign-out').hidden = !state.authenticated;
      $('app-error').hidden = !state.error;
      $('app-error').textContent = state.error || '';
      if (reason === 'signed-out' || reason === 'session-expired') {
        clearPrivateViews();
        $('app-status').textContent = reason === 'session-expired'
          ? 'Sign in again to continue.'
          : 'Signed out. Private item data has been cleared from the page.';
      } else if (reason === 'sign-in') {
        $('app-status').textContent = 'Signed in. Loading your saved library…';
      } else if (reason === 'library') {
        $('app-status').textContent = state.polling
          ? 'Library updated. Preparation status will refresh automatically.'
          : 'Library updated.';
      } else if (reason === 'submitted') {
        $('app-status').textContent = 'Submission accepted. Preparation continues on the server.';
      } else if (reason === 'retry') {
        $('app-status').textContent = 'Retry accepted for the same library item.';
      } else if (reason === 'item') {
        $('app-status').textContent = 'Item details loaded.';
      }

      if (state.authenticated) {
        const librarySignature = JSON.stringify(state.items);
        if (librarySignature !== renderedLibrarySignature) {
          renderLibrary($('library'), state.items, {
            onOpen: openItem,
            onRetry: retryItem,
          });
          renderedLibrarySignature = librarySignature;
        }
        $('library-empty').hidden = state.items.length > 0;
        renderSelected(state.selected);
      }
    },
  });

  async function openItem(itemId) {
    try {
      const detail = await controller.openItem(itemId);
      if (!detail) return;
      $('item-title').tabIndex = -1;
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
      $('article-url').focus();
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
      $('app-error').textContent = 'Server sign-out failed. Private item data was cleared from this page.';
    } finally {
      $('sign-out').disabled = false;
    }
  });

  $('article-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    $('submit-article').disabled = true;
    try {
      const url = validateArticleUrl($('article-url').value);
      const item = await controller.submitArticle(url);
      $('article-form').reset();
      await openItem(item.id);
    } catch (error) {
      $('app-error').hidden = false;
      $('app-error').textContent = error.message;
    } finally {
      $('submit-article').disabled = false;
    }
  });

  $('markdown-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    $('upload-markdown').disabled = true;
    try {
      const file = $('markdown-file').files?.[0];
      await readMarkdownFile(file);
      const item = await controller.uploadMarkdown(file);
      $('markdown-form').reset();
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
  $('retry').addEventListener('click', () => {
    if (controller.selected) retryItem(controller.selected.item.id);
  });
  $('play').addEventListener('click', () => {
    if (!player) return;
    player.play().catch((error) => playbackError('Playback error', error));
  });
  $('pause').addEventListener('click', () => player?.pause());
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
        setPlaybackStatus(`Seek error: native controls did not reach ${target} seconds (actual ${audio.currentTime}). The saved position is preserved.`);
        return;
      }
    }
    saveState();
  });
  audio.addEventListener('error', () => {
    nativeSeekTarget = null;
    if (current && !restoringPlaybackState) {
      setPlaybackStatus(`Audio playback failed. Check the connection and retry the item or reload the page. ${describeAudioState()}`);
    }
  });
  audio.addEventListener('durationchange', updatePosition);
  audio.addEventListener('pause', saveState);
  audio.addEventListener('loadedmetadata', () => { saveState(); updatePosition(); });
  window.addEventListener('pagehide', saveState);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      $('app-status').textContent = 'The offline application shell is unavailable. Online features can still be used.';
    });
  }
  controller.restoreSession();
  return controller;
}

if (typeof document !== 'undefined') startApplication();
