import { resolveParagraph } from './timing.js';

export async function restorePlaybackState(player, state, onRestoring = () => {}) {
  onRestoring(true);
  try {
    player.setSpeed(state.speed);
    return await player.seek(state.position);
  } finally {
    onRestoring(false);
  }
}

export class PlaybackRestoreGuard {
  constructor() {
    this.failedState = null;
  }

  get blocked() {
    return this.failedState !== null;
  }

  fail(state) {
    this.failedState = state;
  }

  async replace(operation) {
    const result = await operation();
    this.failedState = null;
    return result;
  }

  completeNativeSeek(target, actual) {
    const verified = Number.isFinite(target) && Number.isFinite(actual) && Math.abs(actual - target) <= 1;
    if (verified) this.failedState = null;
    return verified;
  }
}

export class PlaybackController {
  constructor(audio, timings, onParagraph = () => {}, { seekTimeoutMs = 15000 } = {}) {
    this.audio = audio;
    this.timings = timings;
    this.onParagraph = onParagraph;
    this.seekTimeoutMs = seekTimeoutMs;
    this.pendingSeekCount = 0;
    this.activeParagraph = null;
    this.audio.addEventListener('timeupdate', () => this.handleTimeUpdate());
    this.audio.addEventListener('seeking', () => this.handleTimeUpdate());
    this.handleTimeUpdate();
  }

  async play() {
    await this.audio.play();
  }

  async playFromParagraph(id) {
    await this.seekToParagraph(id);
    await this.play();
  }

  pause() {
    this.audio.pause();
  }

  setSpeed(speed) {
    if (!Number.isFinite(speed) || speed < 0.5 || speed > 3) {
      throw new RangeError('speed must be between 0.5 and 3');
    }
    this.audio.playbackRate = speed;
  }

  async seek(position) {
    if (!Number.isFinite(position) || position < 0) {
      throw new RangeError('seek position must be a non-negative number');
    }
    this.pendingSeekCount += 1;
    try {
      if (this.audio.readyState < 1) await this.waitForMetadata();
      const duration = this.audio.duration;
      const target = Number.isFinite(duration) && duration > 0
        ? Math.min(position, duration)
        : position;
      let cleanup;
      const waitForSeek = new Promise((resolve, reject) => {
        let timeout;
        const onSeeked = () => { cleanup(); resolve(); };
        const onError = () => { cleanup(); reject(new Error('audio seek failed')); };
        cleanup = () => {
          clearTimeout(timeout);
          this.audio.removeEventListener('seeked', onSeeked);
          this.audio.removeEventListener('error', onError);
        };
        this.audio.addEventListener('seeked', onSeeked, { once: true });
        this.audio.addEventListener('error', onError, { once: true });
        timeout = setTimeout(() => {
          cleanup();
          reject(new Error(`audio seek timed out at ${target} seconds`));
        }, this.seekTimeoutMs);
      });

      try {
        this.audio.currentTime = target;
        if (this.audio.seeking) await waitForSeek;
        else cleanup();
        const actual = this.audio.currentTime;
        if (!Number.isFinite(actual) || Math.abs(actual - target) > 1) {
          throw new Error(`audio seek did not reach ${target} seconds (actual ${actual})`);
        }
        return actual;
      } catch (error) {
        cleanup();
        throw error;
      }
    } finally {
      this.pendingSeekCount -= 1;
      this.handleTimeUpdate();
    }
  }

  async waitForMetadata() {
    if (this.audio.readyState >= 1) return;
    await new Promise((resolve, reject) => {
      let timeout;
      const cleanup = () => {
        clearTimeout(timeout);
        this.audio.removeEventListener('loadedmetadata', onReady);
        this.audio.removeEventListener('error', onError);
      };
      const onReady = () => { cleanup(); resolve(); };
      const onError = () => { cleanup(); reject(new Error('audio metadata failed to load')); };
      this.audio.addEventListener('loadedmetadata', onReady, { once: true });
      this.audio.addEventListener('error', onError, { once: true });
      timeout = setTimeout(() => {
        cleanup();
        reject(new Error('audio metadata wait timed out'));
      }, this.seekTimeoutMs);
    });
  }

  async seekBy(offset) {
    await this.seek(this.audio.currentTime + offset);
  }

  async seekToParagraph(id) {
    const timing = this.timings.find((candidate) => candidate.id === id);
    if (!timing) throw new Error(`unknown paragraph: ${id}`);
    await this.seek(timing.start);
  }

  async nextParagraph() {
    const index = this.timings.findIndex((timing) => timing.id === this.activeParagraph);
    const next = this.timings[Math.min(index + 1, this.timings.length - 1)];
    if (next) await this.seekToParagraph(next.id);
  }

  async previousParagraph() {
    const index = this.timings.findIndex((timing) => timing.id === this.activeParagraph);
    const previous = this.timings[Math.max(index - 1, 0)];
    if (previous) await this.seekToParagraph(previous.id);
  }

  handleTimeUpdate() {
    const id = resolveParagraph(this.audio.currentTime, this.timings);
    if (id !== this.activeParagraph) {
      this.activeParagraph = id;
      this.onParagraph(id);
    }
  }
}
