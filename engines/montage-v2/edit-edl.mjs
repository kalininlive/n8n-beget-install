// Renderer-independent edit decision list (EDL) for spoken-video cuts.
// This module only plans and maps time. FFmpeg/Remotion/HyperFrames adapters consume its output.

export const EDL_SCHEMA_VERSION = 'genesis.edit-edl/v1';

const round = (value, digits = 3) => Number(Number(value).toFixed(digits));
const cleanText = (value) => String(value || '').toLowerCase()
  .replace(/ё/g, 'е').replace(/[\s.,!?…:;«»"'`()[\]{}—–-]/g, '');
const sentenceEnd = (value) => /[.!?…]\s*$/.test(String(value || ''));
const DEFAULT_FILLERS = new Set(['ээ', 'эээ', 'эм', 'мм', 'ммм', 'мда', 'хм']);

export function normalizeWords(words, timeUnit = 'seconds') {
  const divisor = timeUnit === 'milliseconds' ? 1000 : 1;
  return (Array.isArray(words) ? words : []).map((word, index) => ({
    id: word.id ?? index,
    text: String(word.text ?? word.word ?? word.w ?? '').trim(),
    start: Number(word.start ?? word.s ?? word.t ?? 0) / divisor,
    end: Number(word.end ?? word.e ?? 0) / divisor,
    confidence: Number(word.confidence ?? word.probability ?? word.p ?? 0),
  })).filter((word) => word.text && Number.isFinite(word.start) && Number.isFinite(word.end) && word.end > word.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
}

export function computeRmsDb(samples, { sampleRate = 16000, frameMs = 10 } = {}) {
  if (!(samples instanceof Float32Array) && !Array.isArray(samples)) throw new TypeError('samples must be Float32Array or Array');
  const frameSize = Math.max(1, Math.round(sampleRate * frameMs / 1000));
  const n = Math.floor(samples.length / frameSize);
  const dbs = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    const offset = i * frameSize;
    for (let j = 0; j < frameSize; j++) {
      const s = samples[offset + j];
      sum += s * s;
    }
    dbs[i] = 20 * Math.log10(Math.sqrt(sum / frameSize) + 1e-6);
  }
  return { dbs, frameMs, sampleRate, frameSize };
}

export function computeAdaptiveThreshold(dbs, { pLo = 10, pHi = 95, factor = 0.35 } = {}) {
  const sorted = Float32Array.from(dbs).sort();
  const n = sorted.length;
  if (!n) return { threshold: -35, lo: -35, hi: -12 };
  const lo = sorted[Math.min(n - 1, Math.max(0, Math.floor(n * (pLo / 100))))];
  const hi = sorted[Math.min(n - 1, Math.max(0, Math.floor(n * (pHi / 100))))];
  const threshold = lo + factor * (hi - lo);
  return { threshold: round(threshold, 2), lo: round(lo, 2), hi: round(hi, 2) };
}

export function snapToVoice(words, samplesOrDbs, { sampleRate = 16000, frameMs = 10, threshold = 'auto', minDuration = 0.06 } = {}) {
  const { dbs } = samplesOrDbs && samplesOrDbs.dbs
    ? samplesOrDbs
    : computeRmsDb(samplesOrDbs, { sampleRate, frameMs });

  const thr = typeof threshold === 'number'
    ? threshold
    : computeAdaptiveThreshold(dbs).threshold;

  const loud = new Uint8Array(dbs.length);
  for (let i = 0; i < dbs.length; i++) {
    if (dbs[i] > thr) loud[i] = 1;
  }

  let saved = 0;
  const normalized = normalizeWords(words);
  const snappedWords = normalized.map((w) => {
    const a = Math.max(0, Math.floor(w.start * 1000 / frameMs));
    const b = Math.min(dbs.length, Math.ceil(w.end * 1000 / frameMs));
    let first = -1, last = -1;
    for (let i = a; i < b; i++) {
      if (loud[i]) {
        if (first === -1) first = i;
        last = i;
      }
    }
    if (first !== -1 && last !== -1) {
      const s = (first * frameMs) / 1000;
      const e = ((last + 1) * frameMs) / 1000;
      if (e - s >= minDuration) {
        saved += (w.end - w.start) - (e - s);
        return { ...w, start: round(s), end: round(e), snapped: true };
      }
    }
    return { ...w };
  });

  return { words: snappedWords, savedSilenceSec: round(Math.max(0, saved)), threshold: thr };
}

// The audio adapter supplies these windows from 10 ms RMS analysis of the cleaned voice.
// Word timestamps are deliberately not used as evidence that a region is silent.
export function detectRmsSilences(samples, { sampleRate = 16000, frameMs = 10, dbThreshold = 'auto', minDuration = 0.18 } = {}) {
  const { dbs } = computeRmsDb(samples, { sampleRate, frameMs });
  const thr = typeof dbThreshold === 'number'
    ? dbThreshold
    : computeAdaptiveThreshold(dbs).threshold;

  const windows = [];
  let i = 0;
  while (i < dbs.length) {
    if (dbs[i] < thr) {
      const first = i;
      while (i < dbs.length && dbs[i] < thr) i++;
      const start = (first * frameMs) / 1000, end = (i * frameMs) / 1000;
      if (end - start >= minDuration) windows.push({ start: round(start), end: round(end), source: 'rms' });
    } else {
      i++;
    }
  }
  return windows;
}

function normaliseWindows(windows, duration) {
  return (Array.isArray(windows) ? windows : []).map((window) => ({
    start: Math.max(0, Number(window.start ?? window[0])),
    end: Math.min(duration, Number(window.end ?? window[1])),
    source: window.source || 'rms',
  })).filter((window) => Number.isFinite(window.start) && Number.isFinite(window.end) && window.end > window.start)
    .sort((a, b) => a.start - b.start);
}

function mergeCuts(cuts) {
  const ordered = cuts.filter((cut) => cut.end > cut.start).sort((a, b) => a.start - b.start || a.end - b.end);
  const merged = [];
  for (const cut of ordered) {
    const previous = merged.at(-1);
    if (previous && cut.start <= previous.end + 1e-6) {
      previous.end = Math.max(previous.end, cut.end);
      previous.reasons.push(...cut.reasons);
    } else merged.push({ start: cut.start, end: cut.end, reasons: [...cut.reasons] });
  }
  return merged.map((cut) => ({ ...cut, start: round(cut.start), end: round(cut.end) }));
}

function timelineMap(duration, cuts) {
  const keeps = [];
  let sourceCursor = 0, outputCursor = 0;
  for (const cut of cuts) {
    if (cut.start > sourceCursor) {
      const sourceEnd = cut.start;
      keeps.push({ sourceStart: round(sourceCursor), sourceEnd: round(sourceEnd), outputStart: round(outputCursor), outputEnd: round(outputCursor + sourceEnd - sourceCursor) });
      outputCursor += sourceEnd - sourceCursor;
    }
    sourceCursor = Math.max(sourceCursor, cut.end);
  }
  if (sourceCursor < duration) keeps.push({ sourceStart: round(sourceCursor), sourceEnd: round(duration), outputStart: round(outputCursor), outputEnd: round(outputCursor + duration - sourceCursor) });
  return keeps;
}

export function mapSourceTime(time, map) {
  for (const segment of map) {
    if (time >= segment.sourceStart - 1e-6 && time <= segment.sourceEnd + 1e-6) return round(segment.outputStart + Math.max(0, Math.min(time, segment.sourceEnd) - segment.sourceStart));
  }
  return null;
}

export function mapOutputTime(time, map) {
  for (const segment of map) {
    if (time >= segment.outputStart - 1e-6 && time <= segment.outputEnd + 1e-6) return round(segment.sourceStart + Math.max(0, Math.min(time, segment.outputEnd) - segment.outputStart));
  }
  return null;
}

export function planEditEdl({ duration, words, silenceWindows, samples = null, jobId = null, profileId = 'vertical-9x16-v1', rules = {} }) {
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('duration must be a positive number');
  const config = {
    silenceMin: 0.18,
    silenceKeep: 0.10,
    sentenceSilenceKeep: 0.22,
    fillerConfidence: 0.85,
    fillerIsolation: 0.12,
    fillers: DEFAULT_FILLERS,
    ...rules,
  };
  let W = normalizeWords(words, rules.timeUnit || 'seconds');
  let snappedInfo = null;
  if (samples) {
    snappedInfo = snapToVoice(W, samples, {
      sampleRate: rules.sampleRate || 16000,
      frameMs: rules.frameMs || 10,
      threshold: rules.dbThreshold || 'auto',
    });
    W = snappedInfo.words;
  }
  const windows = Array.isArray(silenceWindows)
    ? normaliseWindows(silenceWindows, duration)
    : (samples ? normaliseWindows(detectRmsSilences(samples, { sampleRate: rules.sampleRate || 16000, frameMs: rules.frameMs || 10, dbThreshold: rules.dbThreshold || 'auto', minDuration: config.silenceMin }), duration) : []);
  const cuts = [], fillerReport = [], fillerBridges = [];

  for (let index = 0; index < W.length; index++) {
    const word = W[index], token = cleanText(word.text), previous = W[index - 1], next = W[index + 1];
    const isolated = Boolean(previous && next && word.start - previous.end >= config.fillerIsolation && next.start - word.end >= config.fillerIsolation);
    const filler = config.fillers.has(token);
    if (!filler) continue;
    const automatic = isolated && word.confidence >= config.fillerConfidence;
    fillerReport.push({ wordId: word.id, text: word.text, sourceStart: round(word.start), sourceEnd: round(word.end), confidence: word.confidence, isolated, decision: automatic ? 'drop' : 'candidate', reason: automatic ? 'isolated-high-confidence-filler' : 'filler-requires-review' });
    if (!automatic) continue;
    const retained = sentenceEnd(previous.text) ? config.sentenceSilenceKeep : config.silenceKeep;
    // The whole region between adjacent spoken words becomes one retained breath.
    // Treating its two silences independently would preserve two breaths around
    // the deleted interjection and produce a pause longer than the EDL requests.
    const start = previous.end + retained / 2;
    const end = next.start - retained / 2;
    fillerBridges.push({ start: previous.end, end: next.start });
    cuts.push({ start, end, reasons: [{ kind: 'filler', wordId: word.id, text: word.text, confidence: word.confidence }] });
  }

  for (const window of windows) {
    if (window.end - window.start < config.silenceMin) continue;
    // Do not trim head/tail here: their treatment is a style/editorial decision.
    if (window.start <= 1e-6 || window.end >= duration - 1e-6) continue;
    if (fillerBridges.some((bridge) => window.end > bridge.start && window.start < bridge.end)) continue;
    const preceding = [...W].reverse().find((word) => word.end <= window.start + 1e-6);
    const retained = preceding && sentenceEnd(preceding.text) ? config.sentenceSilenceKeep : config.silenceKeep;
    const start = window.start + retained / 2;
    const end = window.end - retained / 2;
    if (end > start) cuts.push({ start, end, reasons: [{ kind: 'silence', source: window.source, detectedStart: round(window.start), detectedEnd: round(window.end), retained: round(retained) }] });
  }

  const mergedCuts = mergeCuts(cuts);
  const map = timelineMap(duration, mergedCuts);
  const isRemoved = (word) => mergedCuts.some((cut) => word.start >= cut.start - 1e-6 && word.end <= cut.end + 1e-6);
  const outputWords = W.filter((word) => !isRemoved(word)).map((word) => ({ ...word, sourceStart: round(word.start), sourceEnd: round(word.end), start: mapSourceTime(word.start, map), end: mapSourceTime(word.end, map) }));
  const outputDuration = map.length ? map.at(-1).outputEnd : 0;

  return {
    schemaVersion: EDL_SCHEMA_VERSION,
    jobId,
    profileId,
    sourceDuration: round(duration),
    outputDuration: round(outputDuration),
    rules: { silenceMin: config.silenceMin, silenceKeep: config.silenceKeep, sentenceSilenceKeep: config.sentenceSilenceKeep, fillerConfidence: config.fillerConfidence, fillerIsolation: config.fillerIsolation },
    cuts: mergedCuts.map((cut) => ({ sourceStart: cut.start, sourceEnd: cut.end, duration: round(cut.end - cut.start), reasons: cut.reasons })),
    timelineMap: map,
    words: outputWords,
    fillerReport,
    stats: { sourceWords: W.length, outputWords: outputWords.length, snappedSilenceSec: snappedInfo ? snappedInfo.savedSilenceSec : 0, removedSeconds: round(duration - outputDuration), cuts: mergedCuts.length, autoRemovedFillers: fillerReport.filter((entry) => entry.decision === 'drop').length, fillerCandidates: fillerReport.filter((entry) => entry.decision === 'candidate').length },
  };
}
