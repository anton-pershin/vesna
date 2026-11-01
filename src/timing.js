function validateTimings(timings) {
  if (!Array.isArray(timings)) {
    throw new TypeError('timing data must be an array');
  }
  let previousEnd = 0;
  for (const timing of timings) {
    if (
      !timing || typeof timing.id !== 'string' || !timing.id ||
      !Number.isFinite(timing.start) || !Number.isFinite(timing.end) ||
      timing.start < previousEnd || timing.end <= timing.start
    ) {
      throw new TypeError('invalid timing data');
    }
    previousEnd = timing.end;
  }
}

export function resolveParagraph(position, timings) {
  validateTimings(timings);
  if (!Number.isFinite(position)) return null;
  for (const timing of timings) {
    if (position >= timing.start && position < timing.end) {
      return timing.id;
    }
  }
  return null;
}

export { validateTimings };
