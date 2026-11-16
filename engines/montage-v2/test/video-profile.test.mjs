import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getVideoProfile,
  rectsIntersect,
  validateLayoutBounds,
} from '../video-profile.mjs';

test('getVideoProfile returns vertical 9:16 profile with correct dimensions and safe insets', () => {
  const profile = getVideoProfile('vertical-9x16-v1');
  assert.equal(profile.width, 1080);
  assert.equal(profile.height, 1920);
  assert.equal(profile.aspectRatio, '9:16');
  assert.equal(profile.safeInsets.top, 220);
  assert.equal(profile.safeInsets.bottom, 420);
});

test('rectsIntersect detects overlapping rectangles correctly', () => {
  const r1 = { x: 0, y: 0, width: 100, height: 100 };
  const r2 = { x: 50, y: 50, width: 100, height: 100 };
  const r3 = { x: 150, y: 150, width: 50, height: 50 };

  assert.equal(rectsIntersect(r1, r2), true);
  assert.equal(rectsIntersect(r1, r3), false);
});

test('validateLayoutBounds detects canvas overflow and safe area breaches', () => {
  // Element that goes beyond canvas width (1080)
  const overflowElement = { x: 950, y: 500, width: 200, height: 80, type: 'title' };
  const res1 = validateLayoutBounds(overflowElement, 'vertical-9x16-v1');
  assert.equal(res1.valid, false);
  assert(res1.violations.some((v) => v.rule === 'canvas-overflow'));

  // Element inside safe area
  const safeElement = { x: 100, y: 300, width: 600, height: 150, type: 'title' };
  const res2 = validateLayoutBounds(safeElement, 'vertical-9x16-v1');
  assert.equal(res2.valid, true);
  assert.equal(res2.hasWarnings, false);

  // Element placed in the bottom TikTok meta area
  const bottomElement = { x: 100, y: 1600, width: 500, height: 100, type: 'caption' };
  const res3 = validateLayoutBounds(bottomElement, 'vertical-9x16-v1');
  assert(res3.violations.some((v) => v.rule === 'ui-exclusion-overlap' || v.rule === 'safe-area-breach'));
});
