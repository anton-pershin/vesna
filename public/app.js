import { PlaybackController, restorePlaybackState } from '/modules/player.js';
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

const $ = (id) => document.getElementById(id);
const audio = $('audio');
const stateStore = new PlaybackStateStore(localStorage);
const fixtureStore = new OfflineFixtureStore(localStorage);
const status = $('status');
const offline = $('offline');
const version = 'fixture-en-v1';
let fixture;
let player;
let restoringPlaybackState = false;
const serviceWorkerRegistration = 'serviceWorker' in navigator
  ? navigator.serviceWorker.register('/sw.js')
  : null;

async function loadFixture() {
  const [manifest, text, timings] = await Promise.all([
    fetch('/fixtures/manifest.json').then((response) => response.json()),
    fetch('/fixtures/text.json').then((response) => response.json()),
    fetch('/fixtures/timings.json').then((response) => response.json()),
  ]);
  if (manifest.version !== text.version || manifest.version !== timings.version) {
    throw new Error('fixture versions do not match');
  }
  fixture = { manifest, text, timings };
  audio.src = `/fixtures/${manifest.audio}`;
  $('reader').replaceChildren(...text.paragraphs.map((paragraph) => {
    const item = document.createElement('li');
    item.id = paragraph.id;
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = paragraph.text;
    button.addEventListener('click', () => {
      player.playFromParagraph(paragraph.id).catch((error) => {
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
  const saved = stateStore.load(version);
  if (saved) {
    await restorePlaybackState(player, saved, (restoring) => {
      restoringPlaybackState = restoring;
    });
    $('speed').value = String(saved.speed);
    updatePosition();
    status.textContent = `Restored position ${Math.floor(saved.position)} seconds at ${saved.speed}×.`;
  } else status.textContent = 'Fixture ready.';
  registerMediaSession(navigator.mediaSession, player, {
    title: manifest.title, artist: 'Vesna probe', album: 'Offline fixture',
  });
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}

function updatePosition() {
  if (!player || !Number.isFinite(audio.currentTime)) return;
  const duration = Number.isFinite(audio.duration) ? audio.duration : fixture.manifest.duration_seconds;
  $('seekbar').max = String(Math.floor(duration));
  $('seekbar').value = String(Math.floor(audio.currentTime));
  $('position').textContent = `${formatTime(audio.currentTime)} / ${formatTime(duration)}`;
}

function saveState() {
  if (restoringPlaybackState || !player || !Number.isFinite(audio.currentTime)) return;
  stateStore.save({ version, position: audio.currentTime, speed: audio.playbackRate });
  if (Number.isFinite(audio.duration)) {
    updateMediaSession(navigator.mediaSession, {
      duration: audio.duration, position: audio.currentTime, rate: audio.playbackRate,
    });
  }
}

$('play').addEventListener('click', () => player.play().catch((error) => { status.textContent = `Playback error: ${error.message}`; }));
$('pause').addEventListener('click', () => player.pause());
$('previous').addEventListener('click', () => player.previousParagraph().catch((error) => { status.textContent = `Seek error: ${error.message}`; }));
$('next').addEventListener('click', () => player.nextParagraph().catch((error) => { status.textContent = `Seek error: ${error.message}`; }));
$('seekbar').addEventListener('input', (event) => {
  const position = Number(event.target.value);
  $('position').textContent = `${formatTime(position)} / ${formatTime(audio.duration || fixture.manifest.duration_seconds)}`;
});
$('seekbar').addEventListener('change', (event) => {
  player.seek(Number(event.target.value)).catch((error) => { status.textContent = `Seek error: ${error.message}`; });
});
$('speed').addEventListener('change', (event) => { player.setSpeed(Number(event.target.value)); saveState(); });
audio.addEventListener('timeupdate', saveState);
audio.addEventListener('timeupdate', updatePosition);
audio.addEventListener('seeking', updatePosition);
audio.addEventListener('durationchange', updatePosition);
audio.addEventListener('pause', saveState);
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
