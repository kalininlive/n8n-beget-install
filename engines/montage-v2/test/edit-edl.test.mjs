import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeAdaptiveThreshold,
  detectRmsSilences,
  mapOutputTime,
  mapSourceTime,
  planEditEdl,
  snapToVoice,
} from '../edit-edl.mjs';

function signal(seconds, sampleRate = 1000) {
  const out = new Float32Array(seconds * sampleRate);
  out.fill(0.15);
  return out;
}

test('RMS detector finds only pauses longer than 180 ms at 10 ms resolution', () => {
  const audio = signal(2);
  audio.fill(0, 400, 650); // 250 ms
  audio.fill(0, 1100, 1250); // 150 ms, intentionally too short
  assert.deepEqual(detectRmsSilences(audio, { sampleRate: 1000 }), [{ start: 0.4, end: 0.65, source: 'rms' }]);
});

test('EDL keeps a sentence breath, removes a high-confidence isolated filler, and remaps subtitles', () => {
  const edl = planEditEdl({
    duration: 2.4,
    jobId: 'fixture-voice-001',
    words: [
      { w: 'Первое.', s: 0.10, e: 0.35, p: 0.99 },
      { w: 'эээ', s: 0.58, e: 0.63, p: 0.98 },
      { w: 'Второе', s: 0.92, e: 1.20, p: 0.99 },
      { w: 'готово.', s: 1.25, e: 1.50, p: 0.99 },
    ],
    silenceWindows: [{ start: 0.35, end: 0.58 }, { start: 0.63, end: 0.92 }, { start: 1.50, end: 2.40 }],
  });
  assert.equal(edl.schemaVersion, 'genesis.edit-edl/v1');
  assert.equal(edl.fillerReport[0].decision, 'drop');
  assert.deepEqual(edl.words.map((word) => word.text), ['Первое.', 'Второе', 'готово.']);
  assert.equal(edl.words[1].start, 0.57); // 0.35s speech + 0.22s sentence breath
  assert.equal(edl.cuts.length, 1);
  assert.equal(edl.stats.autoRemovedFillers, 1);
  assert.equal(mapSourceTime(0.92, edl.timelineMap), 0.57);
  assert.equal(mapOutputTime(0.57, edl.timelineMap), 0.92);
});

test('contextual filler stays a review candidate and is never silently removed', () => {
  const edl = planEditEdl({
    duration: 1.5,
    words: [{ w: 'Ну', s: 0.1, e: 0.25, p: 0.99 }, { w: 'поехали', s: 0.26, e: 0.7, p: 0.99 }],
    silenceWindows: [],
  });
  assert.equal(edl.words.length, 2);
  assert.equal(edl.fillerReport.length, 0);
  assert.equal(edl.stats.removedSeconds, 0);
});

test('snapToVoice snaps stretched word boundaries to actual loud speech frames', () => {
  // 1 second audio at 1000 Hz sample rate. 10ms frame = 10 samples.
  // Speech is present only between 0.10s and 0.40s (loud = 0.25).
  // Silence is from 0.40s to 1.00s (quiet = 0.001).
  const audio = new Float32Array(1000);
  audio.fill(0.001);
  audio.fill(0.25, 100, 400); // 0.10s to 0.40s

  // Whisper hallucinated the word as stretching until 0.85s:
  const words = [{ text: 'Привет', start: 0.05, end: 0.85, confidence: 0.95 }];
  const res = snapToVoice(words, audio, { sampleRate: 1000, frameMs: 10 });

  assert.equal(res.words[0].snapped, true);
  assert.equal(res.words[0].start, 0.10);
  assert.equal(res.words[0].end, 0.40);
  assert(res.savedSilenceSec > 0.4);
});

test('planEditEdl with samples automatically snaps words and cuts silences', () => {
  // 2 seconds audio:
  // 0.10 - 0.40: speech "Первое."
  // 0.40 - 1.20: silence (0.80s pause)
  // 1.20 - 1.60: speech "Второе."
  // 1.60 - 2.00: silence
  const audio = new Float32Array(2000);
  audio.fill(0.001);
  audio.fill(0.20, 100, 400);
  audio.fill(0.20, 1200, 1600);

  const words = [
    { text: 'Первое.', start: 0.10, end: 0.70 }, // stretched by Whisper
    { text: 'Второе.', start: 1.15, end: 1.60 },
  ];

  const edl = planEditEdl({
    duration: 2.0,
    words,
    samples: audio,
    rules: { sampleRate: 1000, frameMs: 10 },
  });

  assert(edl.cuts.length >= 1);
  assert(edl.stats.snappedSilenceSec > 0.2);
  assert(edl.outputDuration < 2.0);
  assert.equal(edl.words.length, 2);
  assert.equal(edl.words[0].text, 'Первое.');
  assert.equal(edl.words[1].text, 'Второе.');
});
