// Мини-экраны телефонов для карточек (в эмах: размер задаёт font-size контейнера = ширина/10).
// Цвета берутся из палитры стиля C.

export const KINDS = ['sky', 'orb', 'accent', 'check', 'chart', 'chat', 'profile', 'night'];

export function mini(kind, C, extra = '') {
  const line = (w, top, col = 'rgba(120,110,100,.45)', l = 1) => `<i style="left:${l}em;top:${top}em;width:${w}em;height:.55em;border-radius:.3em;background:${col}"></i>`;
  const head = (col) => `<i style="left:1em;top:1em;width:1.6em;height:1.6em;border-radius:.5em;background:${col}"></i>${line(4, 1.5, 'rgba(120,110,100,.35)', 3.1)}`;
  let bg = '#F4EEE3', body = '';
  switch (kind) {
    case 'sky':
      bg = 'linear-gradient(180deg,#8DB6E2 0%,#C9DDF0 55%,#F4EEE3 100%)';
      body = `${line(6, 3.4, 'rgba(255,255,255,.9)', 2)}${line(4, 4.4, 'rgba(255,255,255,.75)', 3)}
        <i style="left:.6em;top:9em;width:5em;height:2.4em;border-radius:1.2em;background:#fff;opacity:.9"></i>
        <i style="left:2.6em;top:8em;width:3.4em;height:2.6em;border-radius:1.3em;background:#fff;opacity:.9"></i>
        <i style="left:5em;top:12em;width:4.2em;height:2em;border-radius:1em;background:#fff;opacity:.75"></i>`;
      break;
    case 'orb':
      bg = '#141312';
      body = `<i class="orb" style="left:1.5em;top:5em;width:7em;height:7em;border-radius:50%;background:radial-gradient(circle,${C.orbCore} 0%,${C.acc} 30%,rgba(${C.accRgb},0) 70%)"></i>${line(5, 1.4, 'rgba(255,255,255,.5)', 2.5)}${line(3, 15.2, 'rgba(255,255,255,.35)', 3.5)}`;
      break;
    case 'accent':
      bg = `linear-gradient(160deg,${C.acc},#B9573A)`;
      body = `<b style="left:0;right:0;top:5em;text-align:center;font-size:3.4em;color:#fff;font-weight:900">✳</b>${line(5, 11, 'rgba(255,255,255,.85)', 2.5)}${line(3.4, 12.3, 'rgba(255,255,255,.6)', 3.3)}
        <i style="left:3em;top:14.2em;width:4em;height:1.3em;border-radius:.7em;background:#fff"></i>`;
      break;
    case 'check':
      body = head(C.acc) + [0, 1, 2, 3].map((k) => `<i style="left:1em;top:${4.6 + k * 2.4}em;width:1.1em;height:1.1em;border-radius:50%;background:${C.green}"></i>${line(5 - (k % 2), 4.9 + k * 2.4, 'rgba(120,110,100,.45)', 2.8)}`).join('');
      break;
    case 'chart':
      bg = '#FFFDF8';
      body = head('#6E9BC8') + `<svg style="position:absolute;left:.8em;top:6em;width:8.4em;height:6em" viewBox="0 0 84 60"><path d="M0 52 L12 46 L24 48 L36 36 L48 38 L60 24 L72 18 L84 4" fill="none" stroke="${C.acc}" stroke-width="3.5" stroke-linejoin="round"/><path d="M0 52 L12 46 L24 48 L36 36 L48 38 L60 24 L72 18 L84 4 L84 60 L0 60Z" fill="${C.acc}" opacity=".18"/></svg>${line(6, 13.5)}${line(4, 14.8)}`;
      break;
    case 'chat':
      body = head(C.green) + `<i style="left:1em;top:4.5em;width:5.5em;height:2em;border-radius:.9em;background:#E4DCCD"></i>
        <i style="right:1em;top:7.3em;width:5em;height:2em;border-radius:.9em;background:${C.acc}"></i>
        <i style="left:1em;top:10.1em;width:6.2em;height:2em;border-radius:.9em;background:#E4DCCD"></i>
        <i style="right:1em;top:12.9em;width:3.6em;height:2em;border-radius:.9em;background:${C.acc}"></i>`;
      break;
    case 'profile':
      bg = '#FFFDF8';
      body = `<i style="left:3.4em;top:1.4em;width:3.2em;height:3.2em;border-radius:50%;background:linear-gradient(135deg,${C.acc},#F2B27A)"></i>${line(4, 5.3, 'rgba(120,110,100,.5)', 3)}` +
        [0, 1, 2, 3, 4, 5].map((k) => `<i style="left:${.7 + (k % 3) * 2.9}em;top:${7.2 + Math.floor(k / 3) * 4.3}em;width:2.6em;height:4em;border-radius:.4em;background:${['#EDE6D6', C.acc, '#2A2724', '#8DB6E2', '#F2B27A', '#D8CFBF'][k]}"></i>`).join('');
      break;
    case 'night':
      bg = 'linear-gradient(180deg,#141312,#2A2724)';
      body = [[2, 3], [6.5, 2.2], [4, 6], [8, 7.5], [1.4, 9.4], [6, 11]].map(([x, y]) => `<i style="left:${x}em;top:${y}em;width:.35em;height:.35em;border-radius:50%;background:#fff;opacity:.8"></i>`).join('') +
        `${line(5.5, 13.4, 'rgba(255,255,255,.7)', 2.2)}<i style="left:3em;top:15em;width:4em;height:1.3em;border-radius:.7em;background:${C.acc}"></i>`;
      break;
  }
  return `<div class="mp" style="background:${bg}${extra}">${body}<i style="left:3.5em;bottom:.5em;width:3em;height:.3em;border-radius:.2em;background:rgba(128,128,128,.45)"></i></div>`;
}
