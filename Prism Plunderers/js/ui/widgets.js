// Small controls bound to a setting in S. Each one saves on change and then calls onChange(key).
// The settings menu (a later part) is built from these too.
import { S, saveSettings } from '../core/save.js';
import { uiSfx } from '../core/sound.js';
import { esc } from '../core/util.js';

function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; }
function commit(key, value, onChange) { S[key] = value; saveSettings(); onChange?.(key); }

// one of several choices. options: [[value, label], ...]
export function seg(key, options, onChange) {
  const box = el('div', 'seg');
  for (const [v, label] of options) {
    const b = el('button', S[key] === v ? 'on' : '', esc(label));
    b.type = 'button';
    b.onclick = () => {
      commit(key, v, onChange);
      for (const o of box.children) o.classList.toggle('on', o === b);
      uiSfx.click();
    };
    box.append(b);
  }
  return box;
}
// on / off
export function toggle(key, onChange) {
  const b = el('button', 'sw' + (S[key] ? ' on' : ''), '<i></i>');
  b.type = 'button';
  b.setAttribute('role', 'switch'); b.setAttribute('aria-checked', String(!!S[key]));
  b.onclick = () => {
    commit(key, !S[key], onChange);
    b.classList.toggle('on', S[key]); b.setAttribute('aria-checked', String(S[key]));
    uiSfx.click();
  };
  return b;
}
// a number. fmt turns the value into the text shown next to the slider.
export function slider(key, { min, max, step, fmt = v => String(v) }, onChange) {
  const box = el('div', 'slider'), inp = el('input'), out = el('span', 'val', esc(fmt(S[key])));
  inp.type = 'range'; inp.min = min; inp.max = max; inp.step = step; inp.value = S[key];
  inp.oninput = () => { commit(key, +inp.value, onChange); out.textContent = fmt(S[key]); };
  box.append(inp, out);
  return box;
}
// label on the left, control on the right, optional hint under the label
export function row(label, control, hint = '') {
  const r = el('div', 'row');
  r.append(el('div', 'row-l', `<b>${esc(label)}</b>${hint ? `<small>${esc(hint)}</small>` : ''}`), control);
  return r;
}
export const heading = text => el('h3', 'sect', esc(text));
export { el };
