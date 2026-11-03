import test from 'node:test';
import assert from 'node:assert/strict';
import { registerMediaSession, updateMediaSession } from '../public/modules/media-session.js';

test('registerMediaSession publishes metadata and delegates supported actions', () => {
  const handlers = new Map();
  const session = {
    setActionHandler(action, handler) { handlers.set(action, handler); },
    setPositionState(state) { this.positionState = state; },
  };
  const calls = [];
  const controller = {
    play: () => calls.push('play'),
    pause: () => calls.push('pause'),
    seek: (seconds) => calls.push(['seek', seconds]),
  };

  registerMediaSession(session, controller, {
    title: 'A fixture', artist: 'Vesna probe', album: 'Offline fixture',
  });

  assert.deepEqual(session.metadata, {
    title: 'A fixture', artist: 'Vesna probe', album: 'Offline fixture',
  });
  handlers.get('play')();
  handlers.get('pause')();
  handlers.get('seekbackward')({ seekOffset: 7 });
  handlers.get('seekforward')({ seekOffset: 5 });
  handlers.get('seekto')({ seekTime: 18 });
  assert.deepEqual(calls, [
    'play', 'pause', ['seek', -7], ['seek', 5], ['seek', 18],
  ]);
});

test('updateMediaSession publishes a valid track position', () => {
  const session = { setPositionState(state) { this.positionState = state; } };
  updateMediaSession(session, { duration: 100, position: 12, rate: 1.5 });
  assert.deepEqual(session.positionState, { duration: 100, position: 12, playbackRate: 1.5 });
});
