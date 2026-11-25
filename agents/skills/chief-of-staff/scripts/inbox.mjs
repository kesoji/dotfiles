// CoS の受け箱 — 全 CoS からユーザーへの「要返事（ask）」「確認依頼（review）」「読むだけ（tell）」を1か所に置く。
//
// 項目は1件1ファイル（<受け箱>/<id>.json）。置き場所は ~/.cos/inbox（環境変数 COS_INBOX_DIR で差し替える＝試験用）。
// 項目の形の説明は ../inbox-schema.md（形を変えるときはそこと upgradeItem を直す）。
//
// このファイルの関数を、CLI（cos.mjs の cos ask / review / tell / inbox / answer / withdraw）と
// 画面の API（cos inbox serve の /api/…）の両方が呼ぶ。画面（../inbox-ui/）は API だけに依存する。
// 依存は node の標準だけ。
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, watch, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir, tmpdir } from 'node:os';
import { basename, extname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const INBOX_V = 1;
export const INBOX_DEFAULT_PORT = 7788;
// 答えていない要返事を赤く出すまでの日数（画面と cos inbox の一覧）。
export const STALE_ASK_DAYS = 3;
export const KIND_LABEL = { ask: '要返事', review: '確認依頼', tell: '読むだけ' };
const KIND_ORDER = { ask: 0, review: 1, tell: 2 };
const STATUS_LABEL = { open: '未対応', answered: '返事済み', read: '既読', withdrawn: '取り下げ' };
const REVIEW_CHOICES = { approve: 'approve', ok: 'approve', 承認: 'approve', reject: 'reject', ng: 'reject', 差し戻し: 'reject', 差戻し: 'reject' };
export const REVIEW_LABEL = { approve: '承認', reject: '差し戻し' };
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$/;
const KEY_RE = /^[A-Za-z0-9_-]{1,32}$/;
const LINK_SCHEMES = new Set(['http:', 'https:', 'file:']);
const MAX_BODY = 1 << 20; // API に送れる本文（1MB）
const MAX_LINK_FILE = 5 << 20; // リンクのファイルを画面に出す上限（5MB）

// status は API が返す HTTP の状態（400 入力が違う・404 無い・409 もう済んでいる）。CLI は文だけ使う。
export class InboxError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function inboxDir(env = process.env) {
  return env.COS_INBOX_DIR ? resolve(env.COS_INBOX_DIR) : join(homedir(), '.cos', 'inbox');
}

// ───────── 純関数（self-test の対象） ─────────

// `key:ラベル[:説明]` → { key, label, detail }
export function parseOption(s) {
  const i = String(s).indexOf(':');
  if (i <= 0) throw new InboxError(400, `--option は key:ラベル[:説明] の形です: ${s}`);
  const key = s.slice(0, i);
  if (!KEY_RE.test(key)) throw new InboxError(400, `--option の key は英数字・-・_ です: ${key}`);
  const rest = s.slice(i + 1);
  const j = rest.indexOf(':');
  const label = (j < 0 ? rest : rest.slice(0, j)).trim();
  if (!label) throw new InboxError(400, `--option にラベルがありません: ${s}`);
  const detail = j < 0 ? '' : rest.slice(j + 1).trim();
  return detail ? { key, label, detail } : { key, label };
}

// `名前=URL` か `名前=パス` → { label, href }。パスは cwd から絶対にして file:// にする。名前が無ければ末尾の名前。
export function parseLink(s, cwd) {
  const str = String(s);
  const i = str.indexOf('=');
  const hasLabel = i > 0 && !/^[a-z][a-z0-9+.-]*:\/\//i.test(str.slice(0, i + 1) + 'x') && !str.slice(0, i).includes('/');
  const target = hasLabel ? str.slice(i + 1).trim() : str.trim();
  if (!target) throw new InboxError(400, `--link は 名前=URL（かパス）の形です: ${s}`);
  let href;
  if (/^[a-z][a-z0-9+.-]*:/i.test(target) && !isAbsolute(target)) {
    let u;
    try {
      u = new URL(target);
    } catch {
      throw new InboxError(400, `--link の URL が読めません: ${target}`);
    }
    if (!LINK_SCHEMES.has(u.protocol)) throw new InboxError(400, `--link は http・https・file かパスだけです: ${target}`);
    href = u.href;
  } else {
    href = pathToFileURL(resolve(cwd, target.replace(/^~(?=\/|$)/, homedir()))).href;
  }
  const label = hasLabel ? str.slice(0, i).trim() : href.startsWith('file:') ? basename(fileURLToPath(href)) : href;
  return { label, href };
}

// CoS の名前 → id に入れる短い名前（英小文字と数字。先頭の cos- は落とす。日本語だけなら cos）。
export function chiefSlug(name) {
  const s = String(name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return (s.replace(/^cos-(?=.)/, '').slice(0, 12).replace(/-+$/, '')) || 'cos';
}

// 20261125-1612-main-a3f（ローカルの日時・CoS の短い名前・乱数3桁）
export function makeId(nowMs, chiefName, rand = Math.random) {
  const d = new Date(nowMs);
  const p = (n) => String(n).padStart(2, '0');
  const hex = Math.floor(rand() * 0x1000).toString(16).padStart(3, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}-${chiefSlug(chiefName)}-${hex}`;
}

// 入力を確かめて項目にする（書き込まない）。
export function buildItem(input, { nowMs = Date.now(), rand = Math.random } = {}) {
  const kind = input.kind;
  if (!(kind in KIND_ORDER)) throw new InboxError(400, `kind は ask・review・tell のどれかです: ${kind}`);
  const title = String(input.title ?? '').trim();
  if (!title) throw new InboxError(400, '題（--title）がありません');
  const chief = input.chief ?? {};
  if (!chief.dir || !chief.name) throw new InboxError(400, 'どの CoS の項目か（chief.name・chief.dir）がありません');
  let options = null;
  let recommend = null;
  let freeText = null;
  if (kind === 'ask') {
    options = (input.options ?? []).map((o) => {
      if (!o || !KEY_RE.test(String(o.key ?? '')) || !String(o.label ?? '').trim()) throw new InboxError(400, `選択肢の形が違います: ${JSON.stringify(o)}`);
      return o.detail ? { key: o.key, label: String(o.label).trim(), detail: String(o.detail) } : { key: o.key, label: String(o.label).trim() };
    });
    const keys = options.map((o) => o.key);
    if (new Set(keys).size !== keys.length) throw new InboxError(400, `選択肢の key が重なっています: ${keys.join(', ')}`);
    freeText = input.freeText !== false;
    if (options.length === 0 && !freeText) throw new InboxError(400, '選択肢が無いなら自由記述を止められません');
    recommend = input.recommend ?? null;
    if (recommend !== null && !keys.includes(recommend)) throw new InboxError(400, `--recommend ${recommend} は選択肢にありません（${keys.join(', ') || 'なし'}）`);
  } else if (input.options?.length || input.recommend) {
    throw new InboxError(400, `選択肢を持てるのは ask だけです（${kind}）`);
  }
  const links = (input.links ?? []).map((l) => {
    if (!l?.href || !l?.label) throw new InboxError(400, `リンクの形が違います: ${JSON.stringify(l)}`);
    return { label: String(l.label), href: String(l.href) };
  });
  const item = {
    v: INBOX_V,
    id: input.id ?? makeId(nowMs, chief.name, rand),
    kind,
    chief: { name: String(chief.name), dir: String(chief.dir), session: chief.session ?? null },
    worker: input.worker ?? null,
    title,
    body: String(input.body ?? ''),
    options,
    recommend,
    freeText,
    links,
    createdAt: new Date(nowMs).toISOString(),
    status: 'open',
    answer: null,
    supersedes: input.supersedes ?? null,
  };
  if (input.tag) item.tag = String(input.tag);
  return item;
}

// 返事を付ける（ask・review）。choice は ask なら選択肢の key（自由記述だけなら null）、review なら approve / reject。
export function applyAnswer(item, { choice = null, text = null, via = 'cli' } = {}, nowIso = new Date().toISOString()) {
  if (item.kind === 'tell') throw new InboxError(400, `${item.id} は読むだけの項目です（返事はできません。既読にします）`);
  if (item.status !== 'open') throw new InboxError(409, `${item.id} はもう「${STATUS_LABEL[item.status] ?? item.status}」です`);
  const t = String(text ?? '').trim() || null;
  let c = choice === '' || choice === '-' || choice === undefined ? null : choice;
  if (item.kind === 'review') {
    c = REVIEW_CHOICES[String(c ?? '').toLowerCase()] ?? null;
    if (!c) throw new InboxError(400, '確認依頼への返事は approve（承認）か reject（差し戻し）です');
    if (c === 'reject' && !t) throw new InboxError(400, '差し戻しにはコメントが要ります');
  } else if (c === null) {
    if (!item.freeText) throw new InboxError(400, `${item.id} は選択肢から選びます（${item.options.map((o) => o.key).join(', ')}）`);
    if (!t) throw new InboxError(400, '選択肢を選ぶか、文章で返してください');
  } else if (!item.options.some((o) => o.key === c)) {
    throw new InboxError(400, `選択肢に ${c} はありません（${item.options.map((o) => o.key).join(', ') || 'なし＝文章で返す'}）`);
  }
  return { ...item, status: 'answered', answer: { choice: c, text: t, at: nowIso, via } };
}

// 既読にする（tell）。もう既読なら何も変えない。
export function applyRead(item, nowIso = new Date().toISOString()) {
  if (item.kind !== 'tell') throw new InboxError(400, `${item.id} は${KIND_LABEL[item.kind]}の項目です（既読にできるのは読むだけの項目）`);
  if (item.status === 'read') return item;
  if (item.status !== 'open') throw new InboxError(409, `${item.id} はもう「${STATUS_LABEL[item.status] ?? item.status}」です`);
  return { ...item, status: 'read', readAt: nowIso };
}

// 取り下げる（CoS が出した項目を引っ込める・supersedes で置き換えられた）。
export function applyWithdraw(item, nowIso = new Date().toISOString(), { supersededBy = null } = {}) {
  if (item.status !== 'open') throw new InboxError(409, `${item.id} はもう「${STATUS_LABEL[item.status] ?? item.status}」です`);
  const out = { ...item, status: 'withdrawn', withdrawnAt: nowIso };
  if (supersededBy) out.supersededBy = supersededBy;
  return out;
}

export function sameDir(a, b) {
  if (!a || !b) return false;
  const real = (p) => {
    try {
      return realpathSync(p);
    } catch {
      return resolve(p);
    }
  };
  return real(a) === real(b);
}

// この CoS（chiefDir）の項目のうち、答えが付いていて、まだ見張りが CoS に渡していないもの。
// 他の CoS の項目は入れない（他の CoS の答えで起こさない）。
export function answeredFor(items, chiefDir) {
  return items
    .filter((x) => x.status === 'answered' && !x.deliveredAt && sameDir(x.chief?.dir, chiefDir))
    .sort((a, b) => String(a.answer?.at).localeCompare(String(b.answer?.at)));
}

// 見張りの出来事（cos watch が出す1行）。
export function answeredEvent(item) {
  const c = item.answer?.choice ?? null;
  const label = item.kind === 'review' ? REVIEW_LABEL[c] ?? c : item.options?.find((o) => o.key === c)?.label ?? null;
  return { event: 'answered', id: item.id, kind: item.kind, worker: item.worker ?? undefined, title: item.title, choice: c, label: label ?? undefined, text: item.answer?.text ?? undefined, at: item.answer?.at };
}

// 並び: 要返事 → 確認依頼 → 読むだけ。各群の中は古い順（待たせている順）。
export function sortInbox(items) {
  return [...items].sort((a, b) => (KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9) || String(a.createdAt).localeCompare(String(b.createdAt)));
}

export function openCounts(items) {
  const c = { ask: 0, review: 0, tell: 0 };
  for (const x of items) if (x.status === 'open' && x.kind in c) c[x.kind]++;
  return c;
}

// 返事待ち（open な ask と review）が上限を超えているか（cos spawn の警告）。
export function overLimit(items, max) {
  const c = openCounts(items);
  const n = c.ask + c.review;
  return { n, over: Number(max) > 0 && n > Number(max) };
}

// 完了のまま取り込まれていない作業セッションのうち、確認依頼をまだ出していないもの。
// stale は [{ id, ms }]、workers は台帳の作業セッション（id → { createdAt }）。同じ作業セッション（立て直しは別）に一度だけ出す。
export function staleReviewTargets(stale, items, chiefDir, workers) {
  return stale.filter((s) => {
    const since = Date.parse(workers[s.id]?.createdAt ?? '') || 0;
    return !items.some((x) => x.tag === `stale-done:${s.id}` && sameDir(x.chief?.dir, chiefDir) && Date.parse(x.createdAt) >= since);
  });
}

// 項目の形を読み分ける。形を変えたら v を上げ、ここで古い形を新しい形に直す。
export function upgradeItem(j) {
  if (!j || typeof j !== 'object') throw new InboxError(400, '項目が JSON のオブジェクトではありません');
  switch (j.v) {
    case 1:
      return j;
    default:
      throw new InboxError(400, `この版では読めない形です（v: ${JSON.stringify(j.v)}）`);
  }
}

// 新しい要返事・確認依頼を知らせるコマンド（herdr の通知と macOS の通知の両方を出す）。
export function notifyCommands(item, platform) {
  const title = `${KIND_LABEL[item.kind]}（${item.chief.name}）`;
  const cmds = [['herdr', ['notification', 'show', title, '--body', item.title, '--sound', 'request']]];
  if (platform === 'darwin') {
    const q = (s) => `"${String(s).replace(/[\\"]/g, '\\$&')}"`;
    cmds.push(['osascript', ['-e', `display notification ${q(item.title)} with title ${q(`CoS 受け箱: ${title}`)}`]]);
  }
  return cmds;
}

// ───────── 置き場所の読み書き ─────────

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function withInboxLock(dir, fn) {
  mkdirSync(dir, { recursive: true });
  const lock = join(dir, '.lock');
  const t0 = Date.now();
  for (;;) {
    try {
      mkdirSync(lock);
      break;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try {
        if (Date.now() - statSync(lock).mtimeMs > 30_000) {
          rmSync(lock, { recursive: true, force: true }); // 落ちたプロセスの残骸
          continue;
        }
      } catch {
        continue;
      }
      if (Date.now() - t0 > 10_000) throw new Error(`受け箱のロックが取れません: ${lock}`);
      sleep(25);
    }
  }
  try {
    return fn();
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

function itemFile(dir, id) {
  if (!ID_RE.test(String(id))) throw new InboxError(404, `受け箱に ${id} はありません`);
  return join(dir, `${id}.json`);
}

function writeItem(dir, item) {
  mkdirSync(dir, { recursive: true });
  const file = itemFile(dir, item.id);
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(item, null, 2)}\n`);
  renameSync(tmp, file);
}

export function getItem(dir, id) {
  const file = itemFile(dir, id);
  if (!existsSync(file)) throw new InboxError(404, `受け箱に ${id} はありません`);
  return upgradeItem(JSON.parse(readFileSync(file, 'utf8')));
}

// 全部の項目。読めないファイルは飛ばして skipped に理由を残す（1件壊れても受け箱を止めない）。
export function listItems(dir) {
  const items = [];
  const skipped = [];
  let names = [];
  try {
    names = readdirSync(dir);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  for (const name of names) {
    if (name.startsWith('.') || !name.endsWith('.json')) continue;
    try {
      items.push(upgradeItem(JSON.parse(readFileSync(join(dir, name), 'utf8'))));
    } catch (e) {
      skipped.push({ file: name, reason: e.message });
    }
  }
  return { items, skipped };
}

// 項目を作る。supersedes があれば、前の項目（同じ CoS の未対応のもの）を取り下げにして置き換える。
export function createItem(dir, input, opts = {}) {
  return withInboxLock(dir, () => {
    let item = buildItem(input, opts);
    for (let i = 0; existsSync(join(dir, `${item.id}.json`)); i++) {
      if (input.id || i > 20) throw new InboxError(409, `受け箱に ${item.id} がもうあります`);
      item = buildItem(input, { ...opts, rand: Math.random });
    }
    if (item.supersedes) {
      const old = getItem(dir, item.supersedes);
      if (!sameDir(old.chief?.dir, item.chief.dir)) throw new InboxError(400, `${old.id} は別の CoS（${old.chief?.name}）の項目なので置き換えられません`);
      writeItem(dir, applyWithdraw(old, item.createdAt, { supersededBy: item.id }));
    }
    writeItem(dir, item);
    return item;
  });
}

function mutate(dir, id, fn) {
  return withInboxLock(dir, () => {
    const cur = getItem(dir, id);
    const next = fn(cur);
    if (next !== cur) writeItem(dir, next);
    return next;
  });
}

export function answerItem(dir, id, ans) {
  return mutate(dir, id, (x) => applyAnswer(x, ans));
}

export function readItem(dir, id) {
  return mutate(dir, id, (x) => applyRead(x));
}

// chiefDir を渡すと、その CoS の項目でなければ断る（他の CoS の問いを引っ込めない）。
export function withdrawItem(dir, id, { chiefDir = null } = {}) {
  return mutate(dir, id, (x) => {
    if (chiefDir && !sameDir(x.chief?.dir, chiefDir)) throw new InboxError(400, `${x.id} は別の CoS（${x.chief?.name}）の項目です（それでも取り下げるなら --force）`);
    return applyWithdraw(x);
  });
}

// 見張りが CoS に渡した印（同じ答えで二度起こさない）。
export function markDelivered(dir, ids) {
  const at = new Date().toISOString();
  for (const id of ids) mutate(dir, id, (x) => (x.deliveredAt ? x : { ...x, deliveredAt: at }));
}

// 置き場所が変わったか（項目の書き込みは rename なので、ディレクトリの更新時刻が変わる）。見張りが毎周ぜんぶ読まないために使う。
export function inboxStamp(dir) {
  try {
    return statSync(dir).mtimeMs;
  } catch {
    return 0;
  }
}

// 新しい要返事・確認依頼を知らせる。失敗しても投げない。COS_INBOX_NOTIFY=0 で出さない（試験用）。
export function notifyNew(item, env = process.env) {
  if (env.COS_INBOX_NOTIFY === '0' || (item.kind !== 'ask' && item.kind !== 'review')) return [];
  const via = [];
  for (const [bin, args] of notifyCommands(item, process.platform)) {
    try {
      execFileSync(bin, args, { stdio: 'ignore', timeout: 10_000 });
      via.push(bin);
    } catch {
      // 片方が出せなくても、もう片方は出す
    }
  }
  return via;
}

// ───────── 画面の API（localhost の JSON over HTTP） ─────────

// 画面に渡す形。file:// のリンクはブラウザから開けないので、API 経由で読める url を足す。
export function publicItem(item) {
  return {
    ...item,
    links: (item.links ?? []).map((l, i) => ({ ...l, url: l.href.startsWith('file:') ? `/api/items/${item.id}/links/${i}` : l.href })),
  };
}

function closedAt(x) {
  return x.answer?.at ?? x.readAt ?? x.withdrawnAt ?? x.createdAt;
}

// API の1回の呼び出し。返すのは { status, json } か { status, text, type }。ネットワークを通さず試せるように http から切り離してある。
//   GET  /api/items[?status=open]         全部（未対応を並び順で先に、済んだものは新しい順）
//   GET  /api/items/:id
//   GET  /api/items/:id/links/:n          項目のリンクが指す手元のファイルの中身（項目に書かれたファイルだけ）
//   POST /api/items/:id/answer  { choice, text }
//   POST /api/items/:id/read
//   GET  /api/events                      （serveInbox が出す）押し出し。SSE で、受け箱が変わるたびに `change` が届く
export function handleApi(dir, method, pathname, { query = new URLSearchParams(), body = null } = {}) {
  try {
    const seg = pathname.split('/').filter(Boolean).map(decodeURIComponent);
    if (seg[0] !== 'api' || seg[1] !== 'items') throw new InboxError(404, 'そういう API はありません');
    if (seg.length === 2 && method === 'GET') {
      const { items, skipped } = listItems(dir);
      const open = sortInbox(items.filter((x) => x.status === 'open'));
      const closed = query.get('status') === 'open' ? [] : items.filter((x) => x.status !== 'open').sort((a, b) => String(closedAt(b)).localeCompare(String(closedAt(a))));
      return {
        status: 200,
        json: {
          v: INBOX_V,
          now: new Date().toISOString(),
          staleAskDays: STALE_ASK_DAYS,
          counts: openCounts(items),
          chiefs: [...new Set(items.map((x) => x.chief?.name).filter(Boolean))].sort(),
          items: [...open, ...closed].map(publicItem),
          skipped: skipped.length,
        },
      };
    }
    const id = seg[2];
    if (seg.length === 3 && method === 'GET') return { status: 200, json: publicItem(getItem(dir, id)) };
    if (seg.length === 5 && seg[3] === 'links' && method === 'GET') {
      const link = getItem(dir, id).links?.[Number(seg[4])];
      if (!link || !link.href.startsWith('file:')) throw new InboxError(404, 'そのリンクは手元のファイルではありません');
      const file = fileURLToPath(link.href);
      let st;
      try {
        st = statSync(file);
      } catch {
        throw new InboxError(404, `ファイルがありません: ${file}`);
      }
      if (!st.isFile()) throw new InboxError(400, `ファイルではありません: ${file}`);
      if (st.size > MAX_LINK_FILE) throw new InboxError(400, `大きすぎて出せません（${st.size} バイト）: ${file}`);
      return { status: 200, text: readFileSync(file, 'utf8'), type: 'text/plain; charset=utf-8' };
    }
    if (seg.length === 4 && method === 'POST' && seg[3] === 'answer') {
      return { status: 200, json: publicItem(answerItem(dir, id, { choice: body?.choice ?? null, text: body?.text ?? null, via: 'ui' })) };
    }
    if (seg.length === 4 && method === 'POST' && seg[3] === 'read') return { status: 200, json: publicItem(readItem(dir, id)) };
    throw new InboxError(seg.length >= 3 ? 405 : 404, 'そういう API はありません');
  } catch (e) {
    if (e instanceof InboxError) return { status: e.status, json: { error: e.message } };
    return { status: 500, json: { error: String(e.message ?? e) } };
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};

// 画面のファイル（uiDir の中だけ・隠しファイルは出さない）。
export function staticFile(uiDir, pathname) {
  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (rel.endsWith('/')) rel += 'index.html';
  const parts = rel.split('/').filter(Boolean);
  if (parts.some((p) => p.startsWith('.') || p.includes('\\'))) return null;
  const root = resolve(uiDir);
  const file = resolve(root, ...parts);
  if (file !== root && !file.startsWith(root + sep)) return null;
  try {
    if (!statSync(file).isFile()) return null;
  } catch {
    return null;
  }
  return { file, type: MIME[extname(file).toLowerCase()] ?? 'application/octet-stream' };
}

// 受け箱の変更を拾う。どこから変えても（CLI・API・別の画面）項目のファイルが書き換わるので、ディレクトリを見ていれば足りる。
// fs.watch を主に、取りこぼしに備えて更新時刻も pollMs ごとに見る。短い間の続けての変更は1回にまとめる。止める関数を返す。
export function watchInbox(dir, onChange, { debounceMs = 40, pollMs = 2000 } = {}) {
  mkdirSync(dir, { recursive: true });
  let timer = null;
  let stamp = inboxStamp(dir);
  const fire = () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      stamp = inboxStamp(dir);
      onChange();
    }, debounceMs);
  };
  let w = null;
  try {
    // 項目のファイル（<id>.json）だけを見る。ロックや書きかけ（.lock・*.tmp-*）では知らせない。
    w = watch(dir, (_ev, name) => {
      if (name == null || (String(name).endsWith('.json') && !String(name).startsWith('.'))) fire();
    });
    w.on('error', () => {});
  } catch {
    // fs.watch が使えなければ更新時刻だけで見る
  }
  const poll = setInterval(() => {
    if (inboxStamp(dir) !== stamp) fire();
  }, pollMs);
  return () => {
    clearInterval(poll);
    if (timer) clearTimeout(timer);
    try {
      w?.close();
    } catch {
      // 閉じられなくても止める
    }
  };
}

// 画面と API を出す。127.0.0.1 にだけ bind する（認証は無い）。ほかのサイトのページから叩かれないように、
// Host が自分でない要求と、JSON でない POST・よその Origin の POST は断る。
export function serveInbox({ dir, port = INBOX_DEFAULT_PORT, uiDir, host = '127.0.0.1' }) {
  const allowed = () => new Set([`127.0.0.1:${server.address().port}`, `localhost:${server.address().port}`]);
  const send = (res, status, body, type) => {
    res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(body);
  };
  const sendJson = (res, status, json) => send(res, status, JSON.stringify(json), 'application/json; charset=utf-8');
  // 押し出し（SSE）。つないでいる画面の全部に、受け箱が変わるたびに change を送る。画面は受け取ったら全件を取り直す。
  const clients = new Set();
  let rev = 0;
  const push = (res, event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const stopWatch = watchInbox(dir, () => {
    rev++;
    for (const res of clients) push(res, 'change', { rev });
  });
  const beat = setInterval(() => {
    for (const res of clients) res.write(': ping\n\n');
  }, 20_000);
  const server = createServer((req, res) => {
    const ok = allowed();
    if (!ok.has(req.headers.host ?? '')) return sendJson(res, 403, { error: 'この受け箱は 127.0.0.1 からだけ使えます' });
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      if (url.pathname === '/api/events' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        res.write('retry: 1000\n\n');
        push(res, 'hello', { rev });
        clients.add(res);
        req.on('close', () => clients.delete(res));
        return undefined;
      }
      if (req.method === 'GET') {
        const r = handleApi(dir, 'GET', url.pathname, { query: url.searchParams });
        return r.json ? sendJson(res, r.status, r.json) : send(res, r.status, r.text, r.type);
      }
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'GET か POST だけです' });
      const origin = req.headers.origin;
      if (origin && !ok.has(origin.replace(/^https?:\/\//, ''))) return sendJson(res, 403, { error: 'よそのページからは使えません' });
      if (!/^application\/json\b/i.test(req.headers['content-type'] ?? '')) return sendJson(res, 415, { error: 'Content-Type: application/json で送ってください' });
      const chunks = [];
      let size = 0;
      req.on('data', (c) => {
        size += c.length;
        if (size > MAX_BODY) req.destroy();
        else chunks.push(c);
      });
      req.on('end', () => {
        let body = null;
        try {
          const raw = Buffer.concat(chunks).toString('utf8');
          body = raw.trim() ? JSON.parse(raw) : {};
        } catch {
          return sendJson(res, 400, { error: 'JSON が読めません' });
        }
        const r = handleApi(dir, 'POST', url.pathname, { body });
        sendJson(res, r.status, r.json);
      });
      return undefined;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'GET だけです' });
    const f = staticFile(uiDir, url.pathname);
    if (!f) return send(res, 404, 'not found', 'text/plain; charset=utf-8');
    return send(res, 200, req.method === 'HEAD' ? '' : readFileSync(f.file), f.type);
  });
  server.on('close', () => {
    stopWatch();
    clearInterval(beat);
    for (const res of clients) res.end();
  });
  server.listen(port, host);
  return server;
}

// 動いている画面の記録（<受け箱>/.server.json）。cos ask などが「画面はここ」と出すために使う。
export function serverInfo(dir) {
  try {
    const j = JSON.parse(readFileSync(join(dir, '.server.json'), 'utf8'));
    process.kill(j.pid, 0);
    return j;
  } catch {
    return null;
  }
}

export function writeServerInfo(dir, info) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, '.server.json'), `${JSON.stringify(info, null, 2)}\n`);
}

export function clearServerInfo(dir, pid) {
  try {
    const f = join(dir, '.server.json');
    if (JSON.parse(readFileSync(f, 'utf8')).pid === pid) rmSync(f, { force: true });
  } catch {
    // 無ければ何もしない
  }
}

// ───────── 自己テスト（cos self-test から呼ぶ） ─────────

export function selfTestInbox(assert) {
  const throws = (fn, status) => {
    try {
      fn();
    } catch (e) {
      return e instanceof InboxError && (status === undefined || e.status === status);
    }
    return false;
  };
  const T0 = Date.parse('2026-11-25T07:12:00Z');
  const A = { name: 'cos-main', dir: '/r/main', session: 's1' };
  const B = { name: '経理IT', dir: '/r/it', session: null };

  // 選択肢・リンク・id
  assert(JSON.stringify(parseOption('rec:おすすめどおり:B1〜B3: 全部')) === JSON.stringify({ key: 'rec', label: 'おすすめどおり', detail: 'B1〜B3: 全部' }), 'inbox: 選択肢 説明つき');
  assert(JSON.stringify(parseOption('all:全部')) === JSON.stringify({ key: 'all', label: '全部' }), 'inbox: 選択肢 説明なし');
  assert(throws(() => parseOption('全部'), 400) && throws(() => parseOption('a b:x'), 400) && throws(() => parseOption('a:'), 400), 'inbox: 選択肢の形が違えば断る');
  const l1 = parseLink('報告書=notes/report.md', '/w');
  assert(l1.label === '報告書' && l1.href === 'file:///w/notes/report.md', `inbox: リンク 相対パス ${JSON.stringify(l1)}`);
  const l2 = parseLink('PR=https://example.com/pull/1?a=b', '/w');
  assert(l2.label === 'PR' && l2.href === 'https://example.com/pull/1?a=b', `inbox: リンク URL ${JSON.stringify(l2)}`);
  const l3 = parseLink('https://example.com/x?a=b', '/w');
  assert(l3.href === 'https://example.com/x?a=b' && l3.label === l3.href, `inbox: 名前なしの URL ${JSON.stringify(l3)}`);
  assert(parseLink('/a/b.md', '/w').label === 'b.md', 'inbox: 名前なしのパス');
  assert(throws(() => parseLink('x=javascript:alert(1)', '/w'), 400), 'inbox: http・https・file 以外のリンクは断る');
  assert(chiefSlug('cos-main') === 'main' && chiefSlug('my-app') === 'my-app' && chiefSlug('経理IT') === 'it' && chiefSlug('受付') === 'cos' && chiefSlug('cos') === 'cos', 'inbox: CoS の短い名前');
  assert(/^\d{8}-\d{4}-main-0ff$/.test(makeId(T0, 'cos-main', () => 0xff / 0x1000)), `inbox: id ${makeId(T0, 'cos-main', () => 0xff / 0x1000)}`);

  // 項目を作る
  const ask = buildItem({ kind: 'ask', chief: A, worker: 'w1', title: ' どれにするか ', body: 'b', options: [{ key: 'a', label: 'A' }, { key: 'b', label: 'B', detail: 'd' }], recommend: 'a' }, { nowMs: T0 });
  assert(ask.v === 1 && ask.status === 'open' && ask.answer === null && ask.title === 'どれにするか' && ask.freeText === true && ask.supersedes === null && ask.createdAt === '2026-11-25T07:12:00.000Z', 'inbox: ask の形');
  assert(throws(() => buildItem({ kind: 'ask', chief: A, title: 'x', options: [{ key: 'a', label: 'A' }], recommend: 'z' }), 400), 'inbox: おすすめが選択肢に無い');
  assert(throws(() => buildItem({ kind: 'ask', chief: A, title: 'x', options: [{ key: 'a', label: 'A' }, { key: 'a', label: 'B' }] }), 400), 'inbox: key が重なる');
  assert(throws(() => buildItem({ kind: 'ask', chief: A, title: 'x', freeText: false }), 400), 'inbox: 選択肢も自由記述も無い ask');
  assert(throws(() => buildItem({ kind: 'tell', chief: A, title: '' }), 400) && throws(() => buildItem({ kind: 'memo', chief: A, title: 'x' }), 400) && throws(() => buildItem({ kind: 'tell', title: 'x' }), 400), 'inbox: 題・種類・CoS が要る');
  assert(throws(() => buildItem({ kind: 'review', chief: A, title: 'x', options: [{ key: 'a', label: 'A' }] }), 400), 'inbox: 選択肢は ask だけ');
  const review = buildItem({ kind: 'review', chief: A, title: 'PR を見て' }, { nowMs: T0 + 1000 });
  const tell = buildItem({ kind: 'tell', chief: B, title: '終わりました' }, { nowMs: T0 + 2000 });
  assert(review.options === null && review.freeText === null && tell.options === null, 'inbox: review・tell は選択肢を持たない');

  // 返事
  const a1 = applyAnswer(ask, { choice: 'b', text: ' 一言 ', via: 'ui' }, 'T');
  assert(a1.status === 'answered' && a1.answer.choice === 'b' && a1.answer.text === '一言' && a1.answer.at === 'T' && a1.answer.via === 'ui' && ask.status === 'open', 'inbox: 選んで返す（元は変えない）');
  assert(applyAnswer(ask, { choice: '-', text: '別の案で' }).answer.choice === null, 'inbox: 自由記述だけで返す');
  assert(throws(() => applyAnswer(ask, { choice: 'z' }), 400) && throws(() => applyAnswer(ask, {}), 400), 'inbox: 選択肢に無い・何も無い返事は断る');
  assert(throws(() => applyAnswer({ ...ask, freeText: false }, { text: '文章' }), 400), 'inbox: 自由記述を止めた ask は選ぶだけ');
  assert(throws(() => applyAnswer(a1, { choice: 'a' }), 409), 'inbox: 返事済みには返せない');
  assert(applyAnswer(review, { choice: '承認' }).answer.choice === 'approve' && applyAnswer(review, { choice: 'reject', text: 'ここを直して' }).answer.choice === 'reject', 'inbox: 承認・差し戻し');
  assert(throws(() => applyAnswer(review, { choice: 'reject' }), 400) && throws(() => applyAnswer(review, { choice: 'maybe' }), 400), 'inbox: 差し戻しはコメント必須');
  assert(throws(() => applyAnswer(tell, { choice: 'a' }), 400), 'inbox: 読むだけには返事できない');

  // 既読・取り下げ
  const r1 = applyRead(tell, 'T');
  assert(r1.status === 'read' && r1.readAt === 'T' && applyRead(r1) === r1 && throws(() => applyRead(ask), 400), 'inbox: 既読は tell だけ・二度目は変えない');
  const w1 = applyWithdraw(ask, 'T', { supersededBy: 'n' });
  assert(w1.status === 'withdrawn' && w1.supersededBy === 'n' && throws(() => applyWithdraw(a1), 409) && throws(() => applyAnswer(w1, { choice: 'a' }), 409) && throws(() => applyRead(applyWithdraw(tell)), 409), 'inbox: 取り下げ');

  // answered の出来事: 自分の CoS の、まだ渡していない答えだけ
  const other = applyAnswer(buildItem({ kind: 'ask', chief: B, title: '他の CoS' }, { nowMs: T0 }), { text: 'はい' }, 'T2');
  const mine = [a1, other, review, { ...a1, id: 'done', deliveredAt: 'T' }, w1];
  assert(answeredFor(mine, '/r/main').map((x) => x.id).join() === a1.id, 'inbox: answered は自分の CoS の未配達の答えだけ');
  assert(answeredFor(mine, '/r/it').map((x) => x.id).join() === other.id && answeredFor(mine, '/r/none').length === 0 && answeredFor(mine, null).length === 0, 'inbox: 他の CoS の項目では起きない');
  const ev = answeredEvent(a1);
  assert(ev.event === 'answered' && ev.id === a1.id && ev.choice === 'b' && ev.label === 'B' && ev.text === '一言' && ev.worker === 'w1', `inbox: 出来事の形 ${JSON.stringify(ev)}`);
  assert(answeredEvent(applyAnswer(review, { choice: 'ng', text: 'x' })).label === '差し戻し', 'inbox: 確認依頼の出来事');

  // 並びと件数
  const old = buildItem({ kind: 'ask', chief: B, title: '古い' }, { nowMs: T0 - 5000 });
  assert(sortInbox([tell, review, ask, old]).map((x) => x.title).join() === '古い,どれにするか,PR を見て,終わりました', 'inbox: 要返事 → 確認 → 読むだけ・古い順');
  assert(JSON.stringify(openCounts([ask, old, review, tell, a1, r1])) === JSON.stringify({ ask: 2, review: 1, tell: 1 }), 'inbox: 件数は未対応だけ');
  assert(overLimit([ask, old, review, tell], 3).over === false && overLimit([ask, old, review, tell], 2).over === true && overLimit([ask, old, review], 0).over === false && overLimit([ask, old, review, tell], 2).n === 3, 'inbox: 上限は ask+review・0 なら見ない');

  // 取り込み待ちの確認依頼は、同じ作業セッションに一度だけ
  const sr = { ...review, tag: 'stale-done:w1' };
  const workers = { w1: { createdAt: '2026-11-20T00:00:00Z' }, w2: { createdAt: '2026-11-20T00:00:00Z' } };
  const stale = [{ id: 'w1', ms: 1 }, { id: 'w2', ms: 1 }];
  assert(staleReviewTargets(stale, [sr], '/r/main', workers).map((x) => x.id).join() === 'w2', 'inbox: 出し済みの取り込み待ちは出さない');
  assert(staleReviewTargets(stale, [applyAnswer(sr, { choice: 'approve' })], '/r/main', workers).map((x) => x.id).join() === 'w2', 'inbox: 答えが付いた後も出し直さない');
  assert(staleReviewTargets(stale, [sr], '/r/it', workers).length === 2, 'inbox: 他の CoS が出した分は数えない');
  assert(staleReviewTargets(stale, [sr], '/r/main', { ...workers, w1: { createdAt: '2026-11-26T00:00:00Z' } }).length === 2, 'inbox: 同じ ID を立て直したら出し直す');

  // 形の読み分け
  assert(upgradeItem(ask) === ask && throws(() => upgradeItem({ ...ask, v: 2 }), 400) && throws(() => upgradeItem({ id: 'x' }), 400) && throws(() => upgradeItem(null), 400), 'inbox: v が違う項目は読まない');

  // 知らせ
  const nc = notifyCommands(ask, 'darwin');
  assert(nc.length === 2 && nc[0][0] === 'herdr' && nc[0][1].join(' ') === 'notification show 要返事（cos-main） --body どれにするか --sound request' && nc[1][0] === 'osascript', `inbox: 知らせ ${JSON.stringify(nc)}`);
  assert(notifyCommands(review, 'linux').length === 1 && notifyNew(tell, {}).length === 0 && notifyNew(ask, { COS_INBOX_NOTIFY: '0' }).length === 0, 'inbox: tell は知らせない・止められる');
  assert(notifyCommands({ ...ask, title: 'a"b\\c' }, 'darwin')[1][1][1].includes('"a\\"b\\\\c"'), 'inbox: 通知の文のエスケープ');

  // 置き場所（一時ディレクトリ）: 作る・置き換える・答える・既読・取り下げ・API
  const dir = mkdtempSync(join(tmpdir(), 'cos-inbox-selftest-'));
  try {
    const q1 = createItem(dir, { kind: 'ask', chief: { ...A, dir }, title: 'Q1', options: [{ key: 'y', label: 'はい' }, { key: 'n', label: 'いいえ' }] });
    const q2 = createItem(dir, { kind: 'ask', chief: { ...A, dir }, title: 'Q1 改', options: [{ key: 'y', label: 'はい' }], supersedes: q1.id });
    assert(getItem(dir, q1.id).status === 'withdrawn' && getItem(dir, q1.id).supersededBy === q2.id && getItem(dir, q2.id).supersedes === q1.id, 'inbox: supersedes で前の項目は取り下げ');
    assert(throws(() => createItem(dir, { kind: 'ask', chief: { ...A, dir }, title: 'x', supersedes: q1.id }), 409), 'inbox: 済んだ項目は置き換えられない');
    assert(throws(() => createItem(dir, { kind: 'ask', chief: B, title: 'x', supersedes: q2.id }), 400) && getItem(dir, q2.id).status === 'open', 'inbox: 他の CoS の項目は置き換えられない');
    assert(throws(() => createItem(dir, { kind: 'ask', chief: A, title: 'x', supersedes: 'nope' }), 404), 'inbox: 無い項目は置き換えられない');
    assert(listItems(dir).items.length === 2, 'inbox: 失敗した作成は何も残さない');
    const rv = createItem(dir, { kind: 'review', chief: { ...A, dir }, title: 'R1', links: [{ label: 'メモ', href: pathToFileURL(join(dir, 'memo.txt')).href }, { label: 'PR', href: 'https://example.com/1' }] });
    const tl = createItem(dir, { kind: 'tell', chief: B, title: 'T1' });
    const ot = createItem(dir, { kind: 'ask', chief: B, title: '他の CoS の問い' });
    writeFileSync(join(dir, 'memo.txt'), 'メモの中身');
    writeFileSync(join(dir, 'broken.json'), '{');
    writeFileSync(join(dir, 'future.json'), JSON.stringify({ v: 99, id: 'future' }));
    const ls = listItems(dir);
    assert(ls.items.length === 5 && ls.skipped.length === 2, `inbox: 壊れた・読めない版のファイルは飛ばす ${ls.items.length}/${ls.skipped.length}`);
    assert(throws(() => getItem(dir, '../x'), 404) && throws(() => getItem(dir, 'nope'), 404), 'inbox: 無い id');

    const api = (m, p, o) => handleApi(dir, m, p, o);
    const all = api('GET', '/api/items').json;
    assert(all.v === 1 && all.items.length === 5 && all.skipped === 2 && JSON.stringify(all.counts) === JSON.stringify({ ask: 2, review: 1, tell: 1 }) && all.staleAskDays === 3, `inbox API: 一覧 ${JSON.stringify(all.counts)}`);
    assert(all.items.map((x) => x.status).join() === 'open,open,open,open,withdrawn' && all.items[0].kind === 'ask' && all.items[2].kind === 'review' && all.items[3].kind === 'tell', 'inbox API: 未対応を並び順で先に');
    assert(all.chiefs.join() === 'cos-main,経理IT' && api('GET', '/api/items', { query: new URLSearchParams('status=open') }).json.items.length === 4, 'inbox API: CoS の名前・未対応だけ');
    const pv = api('GET', `/api/items/${rv.id}`).json;
    assert(pv.links[0].url === `/api/items/${rv.id}/links/0` && pv.links[1].url === 'https://example.com/1', 'inbox API: 手元のファイルのリンクは API 経由');
    assert(api('GET', `/api/items/${rv.id}/links/0`).text === 'メモの中身' && api('GET', `/api/items/${rv.id}/links/1`).status === 404 && api('GET', `/api/items/${rv.id}/links/9`).status === 404, 'inbox API: リンクのファイル');
    assert(api('POST', `/api/items/${q2.id}/answer`, { body: { choice: 'zzz' } }).status === 400 && getItem(dir, q2.id).status === 'open', 'inbox API: 選択肢に無い返事は 400');
    const ans = api('POST', `/api/items/${q2.id}/answer`, { body: { choice: 'y', text: 'お願いします' } });
    assert(ans.status === 200 && ans.json.status === 'answered' && ans.json.answer.via === 'ui' && getItem(dir, q2.id).answer.choice === 'y', 'inbox API: 返事');
    assert(api('POST', `/api/items/${q2.id}/answer`, { body: { choice: 'y' } }).status === 409, 'inbox API: 二度目の返事は 409');
    assert(api('POST', `/api/items/${rv.id}/answer`, { body: { choice: 'reject' } }).status === 400 && api('POST', `/api/items/${rv.id}/answer`, { body: { choice: 'reject', text: '直して' } }).json.answer.choice === 'reject', 'inbox API: 差し戻し');
    assert(api('POST', `/api/items/${tl.id}/read`).json.status === 'read' && api('POST', `/api/items/${tl.id}/read`).status === 200 && api('POST', `/api/items/${ot.id}/read`).status === 400, 'inbox API: 既読');
    assert(api('GET', '/api/items/nope').status === 404 && api('GET', '/api/nope').status === 404 && api('DELETE', `/api/items/${ot.id}`).status === 405 && api('POST', '/api/items/nope/answer', { body: {} }).status === 404, 'inbox API: 無いもの');

    // 見張りが拾う答え: 自分の CoS の分だけ・渡したら二度出ない
    answerItem(dir, ot.id, { text: '他の CoS への返事' });
    const got = answeredFor(listItems(dir).items, dir).map((x) => x.id).sort().join();
    assert(got === [q2.id, rv.id].sort().join(), `inbox: 見張りが拾うのは自分の CoS の答え ${got}`);
    markDelivered(dir, [q2.id, rv.id]);
    assert(answeredFor(listItems(dir).items, dir).length === 0 && answeredFor(listItems(dir).items, '/r/it').length === 1, 'inbox: 渡した答えは二度出ない・他の CoS の答えは残る');
    assert(throws(() => withdrawItem(dir, q2.id), 409), 'inbox: 返事済みは取り下げられない');
    const w2 = createItem(dir, { kind: 'ask', chief: { ...A, dir }, title: '取り下げる問い' });
    assert(throws(() => withdrawItem(dir, w2.id, { chiefDir: '/r/it' }), 400) && withdrawItem(dir, w2.id, { chiefDir: dir }).status === 'withdrawn', 'inbox: 取り下げは自分の CoS の項目だけ');
    assert(api('POST', `/api/items/${w2.id}/answer`, { body: { text: 'x' } }).status === 409, 'inbox API: 取り下げた項目には返せない');

    // 画面のファイルは uiDir の中だけ
    mkdirSync(join(dir, 'ui'));
    writeFileSync(join(dir, 'ui', 'index.html'), '<p>x</p>');
    writeFileSync(join(dir, 'ui', '.secret'), 'x');
    assert(staticFile(join(dir, 'ui'), '/')?.type.startsWith('text/html') && staticFile(join(dir, 'ui'), '/index.html') !== null, 'inbox: 画面の入口');
    assert(staticFile(join(dir, 'ui'), '/../memo.txt') === null && staticFile(join(dir, 'ui'), '/%2e%2e/memo.txt') === null && staticFile(join(dir, 'ui'), '/.secret') === null && staticFile(join(dir, 'ui'), '/none.js') === null, 'inbox: uiDir の外・隠しファイルは出さない');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
