// Centralized VideoProfile and SafeZones contracts for Video Editing System.
// Covers Canvas Bounds, Design Safe Area, and Platform UI Safe Area (TikTok, Reels, Shorts).

export const PROFILES = {
  'vertical-9x16-v1': {
    id: 'vertical-9x16-v1',
    name: 'Vertical Full HD 9:16',
    width: 1080,
    height: 1920,
    fps: 30,
    aspectRatio: '9:16',
    platform: 'reels-shorts-tiktok',
    safeInsets: {
      top: 220,
      right: 140,
      bottom: 420,
      left: 60,
    },
    uiExclusionZones: [
      { id: 'top-header', name: 'Top UI / Search / Back', x: 0, y: 0, width: 1080, height: 180 },
      { id: 'right-actions', name: 'Like / Comment / Share / Sound', x: 920, y: 880, width: 160, height: 780 },
      { id: 'bottom-meta', name: 'Author / Description / Music title / CTA', x: 0, y: 1500, width: 920, height: 420 },
    ],
    subtitleZone: {
      x: 80,
      y: 1150,
      width: 800,
      height: 320,
      maxLines: 2,
    },
  },
  'vertical-9x16-720p': {
    id: 'vertical-9x16-720p',
    name: 'Vertical HD 720p',
    width: 720,
    height: 1280,
    fps: 30,
    aspectRatio: '9:16',
    platform: 'reels-shorts-tiktok',
    scaleRatio: 2 / 3,
    safeInsets: {
      top: Math.round(220 * (2 / 3)),
      right: Math.round(140 * (2 / 3)),
      bottom: Math.round(420 * (2 / 3)),
      left: Math.round(60 * (2 / 3)),
    },
    uiExclusionZones: [
      { id: 'top-header', name: 'Top UI / Search / Back', x: 0, y: 0, width: 720, height: 120 },
      { id: 'right-actions', name: 'Like / Comment / Share / Sound', x: 613, y: 587, width: 107, height: 520 },
      { id: 'bottom-meta', name: 'Author / Description / Music title / CTA', x: 0, y: 1000, width: 613, height: 280 },
    ],
    subtitleZone: {
      x: 53,
      y: 767,
      width: 533,
      height: 213,
      maxLines: 2,
    },
  },
  'landscape-16x9-v1': {
    id: 'landscape-16x9-v1',
    name: 'Landscape Full HD 16:9',
    width: 1920,
    height: 1080,
    fps: 30,
    aspectRatio: '16:9',
    platform: 'youtube-desktop',
    safeInsets: {
      top: 80,
      right: 120,
      bottom: 120,
      left: 120,
    },
    uiExclusionZones: [
      { id: 'bottom-player-bar', name: 'Player Controls and Progress Bar', x: 0, y: 960, width: 1920, height: 120 },
    ],
    subtitleZone: {
      x: 240,
      y: 840,
      width: 1440,
      height: 120,
      maxLines: 2,
    },
  },
  'square-1x1-v1': {
    id: 'square-1x1-v1',
    name: 'Square 1:1',
    width: 1080,
    height: 1080,
    fps: 30,
    aspectRatio: '1:1',
    platform: 'feed-post',
    safeInsets: {
      top: 80,
      right: 80,
      bottom: 100,
      left: 80,
    },
    uiExclusionZones: [],
    subtitleZone: {
      x: 100,
      y: 860,
      width: 880,
      height: 140,
      maxLines: 2,
    },
  },
};

export function getVideoProfile(profileId = 'vertical-9x16-v1') {
  const profile = PROFILES[profileId];
  if (!profile) throw new Error(`Unknown video profile: ${profileId}`);
  return profile;
}

export function rectsIntersect(r1, r2) {
  return !(
    r2.x >= r1.x + r1.width ||
    r2.x + r2.width <= r1.x ||
    r2.y >= r1.y + r1.height ||
    r2.y + r2.height <= r1.y
  );
}

export function validateLayoutBounds(element, profileOrId = 'vertical-9x16-v1') {
  const profile = typeof profileOrId === 'string' ? getVideoProfile(profileOrId) : profileOrId;
  const { x, y, width, height, type = 'generic' } = element;
  const violations = [];

  // 1. Canvas bounds check
  if (x < 0 || y < 0 || x + width > profile.width || y + height > profile.height) {
    violations.push({
      rule: 'canvas-overflow',
      severity: 'error',
      message: `Element [${type}] bounds (${x}, ${y}, ${width}x${height}) exceed canvas (${profile.width}x${profile.height})`,
    });
  }

  // 2. Platform UI exclusion zones check
  for (const zone of profile.uiExclusionZones || []) {
    if (rectsIntersect({ x, y, width, height }, zone)) {
      violations.push({
        rule: 'ui-exclusion-overlap',
        severity: type === 'background' || type === 'broll-cover' ? 'info' : 'warning',
        zoneId: zone.id,
        message: `Element [${type}] overlaps platform UI zone "${zone.name || zone.id}"`,
      });
    }
  }

  // 3. Design Safe Area check (for text / captions / UI cards)
  if (type === 'caption' || type === 'title' || type === 'card' || type === 'button') {
    const minX = profile.safeInsets.left;
    const maxX = profile.width - profile.safeInsets.right;
    const minY = profile.safeInsets.top;
    const maxY = profile.height - profile.safeInsets.bottom;

    if (x < minX || x + width > maxX || y < minY || y + height > maxY) {
      violations.push({
        rule: 'safe-area-breach',
        severity: 'warning',
        message: `Important element [${type}] breaches design safe area insets (${minX}, ${minY}, ${maxX}, ${maxY})`,
      });
    }
  }

  return {
    valid: !violations.some((v) => v.severity === 'error'),
    hasWarnings: violations.some((v) => v.severity === 'warning'),
    violations,
  };
}
