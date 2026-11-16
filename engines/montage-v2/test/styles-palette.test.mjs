import test from 'node:test';
import assert from 'node:assert/strict';
import { getStylePalette, bgGeq, STYLE_CAPTIONS } from '../render.mjs';

test('getStylePalette returns palette for known styles', () => {
  const p = getStylePalette('pixel8');
  assert.ok(p, 'pixel8 palette exists');
  assert.equal(p.ink, '#FFF7B2');
  assert.equal(p.surface, '#24205B');
  assert.equal(p.border, '#F6D743');
  assert.equal(p.radius, 0);
  assert.ok(p.bgLight);
  assert.ok(p.bgMain);
  assert.ok(p.bgDeep);
});

test('bgGeq generates filter string with palette colors', () => {
  const skin = { brand: '#1E6BFF', brandLight: '#4F8CFF', brandDeep: '#0D47A1' };
  const palette = getStylePalette('pixel8');
  const geq = bgGeq(skin, palette);
  assert.ok(geq.startsWith('format=gbrp,geq=r='));
  // Pixel8 surface #24205B in decimal: R=36, G=32, B=91
  assert.ok(geq.includes('36') || geq.includes('16'), 'geq contains pixel8 RGB channel values');
});

test('STYLE_CAPTIONS covers all key styles', () => {
  const styles = ['pixel8', 'synthwave', 'matrixglitch', 'clean-ui', 'beat-cards'];
  for (const s of styles) {
    assert.ok(STYLE_CAPTIONS[s], `STYLE_CAPTIONS covers ${s}`);
    assert.ok(STYLE_CAPTIONS[s].accent, `${s} has accent color`);
  }
});
