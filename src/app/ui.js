// Small DOM helpers shared by the mode panels.

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

// A labelled range input. `format` turns the value into display text.
export function slider({ id, label, min, max, step, value, format = (v) => v, oninput }) {
  const out = el('output', { for: id }, format(value));
  const input = el('input', { type: 'range', id, min, max, step, value });
  input.addEventListener('input', () => {
    const v = Number(input.value);
    out.textContent = format(v);
    oninput(v);
  });
  return {
    node: el('div', { class: 'slider' }, el('label', { for: id }, label), out, input),
    set(v) {
      input.value = v;
      out.textContent = format(Number(v));
    },
  };
}

// A row of toggle chips, either exclusive (radio-like) or independent.
export function chips(items, { exclusive = false, onchange }) {
  const row = el('div', { class: 'row', role: exclusive ? 'radiogroup' : 'group' });
  const buttons = items.map((it) => {
    const b = el('button', { class: 'chip', type: 'button', 'aria-pressed': it.on ? 'true' : 'false', 'data-id': it.id, title: it.title }, it.label);
    b.addEventListener('click', () => {
      if (exclusive) {
        for (const o of buttons) o.setAttribute('aria-pressed', o === b ? 'true' : 'false');
        onchange(it.id, true);
      } else {
        const on = b.getAttribute('aria-pressed') !== 'true';
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
        onchange(it.id, on);
      }
    });
    row.append(b);
    return b;
  });
  return {
    node: row,
    set(id, on = true) {
      for (const b of buttons) {
        if (exclusive) b.setAttribute('aria-pressed', b.dataset.id === id ? 'true' : 'false');
        else if (b.dataset.id === id) b.setAttribute('aria-pressed', on ? 'true' : 'false');
      }
    },
  };
}

export function stats(pairs) {
  return el('dl', { class: 'stats' }, pairs.flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v)]));
}

export function fmt(x, digits = 3) {
  if (!Number.isFinite(x)) return '—';
  const a = Math.abs(x);
  if (a !== 0 && (a < 1e-3 || a >= 1e5)) return x.toExponential(Math.max(1, digits - 1)).replace('e', '×10^').replace(/\^\+?(-?\d+)/, (_, e) => toSup(e));
  return x.toPrecision(digits);
}

function toSup(e) {
  const map = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
  return String(e).split('').map((c) => map[c] ?? c).join('');
}
