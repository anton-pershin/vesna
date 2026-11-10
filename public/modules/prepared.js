export function validatePreparedVersion(textResult, timingResult, expectedVersion) {
  if (
    !textResult || textResult.version !== expectedVersion ||
    !timingResult || timingResult.version !== expectedVersion ||
    !Array.isArray(textResult.paragraphs) || !Array.isArray(timingResult.timings) ||
    textResult.paragraphs.length === 0 ||
    textResult.paragraphs.length !== timingResult.timings.length
  ) {
    throw new Error('Prepared text and timings do not identify the same complete version');
  }
  const ids = new Set();
  let previousEnd = 0;
  for (let index = 0; index < textResult.paragraphs.length; index += 1) {
    const paragraph = textResult.paragraphs[index];
    const timing = timingResult.timings[index];
    if (
      !paragraph || typeof paragraph.id !== 'string' || !paragraph.id || ids.has(paragraph.id) ||
      typeof paragraph.text !== 'string' || !timing || timing.id !== paragraph.id ||
      !Number.isFinite(timing.start) || !Number.isFinite(timing.end) ||
      timing.start < previousEnd || timing.end <= timing.start
    ) {
      throw new Error('Prepared paragraphs and timings are inconsistent');
    }
    ids.add(paragraph.id);
    previousEnd = timing.end;
  }
  return {
    paragraphs: textResult.paragraphs,
    timings: timingResult.timings,
    duration: previousEnd,
  };
}
