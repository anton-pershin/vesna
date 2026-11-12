export class PlaybackBarController {
  constructor({ audio, button, onToggle, onError = () => {} }) {
    this.audio = audio;
    this.button = button;
    this.onToggle = onToggle;
    this.onError = onError;
    this.pending = false;
    this.enabled = true;
    this.button.addEventListener('click', () => { this.toggle(); });
    for (const event of ['play', 'pause', 'ended']) {
      this.audio.addEventListener(event, () => this.sync());
    }
    this.sync();
  }

  sync() {
    const action = this.audio.paused || this.audio.ended ? 'Play' : 'Pause';
    this.button.setAttribute('aria-label', action);
    this.button.dataset.action = action.toLowerCase();
    this.button.disabled = this.pending || !this.enabled;
    this.button.querySelector('use')?.setAttribute('href', action === 'Play' ? '#icon-play' : '#icon-pause');
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    this.sync();
  }

  async toggle() {
    if (this.pending || !this.enabled) return;
    this.pending = true;
    this.sync();
    try {
      await this.onToggle();
    } catch (error) {
      this.onError(error);
    } finally {
      this.pending = false;
      this.sync();
    }
  }
}
