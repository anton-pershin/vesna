import { resolveParagraph } from './timing.js';

export class PlaybackController {
  constructor(audio, timings, onParagraph = () => {}) {
    this.audio = audio; this.timings = timings; this.onParagraph = onParagraph;
    this.activeParagraph = null;
    this.audio.addEventListener('timeupdate', () => this.handleTimeUpdate());
    this.audio.addEventListener('seeking', () => this.handleTimeUpdate());
    this.handleTimeUpdate();
  }
  async play() { await this.audio.play(); }
  async playFromParagraph(id) { this.seekToParagraph(id); await this.play(); }
  pause() { this.audio.pause(); }
  setSpeed(speed) {
    if (!Number.isFinite(speed) || speed < 0.5 || speed > 3) throw new RangeError('speed must be between 0.5 and 3');
    this.audio.playbackRate = speed;
  }
  seek(position) { this.audio.currentTime = Math.max(0, position); this.handleTimeUpdate(); }
  seekBy(offset) { this.seek(this.audio.currentTime + offset); }
  seekToParagraph(id) {
    const timing = this.timings.find((candidate) => candidate.id === id);
    if (!timing) throw new Error(`unknown paragraph: ${id}`);
    this.seek(timing.start);
  }
  nextParagraph() {
    const index = this.timings.findIndex((timing) => timing.id === this.activeParagraph);
    const next = this.timings[Math.min(index + 1, this.timings.length - 1)];
    if (next) this.seekToParagraph(next.id);
  }
  previousParagraph() {
    const index = this.timings.findIndex((timing) => timing.id === this.activeParagraph);
    const previous = this.timings[Math.max(index - 1, 0)];
    if (previous) this.seekToParagraph(previous.id);
  }
  handleTimeUpdate() {
    const id = resolveParagraph(this.audio.currentTime, this.timings);
    if (id !== this.activeParagraph) { this.activeParagraph = id; this.onParagraph(id); }
  }
}
