// CoS 受け箱の画面。API（/api/items・/api/items/:id/answer・/api/items/:id/read・/api/chiefs・/api/messages・/api/todos・/api/todos/done・/api/events）だけに依存する。
// 項目の形は ../inbox-schema.md。作り直すときは、このディレクトリを差し替える（cos inbox serve --ui-dir）。
'use strict';

const $ = (id) => document.getElementById(id);
const KINDS = ['ask', 'review', 'todo', 'tell'];
const FILTER_KINDS = [...KINDS, 'tfile']; // 種類の絞り込み（⌥1〜5）。tfile＝TODO ファイルの行（受け箱の項目ではない）
const state = {
  items: [],
  counts: { ask: 0, review: 0, todo: 0, tell: 0 },
  staleAskDays: 3,
  filter: load('cos-inbox-filter') || '',
  kind: FILTER_KINDS.includes(load('cos-inbox-kind')) ? load('cos-inbox-kind') : '', // 種類の絞り込み（CoS の絞り込みとは独立。両方が効く）
  drafts: new Map(), // id → { choice, text, rejecting }（描き直しても書きかけを失わない）
  kept: new Set(), // この画面で開いて既読にした「読むだけ」（読んでいる最中に消さない）
  openBodies: new Set(), // 長い本文を全部開いている項目の id（描き直しても開閉を保つ）
  threads: new Map(), // 指示の id → スレッド（thread.js の buildThreads。render のたびに作り直す）
  busy: new Set(),
  chiefs: [], // GET /api/chiefs（記録されている CoS と状況）
  compose: { to: '', text: '', sending: false }, // 指示の書きかけ（to は CoS の dir）
  todos: [], // GET /api/todos の chiefs（TODO ファイルを持つ CoS と、その行）
  todosLoaded: false,
  today: '', // サーバーの今日（YYYY-MM-DD）
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
  return (item.kind === 'ask' || item.kind === 'todo') && item.status === 'open' && Date.now() - Date.parse(item.createdAt) >= state.staleAskDays * 86400000;
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
      // TODO も同じ（古い版のサーバーには /api/todos が無い＝TODO の欄を出さない）
      const [j, c, t] = await Promise.all([api('GET', '/api/items'), api('GET', '/api/chiefs').catch(() => null), api('GET', '/api/todos').catch(() => null)]);
      if (c) state.chiefs = c.chiefs || [];
      state.todos = t ? t.chiefs || [] : [];
      state.today = t ? t.today : '';
      state.todosLoaded = true;
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
// Enter で送る・Shift+Enter で改行。⌘Enter（Mac 以外は Ctrl+Enter）でも送る。
// 日本語の変換を確定する Enter（isComposing / keyCode 229）では送らない。
// 行が増えたら高さを伸ばす（上限は CSS の max-height。超えたらスクロール）。
const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const MOD_ENTER = IS_MAC ? '⌘Enter' : 'Ctrl+Enter';
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
      if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
      const mod = IS_MAC ? e.metaKey : e.ctrlKey;
      if (!mod && e.shiftKey) return; // 改行
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

// 本文。長い本文は、カードでは最初の約2行だけを出し、2行目の途中から下へ透明にしていく（題と選択肢を先に見せる）。
// 「本文を開く」か薄くなっている本文を押すと全部が開き、「閉じる」で戻る。開閉は state.openBodies に覚える（描き直しても保つ）。
// preview: false（1行の項目を開いたときの本文）は、開いた時点で全部を出す。
function bodyBlock(item, preview = true) {
  if (!item.body || !item.body.trim()) return null;
  const body = h('div', { class: 'body' }, markdown(item.body, item.repo));
  if (!preview || !(item.body.length > 700 || item.body.split('\n').length > 14)) return body;
  const btn = h('button', { class: 'fold-btn', type: 'button' });
  const wrap = h('div', { class: 'fold' }, body, btn);
  const set = (open) => {
    wrap.classList.toggle('open', open);
    btn.textContent = open ? '閉じる' : '本文を開く';
    btn.setAttribute('aria-expanded', String(open));
    if (open) state.openBodies.add(item.id); else state.openBodies.delete(item.id);
  };
  btn.addEventListener('click', () => set(!wrap.classList.contains('open')));
  body.addEventListener('click', (e) => { // 薄くなっている本文を押しても開く（中のリンクはそのまま開く）
    if (wrap.classList.contains('open') || e.target.closest('a')) return;
    set(true);
  });
  set(state.openBodies.has(item.id));
  return wrap;
}

// 手元のファイルのリンクは、もう片方のホスト名（127.0.0.1 ⇄ localhost）の URL で開く。同じサーバーだがオリジンが別なので、
// アプリ（PWA）の窓の中ではなく、ブラウザの別タブで開く（PWA の範囲は入れたときのオリジンだけ）。どちらでもないホスト名なら同じオリジンのまま。
const ALT_ORIGIN = (() => {
  const other = { '127.0.0.1': 'localhost', localhost: '127.0.0.1' }[location.hostname];
  return other ? `${location.protocol}//${other}${location.port ? `:${location.port}` : ''}` : '';
})();
// 手元の .md は view.html で Markdown として表示する（元のテキストはそこから開ける）。.html はサーバーが sandbox 付きの HTML で返す。
function linkHref(l, repo) {
  const url = l.url || l.href;
  if (!url.startsWith('/api/')) return url;
  if (/\.(md|markdown)$/i.test(l.href)) return `${ALT_ORIGIN}/view.html?src=${encodeURIComponent(url)}&name=${encodeURIComponent(l.label)}${repo ? `&repo=${encodeURIComponent(repo)}` : ''}`;
  return `${ALT_ORIGIN}${url}`;
}
function linksBlock(item) {
  if (!item.links || !item.links.length) return null;
  return h('div', { class: 'links' }, item.links.map((l) => h('a', { href: linkHref(l, item.repo), target: '_blank', rel: 'noopener noreferrer', text: `${l.label} を開く` })));
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
    replyOf(item),
    item.todoLine ? h('span', { class: 'reply-to', text: `☑ TODO「${item.todoLine.title}」から（「やった」で TODO も済になる）` }) : null);
}

function draftOf(id) {
  if (!state.drafts.has(id)) state.drafts.set(id, { choice: null, text: '', rejecting: false });
  return state.drafts.get(id);
}

function askCard(item) {
  const d = draftOf(item.id);
  const opts = item.options || [];
  const send = h('button', { class: 'btn primary', type: 'submit', text: '返す', title: `Enter か ${MOD_ENTER} でも返せる` });
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
  h('div', { class: 'reply' }, text, send, h('span', { class: 'key-hint', text: 'Enter で送る・Shift+Enter で改行' })));
  sync();
  return h('article', { class: 'card' }, metaBlock(item), h('h3', { class: 'title' }, refLinks(item.title, item.repo)), bodyBlock(item), linksBlock(item), form);
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
    const send = h('button', { class: 'btn danger', type: 'button', text: '差し戻す', title: `Enter か ${MOD_ENTER} でも送れる`, disabled: !d.text.trim(), onclick: () => { send.disabled = true; act(item.id, 'answer', { choice: 'reject', text: d.text.trim() }); } });
    const ta = autoText({ value: d.text, placeholder: '差し戻す理由・直してほしい点（必須）', label: '差し戻しのコメント', oninput: (v) => { d.text = v; send.disabled = !d.text.trim(); }, onsubmit: () => send.click() });
    reply.replaceChildren(ta, send, h('button', { class: 'btn', type: 'button', text: 'やめる', onclick: () => { d.rejecting = false; draw(); } }),
      h('span', { class: 'key-hint', text: 'Enter で送る・Shift+Enter で改行' }));
  };
  draw();
  return h('article', { class: 'card' }, metaBlock(item), h('h3', { class: 'title' }, refLinks(item.title, item.repo)), bodyBlock(item), linksBlock(item), reply);
}

// やること: 「やった」（一言は任意）と「できない…」（コメント必須）。押すまで受け箱に残る。
function todoCard(item) {
  const d = draftOf(item.id);
  const reply = h('div', { class: 'reply' });
  const draw = () => {
    if (!d.rejecting) {
      const done = h('button', { class: 'btn primary', type: 'button', text: 'やった', title: `Enter か ${MOD_ENTER} でも送れる`, onclick: () => { done.disabled = true; act(item.id, 'answer', { choice: 'done', text: d.text.trim() || null }); } });
      const ta = autoText({ value: d.text, placeholder: '一言（任意・結果など）', label: '一言', oninput: (v) => { d.text = v; }, onsubmit: () => { if (d.text.trim()) done.click(); } }); // 空の Enter で「やった」にしない（押すのはボタン）
      reply.replaceChildren(ta, done,
        h('button', { class: 'btn danger', type: 'button', text: 'できない…', onclick: () => { d.rejecting = true; draw(); reply.querySelector('textarea').focus(); } }),
        h('span', { class: 'key-hint', text: 'Enter で送る・Shift+Enter で改行' }));
      return;
    }
    const send = h('button', { class: 'btn danger', type: 'button', text: 'できないと返す', title: `Enter か ${MOD_ENTER} でも送れる`, disabled: !d.text.trim(), onclick: () => { send.disabled = true; act(item.id, 'answer', { choice: 'cannot', text: d.text.trim() }); } });
    const ta = autoText({ value: d.text, placeholder: 'できない理由・どこで止まったか（必須）', label: 'できない理由', oninput: (v) => { d.text = v; send.disabled = !d.text.trim(); }, onsubmit: () => send.click() });
    reply.replaceChildren(ta, send, h('button', { class: 'btn', type: 'button', text: 'やめる', onclick: () => { d.rejecting = false; draw(); } }),
      h('span', { class: 'key-hint', text: 'Enter で送る・Shift+Enter で改行' }));
  };
  draw();
  return h('article', { class: 'card', id: `item-${item.id}` }, metaBlock(item), h('h3', { class: 'title' }, refLinks(item.title, item.repo)), bodyBlock(item), linksBlock(item), reply);
}

const CHOICE_JA = { review: { approve: '承認', reject: '差し戻し' }, todo: { done: 'やった', cannot: 'できない' } };
function answerSummary(item) {
  if (item.status === 'read') return '既読';
  if (item.status === 'withdrawn') return item.supersededBy ? '取り下げ（置き換え）' : '取り下げ';
  const a = item.answer || {};
  const label = CHOICE_JA[item.kind] ? CHOICE_JA[item.kind][a.choice] : (item.options || []).find((o) => o.key === a.choice)?.label;
  return [label || a.choice, a.text ? `「${a.text}」` : null].filter(Boolean).join(' ') || '返事済み';
}

// 1行の項目（読むだけ・済んだもの）。開くと本文。読むだけは開いたら既読にする。
// compact はスレッドの中の小さい行（CoS の名前と元の指示は見出しにあるので出さず、種類を出す）。
function row(item, compact = false) {
  const el = h('details', { class: compact ? 'row compact' : 'row' },
    h('summary', {},
      compact ? h('span', { class: 'who', text: `${KIND_JA[item.kind] || item.kind}${item.worker ? ` / ${item.worker}` : ''}` }) : whoBlock(item),
      h('span', { class: 't' }, refLinks(item.title, item.repo)),
      h('span', { class: 'state' }),
      h('span', { class: 'age' })),
    h('div', { class: 'inner' }, item.replyTo && !compact ? h('p', { class: 'meta' }, replyOf(item)) : null, bodyBlock(item, false) || h('p', { class: 'body', text: '（本文なし）' }), linksBlock(item), h('p', { class: 'answer', hidden: true })));
  el.addEventListener('toggle', () => {
    const cur = state.items.find((x) => x.id === item.id);
    if (el.open && cur && cur.kind === 'tell' && cur.status === 'open') {
      state.kept.add(item.id);
      act(item.id, 'read');
    }
  });
  return el;
}

// ───── スレッド（1つの指示から続く項目のまとまり） ─────
// 元の指示を見出しにし、前の「読むだけ」や済んだ項目は小さい行で上に、手が要る項目（要返事・確認依頼・やること）はカードで下に出す。
const CARD_OF = { ask: askCard, review: reviewCard, todo: todoCard };

// ───── 作業セッションの質問（CoS がまだ受け箱に出していないもの。wq.js の workerQuestions） ─────
// 要返事の列にカードで出す。答えは、その CoS 宛ての指示（POST /api/messages の worker 付き）として送り、CoS が cos send で作業セッションに渡す。
// 送った答えは、カードの中に指示と同じ印（送った（CoS は未読）→ CoS が読んだ）で並べる。
const msgState = (m) => (m.status === 'open' ? '送った（CoS は未読）' : m.status === 'read' ? `CoS が読んだ（${ago(m.readAt || m.createdAt)}）` : '取り下げ');
function wqCard(q) {
  const d = draftOf(q.id);
  const w = q.worker;
  const send = h('button', { class: 'btn primary', type: 'submit', text: 'CoS に送る', title: `Enter か ${MOD_ENTER} でも送れる` });
  const sync = () => { send.disabled = d.sending || !d.text.trim(); };
  const text = autoText({
    value: d.text,
    placeholder: q.answered ? '付け足す（CoS に指示として届きます）' : '答えを書く（CoS に指示として届き、CoS が作業セッションに渡します）',
    label: `作業セッション ${w.id} の質問への答え`,
    oninput: (v) => { d.text = v; sync(); },
    onsubmit: () => form.requestSubmit(),
  });
  const form = h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      if (send.disabled) return;
      d.sending = true; sync();
      try {
        await api('POST', '/api/messages', { to: q.chief.dir, text: d.text.trim(), worker: w.id });
        d.text = ''; text.value = ''; grow(text);
      } catch (err) {
        showError(err.message);
      } finally {
        d.sending = false; sync(); refresh();
      }
    },
  }, h('div', { class: 'reply' }, text, send, h('span', { class: 'key-hint', text: 'Enter で送る・Shift+Enter で改行' })));
  sync();
  const body = q.question ? bodyBlock({ id: q.id, body: q.question, repo: null }) : h('p', { class: 'body plain', text: '（報告書に質問の節が見つかりません。作業セッションのペインか報告書を見てください）' });
  return h('article', { class: 'card wq', id: `item-${q.id}` },
    h('div', { class: 'meta' },
      h('span', { class: 'wq-mark', text: '作業セッションの質問' }),
      h('span', { class: 'who' }, chiefTag(q.chief.name), ` / ${w.id}${w.label && w.label !== w.id ? `「${w.label}」` : ''}`),
      h('span', { class: 'age' })),
    h('p', { class: 'wq-note', text: 'CoS はまだ受け箱に出していません。答えは CoS への指示として届きます。' }),
    body,
    h('ul', { class: 'wq-answers' }),
    form);
}
function wqTouch(el, q) {
  el.querySelector('.age').textContent = q.since ? `${ago(q.since)}から止まっている` : '';
  el.classList.toggle('answered', q.answered);
  el.querySelector('.wq-answers').replaceChildren(...q.answers.map((m) => h('li', { class: m.status === 'open' ? 'pending' : '' },
    h('span', { class: 'wa-t', text: `答え: ${m.body.startsWith(`作業セッション ${q.worker.id} の質問への答え: `) ? m.body.slice(`作業セッション ${q.worker.id} の質問への答え: `.length) : m.body}` }),
    h('span', { class: 'state', text: msgState(m) }),
    h('span', { class: 'age', text: ago(m.createdAt) }))));
}
const wqSig = (q) => JSON.stringify([q.id, q.chief.name, q.worker.id, q.worker.label, q.question, q.answered]);
function threadCard(t) {
  const parts = []; // [要素, 項目の id]（touchThread が経過・既読の印を進める）
  const part = (el, x) => { parts.push([el, x.id]); return el; };
  const el = h('article', { class: 'thread', id: `thread-${t.id}` },
    h('details', { class: 'thread-head' },
      h('summary', { title: '押すと指示の全文' },
        h('span', { class: 'th-mark', text: '↩ 指示' }),
        chiefTag(t.root.chief.name),
        h('span', { class: 'tt', text: t.root.title }),
        h('span', { class: 'th-n', text: `続き ${t.items.length} 件` }),
        h('span', { class: 'th-age' })),
      h('p', { class: 'body plain', text: t.root.body })),
    t.prev.length ? h('div', { class: 'thread-prev' }, t.prev.map((x) => part(row(x, true), x))) : null,
    t.focus.map((x) => part(CARD_OF[x.kind](x), x)));
  el._parts = parts;
  return el;
}
function touchThread(el, t) {
  el.querySelector('.th-age').textContent = `${ago(t.root.createdAt)}の指示`;
  for (const [pe, id] of el._parts) {
    const x = t.items.find((y) => y.id === id);
    if (x) touch(pe, x);
  }
}
const threadSig = (t) => JSON.stringify([t.id, t.root.title, t.root.body, t.root.chief.name, t.focus.map(cardSig), t.prev.map((x) => [x.kind, rowSig(x)])]);
// 「送った指示」の行から、そのスレッドへ飛ぶ
function jumpToThread(id) {
  const el = document.getElementById(`thread-${id}`);
  if (!el) return;
  el.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  el.classList.add('flash');
  setTimeout(() => el.classList.remove('flash'), 1800);
}
// 列に出すもの（つながっていない項目と、その列に入るスレッド）を古い順に並べる
function entriesOf(items, threads) {
  return [...items.map((x) => ({ id: x.id, at: x.createdAt, item: x })), ...threads.map((t) => ({ id: `thread-${t.id}`, at: t.at, thread: t }))]
    .sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

// ───── CoS への指示と CoS の状況 ─────
const repliesOf = (id) => state.items.filter((x) => x.replyTo === id);
const KIND_JA = { ask: '要返事', review: '確認依頼', todo: 'やること', tell: '読むだけ' };
const activeThread = (id) => { const t = state.threads.get(id); return t && t.column ? t : null; };

// 送った指示の1行。開くと全文と、CoS の返事（--reply-to で出された項目）。
function msgRow(item) {
  const replies = repliesOf(item.id);
  return h('details', { class: 'row msg' },
    h('summary', {},
      h('span', { class: 'who' }, '→ ', chiefTag(item.chief.name)),
      h('span', { class: 't', text: item.title }),
      activeThread(item.id) ? h('button', { class: 'jump', type: 'button', text: `${KIND_JA[activeThread(item.id).column]}のスレッドへ ↓`, title: 'この指示から続く項目へ移る', onclick: (e) => { e.preventDefault(); jumpToThread(item.id); } }) : null,
      h('span', { class: 'state' }),
      h('span', { class: 'age' })),
    h('div', { class: 'inner' },
      h('p', { class: 'body plain', text: item.body }),
      replies.length ? h('ul', { class: 'replies' }, replies.map((r) => h('li', { text: `CoS の返事（${KIND_JA[r.kind] || r.kind}）: ${r.title}` }))) : null));
}
const msgSig = (x) => JSON.stringify([x.id, x.body, x.chief.name, repliesOf(x.id).map((r) => [r.id, r.title]), activeThread(x.id)?.column ?? null]);

const WORKER_STATUS = { working: '作業中', idle: 'ターン終了', done: 'ターン終了', blocked: '承認待ち', gone: 'いない' };
const workerStatusText = (w) => (w.state !== 'running' ? w.state : (WORKER_STATUS[w.status] || w.status || '?'));
const staleDays = (w) => (w.staleDone != null ? Math.floor(w.staleDone / 86400000) : null);
// 作業セッションの種別: stale＝取り込み待ち、wait＝質問・承認待ち、work＝作業中、他は空
function workerKind(w) {
  if (w.staleDone != null) return 'stale';
  if (w.report === '質問' || w.status === 'blocked') return 'wait';
  if (w.state === 'running' && w.status === 'working') return 'work';
  return '';
}
function workerTitle(w) {
  const days = staleDays(w);
  return [`${w.id}${w.label && w.label !== w.id ? `「${w.label}」` : ''}`,
    `${workerStatusText(w)}・報告「${w.report || 'なし'}」${w.reportUpdated ? `（${ago(w.reportUpdated)}）` : ''}${days != null ? `・取り込み待ち${days ? ` ${days}日` : ''}` : ''}`,
    w.title || null].filter(Boolean).join('\n');
}
// 詳細（縦の一覧）の1行
function workerLine(w) {
  const days = staleDays(w);
  return h('li', { class: workerKind(w) },
    h('b', { text: w.id }),
    w.label && w.label !== w.id ? `「${w.label}」` : null,
    h('span', { class: 'ws', text: ` ${workerStatusText(w)}・報告「${w.report || 'なし'}」${w.reportUpdated ? `（${ago(w.reportUpdated)}）` : ''}${days != null ? `・取り込み待ち${days ? ` ${days}日` : ''}` : ''}` }),
    w.title ? h('span', { class: 'wt', text: ` ${w.title}` }) : null);
}
// 小さいチップ（サイドバーの名前だけ。詳細は title）
function workerChip(w) {
  const days = staleDays(w);
  return h('span', { class: `wchip ${workerKind(w)}`, title: workerTitle(w) },
    w.label || w.id,
    days ? h('small', { text: `${days}日` }) : null);
}
function when(iso) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
const chiefOpen = () => { try { return new Set(JSON.parse(load('cos-inbox-ch-open') || '[]')); } catch { return new Set(); } };
function chiefCard(c) {
  const picked = state.filter === c.name;
  const ws = c.workers || [];
  const watch = c.watch && c.watch.alive
    ? h('span', { class: 'watch on', text: '見張り中' })
    : h('span', { class: 'watch off', text: `見張りなし${c.watch && c.watch.lastAt ? `（最後は${ago(c.watch.lastAt)}）` : ''}`, title: '指示は、この CoS が次に cos watch を張ったときに届きます' });
  const n = (k) => ws.filter((w) => workerKind(w) === k).length;
  const count = (k, label) => (n(k) ? h('span', { class: `cnt ${k}`, title: label, text: `${label} ${n(k)}` }) : null);
  const open = chiefOpen();
  const more = ws.length ? h('details', { class: 'ch-more', open: picked || open.has(c.name), ontoggle: (e) => {
    const cur = chiefOpen();
    if (e.target.open) cur.add(c.name); else cur.delete(c.name);
    save('cos-inbox-ch-open', JSON.stringify([...cur]));
  } },
    h('summary', { text: '詳細' }),
    h('ul', { class: 'workers' }, ws.map(workerLine))) : null;
  return h('article', { class: `chief-card${picked ? ' picked' : ''}` },
    h('div', { class: 'ch-head' },
      h('button', { class: 'ch-name', type: 'button', title: picked ? '絞り込みを外す' : 'この CoS に絞り込んで指示を書く', onclick: () => setFilter(picked ? '' : c.name) }, chiefTag(c.name)),
      watch,
      h('span', { class: 'ch-n', text: ws.length ? `作業 ${ws.length} 本` : '作業なし' }),
      count('stale', '取り込み待ち'), count('work', '作業中'), count('wait', '質問'),
      c.unread ? h('span', { class: 'unread-n', text: `未読の指示 ${c.unread}` }) : null,
      c.retro ? h('span', { class: `retro${c.retro.due ? ' due' : ''}`, text: c.retro.due ? `振り返り 期限超過（${when(c.retro.dueAt)}）` : `振り返り ${when(c.retro.dueAt)}` }) : null),
    c.error ? h('p', { class: 'ch-error', text: `状況を読めません: ${c.error}` }) : null,
    ws.length ? h('div', { class: 'wchips' }, ws.map(workerChip)) : null,
    more);
}

function setKind(k) {
  state.kind = k;
  save('cos-inbox-kind', k);
  render();
}

function setFilter(name) {
  state.filter = name;
  save('cos-inbox-filter', name);
  render();
}

// ───── 絞り込みの並びと、数字キーでの切り替え ─────
// 並びは「全部」が先頭、その後ろに CoS。CoS は初めて画面に出た順（同時に出たものは名前順）で、順番を localStorage に覚える。
// 名前順のままだと、CoS が1つ増えるたびに後ろの番号がずれるため。新しい CoS は末尾に付き、いなくなった CoS の席は詰める。
function chiefOrder(names) {
  let known = [];
  try { const v = JSON.parse(load('cos-inbox-order') || '[]'); if (Array.isArray(v)) known = v.filter((x) => typeof x === 'string'); } catch { /* 壊れていたら作り直す */ }
  const fresh = [...names].filter((n) => !known.includes(n)).sort();
  if (fresh.length) { known = [...known, ...fresh]; save('cos-inbox-order', JSON.stringify(known)); }
  return known.filter((n) => names.has(n));
}
// ⌘1〜9（Mac 以外は Ctrl+1〜9）で、絞り込みの 1〜9 番目を選ぶ（1＝全部）。
// 普通のタブではブラウザが ⌘数字をタブの切り替えに使って画面に届かないので、入力欄にフォーカスが無いときは数字だけでも切り替える。
// アプリ（PWA）の窓では ⌘数字が届く。ボタンのヒントは、その窓で効くほうを出す。
const IS_APP = ['standalone', 'minimal-ui', 'window-controls-overlay'].some((m) => { try { return matchMedia(`(display-mode: ${m})`).matches; } catch { return false; } }) || navigator.standalone === true;
const keyHint = (i) => (i > 8 ? null : IS_APP ? `${IS_MAC ? '⌘' : 'Ctrl+'}${i + 1}` : String(i + 1));
const typing = (el) => Boolean(el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)));
document.addEventListener('keydown', (e) => {
  if (e.isComposing || e.keyCode === 229 || e.repeat || e.altKey || e.shiftKey) return;
  if (!/^[1-9]$/.test(e.key)) return;
  const mod = IS_MAC ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  if (!mod && (e.metaKey || e.ctrlKey || typing(document.activeElement))) return; // 文字を打っている最中の数字は奪わない
  const chip = $('chips').hidden ? null : $('chips').children[Number(e.key) - 1];
  if (!chip) return; // 当てはまる絞り込みが無ければブラウザに任せる
  e.preventDefault();
  if (chip.getAttribute('aria-pressed') !== 'true') chip.click();
});

// ⌥1〜5 で種類の絞り込み（5 は TODO）（押している種類をもう一度で解除）。⌘数字（CoS の切り替え）とはぶつけない。Mac では ⌥数字が別の文字になるので e.code で見る。
document.addEventListener('keydown', (e) => {
  if (e.isComposing || e.keyCode === 229 || e.repeat || !e.altKey || e.metaKey || e.ctrlKey || e.shiftKey) return;
  const m = /^Digit([1-5])$/.exec(e.code);
  if (!m) return;
  const k = FILTER_KINDS[Number(m[1]) - 1];
  if (k === 'tfile' && !state.todos.length) return; // TODO ファイルを持つ CoS がいなければ何もしない
  e.preventDefault();
  setKind(state.kind === k ? '' : k);
});

// 指示の入力欄（1つだけ作って使い回す＝描き直しても書きかけを失わない）
const compose = (() => {
  const c = state.compose;
  const to = h('select', { id: 'compose-to', 'aria-label': '宛先の CoS', onchange: () => { c.to = to.value; sync(); } });
  const send = h('button', { class: 'btn primary', type: 'submit', text: '送る', title: `Enter か ${MOD_ENTER} でも送れる` });
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

// ───── TODO（CoS の TODO ファイルの行。受け箱の項目とは別で、足しても済にしても CoS は起きない） ─────
// 行は { key, chief, dir, file, label, t }（t は GET /api/todos の行）。並びはサーバーの state と期日で決める。
// 締切を過ぎた → 今日 → 着手できる → 先のもの → 起きた日だけ → いつでも → 読めない行 → 済（todofile.mjs の STATE_RANK と同じ）。知らない state は先のものと同じに
const TF_RANK = { overdue: 0, today: 1, startable: 2, future: 3, noted: 4, anytime: 5, unreadable: 6, done: 7 };
const tfRank = (t) => TF_RANK[t.state] ?? TF_RANK.future;
function todoRows(boards) {
  const rows = boards.flatMap((b) => b.files.flatMap((f) => f.todos.map((t) => ({ id: `${b.dir}\n${f.path}\n${t.id}`, chief: b.name, dir: b.dir, file: f.path, label: f.label, t }))));
  return rows.sort((a, b) => tfRank(a.t) - tfRank(b.t)
    || (a.t.done ? String(b.t.doneOn || '').localeCompare(String(a.t.doneOn || '')) : String(a.t.due || '').localeCompare(String(b.t.due || '')))
    || a.chief.localeCompare(b.chief) || a.t.n - b.t.n);
}
// 期日の添え書き。日付の読み取りと種類（dueKind）はサーバーがする（due は YYYY-MM-DD）。
//   締切: 「3日過ぎ」「今日」「明日」「あと5日」
//   着手日（after）: 来る前は「明日」「あと5日」、当日は「今日から」、過ぎたら「着手できる」（赤くしない）
//   起きた日（since）: 「3日前」
function dueNote(t) {
  if (!t.due || !state.today) return '';
  const d = Math.round((Date.parse(`${t.due}T00:00:00Z`) - Date.parse(`${state.today}T00:00:00Z`)) / 86400000);
  if (t.dueKind === 'since') return d < 0 ? `${-d}日前` : '';
  if (t.dueKind === 'after' && d <= 0) return d === 0 ? '今日から' : '着手できる';
  return d < 0 ? `${-d}日過ぎ` : d === 0 ? '今日' : d === 1 ? '明日' : d <= 14 ? `あと${d}日` : '';
}
const DUE_KIND_JA = { after: '着手日（この日から）', deadline: '締切', since: '起きた日' };
async function todoAct(r, done, box) {
  if (state.busy.has(r.id)) return;
  state.busy.add(r.id);
  box.disabled = true;
  try {
    const j = await api('POST', '/api/todos/done', { to: r.dir, file: r.file, id: r.t.id, done });
    if (j.commit && j.commit.reason) showError(`TODO は書き換えましたが、コミットできませんでした: ${j.commit.reason}`);
  } catch (e) {
    showError(e.message);
    box.checked = !done;
    box.disabled = false;
  } finally {
    state.busy.delete(r.id);
    refresh();
  }
}
function jumpToItem(id) {
  const el = document.getElementById(`item-${id}`);
  if (!el) return;
  el.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  el.classList.add('flash');
  setTimeout(() => el.classList.remove('flash'), 1800);
}
function todoRow(r) {
  const t = r.t;
  const box = h('input', { type: 'checkbox', checked: t.done, 'aria-label': t.done ? `未完了に戻す: ${t.title}` : `済にする: ${t.title}`, title: t.done ? '未完了に戻す' : '済にする', onchange: () => todoAct(r, box.checked, box) });
  const note = dueNote(t);
  const due = t.state === 'unreadable' ? h('span', { class: 'tf-due', text: '期日が読めない', title: '頭の太字が期日でも「いつでも」でもない行です。TODO ファイルを手で直すと期日で並びます（この行の文字は変えません）' })
    : h('span', { class: 'tf-due', title: t.dueKind ? DUE_KIND_JA[t.dueKind] : '' }, h('span', { class: 'tf-due-text', text: t.dueText || 'いつでも' }), !t.done && note && note !== t.dueText ? h('b', { text: note }) : null);
  const linked = (t.items || []).filter((id) => document.getElementById(`item-${id}`) || state.items.some((x) => x.id === id && x.status === 'open'));
  return h('div', { class: 'tf-row', 'data-state': t.state },
    h('label', { class: 'tf-box' }, box),
    due,
    h('span', { class: 'tf-main' },
      // 題が期日の文字と同じ（太字が期日だけで、題にする語が無い行）なら、期日の欄に出ているので出さない
      t.title && t.title !== t.dueText ? h('span', { class: 'tf-title' }, inline(t.title, null)) : null,
      t.note ? h('span', { class: 'tf-note' }, inline(t.note, null)) : null,
      t.done && t.doneOn ? h('span', { class: 'tf-note', text: `済 ${t.doneOn}${t.doneNote ? `: ${t.doneNote}` : ''}` }) : null,
      linked.length ? h('button', { class: 'jump', type: 'button', text: 'やることに出ている ↓', title: 'この行から CoS が出した「やること」へ移る', onclick: () => jumpToItem(linked[0]) }) : null),
    state.todos.length > 1 && !state.filter ? chiefTag(r.chief) : null);
}
const todoSig = (r) => JSON.stringify([r.id, r.t, state.todos.length > 1 && !state.filter, state.today]);

// TODO は画面からは足さない（ユーザーの決定: CoS に「TODO: 〜」と指示で頼み、CoS が cos todo-file で整えて足す）。
// 画面でできるのは済にする・戻すだけ。ここには足し方の案内だけを出す。
const todoAdd = (() => {
  const form = h('p', { class: 'tf-add-hint' });
  function update() {
    const b = state.filter ? state.todos.find((x) => x.name === state.filter) : state.todos.length === 1 ? state.todos[0] : null;
    form.hidden = !(b && b.files.length);
    if (form.hidden) return;
    form.textContent = `TODO を足すときは、${b.name} への指示に「TODO: 〜」と書いてください（CoS が期日と言い回しを整えて足します）。ここでは済にする・戻すだけができます。`;
  }
  return { form, update };
})();

// 描き直さずに変えられるところ（経過・赤・既読の印）
function touch(el, item) {
  if (item.kind === 'message') {
    el.querySelector('.age').textContent = ago(item.createdAt);
    el.classList.toggle('pending', item.status === 'open');
    el.querySelector('.state').textContent = msgState(item);
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
function reconcile(container, items, make, sigOf, touchOf = touch) {
  const want = [];
  for (const item of items) {
    const key = `${container.id}:${item.id}`;
    const sig = sigOf(item);
    let b = built.get(key);
    if (!b || b.sig !== sig) {
      b = { el: make(item), sig };
      built.set(key, b);
    }
    touchOf(b.el, item);
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

const cardSig = (x) => JSON.stringify([x.id, x.title, x.body, x.options, x.recommend, x.freeText, x.links, x.worker, x.chief.name, x.replyTo, x.repo, x.todoLine]);
const rowSig = (x) => JSON.stringify([x.id, x.title, x.body, x.links, x.worker, x.chief.name, x.replyTo, x.repo]);

function render() {
  const all = state.items;
  const open = all.filter((x) => x.status === 'open');
  // 絞り込みに出す CoS: 記録されている CoS（指示の宛先になる）と、未対応の項目を持つ CoS
  const chiefs = chiefOrder(new Set([...state.chiefs.map((c) => c.name), ...all.filter((x) => x.status === 'open' || state.kept.has(x.id)).map((x) => x.chief.name)]));
  if (state.filter && !chiefs.includes(state.filter)) state.filter = '';
  const seen = (x) => !state.filter || x.chief.name === state.filter;
  paintChiefs(new Set([...all.map((x) => x.chief.name), ...chiefs]));

  // 見出しの件数（CoS で絞っているときは、その CoS の件数。アプリのバッジとタブの題は全 CoS の返事待ちのまま）
  const c = state.counts;
  // 作業セッションの質問（CoS が受け箱に出していないもの）。答えを送っていないものは要返事に数える（送ったら CoS の番）
  const wqAll = workerQuestions(state.chiefs, all);
  const wqWait = wqAll.filter((q) => !q.answered);
  const wqN = (name) => wqWait.filter((q) => !name || q.chief.name === name).length;
  // todo は、知らない版のサーバー（counts に無い）でも画面が数える
  const nTodo = c.todo ?? open.filter((x) => x.kind === 'todo').length;
  // 件数は押せる＝その種類だけを並べる（もう一度押すと外れる）
  // TODO（TODO ファイルの未完了の行。受け箱の項目ではないので、返事待ちには数えない）
  if (state.kind === 'tfile' && state.todosLoaded && !state.todos.length) state.kind = '';
  const tfAll = todoRows(state.todos);
  const tfOpenN = (name) => tfAll.filter((r) => !r.t.done && (!name || r.chief === name)).length;
  const tfDueN = tfAll.filter((r) => (r.t.state === 'overdue' || r.t.state === 'today') && (!state.filter || r.chief === state.filter)).length;
  const allN = { ask: c.ask + wqN(''), review: c.review, todo: nTodo, tell: c.tell, tfile: tfOpenN('') };
  const kindLabel = { ask: '要返事', review: '確認', todo: 'やること', tell: '読むだけ', tfile: 'TODO' };
  const hereN = (k) => (k === 'tfile' ? tfOpenN(state.filter) : open.filter((x) => x.kind === k && x.chief.name === state.filter).length + (k === 'ask' ? wqN(state.filter) : 0));
  const kindN = Object.fromEntries(Object.entries(allN).map(([k, n]) => [k, state.filter ? hereN(k) : n]));
  $('counts').replaceChildren(...FILTER_KINDS.filter((k) => k !== 'tfile' || state.todos.length).flatMap((k, i) => [
    i ? ' ・ ' : null,
    h('button', {
      class: 'kind', type: 'button', 'aria-pressed': String(state.kind === k), 'data-kind': k,
      title: state.kind === k ? '種類の絞り込みを外す' : state.filter ? `${state.filter} の${kindLabel[k]}だけを並べる（全 CoS では ${allN[k]}）` : `${kindLabel[k]}だけを、すべての CoS ぶん並べる`,
      'aria-keyshortcuts': `Alt+${i + 1}`,
      onclick: () => setKind(state.kind === k ? '' : k),
    }, `${kindLabel[k]} `, h('b', { text: String(kindN[k]) }),
    k === 'tfile' && tfDueN ? h('span', { class: 'due-n', title: '期日が今日か、過ぎている TODO', text: `期日 ${tfDueN}` }) : null,
    h('kbd', { class: 'key', 'aria-hidden': 'true', text: `${IS_MAC ? '⌥' : 'Alt+'}${i + 1}` })),
  ]).filter(Boolean));
  const waiting = c.ask + wqN('') + c.review + nTodo; // 返事待ち＝ユーザーが返すまで残るもの
  document.title = `${waiting ? `(${waiting}) ` : ''}CoS 受け箱`;
  { const fav = $('favicon'); const want = waiting ? 'favicon-alert.svg' : 'favicon.svg'; if (fav && !fav.getAttribute('href').endsWith(want)) fav.setAttribute('href', want); } // 返事待ちがあればタブのアイコンに赤丸
  // アプリ（PWA）のアイコンに、返事待ち（要返事＋確認依頼＋やること）の件数を出す。使えないブラウザでは何もしない。
  try {
    if (waiting && navigator.setAppBadge) navigator.setAppBadge(waiting).catch(() => {});
    else if (!waiting && navigator.clearAppBadge) navigator.clearAppBadge().catch(() => {});
  } catch { /* バッジが出せなくても動く */ }

  // CoS ごとの絞り込み
  const chip = (name, label, n, i) => h('button', {
    class: 'chip', type: 'button', 'aria-pressed': String(state.filter === name),
    'aria-keyshortcuts': i > 8 ? null : `${IS_MAC ? 'Meta' : 'Control'}+${i + 1} ${i + 1}`,
    onclick: () => setFilter(name),
  }, name ? h('span', { class: 'swatch', 'data-chief': name }) : null, label, h('span', { class: 'n', text: String(n) }),
  keyHint(i) ? h('kbd', { class: 'key', 'aria-hidden': 'true', text: keyHint(i) }) : null);
  const mine = open.filter((x) => x.kind !== 'message'); // 件数はユーザーの番のものだけ
  $('chips').replaceChildren(chip('', '全部', mine.length + wqN(''), 0), ...chiefs.map((n, i) => chip(n, n, mine.filter((x) => x.chief.name === n).length + wqN(n), i + 1)));
  $('chips').hidden = chiefs.length < (state.chiefs.length ? 1 : 2);

  // スレッド: 指示（message）に replyTo でつながる項目をまとめる。列に出ているスレッドの項目は、列にそのままは出さない。
  const T = buildThreads(all, { kept: state.kept });
  state.threads = T.byRoot;
  const loose = (x) => !T.inThread.has(x.id);
  const threadsIn = (col) => T.threads.filter((t) => t.column === col && seen(t.root));

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

  const kindOk = (k) => !state.kind || state.kind === k; // 種類で絞っているときは、その種類の列だけ
  const wqs = wqAll.filter((q) => seen(q)).map((q) => ({ id: q.id, at: q.since || '', wq: q }));
  const asks = kindOk('ask') ? [...wqs, ...entriesOf(open.filter((x) => x.kind === 'ask' && seen(x) && loose(x)), threadsIn('ask'))].sort((a, b) => String(a.at).localeCompare(String(b.at))) : [];
  const reviews = kindOk('review') ? entriesOf(open.filter((x) => x.kind === 'review' && seen(x) && loose(x)), threadsIn('review')) : [];
  const todos = kindOk('todo') ? entriesOf(open.filter((x) => x.kind === 'todo' && seen(x) && loose(x)), threadsIn('todo')) : [];
  const looseTells = all.filter((x) => x.kind === 'tell' && (x.status === 'open' || (state.kept.has(x.id) && x.status === 'read')) && seen(x) && loose(x));
  const tells = kindOk('tell') ? entriesOf(looseTells, threadsIn('tell')) : [];
  const done = state.kind ? [] : all.filter((x) => x.status !== 'open' && x.kind !== 'message' && !looseTells.includes(x) && seen(x) && loose(x)).slice(0, 30);
  document.querySelector('main').classList.toggle('by-kind', Boolean(state.kind));

  // 列の1件は、つながっていない項目（カードか1行）か、スレッド
  const col = (list, entries, make) => reconcile(list, entries,
    (e) => (e.wq ? wqCard(e.wq) : e.thread ? threadCard(e.thread) : make(e.item)),
    (e) => (e.wq ? wqSig(e.wq) : e.thread ? threadSig(e.thread) : (make === row ? rowSig : cardSig)(e.item)),
    (el, e) => (e.wq ? wqTouch(el, e.wq) : e.thread ? touchThread(el, e.thread) : touch(el, e.item)));
  col($('list-ask'), asks, askCard);
  col($('list-review'), reviews, reviewCard);
  col($('list-todo'), todos, todoCard);
  col($('list-tell'), tells, row);
  reconcile($('list-done'), done, row, rowSig);
  // 列は種類で絞っているときだけ隠す。空の列は is-empty（広い画面では最低限の幅で「なし」と出して場所を残す・狭い画面では隠す。style.css の段組み）
  const colState = (id, kind, n) => {
    $(id).hidden = Boolean(state.kind) && state.kind !== kind;
    $(id).classList.toggle('is-empty', !n);
  };
  colState('sec-ask', 'ask', asks.length);
  colState('sec-review', 'review', reviews.length);
  colState('sec-todo', 'todo', todos.length);
  colState('sec-tell', 'tell', tells.length);
  $('sec-done').hidden = !done.length;
  $('done-count').textContent = done.length ? `（直近 ${done.length} 件）` : '';

  // TODO の欄: 絞り込んだ CoS の TODO ファイルの行。未完了を期日の近い順に、済んだものは畳んで下に。
  const boards = kindOk('tfile') ? state.todos.filter((b) => !state.filter || b.name === state.filter) : [];
  const tfRows = todoRows(boards);
  const tfOpen = tfRows.filter((r) => !r.t.done);
  const tfDone = tfRows.filter((r) => r.t.done);
  const noTouch = () => {};
  reconcile($('list-tfile'), tfOpen, todoRow, todoSig, noTouch);
  reconcile($('list-tfile-done'), tfDone, todoRow, todoSig, noTouch);
  if (!$('tfile-add-slot').firstChild) $('tfile-add-slot').append(todoAdd.form);
  todoAdd.update();
  // TODO の列は、TODO ファイルを持つ CoS がいる限り残す（絞り込んだ CoS に無ければ「未完了の TODO はありません」）
  colState('sec-tfile', 'tfile', tfOpen.length);
  if (!state.todos.length) $('sec-tfile').hidden = true;
  $('list-tfile').hidden = !tfOpen.length;
  $('tfile-empty').hidden = Boolean(tfOpen.length);
  $('tfile-done').hidden = !tfDone.length;
  $('tfile-done-count').textContent = `（${tfDone.length} 件）`;
  $('tfile-sub').textContent = boards.flatMap((b) => b.files.map((f) => `${boards.length > 1 ? `${b.name} の ` : ''}${f.label}`)).join('・');
  const tfErr = boards.flatMap((b) => b.files.filter((f) => f.error).map((f) => `${b.name} の ${f.label} が読めません（${f.error}）`));
  $('tfile-error').textContent = tfErr.join('・');
  $('tfile-error').hidden = !tfErr.length;

  $('empty').hidden = Boolean(asks.length || reviews.length || todos.length || tells.length || boards.length);
  $('empty').textContent = state.kind ? `${kindLabel[state.kind]}で待っているものはありません。` : 'いま待っているものはありません。';

  // 消えた項目の書きかけは捨てる
  for (const id of [...state.drafts.keys()]) if (!open.some((x) => x.id === id) && !wqAll.some((q) => q.id === id)) state.drafts.delete(id);
  for (const id of [...state.openBodies]) if (!all.some((x) => x.id === id) && !wqAll.some((q) => q.id === id)) state.openBodies.delete(id);
}

connect();
refresh();
setInterval(() => { if (state.items.length) render(); }, 60000); // 「3時間前」と赤の印を進める
setInterval(refresh, 15000); // CoS の状況（見張り・作業セッション）は受け箱の変更では知らされないので、時々取り直す
window.addEventListener('resize', () => document.querySelectorAll('textarea.auto').forEach(grow));
