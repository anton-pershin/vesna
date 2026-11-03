function createMetadata(metadata) {
  if (typeof globalThis.MediaMetadata === 'function') {
    return new globalThis.MediaMetadata(metadata);
  }
  return { ...metadata };
}

function delegateSeek(controller, value) {
  if (typeof controller.seekBy === 'function') return controller.seekBy(value);
  return controller.seek(value);
}

export function registerMediaSession(session, controller, metadata) {
  if (!session) return;
  session.metadata = createMetadata(metadata);
  const handlers = {
    play: () => controller.play(),
    pause: () => controller.pause(),
    seekbackward: (details = {}) => delegateSeek(controller, -(details.seekOffset || 10)),
    seekforward: (details = {}) => delegateSeek(controller, details.seekOffset || 10),
    seekto: (details = {}) => controller.seek(details.seekTime || 0),
  };
  for (const [action, handler] of Object.entries(handlers)) {
    try {
      session.setActionHandler(action, handler);
    } catch {
      // The platform may not expose every action; page controls still work.
    }
  }
}

export function updateMediaSession(session, { duration, position, rate }) {
  if (
    typeof session?.setPositionState !== 'function' ||
    !Number.isFinite(duration) || duration <= 0 ||
    !Number.isFinite(position) || position < 0 || position > duration ||
    !Number.isFinite(rate) || rate <= 0
  ) return;
  try {
    session.setPositionState({ duration, position, playbackRate: rate });
  } catch {
    // A browser can reject position updates while metadata is unavailable.
  }
}
