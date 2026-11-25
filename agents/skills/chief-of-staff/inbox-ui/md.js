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
// GitHub へのリンク: repo（項目の GitHub のリポジトリ owner/name）が分かるときだけ、PR #123・#123・Issue #123 とコミットの SHA をリンクにする。
// owner/name#123 は repo が無くてもリンクにする。コード（`…`・```）と、すでにリンクの中の文字はリンクにしない。
const REPO_OK = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/;
const okRepo = (r) => (typeof r === 'string' && REPO_OK.test(r) ? r : null);
let mdRepo = null; // markdown() が描いているあいだの repo
const ext = (href, text) => h('a', { href, target: '_blank', rel: 'noopener noreferrer', text });
// refsOnly: 題などの1行の文字用。Markdown の記法は描かず（元の文字のまま）、GitHub へのリンクだけを作る。
function inline(text, repo = mdRepo, refsOnly = false) {
  const out = [];
  repo = okRepo(repo);
  //          1 code       2 bold               3,4 [text](url)                          5 url
  const re = /`([^`\n]+)`|\*\*([^*\n]+)\*\*|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>"'）」、。]+)|(?<![A-Za-z0-9_.\/#&-])([A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100})#(\d+)(?![A-Za-z0-9_])|(?<![A-Za-z0-9_\/#&])(?:(PR|Issue)\s?)?#(\d+)(?![A-Za-z0-9_])|(?<![A-Za-z0-9_\/.#@-])([0-9a-f]{7,40})(?![A-Za-z0-9_-])/g;
  //          6,7 owner/name#N   8,9 (PR|Issue)? #N   10 コミットの SHA
  let last = 0;
  for (let m; (m = re.exec(text)); ) {
    let node = null;
    if (m[6] !== undefined) node = ext(`https://github.com/${m[6]}/issues/${m[7]}`, m[0]);
    else if (m[9] !== undefined) node = repo ? ext(`https://github.com/${repo}/${m[8] === 'PR' ? 'pull' : 'issues'}/${m[9]}`, m[0]) : null;
    // SHA は数字と a-f の両方を含むものだけ（"deadbeef" のような英単語・日付のような数字だけの並びはリンクにしない）
    else if (m[10] !== undefined) node = repo && /[0-9]/.test(m[10]) && /[a-f]/.test(m[10]) ? ext(`https://github.com/${repo}/commit/${m[10]}`, m[0]) : null;
    else if (refsOnly) node = null;
    else if (m[1] !== undefined) node = h('code', { text: m[1] });
    else if (m[2] !== undefined) node = h('strong', {}, inline(m[2], repo));
    else if (m[3] !== undefined) node = ext(m[4], m[3]);
    else node = ext(m[5], m[5]);
    if (node === null) continue; // リンクにしないものは元の文字のまま（次の文字の塊に含める）
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(node);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
// 題などの1行の文字。GitHub へのリンクだけを作る。
function refLinks(text, repo) {
  return inline(String(text ?? ''), repo, true);
}
function markdown(src, repo = null) {
  mdRepo = okRepo(repo);
  try {
    return markdownBody(src);
  } finally {
    mdRepo = null;
  }
}
const HR = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const LI = /^(\s*)(?:([-*+・])|(\d+)[.)])\s+(.*)$/;
const indentOf = (line) => line.match(/^[ \t]*/)[0].replace(/\t/g, '    ').length;
function markdownBody(src) {
  const root = document.createDocumentFragment();
  const lines = String(src || '').replace(/\r\n?/g, '\n').replace(/<!--[\s\S]*?-->/g, '').split('\n');
  let para = [];
  // 入れ子のリスト: stack の各段は { indent（記号の字下げ）, el（ul/ol）, parent（el を置いた先） }
  let stack = [];
  const flushPara = () => {
    if (!para.length) return;
    const p = h('p');
    para.forEach((l, i) => { if (i) p.append(h('br')); p.append(...inline(l)); });
    root.append(p);
    para = [];
  };
  const flush = () => { flushPara(); stack = []; };
  const nextNonBlank = (i) => { for (let j = i + 1; j < lines.length; j++) if (lines[j].trim()) return lines[j]; return null; };
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
    if (!line.trim()) {
      flushPara();
      // 項目のあいだの空行ではリストを続ける（次が項目か字下げした続きのとき）
      const nx = nextNonBlank(i);
      if (!(stack.length && nx !== null && (LI.test(nx) || indentOf(nx) > 0))) stack = [];
      continue;
    }
    if (/^\s*>/.test(line)) { // 引用: 続く > の行をまとめ、中身は Markdown として描く
      flush();
      const buf = [line.replace(/^\s*>\s?/, '')];
      while (i + 1 < lines.length && /^\s*>/.test(lines[i + 1])) buf.push(lines[++i].replace(/^\s*>\s?/, ''));
      root.append(h('blockquote', {}, markdownBody(buf.join('\n'))));
      continue;
    }
    if (HR.test(line)) { flush(); root.append(h('hr')); continue; }
    const head = line.match(/^\s{0,3}(#{1,6})\s+(.*)$/);
    if (head) {
      flush();
      root.append(h(`h${Math.min(5, head[1].length + 2)}`, {}, inline(head[2])));
      continue;
    }
    const li = line.match(LI);
    if (li) {
      flushPara();
      const indent = indentOf(line);
      const tag = li[2] ? 'ul' : 'ol';
      while (stack.length > 1 && stack[stack.length - 1].indent > indent) stack.pop();
      let top = stack[stack.length - 1];
      if (top && indent >= top.indent + 2 && top.el.lastChild) { // 前の項目の子
        const parent = top.el.lastChild;
        const el = h(tag, tag === 'ol' && Number(li[3]) !== 1 ? { start: Number(li[3]) } : {});
        parent.append(el);
        top = { indent, el, parent };
        stack.push(top);
      } else if (!top || top.el.tagName.toLowerCase() !== tag) { // 最初の項目、または同じ階層で種類が変わった
        const parent = top ? top.parent : root;
        const el = h(tag, tag === 'ol' && Number(li[3]) !== 1 ? { start: Number(li[3]) } : {});
        parent.append(el);
        if (top) stack.pop();
        top = { indent: top ? top.indent : indent, el, parent };
        stack.push(top);
      }
      top.el.append(h('li', {}, inline(li[4])));
      continue;
    }
    if (stack.length && indentOf(line) > 0) { // 項目の続きの行（いちばん近い親の項目に入れる）
      const ind = indentOf(line);
      const owner = [...stack].reverse().find((s) => s.indent < ind) || stack[0];
      const li2 = owner.el.lastChild;
      const lastTag = li2.lastChild && li2.lastChild.tagName ? li2.lastChild.tagName.toLowerCase() : '';
      if (lastTag === 'ul' || lastTag === 'ol') li2.append(h('div', {}, inline(line.trim()))); // 子のリストの後ろの続きは別の行に
      else if (lastTag === 'div') li2.lastChild.append(h('br'), ...inline(line.trim()));
      else li2.append(h('br'), ...inline(line.trim()));
      continue;
    }
    stack = [];
    para.push(line);
  }
  flush();
  return root;
}
