export class SeekBarController {
  constructor(slider, audio, player, onPosition = () => {}, onError = () => {}) {
    this.slider = slider;
    this.audio = audio;
    this.player = player;
    this.onPosition = onPosition;
    this.onError = onError;
    this.dragging = false;
    this.destroyed = false;
    this.pendingPosition = Number(slider.value) || 0;

    this.sliderListeners = {
      pointerdown: () => { this.dragging = true; },
      touchstart: () => { this.dragging = true; },
      input: (event) => {
        this.pendingPosition = Number(event.target.value);
        this.onPosition(this.pendingPosition);
        this.commit();
      },
      pointerup: () => this.finishDrag(),
      pointercancel: () => this.finishDrag(),
      touchend: () => this.finishDrag(),
      change: (event) => {
        this.pendingPosition = Number(event.target.value);
        if (!this.dragging) this.commit();
      },
    };
    for (const [event, handler] of Object.entries(this.sliderListeners)) {
      this.slider.addEventListener(event, handler, event === 'touchstart' ? { passive: true } : undefined);
    }
    this.audioListeners = {
      timeupdate: () => this.syncFromAudio(),
      seeking: () => this.syncFromAudio(),
      seeked: () => this.syncFromAudio(),
      loadedmetadata: () => this.syncFromAudio(),
    };
    for (const [event, handler] of Object.entries(this.audioListeners)) {
      this.audio.addEventListener(event, handler);
    }
    this.syncFromAudio();
  }

  destroy() {
    this.destroyed = true;
    for (const [event, handler] of Object.entries(this.sliderListeners)) {
      this.slider.removeEventListener(event, handler);
    }
    for (const [event, handler] of Object.entries(this.audioListeners)) {
      this.audio.removeEventListener(event, handler);
    }
  }

  syncFromAudio() {
    if (this.destroyed || this.dragging) return;
    const position = Number.isFinite(this.audio.currentTime) ? this.audio.currentTime : 0;
    this.slider.value = String(Math.floor(position));
    this.pendingPosition = position;
    this.onPosition(position);
  }

  finishDrag() {
    if (this.destroyed || !this.dragging) return;
    this.dragging = false;
    this.commit();
  }

  commit() {
    if (this.destroyed || !Number.isFinite(this.pendingPosition)) return;
    Promise.resolve(this.player.seek(this.pendingPosition))
      .catch((error) => { this.onError(error); })
      .finally(() => {
        if (!this.destroyed) this.syncFromAudio();
      });
  }
}
