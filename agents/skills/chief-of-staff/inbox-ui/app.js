// CoS 受け箱の画面。API（/api/items・/api/items/:id/answer・/api/items/:id/read・/api/events）だけに依存する。
// 項目の形は ../inbox-schema.md。作り直すときは、このディレクトリを差し替える（cos inbox serve --ui-dir）。
'use strict';

const $ = (id) => document.getElementById(id);
const state = {
  items: [],
  counts: { ask: 0, review: 0, tell: 0 },
  staleAskDays: 3,
  filter: load('cos-inbox-filter') || '',
  drafts: new Map(), // id → { choice, text, rejecting }（描き直しても書きかけを失わない）
  kept: new Set(), // この画面で開いて既読にした「読むだけ」（読んでいる最中に消さない）
  busy: new Set(),
};

function load(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function save(key, v) {
  try { localStorage.setItem(key, v); } catch { /* 覚えられなくても動く */ }
}

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

// ───── 時刻 ─────
function ago(iso) {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return 'たった今';
  if (s < 5400) return `${Math.round(s / 60)}分前`;
  if (s < 129600) return `${Math.round(s / 3600)}時間前`;
  return `${Math.floor(s / 86400)}日前`;
}
function isStale(item) {
  return item.kind === 'ask' && item.status === 'open' && Date.now() - Date.parse(item.createdAt) >= state.staleAskDays * 86400000;
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
  const lines = String(src || '').replace(/\r\n?/g, '\n').split('\n');
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
    if (/^\s*\|/.test(line)) { // 表はそのままの字面で出す
      flush();
      const buf = [line];
      while (i + 1 < lines.length && /^\s*\|/.test(lines[i + 1])) buf.push(lines[++i]);
      root.append(h('pre', {}, h('code', { text: buf.join('\n') })));
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

// ───── API ─────
async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json.error || `失敗しました（${res.status}）`), { status: res.status });
  return json;
}

let errorTimer = null;
function showError(msg) {
  const el = $('error');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(errorTimer);
  errorTimer = setTimeout(() => { el.hidden = true; }, 8000);
}

let loading = null;
let again = false;
function refresh() { // 全件を取り直す。取り直している最中に次の知らせが来たら、終わってからもう一度。
  if (loading) { again = true; return loading; }
  loading = (async () => {
    try {
      const j = await api('GET', '/api/items');
      state.items = j.items;
      state.counts = j.counts;
      state.staleAskDays = j.staleAskDays ?? 3;
      render();
    } catch (e) {
      showError(`受け箱を読めません: ${e.message}`);
    } finally {
      loading = null;
      if (again) { again = false; refresh(); }
    }
  })();
  return loading;
}

async function act(id, path, body) {
  if (state.busy.has(id)) return;
  state.busy.add(id);
  try {
    await api('POST', `/api/items/${encodeURIComponent(id)}/${path}`, body || {});
    state.drafts.delete(id);
  } catch (e) {
    showError(e.message);
  } finally {
    state.busy.delete(id);
    refresh();
  }
}

// ───── 押し出し（SSE）。切れたら自動でつなぎ直し、つながるたびに全件を取り直す ─────
function setConn(s) {
  const el = $('conn');
  el.dataset.state = s;
  el.textContent = { live: '同期中', lost: '切れました。つなぎ直しています…', connecting: 'つないでいます…' }[s];
}
function connect() {
  const es = new EventSource('/api/events');
  es.addEventListener('hello', () => { setConn('live'); refresh(); });
  es.addEventListener('change', () => refresh());
  es.onerror = () => {
    setConn('lost');
    if (es.readyState === EventSource.CLOSED) { // ブラウザがつなぎ直しをやめたときは自分でやり直す
      es.close();
      setTimeout(connect, 1500);
    }
  };
}

// ───── 描く ─────
function whoOf(item) {
  return item.worker ? `${item.chief.name} / ${item.worker}` : item.chief.name;
}

function bodyBlock(item) {
  if (!item.body || !item.body.trim()) return null;
  const body = h('div', { class: 'body' }, markdown(item.body));
  // 長い本文は折りたたむ（題と選択肢を先に見せる）
  if (item.body.length > 700 || item.body.split('\n').length > 14) {
    return h('details', { class: 'fold' }, h('summary', { text: '本文を開く' }), body);
  }
  return body;
}

function linksBlock(item) {
  if (!item.links || !item.links.length) return null;
  return h('div', { class: 'links' }, item.links.map((l) => h('a', { href: l.url || l.href, target: '_blank', rel: 'noopener noreferrer', text: `${l.label} を開く` })));
}

function metaBlock(item) {
  return h('div', { class: 'meta' },
    h('span', { class: 'who', text: whoOf(item) }),
    h('span', { text: '・' }),
    h('span', { class: 'age' }),
    h('span', { class: 'badge', text: `${state.staleAskDays}日以上`, hidden: true }));
}

function draftOf(id) {
  if (!state.drafts.has(id)) state.drafts.set(id, { choice: null, text: '', rejecting: false });
  return state.drafts.get(id);
}

function askCard(item) {
  const d = draftOf(item.id);
  const opts = item.options || [];
  const send = h('button', { class: 'btn primary', type: 'submit', text: '返す' });
  const text = h('input', {
    type: 'text', value: d.text, autocomplete: 'off',
    placeholder: opts.length ? (item.freeText ? '一言（任意）。選ばずに文章だけで返してもよい' : '一言（任意）') : '返事を書く',
    'aria-label': '一言',
    oninput: () => { d.text = text.value; sync(); },
  });
  const sync = () => { send.disabled = !(d.choice || (item.freeText && d.text.trim())); };
  const form = h('form', {
    onsubmit: (e) => {
      e.preventDefault();
      if (send.disabled) return;
      send.disabled = true;
      act(item.id, 'answer', { choice: d.choice, text: d.text.trim() || null });
    },
  },
  opts.length ? h('fieldset', { class: 'options' }, h('legend', { hidden: true, text: '選択肢' }), opts.map((o) => h('label', { class: 'opt' },
    h('input', { type: 'radio', name: `opt-${item.id}`, value: o.key, checked: d.choice === o.key, onchange: () => { d.choice = o.key; sync(); } }),
    h('span', {}, h('span', { class: 'label', text: o.label }), o.key === item.recommend ? h('span', { class: 'rec', text: '★ おすすめ' }) : null),
    o.detail ? h('span', { class: 'detail', text: o.detail }) : null))) : null,
  h('div', { class: 'reply' }, text, send));
  sync();
  return h('article', { class: 'card' }, metaBlock(item), h('h3', { class: 'title', text: item.title }), bodyBlock(item), linksBlock(item), form);
}

function reviewCard(item) {
  const d = draftOf(item.id);
  const reply = h('div', { class: 'reply' });
  const draw = () => {
    if (!d.rejecting) {
      reply.replaceChildren(
        h('button', { class: 'btn primary', type: 'button', text: '承認', onclick: (e) => { e.target.disabled = true; act(item.id, 'answer', { choice: 'approve' }); } }),
        h('button', { class: 'btn danger', type: 'button', text: '差し戻し…', onclick: () => { d.rejecting = true; draw(); reply.querySelector('textarea').focus(); } }));
      return;
    }
    const send = h('button', { class: 'btn danger', type: 'button', text: '差し戻す', disabled: !d.text.trim(), onclick: () => { send.disabled = true; act(item.id, 'answer', { choice: 'reject', text: d.text.trim() }); } });
    const ta = h('textarea', { value: d.text, placeholder: '差し戻す理由・直してほしい点（必須）', 'aria-label': '差し戻しのコメント', oninput: () => { d.text = ta.value; send.disabled = !d.text.trim(); } });
    reply.replaceChildren(ta, send, h('button', { class: 'btn', type: 'button', text: 'やめる', onclick: () => { d.rejecting = false; draw(); } }));
  };
  draw();
  return h('article', { class: 'card' }, metaBlock(item), h('h3', { class: 'title', text: item.title }), bodyBlock(item), linksBlock(item), reply);
}

function answerSummary(item) {
  if (item.status === 'read') return '既読';
  if (item.status === 'withdrawn') return item.supersededBy ? '取り下げ（置き換え）' : '取り下げ';
  const a = item.answer || {};
  const label = item.kind === 'review' ? { approve: '承認', reject: '差し戻し' }[a.choice] : (item.options || []).find((o) => o.key === a.choice)?.label;
  return [label || a.choice, a.text ? `「${a.text}」` : null].filter(Boolean).join(' ') || '返事済み';
}

// 1行の項目（読むだけ・済んだもの）。開くと本文。読むだけは開いたら既読にする。
function row(item) {
  const el = h('details', { class: 'row' },
    h('summary', {},
      h('span', { class: 'who', text: whoOf(item) }),
      h('span', { class: 't', text: item.title }),
      h('span', { class: 'state' }),
      h('span', { class: 'age' })),
    h('div', { class: 'inner' }, bodyBlock(item) || h('p', { class: 'body', text: '（本文なし）' }), linksBlock(item), h('p', { class: 'answer', hidden: true })));
  el.addEventListener('toggle', () => {
    const cur = state.items.find((x) => x.id === item.id);
    if (el.open && cur && cur.kind === 'tell' && cur.status === 'open') {
      state.kept.add(item.id);
      act(item.id, 'read');
    }
  });
  return el;
}

// 描き直さずに変えられるところ（経過・赤・既読の印）
function touch(el, item) {
  const age = el.querySelector('.age');
  if (age) age.textContent = ago(item.status === 'open' ? item.createdAt : (item.answer?.at || item.readAt || item.withdrawnAt || item.createdAt));
  if (el.classList.contains('card')) {
    const stale = isStale(item);
    el.classList.toggle('stale', stale);
    el.querySelector('.badge').hidden = !stale;
  } else {
    el.classList.toggle('unread', item.status === 'open');
    const st = el.querySelector('.state');
    st.textContent = item.status === 'open' ? '' : answerSummary(item);
    const ans = el.querySelector('.answer');
    const closedKind = item.kind !== 'tell' && item.status === 'answered';
    ans.hidden = !closedKind;
    if (closedKind) ans.textContent = `返事: ${answerSummary(item)}`;
  }
}

// 項目の並びを DOM に反映する。変わっていない項目の要素は作り直さない・動かさない（入力中の文字とフォーカスを保つ）。
const built = new Map(); // `${場所}:${id}` → { el, sig }
function reconcile(container, items, make, sigOf) {
  const want = [];
  for (const item of items) {
    const key = `${container.id}:${item.id}`;
    const sig = sigOf(item);
    let b = built.get(key);
    if (!b || b.sig !== sig) {
      b = { el: make(item), sig };
      built.set(key, b);
    }
    touch(b.el, item);
    want.push(b.el);
  }
  const keep = new Set(want);
  for (const el of [...container.children]) if (!keep.has(el)) el.remove();
  want.forEach((el, i) => {
    if (container.children[i] !== el) container.insertBefore(el, container.children[i] || null);
  });
  for (const key of [...built.keys()]) {
    if (key.startsWith(`${container.id}:`) && !keep.has(built.get(key).el)) built.delete(key);
  }
}

const cardSig = (x) => JSON.stringify([x.id, x.title, x.body, x.options, x.recommend, x.freeText, x.links, x.worker, x.chief.name]);
const rowSig = (x) => JSON.stringify([x.id, x.title, x.body, x.links, x.worker, x.chief.name]);

function render() {
  const all = state.items;
  const open = all.filter((x) => x.status === 'open');
  const chiefs = [...new Set(all.filter((x) => x.status === 'open' || state.kept.has(x.id)).map((x) => x.chief.name))].sort();
  if (state.filter && !chiefs.includes(state.filter)) state.filter = '';
  const seen = (x) => !state.filter || x.chief.name === state.filter;

  // 見出しの件数（全 CoS）
  const c = state.counts;
  $('counts').replaceChildren('要返事 ', h('b', { text: String(c.ask) }), ' ・ 確認 ', h('b', { text: String(c.review) }), ' ・ 読むだけ ', h('b', { text: String(c.tell) }));
  const waiting = c.ask + c.review;
  document.title = `${waiting ? `(${waiting}) ` : ''}CoS 受け箱`;

  // CoS ごとの絞り込み
  const chip = (name, label, n) => h('button', {
    class: 'chip', type: 'button', 'aria-pressed': String(state.filter === name),
    onclick: () => { state.filter = name; save('cos-inbox-filter', name); render(); },
  }, label, h('span', { class: 'n', text: String(n) }));
  $('chips').replaceChildren(chip('', '全部', open.length), ...chiefs.map((n) => chip(n, n, open.filter((x) => x.chief.name === n).length)));
  $('chips').hidden = chiefs.length < 2;

  const asks = open.filter((x) => x.kind === 'ask' && seen(x));
  const reviews = open.filter((x) => x.kind === 'review' && seen(x));
  const tells = all.filter((x) => x.kind === 'tell' && (x.status === 'open' || (state.kept.has(x.id) && x.status === 'read')) && seen(x))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const done = all.filter((x) => x.status !== 'open' && !tells.includes(x) && seen(x)).slice(0, 30);

  reconcile($('list-ask'), asks, askCard, cardSig);
  reconcile($('list-review'), reviews, reviewCard, cardSig);
  reconcile($('list-tell'), tells, row, rowSig);
  reconcile($('list-done'), done, row, rowSig);
  $('sec-ask').hidden = !asks.length;
  $('sec-review').hidden = !reviews.length;
  $('sec-tell').hidden = !tells.length;
  $('sec-done').hidden = !done.length;
  $('done-count').textContent = done.length ? `（直近 ${done.length} 件）` : '';
  $('empty').hidden = Boolean(asks.length || reviews.length || tells.length);

  // 消えた項目の書きかけは捨てる
  for (const id of [...state.drafts.keys()]) if (!open.some((x) => x.id === id)) state.drafts.delete(id);
}

connect();
refresh();
setInterval(() => { if (state.items.length) render(); }, 60000); // 「3時間前」と赤の印を進める
