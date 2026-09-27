// Крафт (kraft-reel): разрешённый план → HTML-композиция HyperFrames + GSAP.
// Разрешённый план = выход validate(): {duration, voice, handle, seed, colors?, scenes:[{type, start, end, words:[{w,s,e}], …поля}]}.
// Всё случайное (пейзажи, птицы, карточки) — из seed: ролики разные, рендер одного плана детерминирован.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { rng, hash, landscape, flocks, MODE_ORDER } from './lib/city.mjs';
import { mini, KINDS } from './lib/mini.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CSS = fs.readFileSync(path.join(HERE, 'lib', 'style.css'), 'utf8');

export function buildHtml(plan) {
  const W = 1080, H = 1920, DUR = plan.duration, SC = plan.scenes;
  const R = rng(plan.seed ?? hash(JSON.stringify(SC.map((s) => s.words.map((w) => w.w)))));
  const C = { bg1: '#F1EBDF', bg2: '#EBE3D2', bg3: '#E2D5BF', ink: '#1C1A18', muted: '#7D766B', pale: '#C9C0B2', acc: '#D97454', accPale: '#F0C4B2',
    line: '#C9B596', win: '#1F1D1B', panel: '#2A2724', green: '#3DBE6B', cap: '#F7F2E8', ...(plan.colors || {}) };

  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const r3 = (n) => Math.round(n * 1000) / 1000;
  const norm = (s) => String(s).toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]/g, '');
  const E = '"power3.out"', EB = '"back.out(1.7)"', EI = '"power2.in"';

  // момент, когда в сцене звучит слово фразы (самое длинное, по первым 4 буквам); from — искать не раньше
  function wordTime(sc, phrase, fallback, from = -1) {
    const key = String(phrase).split(/\s+/).map(norm).filter(Boolean).sort((a, b) => b.length - a.length)[0];
    if (!key) return fallback;
    const hit = sc.words.find((w) => w.s > from && norm(w.w).startsWith(key.slice(0, 4)));
    return hit ? hit.s : fallback;
  }

  let uid = 0;
  const id = (p) => `${p}${++uid}`;
  const html = [], js = [];
  const push = (s) => js.push(s);
  const at = r3;

  // ── текст по словам: из бледного в цвет, с размытием ─────────────────────────
  function words(sc, text, t0, { top, size, cls = 'head', left = 70, width = 940 }) {
    const hid = id('h');
    let prev = t0;
    const toks = String(text).split(/\s+/).filter(Boolean).map((raw) => {
      const acc = /^\*.*\*$/.test(raw), w = raw.replace(/^\*|\*$/g, '');
      const t = Math.max(t0, wordTime(sc, w, prev)); prev = t;
      return { w, acc, t };
    });
    html.push(`<div id="${hid}" class="abs ${cls}" style="top:${top}px;left:${left}px;width:${width}px;font-size:${size}px">${toks
      .map((k, i) => `<span id="${hid}w${i}" class="${k.acc ? 'acc' : ''}">${esc(k.w)}</span>`).join(' ')}</div>`);
    toks.forEach((k, i) => push(`tl.fromTo("#${hid}w${i}",{opacity:0,y:22,filter:"blur(8px)",color:"${k.acc ? C.accPale : C.pale}"},{opacity:1,y:0,filter:"blur(0px)",color:"${k.acc ? C.acc : (cls === 'lead' ? C.muted : C.ink)}",duration:.45,ease:${E}},${at(k.t)});`));
    return hid;
  }

  // ── иконки ─────────────────────────────────────────────────────────────────
  const sparkSvg = (col = C.acc) => `<svg viewBox="0 0 48 48" stroke="${col}" stroke-width="3.6" stroke-linecap="round">${[0, 30, 60, 90, 120, 150]
    .map((a) => { const r = (a * Math.PI) / 180, x = 16 * Math.cos(r), y = 16 * Math.sin(r); return `<line x1="${r3(24 - x)}" y1="${r3(24 - y)}" x2="${r3(24 + x)}" y2="${r3(24 + y)}"/>`; }).join('')}</svg>`;
  const ICON = {
    doc: (label = '.bot') => `<svg viewBox="0 0 48 48" fill="none" stroke="${C.ink}" stroke-width="2.2" stroke-linejoin="round"><path d="M12 5h16l9 9v29H12z" fill="#FBF8F2"/><path d="M28 5v9h9"/><path d="M17 20h12M17 25h14" stroke="#CFC6B6"/><text x="24.5" y="37" font-size="7.5" font-weight="800" fill="${C.acc}" stroke="none" text-anchor="middle" font-family="Inter">${esc(label)}</text></svg>`,
    spark: () => sparkSvg(),
    tg: () => `<svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="17" fill="#2AABEE"/><path d="M14 23.5l18-7-3 16-6-4.5-3 3v-5l9-8-11 6.5z" fill="#fff"/></svg>`,
    play: () => `<svg viewBox="0 0 48 48"><rect x="8" y="12" width="32" height="24" rx="7" fill="${C.acc}"/><path d="M21 18l9 6-9 6z" fill="#fff"/></svg>`,
    chart: () => `<svg viewBox="0 0 48 48" fill="none" stroke="${C.acc}" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 36l9-10 7 5 13-15"/><path d="M31 16h7v7"/></svg>`,
    check: () => `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="${C.green}"/><path d="M6.5 12.5l3.5 3.5 7-7.5" stroke="#fff" stroke-width="2.6" fill="none" stroke-linecap="round"/></svg>`,
    eye: () => `<svg viewBox="0 0 24 24" fill="none" stroke="#A8A197" stroke-width="2"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>`,
    cursor: () => `<svg viewBox="0 0 24 24" fill="none" stroke="#A8A197" stroke-width="2" stroke-linejoin="round"><path d="M5 3l14 8-6 2-3 6z"/></svg>`,
  };
  const icon = (name, arg) => (ICON[name] || ICON.spark)(arg);

  // ── эмиттер карточек: вылетают, крутятся и «испаряются» ────────────────────
  function emitter({ x, y, t0, t1, every = .42, dirs, life = 1.5, size = 86, z = 1 }) {
    const n = Math.min(16, Math.max(1, Math.floor((t1 - t0 - life * .5) / every)));
    for (let k = 0; k < n; k++) {
      const cid = id('em'), d = dirs[Math.floor(R() * dirs.length)];
      const dx = d[0] + (R() - .5) * 60, dy = d[1] + (R() - .5) * 50, rot = (R() - .5) * 60, t = t0 + k * every + R() * .12;
      html.push(`<div id="${cid}" class="abs emit" style="left:${r3(x - size / 2)}px;top:${r3(y - size * .9)}px;font-size:${r3(size / 10)}px;z-index:${z}">${mini(KINDS[Math.floor(R() * KINDS.length)], C)}</div>`);
      push(`tl.fromTo("#${cid}",{x:0,y:0,scale:.25,rotation:0,opacity:0,filter:"blur(0px)"},{x:${r3(dx * .55)},y:${r3(dy * .55)},scale:1,rotation:${r3(rot * .6)},opacity:1,duration:${r3(life * .45)},ease:"power2.out"},${at(t)});`);
      push(`tl.to("#${cid}",{x:${r3(dx)},y:${r3(dy)},scale:1.25,rotation:${r3(rot)},opacity:0,filter:"blur(7px)",duration:${r3(life * .55)},ease:"power1.in"},${at(t + life * .45)});`);
    }
  }

  // ── окно macOS ─────────────────────────────────────────────────────────────
  function windowScene(sc, i) {
    const wid = `win${i}`, c = sc.content || {};
    const t0 = sc.start, t1 = sc.end;
    let body = '';
    if (c.kind === 'code') {
      const lines = c.lines || [];
      const total = lines.join('').length || 1, typeEnd = t0 + (t1 - t0) * .42;
      let n = 0;
      body += `<div class="code">${lines.map((ln, li) => {
        let tag = false;
        const spans = [...ln].map((ch, ci) => {
          if (ch === '<') tag = true;
          const col = tag ? C.acc : (/["{}]/.test(ch) ? '#9FC3A6' : '#E8E2D6');
          if (ch === ' ' || ch === '>') tag = false;
          return `<span id="${wid}c${li}_${ci}" style="color:${col}">${esc(ch)}</span>`;
        }).join('');
        return `<div class="cl"><u>${li + 1}</u>${spans}</div>`;
      }).join('')}<b id="${wid}caret" class="caret"></b></div>`;
      lines.forEach((ln, li) => [...ln].forEach((ch, ci) => {
        const t = t0 + .45 + ((typeEnd - t0 - .45) * n++) / total;
        push(`tl.set("#${wid}c${li}_${ci}",{opacity:1},${at(t)});`);
        if (ci === ln.length - 1) push(`tl.set("#${wid}caret",{top:"${r3(li * 1.55 + .15)}em",left:"${r3(1.5 + (ln.length + .2) * .6)}em"},${at(t)});`);
      }));
      push(`tl.fromTo("#${wid}caret",{opacity:1},{opacity:0,duration:.35,repeat:${Math.floor((t1 - t0) / .7)},yoyo:true,ease:"steps(1)"},${at(t0 + .4)});`);
      if (c.note) {
        body += `<div id="${wid}n" class="note"><i></i>${esc(c.note)}</div><div class="thumbs">${[0, 1, 2, 3, 4].map((k) => `<div class="tw" id="${wid}g${k}">${mini(KINDS[(k * 3 + 1) % KINDS.length], C)}</div>`).join('')}</div>`;
        push(`tl.from("#${wid}n",{opacity:0,x:-20,duration:.3,ease:${E}},${at(typeEnd + .1)});`);
        [0, 1, 2, 3, 4].forEach((k) => push(`tl.from("#${wid}g${k}",{y:90,opacity:0,scale:.6,rotation:${(k - 2) * 6},duration:.45,ease:${EB}},${at(typeEnd + .2 + k * .1)});`));
      }
      if (c.strike) {
        const ts = wordTime(sc, c.strike, typeEnd + .8);
        body += `<div class="strike" id="${wid}s"><span id="${wid}st">${esc(c.strike)}</span><b id="${wid}sl"></b></div>`;
        push(`tl.from("#${wid}s",{scale:.5,opacity:0,duration:.35,ease:${EB}},${at(ts - .4)});tl.from("#${wid}sl",{scaleX:0,duration:.3,ease:${E}},${at(ts + .15)});tl.to("#${wid}st",{color:"${C.muted}",duration:.3},${at(ts + .15)});`);
      }
    } else if (c.kind === 'gallery') {
      body += `<div class="gal">
        <div class="gp cream" id="${wid}p0"><div class="gp-ic"><span class="ig"></span><span class="sp">${sparkSvg()}</span></div><div class="gp-t">${esc(c.connect || 'Подключи GENESIS к Instagram').replace(/(Instagram|GENESIS)$/, '<em>$1</em>')}</div><div class="gp-l"></div><div class="gp-l s"></div><div class="gp-b" id="${wid}btn">Подключить</div></div>
        <div class="gp dark" id="${wid}p1"><div class="gp-top">${esc(c.made_title || 'GENESIS делает рилсы')}</div><div class="orb" id="${wid}orb"></div>
          <div class="gp-row">${[0, 1, 2, 3].map((k) => `<div class="gr" id="${wid}r${k}">${mini(KINDS[(k * 2 + 1) % KINDS.length], C)}</div>`).join('')}</div>
          <div class="gp-pill" id="${wid}pl">${esc(c.made_label || 'сделано в GENESIS')}</div></div>
        <div class="gp dark" id="${wid}p2">${mini('night', C, ';position:absolute;left:0;top:0;width:100%;height:100%;border-radius:0;font-size:22px')}<div class="gp-like" id="${wid}lk">♥ ${esc(c.likes || '12,4K')}</div></div></div>`;
      [0, 1, 2].forEach((k) => push(`tl.from("#${wid}p${k}",{y:120,opacity:0,rotationY:${(k - 1) * 20},duration:.5,ease:${EB}},${at(t0 + .35 + k * .18)});`));
      push(`tl.fromTo("#${wid}orb",{scale:.7,opacity:.6},{scale:1.15,opacity:1,duration:.9,yoyo:true,repeat:${Math.floor((t1 - t0) / .9)},ease:"sine.inOut"},${at(t0 + .5)});`);
      [0, 1, 2, 3].forEach((k) => push(`tl.from("#${wid}r${k}",{x:80,opacity:0,scale:.5,duration:.35,ease:${EB}},${at(t0 + 1 + k * .22)});`));
      push(`tl.from("#${wid}pl",{scale:0,duration:.35,ease:${EB}},${at(Math.max(t0 + 1.9, wordTime(sc, c.made_label || 'GENESIS', t0 + 1.9)))});`);
      push(`tl.to("#${wid}btn",{scale:.9,backgroundColor:"${C.green}",duration:.18,yoyo:true,repeat:1},${at(t0 + 1.2)});`);
      push(`tl.from("#${wid}lk",{y:30,opacity:0,scale:.6,duration:.35,ease:${EB}},${at(t0 + 1.5)});`);
    } else if (c.kind === 'stats') {
      const st = c.stats || [], icons = ['eye', 'cursor'];
      body += `<div class="stats">${st.map((s, k) => `<div class="stat" id="${wid}st${k}"><small>${icon(icons[k % 2])}${esc(s.label)}</small><b id="${wid}v${k}">0</b></div>`).join('')}</div>`;
      const tS = st.map((s, k) => (k === 0 ? t0 + .4 : Math.max(t0 + 1.2, wordTime(sc, s.label, t0 + 1.5) - .6)));
      st.forEach((s, k) => {
        push(`tl.from("#${wid}st${k}",{opacity:0,y:40,scale:.8,duration:.4,ease:${EB}},${at(tS[k])});`);
        push(`(()=>{const o={v:0},el=document.getElementById("${wid}v${k}");tl.to(o,{v:${s.value},duration:${k === 0 ? 1.6 : 2.2},ease:"power2.out",onUpdate:()=>{el.textContent=Math.round(o.v).toLocaleString("ru-RU")}},${at(tS[k] + .1)});})();`);
      });
      if (c.chart) {
        const pts = [.05, .08, .07, .12, .1, .16, .15, .22, .2, .3, .28, .4, .47, .58, .7, .86];
        const cw = 760, ch = 400, xy = pts.map((v, k) => [r3((k / (pts.length - 1)) * cw), r3(ch - v * ch)]);
        const d = xy.map((p, k) => (k ? 'L' : 'M') + p.join(' ')).join(' ');
        body += `<div class="chart" id="${wid}ch"><div class="ch-h"><span>${esc(c.chart)}</span><em>▲ ${esc(c.trend || '')}</em></div>
          <svg viewBox="-60 -14 ${cw + 80} ${ch + 34}" width="${cw + 20}" height="${ch + 34}"><defs><linearGradient id="${wid}gr" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.acc}" stop-opacity=".55"/><stop offset="1" stop-color="${C.acc}" stop-opacity="0"/></linearGradient>
          <clipPath id="${wid}cp"><rect id="${wid}cr" x="-60" y="-14" width="0" height="${ch + 34}"/></clipPath></defs>
          ${[0, 1, 2, 3].map((g) => `<line x1="0" x2="${cw}" y1="${(g * ch) / 3}" y2="${(g * ch) / 3}" stroke="#3A3632" stroke-width="2"/><text x="-12" y="${(g * ch) / 3 + 8}" fill="#6F6860" font-size="20" font-family="Inter" font-weight="700" text-anchor="end">${esc((c.axis || ['40K', '25K', '10K', '0'])[g])}</text>`).join('')}
          <g clip-path="url(#${wid}cp)"><path d="${d} L${cw} ${ch} L0 ${ch}Z" fill="url(#${wid}gr)"/><path d="${d}" fill="none" stroke="${C.acc}" stroke-width="5" stroke-linejoin="round"/></g>
          <circle id="${wid}halo" r="22" fill="${C.acc}" opacity="0" cx="0" cy="${xy[0][1]}"/><circle id="${wid}dot" r="10" fill="#fff" stroke="${C.acc}" stroke-width="5" cx="0" cy="${xy[0][1]}"/></svg></div>`;
        const tc = tS[1] ?? t0 + 1, dur = Math.max(1.8, Math.min(2.6, t1 - tc - 1));
        push(`tl.from("#${wid}ch",{opacity:0,y:40,duration:.35,ease:${E}},${at(tc - .2)});`);
        push(`(()=>{const P=${JSON.stringify(xy)},o={p:0},cr=document.getElementById("${wid}cr"),dt=document.getElementById("${wid}dot"),hl=document.getElementById("${wid}halo");tl.to(o,{p:1,duration:${r3(dur)},ease:"power2.out",onUpdate:()=>{const f=o.p*(P.length-1),i=Math.min(P.length-2,Math.floor(f)),u=f-i,x=P[i][0]+(P[i+1][0]-P[i][0])*u,y=P[i][1]+(P[i+1][1]-P[i][1])*u;cr.setAttribute("width",x+60);dt.setAttribute("cx",x);dt.setAttribute("cy",y);hl.setAttribute("cx",x);hl.setAttribute("cy",y);}},${at(tc + .1)});})();`);
        push(`tl.fromTo("#${wid}halo",{attr:{r:14},opacity:.4},{attr:{r:32},opacity:0,duration:.8,repeat:${Math.floor((t1 - tc) / .8)},ease:"power1.out"},${at(tc + .1)});`);
      }
      if (c.badge) {
        const tb = wordTime(sc, c.badge.split(':').pop(), t1 - 1.5);
        body += `<div class="badge" id="${wid}b">${esc(c.badge)}</div>`;
        push(`tl.fromTo("#${wid}b",{scale:2,opacity:0,rotation:-8},{scale:1,opacity:1,rotation:-2,duration:.45,ease:${EB}},${at(tb - .1)});`);
      }
    } else if (c.kind === 'bars') {
      const bars = c.bars || [];
      body += `<div class="bgrid">${[0, 1, 2, 3].map((g) => `<i style="top:${g * 150}px"></i>`).join('')}</div><div class="bars">${bars.map((b, k) => `<div class="bar-c"><div class="bar-v" id="${wid}bv${k}">${esc(b.note || '')}</div><div class="bar ${b.accent ? 'on' : ''}" id="${wid}b${k}" style="height:${Math.round(20 + b.value * 520)}px"></div><p>${esc(b.label)}</p></div>`).join('')}</div>`;
      bars.forEach((b, k) => {
        const tb = k === 0 ? t0 + .45 : Math.max(t0 + 1, wordTime(sc, b.label, t0 + 1.4) - .3);
        push(`tl.from("#${wid}b${k}",{scaleY:0,transformOrigin:"50% 100%",duration:${b.accent ? .9 : .5},ease:${b.accent ? '"elastic.out(1,0.6)"' : EB}},${at(tb)});tl.from("#${wid}bv${k}",{opacity:0,y:20,duration:.3},${at(tb + .4)});`);
        if (b.accent) push(`tl.to("#${wid}b${k}",{boxShadow:"0 0 90px rgba(217,116,84,.75)",duration:.6,yoyo:true,repeat:${Math.max(1, Math.floor((t1 - tb - 1) / .6))},ease:"sine.inOut"},${at(tb + .9)});`);
      });
    }
    // подпись под окном: фразы по 5–7 слов, слова из бледного в цвет
    const cap = `cap${i}`, ws = sc.words, chunks = [];
    ws.forEach((w, k) => { const gap = k ? w.s - ws[k - 1].e : 0; if (!chunks.length || chunks[chunks.length - 1].length >= 7 || (gap > .22 && chunks[chunks.length - 1].length >= 2)) chunks.push([]); chunks[chunks.length - 1].push(w); });
    let capHtml = '';
    chunks.forEach((ch, ci) => {
      const cid = `${cap}_${ci}`;
      capHtml += `<div id="${cid}" class="capt"${ci ? ' style="display:none"' : ''}>${ch.map((w, k) => `<span id="${cid}w${k}">${esc(w.w)}</span>`).join(' ')}</div>`;
      ch.forEach((w, k) => push(`tl.fromTo("#${cid}w${k}",{opacity:0,color:"${C.pale}"},{opacity:1,color:"${C.ink}",duration:.3},${at(w.s)});`));
      if (chunks[ci + 1]) push(`tl.set("#${cid}",{display:"none"},${at(chunks[ci + 1][0].s)});`);
      if (ci) push(`tl.set("#${cid}",{display:"block"},${at(ch[0].s)});`);
    });
    html.push(`<div class="stage"><div id="${wid}" class="win"><div class="bar3"><i style="background:#FF5F57"></i><i style="background:#FEBC2E"></i><i style="background:#28C840"></i><span><em>✳</em> ${esc(sc.window || '')}</span></div><div class="wbody">${body}</div></div>
      <div id="${cap}" class="cap">${capHtml}</div></div>`);
  }

  // ── сцены ──────────────────────────────────────────────────────────────────
  function sceneBody(sc, i) {
    const t0 = sc.start, t1 = sc.end;
    if (sc.type === 'hook_link') {
      const L = id('ic'), Rr = id('ic'), ln = id('ln');
      html.push(`<div id="${L}" class="icon" style="left:120px;top:380px">${icon(sc.left || 'doc', sc.left_label)}</div>
        <div id="${Rr}" class="icon glow" style="left:790px;top:380px">${icon(sc.right || 'spark')}<b class="ring" id="${Rr}rg"></b></div>
        <svg class="abs" style="left:290px;top:455px;z-index:2" width="500" height="20"><path id="${ln}" d="M0 10H500" stroke="${C.acc}" stroke-width="5" stroke-linecap="round" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"/></svg>
        <div id="${ln}d" class="ldot" style="left:280px;top:454px"></div>`);
      push(`tl.fromTo("#${L}",{scale:1.8,opacity:0,filter:"blur(10px)"},{scale:1,opacity:1,filter:"blur(0px)",duration:.45,ease:${EB}},${at(t0)});tl.fromTo("#${Rr}",{scale:1.8,opacity:0,filter:"blur(10px)"},{scale:1,opacity:1,filter:"blur(0px)",duration:.45,ease:${EB}},${at(t0 + .15)});`);
      push(`tl.to("#${ln}",{attr:{"stroke-dashoffset":0},duration:.5,ease:${E}},${at(t0 + .3)});`);
      push(`tl.fromTo("#${ln}d",{x:0,opacity:0},{x:500,opacity:1,duration:.8,ease:"power1.inOut",repeat:${Math.max(1, Math.floor((t1 - t0 - 1) / 1))},repeatDelay:.2},${at(t0 + .7)});`);
      push(`tl.fromTo("#${Rr}rg",{scale:1,opacity:.5},{scale:1.5,opacity:0,duration:1,repeat:${Math.floor((t1 - t0) / 1)},ease:"power1.out"},${at(t0 + .8)});`);
      emitter({ x: 875, y: 440, t0: t0 + .9, t1: t1 - .2, dirs: [[-40, -290], [40, -320], [100, -260], [-100, -250]], size: 84, z: 1 });
      words(sc, sc.headline, t0 + .1, { top: 700, size: 84 });
      (sc.pills || []).forEach((p, k) => {
        const pid = id('pill');
        html.push(`<div class="prow" style="top:${1030 + k * 90}px"><div id="${pid}" class="pill">${icon('check')}<span>${esc(p)}</span></div></div>`);
        push(`tl.fromTo("#${pid}",{scale:.4,opacity:0,filter:"blur(8px)"},{scale:1,opacity:1,filter:"blur(0px)",duration:.4,ease:${EB}},${at(wordTime(sc, p, t0 + 2 + k) - .1)});`);
      });
    } else if (sc.type === 'title') {
      const e = id('eb'), u = id('ul');
      html.push(`<div id="${e}" class="abs eyebrow" style="top:780px">${esc(sc.eyebrow)}</div><div class="prow" style="top:960px"><div id="${u}" class="uline"></div></div>`);
      push(`tl.from("#${e}",{opacity:0,scaleX:1.5,filter:"blur(6px)",duration:.5,ease:${E}},${at(t0 + .05)});`);
      words(sc, sc.title, t0 + .2, { top: 830, size: 94, cls: 'title', left: 40, width: 1000 });
      push(`tl.from("#${u}",{scaleX:0,duration:.45,ease:${E}},${at(wordTime(sc, sc.title, t0 + .6) + .3)});`);
    } else if (sc.type === 'window') {
      windowScene(sc, i);
    } else if (sc.type === 'thought') {
      const st = id('st'), sl = id('sl'), rp = id('rp');
      const tS = wordTime(sc, sc.statement, t0 + 1);
      const steps = sc.reply_steps || [sc.reply];
      words(sc, sc.lead, t0 + .05, { top: 690, size: 44, cls: 'lead', left: 0, width: W });
      html.push(`<div class="abs head" style="top:760px;left:40px;width:1000px;font-size:86px"><span id="${st}" class="stk">${esc(sc.statement)}<b id="${sl}"></b></span></div>
        <div class="prow" style="top:1000px"><div id="${rp}" class="reply">${steps.map((s, k) => `<span id="${rp}s${k}"${k ? ' style="display:none"' : ''}>${esc(s)}</span>`).join('')}</div></div>`);
      // первый шаг — на первое слово ответа, дальше каждый — на своё новое слово
      const tR = [];
      steps.forEach((s, k) => {
        const prevWords = k ? steps[k - 1].split(/\s+/).map(norm) : [];
        const fresh = s.split(/\s+/).filter((w) => !prevWords.includes(norm(w))).join(' ') || s;
        tR.push(wordTime(sc, fresh, (tR[k - 1] ?? t1 - 2) + .5, k ? tR[k - 1] : tS + .3));
      });
      push(`tl.fromTo("#${st}",{opacity:0,y:26,filter:"blur(8px)",color:"${C.pale}"},{opacity:1,y:0,filter:"blur(0px)",color:"${C.ink}",duration:.4,ease:${E}},${at(tS)});`);
      push(`tl.from("#${sl}",{scaleX:0,transformOrigin:"0 50%",duration:.35,ease:${E}},${at(tR[0] - .45)});tl.to("#${st}",{color:"${C.muted}",duration:.3},${at(tR[0] - .45)});`);
      push(`tl.fromTo("#${rp}",{scale:0,rotation:-10},{scale:1,rotation:-2,duration:.45,ease:${EB}},${at(tR[0])});`);
      steps.forEach((_, k) => { if (k) push(`tl.set("#${rp}s${k - 1}",{display:"none"},${at(tR[k])});tl.set("#${rp}s${k}",{display:"inline"},${at(tR[k])});tl.fromTo("#${rp}",{scale:1.25},{scale:1,duration:.4,ease:${EB},immediateRender:false},${at(tR[k])});`); });
    } else if (sc.type === 'question') {
      const q = id('q'), ln = id('ln');
      html.push(`<div class="prow" style="top:500px"><div id="${q}" class="qmark">?</div></div>
        <svg class="abs" style="left:340px;top:1070px" width="400" height="10"><path id="${ln}" d="M0 5H400" stroke="${C.pale}" stroke-width="4" stroke-linecap="round" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"/></svg>`);
      push(`tl.fromTo("#${q}",{scale:0,rotation:-60},{scale:1,rotation:0,duration:.55,ease:${EB}},${at(t0 + .05)});`);
      push(`tl.to("#${q}",{keyframes:[{rotation:-12,duration:.12},{rotation:10,duration:.12},{rotation:-6,duration:.1},{rotation:0,duration:.1}]},${at(t0 + .7)});tl.to("#${q}",{y:-16,duration:.7,yoyo:true,repeat:${Math.max(1, Math.floor((t1 - t0 - 1.2) / .7))},ease:"sine.inOut"},${at(t0 + 1.1)});`);
      words(sc, sc.lead, t0 + .2, { top: 720, size: 42, cls: 'lead', left: 0, width: W });
      words(sc, sc.statement, t0 + .4, { top: 790, size: 100 });
      push(`tl.to("#${ln}",{attr:{"stroke-dashoffset":0},duration:.6,ease:${E}},${at(t0 + 1)});`);
    } else if (sc.type === 'radial') {
      const c = id('rc'), cx = 540, cy = 640;
      const angs = [-165, -138, -112, -88, -64, -40, -15];
      const rays = angs.map((a, k) => { const L = 250 + (k % 2) * 90 + R() * 30, rr = (a * Math.PI) / 180; return { a, L, k, x: r3(Math.cos(rr) * L), y: r3(Math.sin(rr) * L) }; });
      html.push(`<div class="abs" style="left:${cx}px;top:${cy}px;z-index:1">${rays.map((r) => `<div id="${c}r${r.k}" class="ray" style="width:${r3(r.L)}px;transform:rotate(${r.a}deg)"></div>`).join('')}
        ${rays.map((r) => `<div id="${c}m${r.k}" class="abs rmini" style="left:${r3(r.x - 38)}px;top:${r3(r.y - 67)}px">${mini(KINDS[(r.k * 5 + 2) % KINDS.length], C)}</div>`).join('')}</div>
        <div id="${c}" class="icon big" style="left:${cx - 100}px;top:${cy - 100}px">${icon('spark')}<b class="ring" id="${c}rg"></b></div>`);
      push(`tl.fromTo("#${c}",{scale:.2,opacity:0,rotation:-90},{scale:1,opacity:1,rotation:0,duration:.55,ease:${EB}},${at(t0)});`);
      push(`tl.fromTo("#${c}rg",{scale:1,opacity:.5},{scale:1.6,opacity:0,duration:1,repeat:${Math.floor((t1 - t0) / 1)},ease:"power1.out"},${at(t0 + .5)});`);
      rays.forEach((r) => {
        push(`tl.from("#${c}r${r.k}",{scaleX:0,duration:.4,ease:${E}},${at(t0 + .2 + r.k * .06)});`);
        push(`tl.fromTo("#${c}m${r.k}",{x:${-r.x * .9},y:${-r.y * .9},scale:.2,opacity:0},{x:0,y:0,scale:1,opacity:1,duration:.55,ease:${E}},${at(t0 + .4 + r.k * .07)});`);
        push(`tl.to("#${c}m${r.k}",{y:${r.k % 2 ? -12 : 12},rotation:${r.k % 2 ? 4 : -4},duration:1.1,yoyo:true,repeat:${Math.max(1, Math.floor((t1 - t0 - 1.6) / 1.1))},ease:"sine.inOut"},${at(t0 + 1.05 + r.k * .07)});`);
      });
      // поток мелких карточек по лучам — вылетают из центра и тают
      emitter({ x: cx, y: cy + 30, t0: t0 + 1, t1: t1 - .2, every: .55, life: 1.3, size: 50, z: 0, dirs: rays.map((r) => [r.x * 1.3, r.y * 1.3]) });
      words(sc, sc.headline, t0 + .2, { top: 960, size: 88 });
    } else if (sc.type === 'cta') {
      const wd = id('cw'), box = id('bx'), ph = id('ph'), ty = id('ty'), cr = id('cr'), bt = id('bt'), ok = id('ok'), ar = id('ar'), sh = id('sh');
      const tW = wordTime(sc, sc.word, t0 + 1.2), word = String(sc.word);
      words(sc, sc.lead, t0 + .05, { top: 690, size: 44, cls: 'lead', left: 0, width: W });
      html.push(`<div id="${wd}" class="abs title" style="top:755px;text-transform:none"><em class="ast">✳</em> ${esc(word)}</div>
        <div class="prow" style="top:930px"><div id="${box}" class="cbox"><i></i><span id="${ph}" class="phd">${esc(sc.placeholder || 'Добавить комментарий…')}</span><span id="${ty}" class="typ">${[...word].map((ch, k) => `<span id="${ty}k${k}">${esc(ch)}</span>`).join('')}<b id="${cr}" class="tcaret"></b></span><b id="${bt}" class="send">Отправить</b><b id="${ok}" class="ok">Отправлено ✓</b></div></div>
        <div id="${ar}" class="abs areply"><small>АВТООТВЕТ</small><div>✉ ${esc(sc.reply)}<i id="${sh}" class="shine"></i></div></div>`);
      push(`tl.fromTo("#${wd}",{opacity:0,scale:1.6,filter:"blur(12px)"},{opacity:1,scale:1,filter:"blur(0px)",duration:.45,ease:${E}},${at(tW - .15)});tl.from("#${box}",{opacity:0,y:40,duration:.4,ease:${E}},${at(tW + .1)});`);
      const tt = tW + .45;
      push(`tl.set("#${ph}",{display:"none"},${at(tt)});tl.set("#${ty}",{display:"inline-flex"},${at(tt)});`);
      [...word].forEach((_, k) => push(`tl.set("#${ty}k${k}",{display:"inline"},${at(tt + .08 + k * .1)});`));
      const tp = tt + .15 + word.length * .1 + .25;
      push(`tl.fromTo("#${cr}",{opacity:1},{opacity:0,duration:.25,repeat:${Math.ceil((tp - tt) / .25)},yoyo:true,ease:"steps(1)"},${at(tt)});`);
      push(`tl.to("#${bt}",{scale:.85,duration:.1,yoyo:true,repeat:1},${at(tp)});tl.set("#${bt}",{opacity:0},${at(tp + .2)});tl.fromTo("#${ok}",{opacity:0,scale:.5},{opacity:1,scale:1,duration:.35,ease:${EB}},${at(tp + .2)});`);
      push(`tl.set("#${ty}",{display:"none"},${at(tp + .5)});tl.set("#${ph}",{display:"inline"},${at(tp + .5)});`);
      push(`tl.fromTo("#${ar}",{opacity:0,x:-80},{opacity:1,x:0,duration:.45,ease:${E}},${at(tp + .7)});tl.fromTo("#${sh}",{x:-200},{x:1000,duration:.9,ease:"power1.inOut"},${at(tp + 1)});`);
      if (sc.note) words(sc, sc.note, tp + 1.3, { top: 1250, size: 36, cls: 'lead', left: 0, width: W });
    }
  }

  // ── фон: пейзаж на каждую сцену, птицы, солнце, облака ─────────────────────
  let lastMode = '';
  const cities = SC.map((sc, i) => {
    let mode;
    do mode = MODE_ORDER[Math.floor(R() * MODE_ORDER.length)]; while (mode === lastMode);
    lastMode = mode;
    const L = landscape(R, mode), cid = `city${i}`;
    const svg = `<svg id="${cid}" class="abs city" width="${L.W}" height="${L.H}" viewBox="0 0 ${L.W} ${L.H}" fill="none" stroke="${C.line}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">${L.parts
      .map(([d, layer], k) => `<path class="l${layer}" data-k="${k}" d="${d}" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"/>`).join('')}</svg>`;
    const tIn = Math.max(0, sc.start - .1), tOut = sc.end - .45, last = i === SC.length - 1;
    push(`(()=>{document.querySelectorAll("#${cid} path").forEach((p,k)=>{const l=p.classList.contains("l1");tl.to(p,{attr:{"stroke-dashoffset":0},duration:(l?0.5:0.7),ease:"power2.out"},${at(tIn)}+(l?0.35:0)+(k%9)*.035);${last ? '' : `tl.to(p,{attr:{"stroke-dashoffset":1},duration:.4,ease:"power2.in"},${at(tOut)}+(l?0:0.08)+(k%7)*.02);`}});})();`);
    push(`tl.fromTo("#${cid}",{x:${r3(-R() * 200)}},{x:"-=${Math.round((sc.end - sc.start) * 38)}",duration:${r3(sc.end - sc.start + .3)},ease:"none"},${at(tIn)});`);
    return svg;
  }).join('\n');

  const fl = flocks(R, 4 + Math.floor(R() * 2));
  const birds = fl.map((f, fi) => f.map((b, bi) => `<svg class="abs bird" id="bd${fi}_${bi}" style="left:${b.x}px;top:${b.y}px" width="${r3(40 * b.s)}" height="${r3(16 * b.s)}" viewBox="0 0 40 16" fill="none" stroke="${C.line}" stroke-width="2.6" stroke-linecap="round"><path d="M2 12q8-10 18 0q10-10 18 0"/></svg>`).join('')).join('');
  fl.forEach((f, fi) => {
    const dx = (R() < .5 ? -1 : 1) * (60 + R() * 120);
    push(`tl.to("${f.map((_, bi) => `#bd${fi}_${bi}`).join(',')}",{x:${r3(dx)},y:${r3((R() - .5) * 60)},duration:${DUR},ease:"none"},0);`);
    f.forEach((_, bi) => push(`tl.to("#bd${fi}_${bi}",{scaleY:.35,duration:${r3(.28 + R() * .12)},yoyo:true,repeat:${Math.floor(DUR / .3)},ease:"sine.inOut"},${r3(R() * .4)});`));
  });
  const sun = R() < .6 ? (() => { const sx = R() < .5 ? 150 : 930, sy = 190 + R() * 60; return `<svg class="abs" id="sun" style="left:${sx - 60}px;top:${r3(sy - 60)}px" width="120" height="120" viewBox="0 0 120 120" fill="none" stroke="${C.line}" stroke-width="2.6" stroke-linecap="round"><circle cx="60" cy="60" r="22"/>${[0, 45, 90, 135, 180, 225, 270, 315].map((a) => { const r = (a * Math.PI) / 180; return `<line x1="${r3(60 + Math.cos(r) * 32)}" y1="${r3(60 + Math.sin(r) * 32)}" x2="${r3(60 + Math.cos(r) * 44)}" y2="${r3(60 + Math.sin(r) * 44)}"/>`; }).join('')}</svg>`; })() : '';
  if (sun) push(`tl.to("#sun",{rotation:40,duration:${DUR},ease:"none"},0);`);
  const clouds = [0, 1].map((k) => { const cx = 120 + R() * 800, cy = 110 + k * 260 + R() * 60; return `<svg class="abs cloud" id="cl${k}" style="left:${r3(cx)}px;top:${r3(cy)}px" width="160" height="60" viewBox="0 0 160 60" fill="none" stroke="${C.line}" stroke-width="2.4" stroke-linecap="round" opacity=".7"><path d="M10 50h140M24 50a18 18 0 0 1 22-24a26 26 0 0 1 48-6a20 20 0 0 1 34 30"/></svg>`; }).join('');
  push(`tl.to("#cl0",{x:${r3(80 + R() * 80)},duration:${DUR},ease:"none"},0);tl.to("#cl1",{x:${r3(-80 - R() * 80)},duration:${DUR},ease:"none"},0);`);

  // ── сцены + переходы ───────────────────────────────────────────────────────
  const isWin = (s) => s && s.type === 'window';
  SC.forEach((sc, i) => {
    const sid = `s${i}`, prev = SC[i - 1], next = SC[i + 1];
    const pre = i ? .2 : 0;
    html.push(`<div id="${sid}" class="abs scene clip" data-start="${r3(Math.max(0, sc.start - pre))}" data-duration="${r3(sc.end - sc.start + pre)}"><div id="${sid}c" class="cam">`);
    sceneBody(sc, i);
    html.push('</div></div>');
    // камера «дышит»: медленный наезд и лёгкий поворот
    push(`tl.fromTo("#${sid}c",{scale:1,rotationY:${r3((R() - .5) * 3)}},{scale:1.035,rotationY:${r3((R() - .5) * 3)},transformPerspective:1600,duration:${r3(sc.end - sc.start)},ease:"none"},${at(sc.start)});`);
    const ts = sc.start;
    // ВХОД
    if (isWin(sc)) {
      const w = `#win${i}`, cp = `#cap${i}`;
      if (isWin(prev)) push(`tl.fromTo("${w}",{scale:1.5,rotationX:18,rotationY:22,y:220,opacity:0,filter:"blur(14px)"},{scale:1,rotationX:0,rotationY:0,y:0,opacity:1,filter:"blur(0px)",duration:.6,ease:"power3.out"},${at(ts + .05)});`);
      else push(`tl.fromTo("${w}",{scale:2.4,rotationX:26,rotationY:-24,rotationZ:-4,y:420,opacity:0,filter:"blur(18px)"},{scale:1,rotationX:0,rotationY:0,rotationZ:0,y:0,opacity:1,filter:"blur(0px)",duration:.7,ease:"power3.out"},${at(ts - .05)});`);
      push(`tl.fromTo("${cp}",{rotationX:40,y:160,opacity:0,filter:"blur(8px)"},{rotationX:0,y:0,opacity:1,filter:"blur(0px)",duration:.5,ease:${E}},${at(ts + .15)});`);
      if (!isWin(prev)) push(`tl.to("#handle",{opacity:0,duration:.2},${at(ts)});`);
    } else if (isWin(prev)) {
      if (sc.type === 'radial') push(`tl.fromTo("#${sid}",{opacity:0},{opacity:1,duration:.2},${at(ts - .1)});`);
      else push(`tl.fromTo("#${sid}",{opacity:0,rotationX:-38,rotationY:24,y:-60,filter:"blur(10px)",transformPerspective:1400},{opacity:1,rotationX:0,rotationY:0,y:0,filter:"blur(0px)",duration:.55,ease:${E}},${at(ts - .05)});`);
      push(`tl.to("#handle",{opacity:1,duration:.3},${at(ts + .1)});`);
    } else if (i) {
      push(`tl.fromTo("#${sid}",{opacity:0,scale:1.7,filter:"blur(22px)"},{opacity:1,scale:1,filter:"blur(0px)",duration:.5,ease:"power3.out"},${at(ts - .12)});`);
    }
    // ВЫХОД
    if (!next) return;
    const te = sc.end;
    if (isWin(sc)) {
      const w = `#win${i}`, cp = `#cap${i}`;
      if (isWin(next)) {
        push(`tl.to("#veil",{opacity:.5,duration:.22,ease:"power1.in"},${at(te - .25)});tl.to("#veil",{opacity:0,duration:.4,ease:"power1.out"},${at(te + .05)});`);
        push(`tl.to("${w},${cp}",{scale:.92,opacity:0,filter:"blur(10px)",duration:.28,ease:${EI}},${at(te - .25)});`);
      } else if (next.type === 'radial') {
        push(`tl.to("${w}",{scale:.18,rotationY:25,opacity:0,filter:"blur(6px)",y:-140,duration:.4,ease:${EI}},${at(te - .35)});tl.to("${cp}",{opacity:0,y:60,duration:.25},${at(te - .35)});`);
      } else {
        push(`tl.to("${w}",{rotationX:32,rotationY:28,scale:.55,y:160,opacity:0,filter:"blur(8px)",duration:.45,ease:${EI}},${at(te - .4)});tl.to("${cp}",{rotationX:32,y:220,scale:.6,opacity:0,duration:.4,ease:${EI}},${at(te - .38)});`);
      }
    } else if (isWin(next)) {
      push(`tl.to("#${sid}",{opacity:0,scale:.85,filter:"blur(12px)",duration:.3,ease:${EI}},${at(te - .25)});`);
    } else {
      push(`tl.to("#${sid}",{opacity:0,scale:1.25,filter:"blur(18px)",duration:.3,ease:${EI}},${at(te - .25)});`);
    }
  });

  const noise = `url("data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='300' height='300'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' seed='7'/><feColorMatrix values='0 0 0 0 .45  0 0 0 0 .38  0 0 0 0 .28  0 0 0 .22 0'/></filter><rect width='300' height='300' filter='url(#n)'/></svg>`)}")`;

  const css = CSS
    .replace(/\$\{(\w+)\}/g, (m, k) => ({ W, H, noise, ...C })[k] ?? m);

  const page = `<!doctype html>
  <html lang="ru" data-resolution="portrait">
  <head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=${W}, height=${H}" />
  <script src="${plan.gsap || 'assets/gsap.min.js'}"></script>
  <style>
  ${css}
  </style>
  </head>
  <body>
  <div id="root" data-composition-id="main" data-start="0" data-duration="${DUR}" data-width="${W}" data-height="${H}">
    <div id="bg" class="abs"></div>
    <div id="grain" class="abs"></div>
    ${sun}${clouds}${birds}
    <div id="ground" class="abs"></div>
    ${cities}
    <div id="handle" class="abs">${esc(plan.handle || '')}</div>
    <audio id="voice" src="${plan.voice}" data-start="0" data-duration="${DUR}"></audio>
  ${html.join('\n')}
    <div id="veil" class="abs"></div>
  </div>
  <script>
  const tl = gsap.timeline({ paused: true });
  ${js.join('\n')}
  window.__timelines = window.__timelines || {};
  window.__timelines["main"] = tl;
  tl.seek(0);
  </script>
  </body>
  </html>
  `;
  return page;
}
