import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildAgnesQaPrompt,
  planInspectionTimestamps,
} from '../qa-inspector.mjs';

test('planInspectionTimestamps generates evenly distributed points covering scenes', () => {
  const points1 = planInspectionTimestamps(15, [
    { t0: 0, t1: 4.5 },
    { t0: 4.5, t1: 10.2 },
    { t0: 10.2, t1: 15.0 },
  ]);

  assert(points1.length >= 4);
  assert(points1.includes(0.2));
  assert(points1.some((p) => p >= 14.0));
  // All points within duration
  for (const p of points1) {
    assert(p >= 0 && p <= 15);
  }
});

test('buildAgnesQaPrompt includes structured defect checklist and JSON output schema', () => {
  const prompt = buildAgnesQaPrompt({ profileId: 'vertical-9x16-v1', style: 'beat-cards' });
  assert(prompt.includes('text_clipped'));
  assert(prompt.includes('outside_safe_area'));
  assert(prompt.includes('face_obscured'));
  assert(prompt.includes('"verdict": "pass" | "warn" | "fail"'));
});
