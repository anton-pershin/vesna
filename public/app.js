import { PlaybackController, PlaybackRestoreGuard, restorePlaybackState } from '/modules/player.js';
import { SeekBarController } from '/modules/seekbar.js';
import { PlaybackStateStore, OfflineFixtureStore } from '/modules/storage.js';
import { registerMediaSession, updateMediaSession } from '/modules/media-session.js';
import {
  FIXTURE_RESOURCES,
  REQUIRED_OFFLINE_RESOURCES,
  SHELL_CACHE,
  SHELL_RESOURCES,
  replaceOfflineFixture,
  waitForOfflineReadiness,
} from '/modules/offline.js';

const PROBE_BUILD = '2026-11-03-ac1-ac4-r3';
const $ = (id) => document.getElementById(id);
const audio = $('audio');
const stateStore = new PlaybackStateStore(localStorage);
const fixtureStore = new OfflineFixtureStore(localStorage);
const status = $('status');
const offline = $('offline');
let version;
let fixture;
let player;
let seekbarController;
let restoringPlaybackState = false;
let nativeSeekTarget = null;
const restoreGuard = new PlaybackRestoreGuard();
const serviceWorkerRegistration = 'serviceWorker' in navigator
  ? navigator.serviceWorker.register('/sw.js')
  : null;

$('build').textContent = `Probe build: ${PROBE_BUILD}`;

async function loadFixture() {
  const [manifest, text, timings] = await Promise.all([
    fetch('/fixtures/manifest.json').then((response) => response.json()),
    fetch('/fixtures/text.json').then((response) => response.json()),
    fetch('/fixtures/timings.json').then((response) => response.json()),
  ]);
  if (manifest.version !== text.version || manifest.version !== timings.version) {
    throw new Error('fixture versions do not match');
  }
  version = manifest.version;
  fixture = { manifest, text, timings };
  audio.src = `/fixtures/${manifest.audio}`;
  $('reader').replaceChildren(...text.paragraphs.map((paragraph) => {
    const item = document.createElement('li');
    item.id = paragraph.id;
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = paragraph.text;
    button.addEventListener('click', () => {
      replacePlaybackPosition(() => player.playFromParagraph(paragraph.id)).catch((error) => {
        status.textContent = `Playback error: ${error.message}`;
      });
    });
    item.append(button);
    return item;
  }));
  player = new PlaybackController(audio, timings.paragraphs, (id) => {
    document.querySelector('.active')?.classList.remove('active');
    const active = id && document.getElementById(id);
    if (active) {
      active.classList.add('active');
      if ($('autoscroll').checked) active.scrollIntoView({ block: 'nearest' });
    }
    saveState();
  });
  const seekbarPlayer = {
    seek: (position) => replacePlaybackPosition(() => player.seek(position)),
  };
  seekbarController = new SeekBarController($('seekbar'), audio, seekbarPlayer, (position) => {
    $('position').textContent = `${formatTime(position)} / ${formatTime(audio.duration || fixture.manifest.duration_seconds)}`;
  }, (error) => {
    status.textContent = `Seek error: ${error.message}`;
  });
  $('seekbar').max = String(Math.floor(fixture.manifest.duration_seconds));

  let saved = null;
  let statusMessage = `Fixture ${version} ready. No saved playback state; starting at 0 seconds at 1×.`;
  try {
    saved = stateStore.load(version);
  } catch (error) {
    statusMessage = `Playback state error for ${version}: ${error.message}. Starting at 0 seconds at 1×.`;
  }
  if (saved) {
    $('speed').value = String(saved.speed);
    try {
      const restoredPosition = await restorePlaybackState(player, saved, (restoring) => {
        restoringPlaybackState = restoring;
      });
      seekbarController.syncFromAudio();
      updatePosition();
      statusMessage = `Restored ${version} at actual audio position ${Math.floor(restoredPosition)} seconds at ${saved.speed}×.`;
    } catch (error) {
      restoreGuard.fail(saved);
      seekbarController.syncFromAudio();
      updatePosition();
      statusMessage = `Restore failed for ${version}: saved position ${Math.floor(saved.position)} seconds, actual audio position ${Math.floor(audio.currentTime)} seconds at ${saved.speed}×. ${error.message}. ${describeAudioState()}`;
    }
  }
  status.textContent = statusMessage;
  registerMediaSession(navigator.mediaSession, player, {
    title: manifest.title, artist: 'Vesna probe', album: 'Offline fixture',
  });
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}

function formatRanges(ranges) {
  const result = [];
  for (let index = 0; index < ranges.length; index += 1) {
    result.push(`${ranges.start(index).toFixed(1)}-${ranges.end(index).toFixed(1)}`);
  }
  return result.join(', ') || 'none';
}

function describeAudioState() {
  return `Media state: readyState=${audio.readyState}, duration=${audio.duration}, seeking=${audio.seeking}, seekable=${formatRanges(audio.seekable)}, buffered=${formatRanges(audio.buffered)}, error=${audio.error?.code ?? 'none'}.`;
}

function updatePosition() {
  if (!player || !Number.isFinite(audio.currentTime)) return;
  const duration = Number.isFinite(audio.duration) ? audio.duration : fixture.manifest.duration_seconds;
  $('seekbar').max = String(Math.floor(duration));
  $('position').textContent = `${formatTime(audio.currentTime)} / ${formatTime(duration)}`;
}

function saveState() {
  if (restoringPlaybackState || restoreGuard.blocked || !player || !Number.isFinite(audio.currentTime)) return;
  stateStore.save({ version, position: audio.currentTime, speed: audio.playbackRate });
  if (Number.isFinite(audio.duration)) {
    updateMediaSession(navigator.mediaSession, {
      duration: audio.duration, position: audio.currentTime, rate: audio.playbackRate,
    });
  }
}

async function replacePlaybackPosition(operation) {
  nativeSeekTarget = null;
  const result = await restoreGuard.replace(operation);
  saveState();
  return result;
}

$('play').addEventListener('click', () => player.play().catch((error) => { status.textContent = `Playback error: ${error.message}`; }));
$('pause').addEventListener('click', () => player.pause());
$('previous').addEventListener('click', () => {
  replacePlaybackPosition(() => player.previousParagraph())
    .catch((error) => { status.textContent = `Seek error: ${error.message}`; });
});
$('next').addEventListener('click', () => {
  replacePlaybackPosition(() => player.nextParagraph())
    .catch((error) => { status.textContent = `Seek error: ${error.message}`; });
});
$('speed').addEventListener('change', (event) => { player.setSpeed(Number(event.target.value)); saveState(); });
audio.addEventListener('timeupdate', saveState);
audio.addEventListener('timeupdate', updatePosition);
audio.addEventListener('seeking', () => {
  if (restoringPlaybackState || player?.pendingSeekCount > 0) nativeSeekTarget = null;
  else nativeSeekTarget = audio.currentTime;
  updatePosition();
});
audio.addEventListener('seeked', () => {
  if (nativeSeekTarget !== null) {
    const target = nativeSeekTarget;
    nativeSeekTarget = null;
    if (!restoreGuard.completeNativeSeek(target, audio.currentTime)) {
      status.textContent = `Seek error: native controls did not reach ${target} seconds (actual ${audio.currentTime}).`;
      return;
    }
  }
  saveState();
});
audio.addEventListener('error', () => { nativeSeekTarget = null; });
audio.addEventListener('durationchange', updatePosition);
audio.addEventListener('pause', saveState);
window.addEventListener('pagehide', saveState);
audio.addEventListener('loadedmetadata', () => { saveState(); updatePosition(); });
$('download').addEventListener('click', async () => {
  try {
    const readyBeforeDownload = await waitForOfflineReadiness({
      serviceWorker: navigator.serviceWorker,
      registration: serviceWorkerRegistration,
      cachesApi: caches,
      requiredResources: SHELL_RESOURCES,
      cacheNames: [SHELL_CACHE],
    });
    const published = await replaceOfflineFixture({
      version,
      resources: FIXTURE_RESOURCES,
      fetchImpl: fetch,
      cachesApi: caches,
      fixtureStore,
      requiredResources: REQUIRED_OFFLINE_RESOURCES,
      cacheNames: [SHELL_CACHE],
    });
    await waitForOfflineReadiness({
      serviceWorker: navigator.serviceWorker,
      registration: readyBeforeDownload.registration,
      cachesApi: caches,
      requiredResources: REQUIRED_OFFLINE_RESOURCES,
      cacheNames: [SHELL_CACHE, published.cacheName],
    });
    offline.textContent = 'Offline readiness: complete.';
  } catch (error) {
    offline.textContent = `Offline readiness: failed (${error.message}).`;
  }
});

loadFixture().catch((error) => { status.textContent = `Fixture error: ${error.message}`; });
