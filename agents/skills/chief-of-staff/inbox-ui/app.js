// CoS 受け箱の画面。API（/api/items・/api/items/:id/answer・/api/items/:id/read・/api/chiefs・/api/messages・/api/events）だけに依存する。
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
  chiefs: [], // GET /api/chiefs（記録されている CoS と状況）
  compose: { to: '', text: '', sending: false }, // 指示の書きかけ（to は CoS の dir）
};

function load(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function save(key, v) {
  try { localStorage.setItem(key, v); } catch { /* 覚えられなくても動く */ }
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
      // CoS の状況は取れなくても受け箱は出す（古い版のサーバーには /api/chiefs が無い）
      const [j, c] = await Promise.all([api('GET', '/api/items'), api('GET', '/api/chiefs').catch(() => null)]);
      if (c) state.chiefs = c.chiefs || [];
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

// ───── 複数行の入力欄 ─────
// Enter で送る・Shift+Enter で改行。日本語の変換を確定する Enter（isComposing / keyCode 229）では送らない。
// 行が増えたら高さを伸ばす（上限は CSS の max-height。超えたらスクロール）。
function grow(ta) {
  if (!ta.isConnected) return;
  ta.style.height = 'auto';
  ta.style.height = `${ta.scrollHeight + 2}px`;
}
function autoText({ value = '', placeholder = '', label = '', oninput, onsubmit }) {
  const ta = h('textarea', {
    class: 'auto', rows: 1, value, placeholder, 'aria-label': label, autocomplete: 'off',
    oninput: () => { grow(ta); if (oninput) oninput(ta.value); },
    onkeydown: (e) => {
      if (e.key !== 'Enter' || e.shiftKey || e.isComposing || e.keyCode === 229) return;
      e.preventDefault();
      if (onsubmit) onsubmit();
    },
  });
  requestAnimationFrame(() => grow(ta)); // DOM に入ってから高さを合わせる（書きかけを戻したとき）
  return ta;
}

// ───── CoS ごとの色 ─────
// 名前のハッシュで色を決め、ほかの CoS とぶつかったら次の色へずらす（開番地法）。
// 一度決まった色は localStorage に覚えて、CoS が増えても変えない。
const PALETTE = [
  ['#e3f0ff', '#1f5fbf'], ['#e6f6ea', '#1d7a3a'], ['#fdeee2', '#b3541e'], ['#f3e8fd', '#7b3fc4'],
  ['#fde8ef', '#b8326a'], ['#e2f5f5', '#14787a'], ['#fbf3d9', '#8a6a00'], ['#ececf9', '#4447b0'],
  ['#f9e6e3', '#a8382a'], ['#e9f2df', '#4f7a1c'], ['#e5eef3', '#3d6278'], ['#f6e9df', '#7d5232'],
];
function fnv1a(s) {
  let x = 0x811c9dc5;
  for (const ch of s) { x ^= ch.codePointAt(0); x = Math.imul(x, 0x01000193) >>> 0; }
  return x;
}
const colors = (() => { try { return JSON.parse(load('cos-inbox-colors') || '{}'); } catch { return {}; } })();
function colorOf(name) {
  if (colors[name] === undefined) {
    const used = new Set(Object.values(colors));
    let i = fnv1a(name) % PALETTE.length;
    for (let n = 0; n < PALETTE.length && used.has(i); n++) i = (i + 1) % PALETTE.length; // 全部使い切ったら重なってよい
    colors[name] = i;
    save('cos-inbox-colors', JSON.stringify(colors));
  }
  return PALETTE[colors[name]];
}
// 色は data-chief の CSS で付ける（描き直さずに済む）
function paintChiefs(names) {
  const css = [...names].sort().map((n) => { const [bg, fg] = colorOf(n); return `[data-chief="${CSS.escape(n)}"]{--c-bg:${bg};--c-fg:${fg}}`; }).join('\n');
  let el = document.getElementById('chief-colors');
  if (!el) { el = h('style', { id: 'chief-colors' }); document.head.append(el); }
  if (el.textContent !== css) el.textContent = css;
}
const chiefTag = (name) => h('span', { class: 'tag', 'data-chief': name, text: name });

// ───── 描く ─────
function whoBlock(item) {
  return h('span', { class: 'who' }, chiefTag(item.chief.name), item.worker ? ` / ${item.worker}` : null);
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

// 手元の .md は view.html で Markdown として表示する（元のテキストはそこから開ける）
function linkHref(l) {
  const url = l.url || l.href;
  if (url.startsWith('/api/') && /\.(md|markdown)$/i.test(l.href)) return `view.html?src=${encodeURIComponent(url)}&name=${encodeURIComponent(l.label)}`;
  return url;
}
function linksBlock(item) {
  if (!item.links || !item.links.length) return null;
  return h('div', { class: 'links' }, item.links.map((l) => h('a', { href: linkHref(l), target: '_blank', rel: 'noopener noreferrer', text: `${l.label} を開く` })));
}

// 指示への返事なら、元の指示を1行で出す
function replyOf(item) {
  if (!item.replyTo) return null;
  const m = state.items.find((x) => x.id === item.replyTo);
  return h('span', { class: 'reply-to', text: `↩ 指示「${m ? m.title : item.replyTo}」への返事` });
}

function metaBlock(item) {
  return h('div', { class: 'meta' },
    whoBlock(item),
    h('span', { text: '・' }),
    h('span', { class: 'age' }),
    h('span', { class: 'badge', text: `${state.staleAskDays}日以上`, hidden: true }),
    replyOf(item));
}

function draftOf(id) {
  if (!state.drafts.has(id)) state.drafts.set(id, { choice: null, text: '', rejecting: false });
  return state.drafts.get(id);
}

function askCard(item) {
  const d = draftOf(item.id);
  const opts = item.options || [];
  const send = h('button', { class: 'btn primary', type: 'submit', text: '返す' });
  const text = autoText({
    value: d.text,
    placeholder: opts.length ? (item.freeText ? '一言（任意）。選ばずに文章だけで返してもよい' : '一言（任意）') : '返事を書く',
    label: '一言',
    oninput: (v) => { d.text = v; sync(); },
    onsubmit: () => form.requestSubmit(),
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
    const ta = autoText({ value: d.text, placeholder: '差し戻す理由・直してほしい点（必須）', label: '差し戻しのコメント', oninput: (v) => { d.text = v; send.disabled = !d.text.trim(); }, onsubmit: () => send.click() });
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
      whoBlock(item),
      h('span', { class: 't', text: item.title }),
      h('span', { class: 'state' }),
      h('span', { class: 'age' })),
    h('div', { class: 'inner' }, item.replyTo ? h('p', { class: 'meta' }, replyOf(item)) : null, bodyBlock(item) || h('p', { class: 'body', text: '（本文なし）' }), linksBlock(item), h('p', { class: 'answer', hidden: true })));
  el.addEventListener('toggle', () => {
    const cur = state.items.find((x) => x.id === item.id);
    if (el.open && cur && cur.kind === 'tell' && cur.status === 'open') {
      state.kept.add(item.id);
      act(item.id, 'read');
    }
  });
  return el;
}

// ───── CoS への指示と CoS の状況 ─────
const repliesOf = (id) => state.items.filter((x) => x.replyTo === id);
const KIND_JA = { ask: '要返事', review: '確認依頼', tell: '読むだけ' };

// 送った指示の1行。開くと全文と、CoS の返事（--reply-to で出された項目）。
function msgRow(item) {
  const replies = repliesOf(item.id);
  return h('details', { class: 'row msg' },
    h('summary', {},
      h('span', { class: 'who' }, '→ ', chiefTag(item.chief.name)),
      h('span', { class: 't', text: item.title }),
      h('span', { class: 'state' }),
      h('span', { class: 'age' })),
    h('div', { class: 'inner' },
      h('p', { class: 'body plain', text: item.body }),
      replies.length ? h('ul', { class: 'replies' }, replies.map((r) => h('li', { text: `CoS の返事（${KIND_JA[r.kind] || r.kind}）: ${r.title}` }))) : null));
}
const msgSig = (x) => JSON.stringify([x.id, x.body, x.chief.name, repliesOf(x.id).map((r) => [r.id, r.title])]);

const WORKER_STATUS = { working: '作業中', idle: 'ターン終了', done: 'ターン終了', blocked: '承認待ち', gone: 'いない' };
function workerLine(w) {
  const st = w.state !== 'running' ? w.state : (WORKER_STATUS[w.status] || w.status || '?');
  const days = w.staleDone != null ? Math.floor(w.staleDone / 86400000) : null;
  return h('li', { class: w.staleDone != null ? 'stale' : (w.report === '質問' || w.status === 'blocked' ? 'wait' : '') },
    h('b', { text: w.id }),
    w.label && w.label !== w.id ? `「${w.label}」` : null,
    h('span', { class: 'ws', text: ` ${st}・報告「${w.report || 'なし'}」${w.reportUpdated ? `（${ago(w.reportUpdated)}）` : ''}${days != null ? `・取り込み待ち${days ? ` ${days}日` : ''}` : ''}` }),
    w.title ? h('span', { class: 'wt', text: ` ${w.title}` }) : null);
}
function when(iso) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function chiefCard(c) {
  const picked = state.filter === c.name;
  const watch = c.watch && c.watch.alive
    ? h('span', { class: 'watch on', text: '見張り中' })
    : h('span', { class: 'watch off', text: `見張りなし${c.watch && c.watch.lastAt ? `（最後は${ago(c.watch.lastAt)}）` : ''}`, title: '指示は、この CoS が次に cos watch を張ったときに届きます' });
  return h('article', { class: `chief-card${picked ? ' picked' : ''}` },
    h('div', { class: 'ch-head' },
      h('button', { class: 'ch-name', type: 'button', title: picked ? '絞り込みを外す' : 'この CoS に絞り込んで指示を書く', onclick: () => setFilter(picked ? '' : c.name) }, chiefTag(c.name)),
      watch,
      c.unread ? h('span', { class: 'unread-n', text: `未読の指示 ${c.unread}` }) : null),
    c.error ? h('p', { class: 'ch-error', text: `状況を読めません: ${c.error}` }) : null,
    c.workers && c.workers.length ? h('ul', { class: 'workers' }, c.workers.map(workerLine)) : (c.error ? null : h('p', { class: 'ch-none', text: '作業セッションなし' })),
    c.retro ? h('p', { class: `retro${c.retro.due ? ' due' : ''}`, text: c.retro.due ? `振り返り: 期限を過ぎています（${when(c.retro.dueAt)}）` : `振り返り: 次は ${when(c.retro.dueAt)}` }) : null);
}

function setFilter(name) {
  state.filter = name;
  save('cos-inbox-filter', name);
  render();
}

// 指示の入力欄（1つだけ作って使い回す＝描き直しても書きかけを失わない）
const compose = (() => {
  const c = state.compose;
  const to = h('select', { id: 'compose-to', 'aria-label': '宛先の CoS', onchange: () => { c.to = to.value; sync(); } });
  const send = h('button', { class: 'btn primary', type: 'submit', text: '送る' });
  const text = autoText({ placeholder: '', label: 'CoS への指示', oninput: (v) => { c.text = v; sync(); }, onsubmit: () => form.requestSubmit() });
  const target = () => (state.filter ? state.chiefs.find((x) => x.name === state.filter) : state.chiefs.find((x) => x.dir === c.to));
  function sync() { send.disabled = c.sending || !target() || !c.text.trim(); }
  const form = h('form', {
    class: 'compose',
    onsubmit: async (e) => {
      e.preventDefault();
      const t = target();
      if (c.sending || !t || !c.text.trim()) return;
      c.sending = true; sync();
      try {
        await api('POST', '/api/messages', { to: t.dir, text: c.text });
        c.text = ''; text.value = ''; grow(text);
      } catch (err) {
        showError(err.message);
      } finally {
        c.sending = false; sync(); refresh();
      }
    },
  }, to, text, send);
  // 宛先の選択肢と見出しを今の絞り込みに合わせる（入力中の文字には触らない）
  function update() {
    const want = JSON.stringify(state.chiefs.map((x) => [x.dir, x.name]));
    if (to.dataset.sig !== want) {
      to.dataset.sig = want;
      to.replaceChildren(h('option', { value: '', text: '宛先を選ぶ…' }), ...state.chiefs.map((x) => h('option', { value: x.dir, text: x.name })));
      to.value = state.chiefs.some((x) => x.dir === c.to) ? c.to : '';
      c.to = to.value;
    }
    to.hidden = Boolean(state.filter);
    text.placeholder = state.filter ? `${state.filter} への指示（Enter で送る・Shift+Enter で改行）` : '指示を書く（Enter で送る・Shift+Enter で改行）';
    const t = target();
    $('compose-note').textContent = t && !(t.watch && t.watch.alive)
      ? `${t.name} は見張り（cos watch）を張っていません。指示は、次に見張りを張ったときに届きます。`
      : '';
    $('compose-note').hidden = !$('compose-note').textContent;
    sync();
  }
  return { form, update };
})();

// 描き直さずに変えられるところ（経過・赤・既読の印）
function touch(el, item) {
  if (item.kind === 'message') {
    el.querySelector('.age').textContent = ago(item.createdAt);
    el.classList.toggle('pending', item.status === 'open');
    el.querySelector('.state').textContent = item.status === 'open' ? '送った（CoS は未読）' : item.status === 'read' ? `CoS が読んだ（${ago(item.readAt || item.createdAt)}）` : '取り下げ';
    return;
  }
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

const cardSig = (x) => JSON.stringify([x.id, x.title, x.body, x.options, x.recommend, x.freeText, x.links, x.worker, x.chief.name, x.replyTo]);
const rowSig = (x) => JSON.stringify([x.id, x.title, x.body, x.links, x.worker, x.chief.name, x.replyTo]);

function render() {
  const all = state.items;
  const open = all.filter((x) => x.status === 'open');
  // 絞り込みに出す CoS: 記録されている CoS（指示の宛先になる）と、未対応の項目を持つ CoS
  const chiefs = [...new Set([...state.chiefs.map((c) => c.name), ...all.filter((x) => x.status === 'open' || state.kept.has(x.id)).map((x) => x.chief.name)])].sort();
  if (state.filter && !chiefs.includes(state.filter)) state.filter = '';
  const seen = (x) => !state.filter || x.chief.name === state.filter;
  paintChiefs(new Set([...all.map((x) => x.chief.name), ...chiefs]));

  // 見出しの件数（全 CoS）
  const c = state.counts;
  $('counts').replaceChildren('要返事 ', h('b', { text: String(c.ask) }), ' ・ 確認 ', h('b', { text: String(c.review) }), ' ・ 読むだけ ', h('b', { text: String(c.tell) }));
  const waiting = c.ask + c.review;
  document.title = `${waiting ? `(${waiting}) ` : ''}CoS 受け箱`;
  // アプリ（PWA）のアイコンに、返事待ち（要返事＋確認依頼）の件数を出す。使えないブラウザでは何もしない。
  try {
    if (waiting && navigator.setAppBadge) navigator.setAppBadge(waiting).catch(() => {});
    else if (!waiting && navigator.clearAppBadge) navigator.clearAppBadge().catch(() => {});
  } catch { /* バッジが出せなくても動く */ }

  // CoS ごとの絞り込み
  const chip = (name, label, n) => h('button', {
    class: 'chip', type: 'button', 'aria-pressed': String(state.filter === name),
    onclick: () => setFilter(name),
  }, name ? h('span', { class: 'swatch', 'data-chief': name }) : null, label, h('span', { class: 'n', text: String(n) }));
  const mine = open.filter((x) => x.kind !== 'message'); // 件数はユーザーの番のものだけ
  $('chips').replaceChildren(chip('', '全部', mine.length), ...chiefs.map((n) => chip(n, n, mine.filter((x) => x.chief.name === n).length)));
  $('chips').hidden = chiefs.length < (state.chiefs.length ? 1 : 2);

  // CoS の状況と、指示の入力欄・送った指示
  const cards = state.chiefs.filter((c) => !state.filter || c.name === state.filter);
  $('chief-cards').replaceChildren(...cards.map(chiefCard));
  if (!$('compose-slot').firstChild) $('compose-slot').append(compose.form);
  compose.update();
  const msgsAll = all.filter((x) => x.kind === 'message' && seen(x)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const msgs = msgsAll.filter((x, i) => x.status === 'open' || i < 5);
  reconcile($('list-msg'), msgs, msgRow, msgSig);
  $('list-msg').hidden = !msgs.length;
  $('sec-chiefs').hidden = !state.chiefs.length && !msgs.length;
  $('compose-box').hidden = !state.chiefs.length;

  const asks = open.filter((x) => x.kind === 'ask' && seen(x));
  const reviews = open.filter((x) => x.kind === 'review' && seen(x));
  const tells = all.filter((x) => x.kind === 'tell' && (x.status === 'open' || (state.kept.has(x.id) && x.status === 'read')) && seen(x))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const done = all.filter((x) => x.status !== 'open' && x.kind !== 'message' && !tells.includes(x) && seen(x)).slice(0, 30);

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
setInterval(refresh, 15000); // CoS の状況（見張り・作業セッション）は受け箱の変更では知らされないので、時々取り直す
window.addEventListener('resize', () => document.querySelectorAll('textarea.auto').forEach(grow));
