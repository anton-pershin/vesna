export class SeekBarController {
  constructor(slider, audio, player, onPosition = () => {}) {
    this.slider = slider;
    this.audio = audio;
    this.player = player;
    this.onPosition = onPosition;
    this.dragging = false;
    this.pendingPosition = Number(slider.value) || 0;
    this.commitQueued = false;

    slider.addEventListener('pointerdown', () => { this.dragging = true; });
    slider.addEventListener('touchstart', () => { this.dragging = true; }, { passive: true });
    slider.addEventListener('input', (event) => {
      this.pendingPosition = Number(event.target.value);
      this.onPosition(this.pendingPosition);
    });
    slider.addEventListener('pointerup', () => this.finishDrag());
    slider.addEventListener('pointercancel', () => this.finishDrag());
    slider.addEventListener('touchend', () => this.finishDrag());
    slider.addEventListener('change', (event) => {
      this.pendingPosition = Number(event.target.value);
      if (!this.dragging) this.commit();
    });
    audio.addEventListener('timeupdate', () => this.syncFromAudio());
    audio.addEventListener('seeking', () => this.syncFromAudio());
    audio.addEventListener('loadedmetadata', () => this.syncFromAudio());
    this.syncFromAudio();
  }

  syncFromAudio() {
    if (this.dragging) return;
    const position = Number.isFinite(this.audio.currentTime) ? this.audio.currentTime : 0;
    this.slider.value = String(Math.floor(position));
    this.pendingPosition = position;
    this.onPosition(position);
  }

  finishDrag() {
    if (!this.dragging) return;
    this.dragging = false;
    this.commit();
  }

  commit() {
    if (this.commitQueued || !Number.isFinite(this.pendingPosition)) return;
    this.commitQueued = true;
    const position = this.pendingPosition;
    Promise.resolve(this.player.seek(position))
      .catch(() => {})
      .finally(() => {
        this.commitQueued = false;
        this.syncFromAudio();
      });
  }
}
