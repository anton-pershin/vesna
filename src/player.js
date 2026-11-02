import { resolveParagraph } from './timing.js';

export class PlaybackController {
  constructor(audio, timings, onParagraph = () => {}) {
    this.audio = audio;
    this.timings = timings;
    this.onParagraph = onParagraph;
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
    await this.waitForMetadata();
    this.audio.currentTime = Math.max(0, position);
    this.handleTimeUpdate();
  }

  async waitForMetadata() {
    if (this.audio.readyState >= 1) return;
    await new Promise((resolve, reject) => {
      const cleanup = () => {
        this.audio.removeEventListener('loadedmetadata', onReady);
        this.audio.removeEventListener('error', onError);
      };
      const onReady = () => { cleanup(); resolve(); };
      const onError = () => { cleanup(); reject(new Error('audio metadata failed to load')); };
      this.audio.addEventListener('loadedmetadata', onReady, { once: true });
      this.audio.addEventListener('error', onError, { once: true });
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
