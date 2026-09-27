// Фон стиля «Бумага»: случайный (по seed) линейный пейзаж для каждой сцены + стайки птиц и небо.
// Все линии — <path> с pathLength=1 и началом у земли: движок рисует их снизу вверх и «убирает в землю».

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const hash = (s) => [...String(s)].reduce((h, c) => (Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0), 2166136261);

const r1 = (n) => Math.round(n * 10) / 10;
const G = 280; // уровень земли внутри svg

// каждый проп: (x, R) → { w, paths: [[d, слой]] }, слой 0 — каркас, 1 — детали (рисуются позже)
const PROPS = {
  tower(x, R) {
    const w = 50 + R() * 70, h = 90 + R() * 170, P = [];
    P.push([`M${r1(x)} ${G}V${r1(G - h)}H${r1(x + w)}V${G}`, 0]);
    const roof = Math.floor(R() * 4);
    if (roof === 1) P.push([`M${r1(x + w / 2)} ${r1(G - h)}v-${r1(25 + R() * 30)}`, 1]);
    if (roof === 2) P.push([`M${r1(x + w * .25)} ${r1(G - h)}v-22h${r1(w * .5)}v22`, 1]);
    if (roof === 3) P.push([`M${r1(x)} ${r1(G - h)}L${r1(x + w / 2)} ${r1(G - h - 28)}L${r1(x + w)} ${r1(G - h)}`, 1]);
    if (R() < .6) {
      const cols = w > 80 ? 3 : 2, rows = Math.min(5, Math.floor(h / 45));
      for (let c = 0; c < cols; c++) for (let rw = 0; rw < rows; rw++) if (R() < .55) {
        const wx = x + 10 + c * ((w - 20) / cols), wy = G - h + 16 + rw * 40;
        P.push([`M${r1(wx)} ${r1(wy + 16)}v-16h10v16z`, 1]);
      }
    }
    return { w, paths: P };
  },
  dome(x, R) {
    const w = 110 + R() * 40, h = 80 + R() * 40, P = [];
    P.push([`M${r1(x)} ${G}V${r1(G - h)}H${r1(x + w)}V${G}`, 0]);
    P.push([`M${r1(x + w * .15)} ${r1(G - h)}A${r1(w * .35)} ${r1(w * .35)} 0 0 1 ${r1(x + w * .85)} ${r1(G - h)}`, 1]);
    P.push([`M${r1(x + w / 2)} ${r1(G - h - w * .35)}v-26`, 1]);
    P.push([`M${r1(x + w * .38)} ${G}V${r1(G - 40)}A${r1(w * .12)} ${r1(w * .12)} 0 0 1 ${r1(x + w * .62)} ${r1(G - 40)}V${G}`, 1]);
    if (R() < .5) P.push([`M${r1(x + w * .44)} ${r1(G - 22)}q${r1(w * .06)} -10 ${r1(w * .12)} 0`, 1]);
    return { w, paths: P };
  },
  palm(x, R) {
    const h = 170 + R() * 80, lean = (R() - .5) * 60, tx = x + 30 + lean, ty = G - h, P = [];
    P.push([`M${r1(x + 30)} ${G}Q${r1(x + 30 + lean * .2)} ${r1(G - h * .5)} ${r1(tx)} ${r1(ty)}`, 0]);
    for (const [dx, dy] of [[-70, 18], [-50, -34], [-10, -48], [40, -40], [72, 12]])
      P.push([`M${r1(tx)} ${r1(ty)}q${r1(dx * .5)} ${r1(dy * .9 - 16)} ${r1(dx)} ${r1(dy)}`, 1]);
    return { w: 90, paths: P };
  },
  pine(x, R) {
    const h = 110 + R() * 70, P = [];
    P.push([`M${r1(x + 30)} ${G}v-22`, 0]);
    P.push([`M${r1(x)} ${G - 22}L${r1(x + 30)} ${r1(G - h)}L${r1(x + 60)} ${G - 22}Z`, 0]);
    P.push([`M${r1(x + 10)} ${r1(G - h * .45)}L${r1(x + 30)} ${r1(G - h * .62)}L${r1(x + 50)} ${r1(G - h * .45)}`, 1]);
    return { w: 70, paths: P };
  },
  tree(x, R) {
    const h = 70 + R() * 50, rr = 26 + R() * 14, P = [];
    P.push([`M${r1(x + rr)} ${G}V${r1(G - h)}`, 0]);
    P.push([`M${r1(x + rr)} ${r1(G - h)}a${r1(rr)} ${r1(rr)} 0 0 1 0 ${r1(-2 * rr)}a${r1(rr)} ${r1(rr)} 0 0 1 0 ${r1(2 * rr)}`, 1]);
    return { w: rr * 2 + 10, paths: P };
  },
  hillhouse(x, R) {
    const w = 260, P = [];
    P.push([`M${r1(x)} ${G}Q${r1(x + w / 2)} ${G - 110} ${r1(x + w)} ${G}`, 0]);
    const hx = x + w * .38, hy = G - 70;
    P.push([`M${r1(hx)} ${r1(hy)}v-54h70v54`, 1]);
    P.push([`M${r1(hx - 10)} ${r1(hy - 50)}L${r1(hx + 35)} ${r1(hy - 88)}L${r1(hx + 80)} ${r1(hy - 50)}`, 1]);
    P.push([`M${r1(hx + 14)} ${r1(hy)}v-30h18v30`, 1]);
    P.push([`M${r1(hx + 44)} ${r1(hy - 38)}h14v14h-14z`, 1]);
    if (R() < .6) P.push([`M${r1(hx + 100)} ${r1(hy + 4)}Q${r1(hx + 104)} ${r1(hy - 60)} ${r1(hx + 120)} ${r1(hy - 110)}q-30 -6 -50 16M${r1(hx + 120)} ${r1(hy - 110)}q30 -8 50 14M${r1(hx + 120)} ${r1(hy - 110)}q-6 -30 -30 -40`, 1]);
    return { w: w + 10, paths: P };
  },
  arch(x, R) {
    const w = 70, h = 110, P = [];
    P.push([`M${r1(x)} ${G}V${r1(G - h + 35)}A35 35 0 0 1 ${r1(x + w)} ${r1(G - h + 35)}V${G}`, 0]);
    P.push([`M${r1(x + 22)} ${r1(G - 30)}q7 -12 13 -3q6 -9 13 3q-6 10 -13 16q-7 -6 -13 -16`, 1]);
    if (R() < .5) P.push([`M${r1(x + 8)} ${r1(G - h + 35)}A27 27 0 0 1 ${r1(x + w - 8)} ${r1(G - h + 35)}`, 1]);
    return { w: w + 20, paths: P };
  },
  lamp(x) {
    return { w: 50, paths: [[`M${r1(x + 10)} ${G}V${G - 120}q0 -14 22 -14`, 0], [`M${r1(x + 28)} ${G - 134}h12v10h-12z`, 1]] };
  },
  bench(x) {
    return { w: 80, paths: [[`M${r1(x + 6)} ${G}v-22M${r1(x + 58)} ${G}v-22`, 0], [`M${r1(x)} ${G - 22}h66M${r1(x)} ${G - 34}v-18h66v18`, 1]] };
  },
  fence(x, R) {
    const n = 4 + Math.floor(R() * 4), P = [];
    for (let i = 0; i < n; i++) P.push([`M${r1(x + i * 18)} ${G}v-34`, 0]);
    P.push([`M${r1(x - 4)} ${G - 12}h${n * 18}M${r1(x - 4)} ${G - 26}h${n * 18}`, 1]);
    return { w: n * 18 + 12, paths: P };
  },
  wheel(x) {
    const cx = x + 80, cy = G - 110, rr = 70, P = [[`M${r1(x + 30)} ${G}L${r1(cx)} ${r1(cy)}L${r1(x + 130)} ${G}`, 0], [`M${r1(cx + rr)} ${r1(cy)}A${rr} ${rr} 0 0 0 ${r1(cx - rr)} ${r1(cy)}A${rr} ${rr} 0 0 0 ${r1(cx + rr)} ${r1(cy)}`, 1]];
    for (let k = 0; k < 6; k++) { const a = (k * Math.PI) / 3; P.push([`M${r1(cx)} ${r1(cy)}l${r1(Math.cos(a) * rr)} ${r1(Math.sin(a) * rr)}`, 1]); }
    return { w: 170, paths: P };
  },
  tank(x) {
    return { w: 70, paths: [[`M${r1(x + 8)} ${G}L${r1(x + 18)} ${G - 110}M${r1(x + 58)} ${G}L${r1(x + 48)} ${G - 110}`, 0], [`M${r1(x + 6)} ${G - 110}v-40h54v40zM${r1(x + 6)} ${G - 150}q27 -20 54 0`, 1]] };
  },
  grass(x) {
    return { w: 30, paths: [[`M${r1(x)} ${G}q4 -12 8 0q4 -16 8 0q4 -10 8 0`, 1]] };
  },
};

const MODES = {
  city: [['tower', 6], ['dome', 1.2], ['tank', .6], ['tree', .8], ['lamp', .5], ['arch', .5], ['grass', .6]],
  village: [['palm', 1.6], ['hillhouse', 1.2], ['tree', 1], ['pine', .8], ['bench', .7], ['lamp', .7], ['fence', .8], ['grass', 1.4], ['arch', .5]],
  park: [['wheel', .7], ['tree', 2], ['pine', 1.2], ['bench', 1], ['lamp', 1], ['fence', .8], ['grass', 1.5], ['tower', 1]],
};
const pick = (R, list) => { const t = list.reduce((s, [, w]) => s + w, 0); let v = R() * t; for (const [k, w] of list) if ((v -= w) <= 0) return k; return list[0][0]; };

// один пейзаж: ширина 1500 (с запасом на проезд камеры), прозрачные «пустоты» — случайные
export function landscape(R, mode) {
  const W = 1500, parts = [];
  let x = -20 + R() * 30;
  while (x < W) {
    const kind = pick(R, MODES[mode]);
    const p = PROPS[kind](x, R);
    parts.push(...p.paths);
    x += p.w + (mode === 'city' ? 6 + R() * 26 : 30 + R() * 90);
  }
  if (mode !== 'city') for (let i = 0; i < 4; i++) parts.push([`M${r1(R() * W)} ${G - 6}q6 -8 12 0`, 1]);
  return { W, H: G + 4, parts };
}
export const MODE_ORDER = Object.keys(MODES);

// птицы: стайки по 2–4, случайные по seed; крыло — одна кривая, машет через scaleY
export function flocks(R, n = 4) {
  const out = [];
  for (let f = 0; f < n; f++) {
    const fx = 60 + R() * 900, fy = 120 + R() * 380, k = 2 + Math.floor(R() * 3), birds = [];
    for (let b = 0; b < k; b++) birds.push({ x: r1(fx + b * (26 + R() * 30)), y: r1(fy + (R() - .5) * 40), s: r1(.7 + R() * .6) });
    out.push(birds);
  }
  return out;
}
