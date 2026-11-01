import { PlaybackController } from '/modules/player.js';
import { PlaybackStateStore, OfflineFixtureStore } from '/modules/storage.js';
import { registerMediaSession, updateMediaSession } from '/modules/media-session.js';

const $ = (id) => document.getElementById(id);
const audio = $('audio');
const stateStore = new PlaybackStateStore(localStorage);
const fixtureStore = new OfflineFixtureStore(localStorage);
const status = $('status');
const offline = $('offline');
const version = 'fixture-en-v1';
let fixture;
let player;

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
    button.addEventListener('click', () => player.seekToParagraph(paragraph.id));
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
    player.setSpeed(saved.speed);
    player.seek(saved.position);
    $('speed').value = String(saved.speed);
    status.textContent = `Restored position ${Math.floor(saved.position)} seconds at ${saved.speed}×.`;
  } else status.textContent = 'Fixture ready.';
  registerMediaSession(navigator.mediaSession, player, {
    title: manifest.title, artist: 'Vesna probe', album: 'Offline fixture',
  });
}

function saveState() {
  if (!player || !Number.isFinite(audio.currentTime)) return;
  stateStore.save({ version, position: audio.currentTime, speed: audio.playbackRate });
  if (Number.isFinite(audio.duration)) {
    updateMediaSession(navigator.mediaSession, {
      duration: audio.duration, position: audio.currentTime, rate: audio.playbackRate,
    });
  }
}

$('play').addEventListener('click', () => player.play());
$('pause').addEventListener('click', () => player.pause());
$('previous').addEventListener('click', () => player.previousParagraph());
$('next').addEventListener('click', () => player.nextParagraph());
$('speed').addEventListener('change', (event) => { player.setSpeed(Number(event.target.value)); saveState(); });
audio.addEventListener('timeupdate', saveState);
audio.addEventListener('pause', saveState);
audio.addEventListener('loadedmetadata', saveState);
$('download').addEventListener('click', async () => {
  try {
    const resources = ['/fixtures/manifest.json', '/fixtures/text.json', '/fixtures/timings.json', '/fixtures/audio/fixture.mp3'];
    const responses = await Promise.all(resources.map((url) => fetch(url)));
    if (responses.some((response) => !response.ok)) throw new Error('resource download failed');
    const cache = await caches.open('vesna-probe-fixture-v1');
    await Promise.all(resources.map((url, index) => cache.put(url, responses[index].clone())));
    fixtureStore.publish({ version, resources });
    offline.textContent = 'Offline readiness: complete.';
  } catch (error) {
    offline.textContent = `Offline readiness: failed (${error.message}).`;
  }
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js');
loadFixture().catch((error) => { status.textContent = `Fixture error: ${error.message}`; });
