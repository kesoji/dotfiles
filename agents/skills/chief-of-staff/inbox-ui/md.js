// 受け箱の画面と報告書の表示で使う Markdown の小さな部分集合。HTML は組み立てず、DOM の節だけを作る。
'use strict';

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k in el && k !== 'list' && k !== 'form') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) el.append(kid);
  return el;
}

// | a | b | の行 → table。2行目が |---| なら見出しの行
function cells(row) {
  const s = row.trim().replace(/^\|/, '').replace(/\|\s*$/, '');
  const out = []; let cur = ''; let code = false;
  for (const ch of s) {
    if (ch === '`') code = !code;
    if (ch === '|' && !code) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}
function table(rows) {
  const sep = rows.length > 1 && /^\s*\|?\s*:?-{2,}/.test(rows[1]);
  const t = h('table');
  rows.forEach((r, i) => {
    if (sep && i === 1) return;
    const tag = sep && i === 0 ? 'th' : 'td';
    t.append(h('tr', {}, cells(r).map((c) => h(tag, {}, inline(c)))));
  });
  return h('div', { class: 'table-wrap' }, t);
}

// ───── Markdown（小さな部分集合。HTML は組み立てず、DOM の節だけを作る） ─────
function inline(text) {
  const out = [];
  const re = /`([^`\n]+)`|\*\*([^*\n]+)\*\*|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>"'）」、。]+)/g;
  let last = 0;
  for (let m; (m = re.exec(text)); ) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] !== undefined) out.push(h('code', { text: m[1] }));
    else if (m[2] !== undefined) out.push(h('strong', {}, inline(m[2])));
    else if (m[3] !== undefined) out.push(h('a', { href: m[4], target: '_blank', rel: 'noopener noreferrer', text: m[3] }));
    else out.push(h('a', { href: m[5], target: '_blank', rel: 'noopener noreferrer', text: m[5] }));
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
function markdown(src) {
  const root = document.createDocumentFragment();
  const lines = String(src || '').replace(/\r\n?/g, '\n').replace(/<!--[\s\S]*?-->/g, '').split('\n');
  let para = [];
  let list = null;
  const flushPara = () => {
    if (!para.length) return;
    const p = h('p');
    para.forEach((l, i) => { if (i) p.append(h('br')); p.append(...inline(l)); });
    root.append(p);
    para = [];
  };
  const flush = () => { flushPara(); list = null; };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = line.match(/^\s*(```|~~~)/);
    if (fence) {
      flush();
      const buf = [];
      for (i++; i < lines.length && !lines[i].trim().startsWith(fence[1]); i++) buf.push(lines[i]);
      root.append(h('pre', {}, h('code', { text: buf.join('\n') })));
      continue;
    }
    if (/^\s*\|/.test(line)) { // 表
      flush();
      const buf = [line];
      while (i + 1 < lines.length && /^\s*\|/.test(lines[i + 1])) buf.push(lines[++i]);
      root.append(table(buf));
      continue;
    }
    if (!line.trim()) { flush(); continue; }
    const head = line.match(/^\s{0,3}(#{1,6})\s+(.*)$/);
    if (head) {
      flush();
      root.append(h(`h${Math.min(5, head[1].length + 2)}`, {}, inline(head[2])));
      continue;
    }
    const li = line.match(/^\s*(?:([-*+・])|(\d+)[.)])\s+(.*)$/);
    if (li) {
      flushPara();
      const tag = li[1] ? 'ul' : 'ol';
      if (!list || list.tagName.toLowerCase() !== tag) { list = h(tag); root.append(list); }
      list.append(h('li', {}, inline(li[3])));
      continue;
    }
    if (list && /^\s+\S/.test(line)) { // 箇条書きの続きの行
      list.lastChild.append(h('br'), ...inline(line.trim()));
      continue;
    }
    list = null;
    para.push(line);
  }
  flush();
  return root;
}

