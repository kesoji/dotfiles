// CoS の受け箱 — 全 CoS からユーザーへの「要返事（ask）」「確認依頼（review）」「やること（todo）」「読むだけ（tell）」と、
// ユーザーから CoS への「指示（message）」を1か所に置く。
//
// 項目は1件1ファイル（<受け箱>/<id>.json）。置き場所は ~/.cos/inbox（環境変数 COS_INBOX_DIR で差し替える＝試験用）。
// 項目の形の説明は ../inbox-schema.md（形を変えるときはそこと upgradeItem を直す）。
//
// このファイルの関数を、CLI（cos.mjs の cos ask / review / todo / tell / inbox / answer / withdraw）と
// 画面の API（cos inbox serve の /api/…）の両方が呼ぶ。画面（../inbox-ui/）は API だけに依存する。
// CoS の一覧（どこにどの CoS がいるか）は ~/.cos/chiefs/ に記録する（noteChief・listChiefs）。
// 依存は node の標準だけ。
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, watch, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir, tmpdir } from 'node:os';
import { basename, extname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { TodoError, addTodoToFile, dueState, findTodo, parseTodos, setTodoDoneInFile, sortTodos, todoFilesOf, watchTodoFiles } from './todofile.mjs';

export const INBOX_V = 1;
export const INBOX_DEFAULT_PORT = 7788;
// 答えていない要返事・終わっていないやることを赤く出すまでの日数（画面と cos inbox の一覧）。
export const STALE_ASK_DAYS = 3;
export const KIND_LABEL = { ask: '要返事', review: '確認依頼', todo: 'やること', tell: '読むだけ', message: '指示' };
// CoS がユーザーに出す種類（cos ask / review / todo / tell）。message はユーザーが CoS に出す（画面の API だけが作る）。
const KIND_ORDER = { ask: 0, review: 1, todo: 2, tell: 3 };
const SORT_ORDER = { ...KIND_ORDER, message: 4 };
// ユーザーの返事を待つ種類（返事待ちの件数・通知・answered の出来事の対象）。tell は入らない（開いたら既読で終わる）。
export const WAITING_KINDS = ['ask', 'review', 'todo'];
// 指示の長さの上限（画面は短い指示向け。長いやり取りは herdr のペインで）。
export const MAX_MESSAGE_CHARS = 4000;
// 見張りの印（~/.cos/chiefs/ の watch.beatAt）がこの秒数より古ければ、見張りは動いていないとみなす。
export const WATCH_BEAT_STALE_SEC = 120;
// 指示が届いてからこの時間のあいだ、続きに見える項目・作業セッションを --reply-to 無しで出すと注意する（threadHint）。
export const THREAD_HINT_HOURS = 24;
const STATUS_LABEL = { open: '未対応', answered: '返事済み', read: '既読', withdrawn: '取り下げ' };
const REVIEW_CHOICES = { approve: 'approve', ok: 'approve', 承認: 'approve', reject: 'reject', ng: 'reject', 差し戻し: 'reject', 差戻し: 'reject' };
export const REVIEW_LABEL = { approve: '承認', reject: '差し戻し' };
const TODO_CHOICES = { done: 'done', やった: 'done', 済: 'done', 済み: 'done', cannot: 'cannot', cant: 'cannot', できない: 'cannot' };
export const TODO_LABEL = { done: 'やった', cannot: 'できない' };

// cos tell の誤用（読むだけの項目で、ユーザーに作業や返事を求めている）を見つけるための言い回し。
// 足し引きはここだけでする。[見つける形, 止めたときに出す名前]。引用（> の行・「」『』の中）とコード（``` と ` の中）は見ない（tellMisuse）。
export const TELL_REQUEST_PHRASES = [
  [/(?:ください|下さい)/, '〜ください'],
  [/お願い(?:します|いたします|致します|したい|できます|です)/, 'お願いします'],
  [/(?:て|で)(?:ほしい|欲しい)/, '〜してほしい'],
  [/あなた(?:が|の)(?:すること|やること|作業|番)/, 'あなたがすること'],
  [/(?:試す|使う|進める|始める)前に/, '〜する前に'],
  [/(?:試して|やって|確認して|確かめて|見て)(?:みて|おいて)/, '〜してみて'],
  [/(?:知らせて|教えて|連絡して|返信して|返事して)(?!もら|くれ|いただ|頂)/, '知らせて・教えて'],
  [/(?:たら|れば|次第)[^。\n]{0,16}(?:知らせ|教え|連絡|返信|返事)/, '〜したら知らせて'],
  [/(?:どうしますか|どちらに(?:しますか|しましょうか)|(?:ますか|でしょうか|ましょうか|(?:よい|いい|良い|よろしい)ですか)\s*[？?])/, '〜しますか？'],
  [/(?:(?<!いく)[うくぐすつぬぶむる]か|ますか)\s*[。？?]?\s*$/, '〜するか・〜しますか で終わる問い'],
  [/頼みたいことがあれば|一言(?:ください|下さい|もらえ|いただけ)/, '頼みたいことがあれば・一言ください'],
  // 見出しや行頭（#・箇条書き・太字・【 の後ろ）に置いた、ユーザーの行動や判断を促す語
  [/^\s*(?:#{1,6}\s*|[-*・■▼◆]\s*|\*\*|__|【|\[)*(?:(?:推奨|おすすめ|お勧め|次の一手|やること|判断)\s*(?:$|[:：（(）)】\]*＊_、])|決めて|選んで)/, '行頭の 推奨・おすすめ・次の一手・やること・判断・決めて・選んで'],
];
// 番号付きの行動の並び（行頭が 1. 2. … で、動詞の終止形で終わる行）。CoS 自身の予定の列挙でも当たるので、止めずに注意だけ出す（soft）。
const TELL_NUMBERED_ACTION = /^\s*\d+\s*[.．)）、]\s*\S.*[うくぐすつぬぶむる]$/;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$/;
const KEY_RE = /^[A-Za-z0-9_-]{1,32}$/;
const LINK_SCHEMES = new Set(['http:', 'https:', 'file:']);
// GitHub のリポジトリ（owner/name）。項目の repo と、画面が作るリンクの宛先に使う。
const REPO_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;
const MAX_BODY = 1 << 20; // API に送れる本文（1MB）
const LINK_IMAGE_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
const MAX_LINK_FILE = 5 << 20; // リンクのファイルを画面に出す上限（5MB）
// 手元の HTML のリンクを HTML として出すときに付ける CSP。allow-same-origin を付けない＝その文書のオリジンは受け箱と別（null）になり、
// 図のための JS は動くが、受け箱の API は読めず（別オリジンの応答は読めない）、POST も Origin の検査で断られる。
export const LINK_HTML_CSP = 'sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox';

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

// CoS の記録の置き場所。~/.cos/chiefs（COS_CHIEFS_DIR で差し替える）。
// 受け箱を差し替えているとき（COS_INBOX_DIR＝試験）は、その中の .chiefs＝本物の記録を汚さない。
export function chiefsDir(env = process.env) {
  if (env.COS_CHIEFS_DIR) return resolve(env.COS_CHIEFS_DIR);
  return env.COS_INBOX_DIR ? join(resolve(env.COS_INBOX_DIR), '.chiefs') : join(homedir(), '.cos', 'chiefs');
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

// git のリモートの URL → GitHub の owner/name（github.com のときだけ。それ以外・読めなければ null）。
//   https://github.com/o/n(.git)・git@github.com:o/n(.git)・ssh://git@github.com/o/n(.git)
export function githubRepoFromUrl(url) {
  const m = /^(?:https?:\/\/(?:[^@/\s]+@)?github\.com\/|(?:ssh:\/\/)?git@github\.com[:/]|git:\/\/github\.com\/)([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i.exec(String(url ?? '').trim());
  if (!m) return null;
  const repo = `${m[1]}/${m[2]}`;
  return REPO_RE.test(repo) ? repo : null;
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
  if (!Object.hasOwn(KIND_ORDER, kind)) throw new InboxError(400, `kind は ask・review・todo・tell のどれかです: ${kind}`);
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
  if (input.replyTo) item.replyTo = String(input.replyTo);
  // もとになった TODO ファイルの行（cos todo --todo-line）。画面が TODO の行とこの項目をつないで出し、「やった」でその行も済にする。
  if (input.todoLine) {
    const t = input.todoLine;
    if (!t.file || !t.id) throw new InboxError(400, `todoLine の形が違います: ${JSON.stringify(t)}`);
    item.todoLine = { file: String(t.file), id: String(t.id), title: String(t.title ?? '') };
  }
  // その件の GitHub のリポジトリ（画面が #123 やコミットをリンクにする宛先）。分からなければ持たない。
  if (input.repo) {
    if (!REPO_RE.test(String(input.repo))) throw new InboxError(400, `--repo は GitHub の owner/name の形です: ${input.repo}`);
    item.repo = String(input.repo);
  }
  return item;
}

// 指示の題（1行目を縮めたもの。一覧と見張りの出来事に出す）。
export function messageTitle(text, max = 60) {
  const first = String(text ?? '').split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  const cps = [...first];
  return cps.length > max ? `${cps.slice(0, max).join('')}…` : first;
}

// ユーザーから CoS への指示（kind: "message"）。chief は宛先の CoS。書き込まない。
// worker を付けると、その作業セッションの質問への答え（画面の自動の質問カードから送ったもの）。本文の先頭に「作業セッション <ID> の質問への答え: 」を付ける
// （CoS が cos send <ID> で渡せばよいと分かるように。cos watch の動きは変えない）。
export const workerAnswerPrefix = (worker) => `作業セッション ${worker} の質問への答え: `;
export function buildMessage({ chief, text, worker = null, id = null }, { nowMs = Date.now(), rand = Math.random } = {}) {
  if (!chief?.dir || !chief?.name) throw new InboxError(400, '宛先の CoS（chief.name・chief.dir）がありません');
  if (worker != null && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,40}$/.test(String(worker))) throw new InboxError(400, `作業セッションの ID が不正です: ${worker}`);
  if (worker != null && String(text ?? '').trim()) text = `${workerAnswerPrefix(worker)}${String(text).trim()}`;
  const body = String(text ?? '').trim();
  if (!body) throw new InboxError(400, '指示が空です');
  if ([...body].length > MAX_MESSAGE_CHARS) throw new InboxError(400, `指示が長すぎます（${MAX_MESSAGE_CHARS} 字まで。長いやり取りは herdr のペインで）`);
  return {
    v: INBOX_V,
    id: id ?? makeId(nowMs, chief.name, rand),
    kind: 'message',
    chief: { name: String(chief.name), dir: String(chief.dir), session: null },
    worker: worker != null ? String(worker) : null,
    title: messageTitle(body),
    body,
    options: null,
    recommend: null,
    freeText: null,
    links: [],
    createdAt: new Date(nowMs).toISOString(),
    status: 'open',
    answer: null,
    supersedes: null,
  };
}

// CoS が指示を読んだ印（message）。もう読んでいれば何も変えない。
export function applyAck(item, nowIso = new Date().toISOString()) {
  if (item.kind !== 'message') throw new InboxError(400, `${item.id} は${KIND_LABEL[item.kind] ?? item.kind}の項目です（ack できるのはユーザーからの指示）`);
  if (item.status === 'read') return item;
  if (item.status !== 'open') throw new InboxError(409, `${item.id} はもう「${STATUS_LABEL[item.status] ?? item.status}」です`);
  return { ...item, status: 'read', readAt: nowIso };
}

// 返事を付ける（ask・review・todo）。choice は ask なら選択肢の key（自由記述だけなら null）、review なら approve / reject、todo なら done / cannot。
export function applyAnswer(item, { choice = null, text = null, via = 'cli' } = {}, nowIso = new Date().toISOString()) {
  if (item.kind === 'message') throw new InboxError(400, `${item.id} はユーザーからの指示です（CoS は cos inbox ack で既読にし、返事は cos ask / tell --reply-to で出す）`);
  if (item.kind === 'tell') throw new InboxError(400, `${item.id} は読むだけの項目です（返事はできません。既読にします）`);
  if (item.status !== 'open') throw new InboxError(409, `${item.id} はもう「${STATUS_LABEL[item.status] ?? item.status}」です`);
  const t = String(text ?? '').trim() || null;
  let c = choice === '' || choice === '-' || choice === undefined ? null : choice;
  if (item.kind === 'review') {
    c = REVIEW_CHOICES[String(c ?? '').toLowerCase()] ?? null;
    if (!c) throw new InboxError(400, '確認依頼への返事は approve（承認）か reject（差し戻し）です');
    if (c === 'reject' && !t) throw new InboxError(400, '差し戻しにはコメントが要ります');
  } else if (item.kind === 'todo') {
    c = Object.hasOwn(TODO_CHOICES, String(c ?? '').toLowerCase()) ? TODO_CHOICES[String(c).toLowerCase()] : null;
    if (!c) throw new InboxError(400, 'やることへの返事は done（やった）か cannot（できない）です');
    if (c === 'cannot' && !t) throw new InboxError(400, '「できない」にはコメント（理由・どこで止まったか）が要ります');
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
  if (item.kind !== 'tell') throw new InboxError(400, `${item.id} は${KIND_LABEL[item.kind]}の項目です（既読にできるのは読むだけの項目${item.kind === 'message' ? '。指示は cos inbox ack' : ''}）`);
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

// この CoS（chiefDir）宛ての指示のうち、まだ読まれておらず、見張りが CoS に渡していないもの。
// 他の CoS 宛ての指示は入れない（宛先でない CoS は起こさない）。
export function messagesFor(items, chiefDir) {
  return items
    .filter((x) => x.kind === 'message' && x.status === 'open' && !x.deliveredAt && sameDir(x.chief?.dir, chiefDir))
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

// この CoS 宛ての、まだ ack していない指示（渡したかどうかは問わない）。
export function unackedFor(items, chiefDir) {
  return items.filter((x) => x.kind === 'message' && x.status === 'open' && sameDir(x.chief?.dir, chiefDir));
}

// 見張りの出来事（指示が届いた）。
export function messageEvent(item) {
  return { event: 'message', id: item.id, title: item.title, text: item.body, at: item.createdAt };
}

// 返事の choice の、人が読む名前（承認・差し戻し／やった・できない／選択肢のラベル）。無ければ null。
export function answerLabel(item) {
  const c = item.answer?.choice ?? null;
  if (c === null) return null;
  if (item.kind === 'review') return REVIEW_LABEL[c] ?? c;
  if (item.kind === 'todo') return TODO_LABEL[c] ?? c;
  return item.options?.find((o) => o.key === c)?.label ?? null;
}

// 項目が古くなっているか（未対応の要返事・やることが STALE_ASK_DAYS 日以上残っている＝赤く出す）。
export function isStaleItem(item, nowMs = Date.now(), days = STALE_ASK_DAYS) {
  return (item.kind === 'ask' || item.kind === 'todo') && item.status === 'open' && nowMs - Date.parse(item.createdAt) >= days * 86400000;
}

// cos tell の題と本文に、ユーザーに作業や返事を求める言い回しがあるか。見つけたものを [{ phrase, line, soft? }] で返す（無ければ空）。
// soft が付いたもの（番号付きの行動の並び）は誤検知が多いので、cos tell は止めずに注意だけ出す。
// 引用（> で始まる行・「」『』の中）とコード（``` の囲みと ` の中）は見ない。
export function tellMisuse(title, body) {
  const hits = [];
  const numbered = [];
  let fence = false;
  for (const raw of `${title ?? ''}\n${body ?? ''}`.split('\n')) {
    if (/^\s*(?:```|~~~)/.test(raw)) {
      fence = !fence;
      continue;
    }
    if (fence || /^\s*>/.test(raw)) continue;
    const line = raw.replace(/`[^`]*`/g, ' ').replace(/「[^」]*」|『[^』]*』/g, ' ');
    if (TELL_NUMBERED_ACTION.test(line.replace(/[。.\s]+$/, '').replace(/(?:（[^（）]*）|\([^()]*\))$/, '').trimEnd())) numbered.push(raw.trim());
    for (const [re, phrase] of TELL_REQUEST_PHRASES) {
      if (re.test(line)) {
        hits.push({ phrase, line: raw.trim() });
        break;
      }
    }
  }
  if (numbered.length >= 2) hits.push({ phrase: '番号付きの行動の並び', line: numbered.join(' ／ '), soft: true });
  return hits;
}

// 見張りの出来事（cos watch が出す1行）。
export function answeredEvent(item) {
  const c = item.answer?.choice ?? null;
  const label = answerLabel(item);
  return { event: 'answered', id: item.id, kind: item.kind, worker: item.worker ?? undefined, title: item.title, choice: c, label: label ?? undefined, text: item.answer?.text ?? undefined, at: item.answer?.at };
}

// ───── スレッド（1つの指示から続く項目のつながり） ─────

// この CoS 宛ての指示のうち、続きがまだ出そうなもの（新しい順）:
// CoS が読んでいて（ack 済み）、届いてから hours 時間以内で、返事がまだ無いか「受け取りました・始めました」の tell だけのもの。
// 要返事・確認依頼・やることが --reply-to 付きで出ていれば、その指示は結果まで届いているとみなして入れない。取り下げた返事は数えない。
export function pendingThreads(items, chiefDir, nowMs = Date.now(), hours = THREAD_HINT_HOURS) {
  return items
    .filter((m) => m.kind === 'message' && m.status === 'read' && nowMs - Date.parse(m.createdAt) < hours * 3600000 && sameDir(m.chief?.dir, chiefDir))
    .filter((m) => items.every((x) => x.replyTo !== m.id || x.status === 'withdrawn' || x.kind === 'tell'))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

// --reply-to を付け忘れていそうなときの注意の文（無ければ null）。what は「この項目」「この作業セッション」など。
export function threadHint(items, chiefDir, what, nowMs = Date.now()) {
  const ms = pendingThreads(items, chiefDir, nowMs);
  if (ms.length === 0) return null;
  const list = ms.slice(0, 3).map((m) => `  ・${m.id}「${m.title}」`).join('\n');
  return `注意: ${what}が次の指示の続きなら、--reply-to <指示の id> を付けてください（付けないと、画面で元の指示とつながらず、別々の項目に見えます）:\n${list}${ms.length > 3 ? `\n  ほか ${ms.length - 3} 件` : ''}`;
}

// 同じ CoS が、同じ種類・同じ題・同じ作業セッションで出した未対応の項目（いちばん新しいもの。無ければ null）。
// cos ask などが、--supersedes の付け忘れで同じ問いが2つ並ぶのを防ぐために使う。
export function duplicateOpen(items, { chiefDir, kind, title, worker = null }) {
  const t = String(title ?? '').trim();
  return items
    .filter((x) => x.status === 'open' && x.kind === kind && x.title === t && (x.worker ?? null) === (worker ?? null) && sameDir(x.chief?.dir, chiefDir))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0] ?? null;
}

// --reply-to に書ける指示か確かめて返す（この CoS 宛ての message だけ）。
export function replyTarget(dir, id, chiefDir) {
  const msg = getItem(dir, id);
  if (msg.kind !== 'message') throw new InboxError(400, `${msg.id} はユーザーからの指示ではありません（--reply-to は指示の id）`);
  if (!sameDir(msg.chief?.dir, chiefDir)) throw new InboxError(400, `${msg.id} は別の CoS（${msg.chief?.name}）宛ての指示です`);
  return msg;
}

// 並び: 要返事 → 確認依頼 → やること → 読むだけ。各群の中は古い順（待たせている順）。
export function sortInbox(items) {
  return [...items].sort((a, b) => (SORT_ORDER[a.kind] ?? 9) - (SORT_ORDER[b.kind] ?? 9) || String(a.createdAt).localeCompare(String(b.createdAt)));
}

export function openCounts(items) {
  const c = { ask: 0, review: 0, todo: 0, tell: 0 };
  for (const x of items) if (x.status === 'open' && Object.hasOwn(c, x.kind)) c[x.kind]++;
  return c;
}

// 返事待ち（open な ask・review・todo）が上限を超えているか（cos spawn の警告）。
export function overLimit(items, max) {
  const c = openCounts(items);
  const n = WAITING_KINDS.reduce((a, k) => a + c[k], 0);
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
// kind "message"・"todo" と replyTo・repo は足しただけ（前からある項目の読み方は変わらない）ので v は 1 のまま。
// v を上げるのは、前からある項目の読み方が変わるときだけ（上げると、古い版は新しい項目を全部読み飛ばす）。
export function upgradeItem(j) {
  if (!j || typeof j !== 'object') throw new InboxError(400, '項目が JSON のオブジェクトではありません');
  switch (j.v) {
    case 1:
      return j;
    default:
      throw new InboxError(400, `この版では読めない形です（v: ${JSON.stringify(j.v)}）`);
  }
}

// 新しい要返事・確認依頼・やることを知らせるコマンド（herdr の通知と macOS の通知の両方を出す）。
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
    // 返事の元の指示（--reply-to）: この CoS 宛ての指示だけ。まだ既読でなければ、返事を出した時点で既読にする。
    const msg = item.replyTo ? replyTarget(dir, item.replyTo, item.chief.dir) : null;
    if (item.supersedes) {
      const old = getItem(dir, item.supersedes);
      if (!sameDir(old.chief?.dir, item.chief.dir)) throw new InboxError(400, `${old.id} は別の CoS（${old.chief?.name}）の項目なので置き換えられません`);
      writeItem(dir, applyWithdraw(old, item.createdAt, { supersededBy: item.id }));
    }
    if (msg?.status === 'open') writeItem(dir, applyAck(msg, item.createdAt));
    // 同じ指示への前の「読むだけ」（受け取りました・始めました）は、続きが出た時点で既読にする（画面ではスレッドの中に小さく残る）。
    if (msg) {
      for (const x of listItems(dir).items) {
        if (x.replyTo === msg.id && x.kind === 'tell' && x.status === 'open' && x.id !== item.supersedes) writeItem(dir, { ...applyRead(x, item.createdAt), readVia: 'thread' });
      }
    }
    writeItem(dir, item);
    return item;
  });
}

// 指示を作る（画面の API から）。chief は宛先の CoS（listChiefs の1件）。
export function createMessage(dir, { chief, text, worker = null }, opts = {}) {
  return withInboxLock(dir, () => {
    let item = buildMessage({ chief, text, worker }, opts);
    for (let i = 0; existsSync(join(dir, `${item.id}.json`)); i++) {
      if (i > 20) throw new InboxError(409, `受け箱に ${item.id} がもうあります`);
      item = buildMessage({ chief, text, worker }, { ...opts, rand: Math.random });
    }
    writeItem(dir, item);
    return item;
  });
}

// CoS が指示を読んだ印を付ける。chiefDir を渡すと、その CoS 宛てでなければ断る。
export function ackItem(dir, id, { chiefDir = null } = {}) {
  return mutate(dir, id, (x) => {
    if (chiefDir && !sameDir(x.chief?.dir, chiefDir)) throw new InboxError(400, `${x.id} は別の CoS（${x.chief?.name}）宛てです（それでも既読にするなら --force）`);
    return applyAck(x);
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

// 新しい要返事・確認依頼・やることを知らせる。失敗しても投げない。COS_INBOX_NOTIFY=0 で出さない（試験用）。
export function notifyNew(item, env = process.env) {
  if (env.COS_INBOX_NOTIFY === '0' || !WAITING_KINDS.includes(item.kind)) return [];
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

// ───────── CoS の記録（~/.cos/chiefs/<鍵>.json） ─────────
// 画面が「どの CoS がどこにいるか」を知るための記録。CoS だけが打つコマンド（cos watch・ask / review / todo / tell・inbox ack・spawn）と
// cos chief の起動フックが書く。サーバーは読むだけ。1つの CoS に1ファイル（鍵は CoS のディレクトリのハッシュ）。
//   { v, name, dir, stateDir, retroIntervalDays, seenAt, via, watch: { pid, startedAt, beatAt } | null, watchEndedAt }

function realDir(p) {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
}

export function chiefKey(dir) {
  return createHash('sha1').update(realDir(dir)).digest('hex').slice(0, 16);
}

function chiefFile(cdir, dir) {
  return join(cdir, `${chiefKey(dir)}.json`);
}

// 記録を書き足す。patch は関数（今の記録 → 新しい記録）でもよい。失敗しても投げない（記録のせいでコマンドを止めない）。
export function noteChief(cdir, chief, patch = {}) {
  try {
    mkdirSync(cdir, { recursive: true });
    const file = chiefFile(cdir, chief.dir);
    let cur = {};
    try {
      cur = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      // 無い・壊れているなら作り直す
    }
    const base = { ...cur, v: 1, name: String(chief.name), dir: realDir(chief.dir), seenAt: new Date().toISOString() };
    const next = typeof patch === 'function' ? patch(base) : { ...base, ...patch };
    const tmp = `${file}.tmp-${process.pid}`;
    writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`);
    renameSync(tmp, file);
    return next;
  } catch {
    return null;
  }
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

// 見張りが動いているか（pid が生きていて、印が新しい）。
export function watchAlive(rec, nowMs = Date.now(), alive = pidAlive) {
  const w = rec?.watch;
  if (!w?.pid || !w.beatAt) return false;
  return nowMs - Date.parse(w.beatAt) < WATCH_BEAT_STALE_SEC * 1000 && alive(w.pid);
}

// 記録されている CoS（ディレクトリが残っているものだけ・名前順）。
export function listChiefs(cdir, { nowMs = Date.now(), alive = pidAlive, exists = existsSync } = {}) {
  let names = [];
  try {
    names = readdirSync(cdir);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  const out = [];
  for (const n of names) {
    if (n.startsWith('.') || !n.endsWith('.json')) continue;
    try {
      const j = JSON.parse(readFileSync(join(cdir, n), 'utf8'));
      if (!j?.name || !j?.dir || !exists(j.dir)) continue;
      const on = watchAlive(j, nowMs, alive);
      out.push({
        name: j.name, dir: j.dir, stateDir: j.stateDir ?? null, retroIntervalDays: j.retroIntervalDays ?? null, seenAt: j.seenAt ?? null,
        watch: { alive: on, since: on ? j.watch.startedAt ?? null : null, lastAt: on ? j.watch.beatAt : j.watchEndedAt ?? j.watch?.beatAt ?? null },
      });
    } catch {
      // 読めない記録は飛ばす
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name) || a.dir.localeCompare(b.dir));
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

// API の1回の呼び出し。返すのは { status, json } か { status, text, type, headers? }。ネットワークを通さず試せるように http から切り離してある。
//   GET  /api/items[?status=open]         全部（未対応を並び順で先に、済んだものは新しい順）
//   GET  /api/items/:id
//   GET  /api/items/:id/links/:n          項目のリンクが指す手元のファイルの中身（項目に書かれたファイルだけ。.html は sandbox 付きの HTML、写真は画像、ほかはテキスト）
//   POST /api/items/:id/answer  { choice, text }   ask は選択肢の key、review は approve / reject、todo は done / cannot
//   POST /api/items/:id/read
//   GET  /api/chiefs                      記録されている CoS と今の状況（作業セッション・見張り・振り返りの期限・未読の指示）
//   POST /api/messages  { to, text, worker? }   CoS 宛ての指示を作る（to は GET /api/chiefs の dir。worker は作業セッションの質問への答えのとき）
//   GET  /api/todos                       TODO ファイル（cos.json の todoFiles）を持つ CoS と、その行（未完了は期日の近い順・済は最後）
//   POST /api/todos  { to, text, due?, note?, file? }      TODO に1行足す（to は GET /api/chiefs の dir。期日は due か、text の文頭から拾う）
//   POST /api/todos/done  { to, file, id, done, note? }    行を済にする（done: true）・未完了に戻す（false）
//   GET  /api/events                      （serveInbox が出す）押し出し。SSE で、受け箱か TODO ファイルが変わるたびに `change` が届く
// chiefs は記録されている CoS を返す関数（既定は listChiefs）。chiefStatus は CoS 1件 → 状況（cos.mjs が台帳を読んで作る。無ければ状況なし）。
// todoFiles は CoS 1件 → TODO ファイルの絶対パス（既定はその CoS の .claude/cos.json の todoFiles）。today はローカルの今日（YYYY-MM-DD）。
export function handleApi(dir, method, pathname, {
  query = new URLSearchParams(), body = null, chiefs = () => listChiefs(chiefsDir()), chiefStatus = null,
  todoFiles = (c) => todoFilesOf(c.dir, homedir()), today = localDay(Date.now()), commit = true,
} = {}) {
  try {
    const seg = pathname.split('/').filter(Boolean).map(decodeURIComponent);
    if (seg[0] === 'api' && seg[1] === 'todos') {
      if (seg.length === 2 && method === 'GET') {
        const { items } = listItems(dir);
        return { status: 200, json: { v: INBOX_V, now: new Date().toISOString(), today, chiefs: todoBoards(chiefs(), todoFiles, today, items) } };
      }
      if (method !== 'POST' || seg.length > 3 || (seg.length === 3 && seg[2] !== 'done')) throw new InboxError(seg.length > 3 ? 404 : 405, 'そういう API はありません');
      const chief = chiefs().find((c) => sameDir(c.dir, body?.to));
      if (!chief) throw new InboxError(400, `CoS が見つかりません（to は GET /api/todos の dir）: ${body?.to ?? '(なし)'}`);
      const files = todoFiles(chief);
      if (files.length === 0) throw new InboxError(400, `${chief.name} には TODO ファイルがありません（.claude/cos.json の todoFiles）`);
      // 書き換えられるのは、その CoS の todoFiles に書かれたファイルだけ
      const file = body?.file ? files.find((f) => f === body.file) : files[0];
      if (!file) throw new InboxError(400, `${chief.name} の TODO ファイルではありません: ${body.file}`);
      const r = seg.length === 2
        ? addTodoToFile(file, { title: body?.text, due: body?.due ?? null, note: body?.note ?? null }, { today, commit })
        : setTodoDoneInFile(file, body?.id, body?.done !== false, { today, note: body?.note ?? null, commit });
      return { status: 200, json: { file, changed: r.changed, commit: r.commit, todo: publicTodo(r.todo, today) } };
    }
    if (seg[0] === 'api' && seg[1] === 'chiefs' && seg.length === 2) {
      if (method !== 'GET') throw new InboxError(405, 'そういう API はありません');
      const { items } = listItems(dir);
      return {
        status: 200,
        json: {
          v: INBOX_V,
          now: new Date().toISOString(),
          chiefs: chiefs().map((c) => {
            let st = {};
            try {
              st = chiefStatus ? chiefStatus(c) : {};
            } catch (e) {
              st = { error: String(e.message ?? e) };
            }
            return { name: c.name, dir: c.dir, seenAt: c.seenAt, watch: c.watch, unread: unackedFor(items, c.dir).length, workers: [], retro: null, error: null, ...st };
          }),
        },
      };
    }
    if (seg[0] === 'api' && seg[1] === 'messages' && seg.length === 2) {
      if (method !== 'POST') throw new InboxError(405, 'そういう API はありません');
      const chief = chiefs().find((c) => sameDir(c.dir, body?.to));
      if (!chief) throw new InboxError(400, `宛先の CoS が見つかりません（to は GET /api/chiefs の dir）: ${body?.to ?? '(なし)'}`);
      return { status: 200, json: publicItem(createMessage(dir, { chief, text: body?.text, worker: body?.worker || null })) };
    }
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
          waiting: overLimit(items, 0).n,
          unreadMessages: items.filter((x) => x.kind === 'message' && x.status === 'open').length,
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
      // .html / .htm は HTML として出す（sandbox 付き＝受け箱のオリジンでは動かさない）。ほかはテキスト。
      if (/\.html?$/i.test(file)) return { status: 200, text: readFileSync(file, 'utf8'), type: 'text/html; charset=utf-8', headers: { 'Content-Security-Policy': LINK_HTML_CSP } };
      // 写真（.png / .jpg / .jpeg / .gif / .webp）は画像のまま出す（テキストにすると文字化けしたバイナリが出る）。.svg はスクリプトを持てるのでテキストのまま。
      const imageType = LINK_IMAGE_TYPES[extname(file).toLowerCase()];
      if (imageType) return { status: 200, text: readFileSync(file), type: imageType };
      return { status: 200, text: readFileSync(file, 'utf8'), type: 'text/plain; charset=utf-8' };
    }
    if (seg.length === 4 && method === 'POST' && seg[3] === 'answer') {
      const done = answerItem(dir, id, { choice: body?.choice ?? null, text: body?.text ?? null, via: 'ui' });
      closeTodoLine(done, { today, commit });
      return { status: 200, json: publicItem(done) };
    }
    if (seg.length === 4 && method === 'POST' && seg[3] === 'read') return { status: 200, json: publicItem(readItem(dir, id)) };
    throw new InboxError(seg.length >= 3 ? 405 : 404, 'そういう API はありません');
  } catch (e) {
    if (e instanceof InboxError || e instanceof TodoError) return { status: e.status, json: { error: e.message } };
    return { status: 500, json: { error: String(e.message ?? e) } };
  }
}

// ───────── TODO ファイル（cos.json の todoFiles） ─────────
// 本体は todofile.mjs（cos todo-file と同じ関数）。ここは、どの CoS がどのファイルを持つかと、画面に渡す形だけ。

function localDay(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// 画面に渡す行。state は overdue（締切を過ぎた）・today（締切が今日）・startable（着手日が来た）・future・noted（起きた日だけ）・
// anytime・unreadable（読めない行）・done。dueKind は after（着手日）・deadline（締切）・since（起きた日）・null。
export function publicTodo(t, today) {
  return {
    id: t.id, n: t.n, done: t.done, state: t.done ? 'done' : dueState(t, today), due: t.due, dueKind: t.dueKind, dueText: t.dueText, title: t.title, note: t.note,
    doneOn: t.doneOn, doneNote: t.doneNote, items: [],
  };
}

// TODO ファイルを持つ CoS と、その行。items は受け箱の項目（todoLine でその行から出た、未対応の「やること」などをつなぐ）。
// 読めないファイルは error を入れて出す（消えた・権限が無い）。
export function todoBoards(chiefList, todoFiles, today, items = [], read = (f) => readFileSync(f, 'utf8')) {
  const out = [];
  for (const c of chiefList) {
    const files = todoFiles(c);
    if (files.length === 0) continue;
    const linked = items.filter((x) => x.todoLine && x.status === 'open' && sameDir(x.chief?.dir, c.dir));
    out.push({
      name: c.name,
      dir: c.dir,
      files: files.map((path) => {
        const label = path.startsWith(c.dir + sep) ? path.slice(c.dir.length + 1) : basename(path);
        try {
          const todos = sortTodos(parseTodos(read(path), today).todos, today).map((t) => ({
            ...publicTodo(t, today),
            items: linked.filter((x) => x.todoLine.id === t.id && x.todoLine.file === path).map((x) => x.id),
          }));
          return { path, label, error: null, todos };
        } catch (e) {
          return { path, label, error: String(e.code || e.message), todos: [] };
        }
      }),
    });
  }
  return out;
}

// 「やること」に「やった」と返したら、もとになった TODO の行（todoLine）も済にする。できなくても返事は付いている（投げない）。
export function closeTodoLine(item, { today = localDay(Date.now()), commit = true } = {}) {
  if (item?.kind !== 'todo' || item.answer?.choice !== 'done' || !item.todoLine) return null;
  try {
    return setTodoDoneInFile(item.todoLine.file, item.todoLine.id, true, { today, note: item.answer.text ?? null, commit });
  } catch {
    return null;
  }
}

// cos todo --todo-line <id か番号>: その CoS の TODO ファイルから行を探して、項目に持たせる形にする。
export function todoLineRef(files, key, today, read = (f) => readFileSync(f, 'utf8')) {
  const hits = [];
  for (const file of files) {
    try {
      const t = findTodo(parseTodos(read(file), today).todos, key);
      hits.push({ file, id: t.id, title: t.title });
    } catch {
      // このファイルには無い
    }
  }
  if (hits.length !== 1) throw new InboxError(400, hits.length ? `--todo-line ${key} は複数の TODO ファイルにあります（id で指す）` : `--todo-line ${key} の行が TODO ファイルにありません（cos todo-file list で見直す）`);
  return hits[0];
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8',
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
export function serveInbox({ dir, port = INBOX_DEFAULT_PORT, uiDir, host = '127.0.0.1', chiefs = undefined, chiefStatus = null }) {
  const allowed = () => new Set([`127.0.0.1:${server.address().port}`, `localhost:${server.address().port}`]);
  const send = (res, status, body, type, headers = {}) => {
    res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
    res.end(body);
  };
  const sendJson = (res, status, json) => send(res, status, JSON.stringify(json), 'application/json; charset=utf-8');
  // 押し出し（SSE）。つないでいる画面の全部に、受け箱が変わるたびに change を送る。画面は受け取ったら全件を取り直す。
  const clients = new Set();
  let rev = 0;
  const push = (res, event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const changed = () => {
    rev++;
    for (const res of clients) push(res, 'change', { rev });
  };
  const stopWatch = watchInbox(dir, changed);
  // TODO ファイル（CoS がコマンドで・ユーザーが手で書き換える）の変更も同じ change で知らせる
  const stopTodoWatch = watchTodoFiles(() => (chiefs ?? (() => listChiefs(chiefsDir())))().flatMap((c) => todoFilesOf(c.dir, homedir())), changed);
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
        const r = handleApi(dir, 'GET', url.pathname, { query: url.searchParams, chiefs, chiefStatus });
        return r.json ? sendJson(res, r.status, r.json) : send(res, r.status, r.text, r.type, r.headers);
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
        const r = handleApi(dir, 'POST', url.pathname, { body, chiefs, chiefStatus });
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
    stopTodoWatch();
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

// ───────── 画面を launchd で常に動かす（macOS） ─────────

export const SERVICE_LABEL = 'local.cos-inbox';

// LaunchAgent の plist。node と cos.mjs は渡されたパスのまま書く（symlink 経由＝dotfiles を更新したら、サービスを再起動すれば新しい版になる）。
// RunAtLoad でログイン時に起動し、KeepAlive で落ちても起こし直す（ポートが使われているときは ThrottleInterval ごとに試し直し、理由がログに残る）。
export function servicePlist({ label = SERVICE_LABEL, node, script, port = INBOX_DEFAULT_PORT, log, home, inboxDir: dir = null }) {
  const x = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const str = (s) => `<string>${x(s)}</string>`;
  const env = dir ? `  <key>EnvironmentVariables</key>\n  <dict>\n    <key>COS_INBOX_DIR</key>\n    ${str(dir)}\n  </dict>\n` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  ${str(label)}
  <key>ProgramArguments</key>
  <array>
    ${[node, script, 'inbox', 'serve', '--port', String(port)].map(str).join('\n    ')}
  </array>
${env}  <key>WorkingDirectory</key>
  ${str(home)}
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>30</integer>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  ${str(log)}
  <key>StandardErrorPath</key>
  ${str(log)}
</dict>
</plist>
`;
}

// PATH の最初の node（symlink をたどらない＝node を上げても plist を書き直さなくてよい）。無ければ null。
export function nodeOnPath(pathEnv, exists = existsSync) {
  for (const d of String(pathEnv ?? '').split(':')) {
    if (d && isAbsolute(d) && exists(join(d, 'node'))) return join(d, 'node');
  }
  return null;
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

  // やること（todo）: やった（一言は任意）・できない（コメント必須）
  const todo = buildItem({ kind: 'todo', chief: A, worker: 'w1', title: 'API を有効にして試す', body: 'b' }, { nowMs: T0 + 1500 });
  assert(todo.kind === 'todo' && todo.v === 1 && todo.status === 'open' && todo.options === null && todo.recommend === null && todo.freeText === null, 'inbox: todo の形（選択肢を持たない）');
  assert(throws(() => buildItem({ kind: 'todo', chief: A, title: 'x', options: [{ key: 'a', label: 'A' }] }), 400) && throws(() => buildItem({ kind: 'toString', chief: A, title: 'x' }), 400), 'inbox: todo は選択肢を持てない・知らない種類は断る');
  const t1 = applyAnswer(todo, { choice: 'done', via: 'ui' }, 'T');
  const t2 = applyAnswer(todo, { choice: 'やった', text: ' 動きました ' }, 'T');
  assert(t1.status === 'answered' && t1.answer.choice === 'done' && t1.answer.text === null && t2.answer.choice === 'done' && t2.answer.text === '動きました' && todo.status === 'open', 'inbox: やった（一言は任意）');
  const t3 = applyAnswer(todo, { choice: 'cannot', text: '権限が無い' }, 'T');
  assert(t3.answer.choice === 'cannot' && t3.answer.text === '権限が無い' && applyAnswer(todo, { choice: 'できない', text: 'x' }).answer.choice === 'cannot', 'inbox: できない（コメント付き）');
  assert(throws(() => applyAnswer(todo, { choice: 'cannot' }), 400) && throws(() => applyAnswer(todo, { choice: 'cannot', text: '  ' }), 400), 'inbox: できないはコメント必須');
  assert(throws(() => applyAnswer(todo, {}), 400) && throws(() => applyAnswer(todo, { text: '文章だけ' }), 400) && throws(() => applyAnswer(todo, { choice: 'approve' }), 400) && throws(() => applyAnswer(todo, { choice: 'constructor' }), 400), 'inbox: todo への返事は done か cannot だけ');
  assert(throws(() => applyAnswer(t1, { choice: 'done' }), 409) && throws(() => applyRead(todo), 400) && throws(() => applyAck(todo), 400), 'inbox: 返事済みの todo には返せない・既読／ack では終わらない');
  const te = answeredEvent(t3);
  assert(te.event === 'answered' && te.kind === 'todo' && te.choice === 'cannot' && te.label === 'できない' && te.text === '権限が無い' && te.worker === 'w1' && answeredEvent(t1).label === 'やった' && answeredEvent(t1).text === undefined, `inbox: todo の出来事 ${JSON.stringify(te)}`);
  assert(answeredFor([t1, todo], '/r/main').map((x) => x.id).join() === t1.id && answeredFor([t1], '/r/it').length === 0 && answeredFor([{ ...t1, deliveredAt: 'T' }], '/r/main').length === 0, 'inbox: todo の答えは出した CoS だけを起こす・一度だけ');
  const DAY = 86400000;
  assert(isStaleItem(todo, T0 + 1500 + 3 * DAY) && isStaleItem(ask, T0 + 3 * DAY) && !isStaleItem(todo, T0 + 2 * DAY) && !isStaleItem(t1, T0 + 9 * DAY) && !isStaleItem(review, T0 + 9 * DAY) && !isStaleItem(tell, T0 + 9 * DAY), 'inbox: 何日も残った要返事・やることは赤くする');

  // cos tell の誤用（ユーザーに作業や返事を求める言い回し）: 止める・引用とコードは見ない
  const mis = (b, t = '題') => tellMisuse(t, b).filter((h) => !h.soft).length;
  const soft = (b) => tellMisuse('題', b).filter((h) => h.soft).length;
  // 実際にあった誤用の形: 「推奨」の見出しの下にユーザーが選ぶ行動が番号付きで並び、「一言ください」で締める（お願いします・してください は無い）
  const picks = '調べた結果、外からのログインは見つかりませんでした。\n\n## 推奨（急ぎではない）\n\n1. 担当の方に一言聞く\n2. 気になるならパスワードを変える\n3. 運用を担当者と決める\n\n何か頼みたいことがあれば、画面から CoS に一言ください';
  assert(mis(picks) === 2 && soft(picks) === 1 && tellMisuse('題', picks).find((h) => h.soft).line.includes('パスワードを変える'), `inbox tell: 推奨の見出し＋番号付きの行動＋一言ください は止める ${JSON.stringify(tellMisuse('題', picks))}`);
  assert(mis('推奨: 案 A') === 1 && mis('**おすすめ**\n案 B') === 1 && mis('### 次の一手') === 1 && mis('- やること: 鍵を作り直す') === 1 && mis('【判断】残すか消すか') === 1 && mis('決めてもらうこと: 期日') === 1 && mis('選んでもらう案は2つ') === 1, 'inbox tell: 行頭の 推奨・おすすめ・次の一手・やること・判断・決めて・選んで');
  assert(mis('前回の推奨どおりに直しました') === 0 && mis('やることは全部終わりました') === 0 && mis('判断の根拠は報告書にあります') === 0 && mis('3つの案から A を選んで実装しました') === 0, 'inbox tell: 行頭でない・見出しでない語は止めない');
  assert(mis('このまま残すか') === 1 && mis('- 先に B を直しますか') === 1 && mis('どちらにするか。') === 1 && mis('どうするかは来週決めます') === 0 && mis('頼みたいことがあれば画面からどうぞ') === 1 && mis('一言もらえれば進めます') === 1, 'inbox tell: 〜するか・〜しますか で終わる問い／頼みたいことがあれば・一言');
  assert(soft('1. 鍵を作り直す\n2. 設定を書き換える（5分）\n3. 再起動する。') === 1 && mis('1. 鍵を作り直す\n2. 設定を書き換える') === 0 && soft('1. 鍵を作り直す') === 0 && soft('1. 鍵を作り直した\n2. 設定を書き換えた') === 0 && soft('1. 3件\n2. 5件') === 0, 'inbox tell: 番号付きの行動の並びは注意だけ（soft）・過去形や名詞の並びは当てない');
  assert(mis('People API を有効にしてください') === 1 && mis('有効にしたら知らせて。') === 1 && mis('あなたがすること: コンソールで有効にする') === 1 && mis('試す前に API を有効にする必要があります') === 1, 'inbox tell: 作業を求める言い回しを見つける');
  assert(mis('確認をお願いします') === 1 && mis('結果を教えてください') === 1 && mis('ご確認ください') === 1 && mis('この方針で進めますか？') === 1 && mis('一度試してみて') === 1 && mis('見てほしい点が2つあります') === 1 && mis('本文', '設定をお願いします') === 1, 'inbox tell: 返事を求める言い回し・題も見る');
  assert(mis('マージしました。テストは全部通っています。\n次は B に着手します。') === 0 && mis('利用者に教えてもらった手順で直しました') === 0 && mis('3件を取り込みました（PR #12）') === 0, 'inbox tell: 普通の報告は止めない');
  assert(mis('> People API を有効にしてください\n\nと依頼されたので、有効にしました。') === 0 && mis('  > 教えてください\nに答えます') === 0, 'inbox tell: 引用（> の行）は見ない');
  assert(mis('文言を `保存してください` に変えました') === 0 && mis('```\necho "入力してください"\n```\n上のとおり直しました') === 0 && mis('~~~\nお願いします\n~~~') === 0, 'inbox tell: コードの中は見ない');
  assert(mis('ユーザーの「有効にしてください」という指示に応えました') === 0 && mis('『お願いします』の表記を直した') === 0 && mis('ボタン「保存」を押してください') === 1, 'inbox tell: 「」『』の中は見ない（外は見る）');
  assert(mis('```\nコード\n```\nこのあと確認してください\n> 引用\nもう一度お願いします') === 2 && tellMisuse('題', '有効にしてください')[0].line === '有効にしてください' && typeof tellMisuse('題', '有効にしてください')[0].phrase === 'string', 'inbox tell: 見つけた行と言い回しを返す');
  assert(TELL_REQUEST_PHRASES.every(([re, name]) => re instanceof RegExp && !re.global && typeof name === 'string'), 'inbox tell: 言い回しの一覧の形');

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
  assert(sortInbox([tell, todo, review, ask, old]).map((x) => x.title).join() === '古い,どれにするか,PR を見て,API を有効にして試す,終わりました', 'inbox: 要返事 → 確認 → やること → 読むだけ・古い順');
  assert(JSON.stringify(openCounts([ask, old, review, tell, a1, r1, todo, t1])) === JSON.stringify({ ask: 2, review: 1, todo: 1, tell: 1 }), 'inbox: 件数は未対応だけ');
  assert(overLimit([ask, old, review, tell], 3).over === false && overLimit([ask, old, review, tell], 2).over === true && overLimit([ask, old, review], 0).over === false && overLimit([ask, old, review, tell], 2).n === 3, 'inbox: 上限は ask+review+todo・0 なら見ない');
  assert(overLimit([ask, review, todo, tell], 2).n === 3 && overLimit([ask, review, todo, tell], 2).over === true && overLimit([ask, review, t1, tell], 2).n === 2, 'inbox: 終わっていない todo は返事待ちに数える');

  // 取り込み待ちの確認依頼は、同じ作業セッションに一度だけ
  const sr = { ...review, tag: 'stale-done:w1' };
  const workers = { w1: { createdAt: '2026-11-20T00:00:00Z' }, w2: { createdAt: '2026-11-20T00:00:00Z' } };
  const stale = [{ id: 'w1', ms: 1 }, { id: 'w2', ms: 1 }];
  assert(staleReviewTargets(stale, [sr], '/r/main', workers).map((x) => x.id).join() === 'w2', 'inbox: 出し済みの取り込み待ちは出さない');
  assert(staleReviewTargets(stale, [applyAnswer(sr, { choice: 'approve' })], '/r/main', workers).map((x) => x.id).join() === 'w2', 'inbox: 答えが付いた後も出し直さない');
  assert(staleReviewTargets(stale, [sr], '/r/it', workers).length === 2, 'inbox: 他の CoS が出した分は数えない');
  assert(staleReviewTargets(stale, [sr], '/r/main', { ...workers, w1: { createdAt: '2026-11-26T00:00:00Z' } }).length === 2, 'inbox: 同じ ID を立て直したら出し直す');

  // ユーザーからの指示（message）: 宛先の CoS だけ起きる・ack・読んだら二度出ない
  const m1 = buildMessage({ chief: A, text: ' デプロイの状況を教えて \n細かいことは後で ' }, { nowMs: T0 + 3000 });
  assert(m1.kind === 'message' && m1.status === 'open' && m1.title === 'デプロイの状況を教えて' && m1.body === 'デプロイの状況を教えて \n細かいことは後で' && m1.chief.dir === '/r/main' && m1.chief.session === null && m1.v === 1, `inbox: 指示の形 ${JSON.stringify(m1)}`);
  assert(messageTitle('あ'.repeat(80)).length === 61 && messageTitle('\n\n 二行目 \n') === '二行目', 'inbox: 指示の題は最初の行を縮める');
  assert(throws(() => buildMessage({ chief: A, text: '  ' }), 400) && throws(() => buildMessage({ chief: {}, text: 'x' }), 400) && throws(() => buildMessage({ chief: A, text: 'x'.repeat(MAX_MESSAGE_CHARS + 1) }), 400), 'inbox: 空・宛先なし・長すぎる指示は断る');
  const m2 = buildMessage({ chief: B, text: '経理IT 宛て' }, { nowMs: T0 + 4000 });
  assert(messagesFor([m1, m2, ask, a1], '/r/main').map((x) => x.id).join() === m1.id && messagesFor([m1, m2], '/r/it').map((x) => x.id).join() === m2.id && messagesFor([m1, m2], '/r/none').length === 0, 'inbox: message は宛先の CoS だけ起こす');
  assert(messagesFor([{ ...m1, deliveredAt: 'T' }], '/r/main').length === 0 && unackedFor([{ ...m1, deliveredAt: 'T' }, m2], '/r/main').length === 1, 'inbox: 渡した指示は二度出ない（未読としては数える）');
  const k1 = applyAck(m1, 'T');
  assert(k1.status === 'read' && k1.readAt === 'T' && applyAck(k1) === k1 && m1.status === 'open' && messagesFor([k1], '/r/main').length === 0 && unackedFor([k1], '/r/main').length === 0, 'inbox: ack で既読・二度目は変えない');
  assert(throws(() => applyAck(ask), 400) && throws(() => applyAck(tell), 400) && throws(() => applyAnswer(m1, { text: 'x' }), 400) && throws(() => applyRead(m1), 400), 'inbox: ack は指示だけ・指示には返事／既読（read）できない');
  const me = messageEvent(m1);
  assert(me.event === 'message' && me.id === m1.id && me.title === m1.title && me.text === m1.body && me.at === m1.createdAt, `inbox: 指示の出来事 ${JSON.stringify(me)}`);
  assert(answeredFor([m1, k1], '/r/main').length === 0 && JSON.stringify(openCounts([m1, ask])) === JSON.stringify({ ask: 1, review: 0, todo: 0, tell: 0 }) && overLimit([m1, m2], 1).n === 0, 'inbox: 指示は answered・ユーザーの未対応の件数に入らない');
  assert(sortInbox([m1, tell, todo, ask]).map((x) => x.kind).join() === 'ask,todo,tell,message', 'inbox: 指示は並びの最後');
  assert(buildItem({ kind: 'tell', chief: A, title: 'x', replyTo: 'm' }).replyTo === 'm' && !('replyTo' in tell), 'inbox: replyTo は付けたときだけ');

  // GitHub のリポジトリ（項目の repo）
  assert(githubRepoFromUrl('https://github.com/o-1/n.x.git') === 'o-1/n.x' && githubRepoFromUrl('git@github.com:o/n.git') === 'o/n' && githubRepoFromUrl('ssh://git@github.com/o/n') === 'o/n' && githubRepoFromUrl('https://user@github.com/o/n/') === 'o/n', 'inbox: origin の URL から owner/name');
  assert(githubRepoFromUrl('https://gitlab.com/o/n.git') === null && githubRepoFromUrl('git@example.com:o/n.git') === null && githubRepoFromUrl('https://github.com/o') === null && githubRepoFromUrl('https://github.com/o/n/x') === null && githubRepoFromUrl('') === null && githubRepoFromUrl(null) === null && githubRepoFromUrl('/local/path') === null, 'inbox: github.com 以外・読めない URL は null');
  assert(buildItem({ kind: 'tell', chief: A, title: 'x', repo: 'o/n' }).repo === 'o/n' && !('repo' in tell) && !('repo' in buildItem({ kind: 'tell', chief: A, title: 'x', repo: null })), 'inbox: repo は分かるときだけ持つ');
  assert(throws(() => buildItem({ kind: 'tell', chief: A, title: 'x', repo: 'o/n/x' }), 400) && throws(() => buildItem({ kind: 'tell', chief: A, title: 'x', repo: 'https://github.com/o/n' }), 400) && throws(() => buildItem({ kind: 'tell', chief: A, title: 'x', repo: 'o' }), 400), 'inbox: owner/name でない repo は断る');

  // CoS の記録と見張りの印
  const nowMs = Date.parse('2026-11-25T08:00:00Z');
  const rec = (sec, pid = 1) => ({ watch: { pid, startedAt: 'S', beatAt: new Date(nowMs - sec * 1000).toISOString() } });
  assert(watchAlive(rec(10), nowMs, () => true) && !watchAlive(rec(10), nowMs, () => false) && !watchAlive(rec(WATCH_BEAT_STALE_SEC + 1), nowMs, () => true) && !watchAlive({ watch: null }, nowMs, () => true) && !watchAlive({}, nowMs, () => true), 'inbox: 見張りは pid が生きていて印が新しいときだけ動いている');
  assert(chiefKey('/r/main') === chiefKey('/r/main') && chiefKey('/r/main') !== chiefKey('/r/it') && /^[0-9a-f]{16}$/.test(chiefKey('/r/main')), 'inbox: CoS の記録の鍵');
  assert(chiefsDir({ COS_CHIEFS_DIR: '/x/c' }) === '/x/c' && chiefsDir({ COS_INBOX_DIR: '/x/inbox' }) === '/x/inbox/.chiefs' && chiefsDir({}).endsWith('/.cos/chiefs'), 'inbox: CoS の記録の置き場所（受け箱を差し替えたらその中）');

  // 形の読み分け
  assert(upgradeItem(ask) === ask && throws(() => upgradeItem({ ...ask, v: 2 }), 400) && throws(() => upgradeItem({ id: 'x' }), 400) && throws(() => upgradeItem(null), 400), 'inbox: v が違う項目は読まない');

  // 知らせ
  const nc = notifyCommands(ask, 'darwin');
  assert(nc.length === 2 && nc[0][0] === 'herdr' && nc[0][1].join(' ') === 'notification show 要返事（cos-main） --body どれにするか --sound request' && nc[1][0] === 'osascript', `inbox: 知らせ ${JSON.stringify(nc)}`);
  assert(notifyCommands(review, 'linux').length === 1 && notifyNew(tell, {}).length === 0 && notifyNew(ask, { COS_INBOX_NOTIFY: '0' }).length === 0 && notifyNew(todo, { COS_INBOX_NOTIFY: '0' }).length === 0, 'inbox: tell は知らせない・止められる');
  assert(notifyCommands(todo, 'linux')[0][1].join(' ') === 'notification show やること（cos-main） --body API を有効にして試す --sound request', 'inbox: やることの知らせ');
  assert(notifyCommands({ ...ask, title: 'a"b\\c' }, 'darwin')[1][1][1].includes('"a\\"b\\\\c"'), 'inbox: 通知の文のエスケープ');

  // launchd の plist
  const pl = servicePlist({ node: '/n/bin/node', script: '/h/.claude/skills/chief-of-staff/scripts/cos.mjs', port: 7788, log: '/h/Library/Logs/cos-inbox.log', home: '/h' });
  assert(pl.includes('<string>local.cos-inbox</string>') && pl.includes('<string>/n/bin/node</string>\n    <string>/h/.claude/skills/chief-of-staff/scripts/cos.mjs</string>\n    <string>inbox</string>\n    <string>serve</string>\n    <string>--port</string>\n    <string>7788</string>'), 'inbox service: plist の起動の引数');
  assert(/<key>RunAtLoad<\/key>\s*<true\/>/.test(pl) && /<key>KeepAlive<\/key>\s*<true\/>/.test(pl) && pl.split('/h/Library/Logs/cos-inbox.log').length === 3 && !pl.includes('EnvironmentVariables'), 'inbox service: RunAtLoad・KeepAlive・ログ');
  const pl2 = servicePlist({ node: '/n/a&b/node', script: '/s', log: '/l', home: '/h', inboxDir: '/tmp/<x>' });
  assert(pl2.includes('/n/a&amp;b/node') && pl2.includes('<key>COS_INBOX_DIR</key>\n    <string>/tmp/&lt;x&gt;</string>'), 'inbox service: XML のエスケープ・受け箱の差し替え');
  assert(nodeOnPath('rel:/a:/b', (f) => f === '/b/node') === '/b/node' && nodeOnPath('/a', () => false) === null && nodeOnPath('', () => true) === null, 'inbox service: PATH の node');

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
    writeFileSync(join(dir, 'fig.HTML'), '<!doctype html><p>図</p>');
    const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x80, 0xfe]);
    writeFileSync(join(dir, 'shot.JPG'), jpg);
    const hv = createItem(dir, { kind: 'tell', chief: B, title: 'H1', links: [{ label: '説明', href: pathToFileURL(join(dir, 'fig.HTML')).href }, { label: 'メモ', href: pathToFileURL(join(dir, 'memo.txt')).href }, { label: '写真', href: pathToFileURL(join(dir, 'shot.JPG')).href }] });
    const hr = handleApi(dir, 'GET', `/api/items/${hv.id}/links/0`);
    const hp = handleApi(dir, 'GET', `/api/items/${hv.id}/links/1`);
    assert(hr.status === 200 && hr.type.startsWith('text/html') && hr.text.includes('<p>図</p>') && hr.headers['Content-Security-Policy'] === LINK_HTML_CSP && /^sandbox /.test(LINK_HTML_CSP) && LINK_HTML_CSP.includes('allow-scripts') && !LINK_HTML_CSP.includes('allow-same-origin'), 'inbox API: 手元の .html は sandbox 付きの HTML で出す（受け箱のオリジンでは動かさない）');
    assert(hp.type.startsWith('text/plain') && hp.headers === undefined, 'inbox API: .html 以外のファイルはテキストのまま');
    const ir = handleApi(dir, 'GET', `/api/items/${hv.id}/links/2`);
    assert(ir.status === 200 && ir.type === 'image/jpeg' && Buffer.isBuffer(ir.text) && ir.text.equals(jpg), 'inbox API: 手元の写真はバイナリのまま画像として出す');
    withdrawItem(dir, hv.id);
    writeFileSync(join(dir, 'broken.json'), '{');
    writeFileSync(join(dir, 'future.json'), JSON.stringify({ v: 99, id: 'future' }));
    const ls = listItems(dir);
    assert(ls.items.length === 6 && ls.skipped.length === 2, `inbox: 壊れた・読めない版のファイルは飛ばす ${ls.items.length}/${ls.skipped.length}`);
    assert(throws(() => getItem(dir, '../x'), 404) && throws(() => getItem(dir, 'nope'), 404), 'inbox: 無い id');

    const api = (m, p, o) => handleApi(dir, m, p, o);
    const all = api('GET', '/api/items').json;
    assert(all.v === 1 && all.items.length === 6 && all.skipped === 2 && JSON.stringify(all.counts) === JSON.stringify({ ask: 2, review: 1, todo: 0, tell: 1 }) && all.waiting === 3 && all.staleAskDays === 3, `inbox API: 一覧 ${JSON.stringify(all.counts)}`);
    assert(all.items.map((x) => x.status).join() === 'open,open,open,open,withdrawn,withdrawn' && all.items[0].kind === 'ask' && all.items[2].kind === 'review' && all.items[3].kind === 'tell', 'inbox API: 未対応を並び順で先に');
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

    // やること（todo）: 一覧の並びと件数・画面の API で返す・出した CoS の見張りだけが拾う
    const td1 = createItem(dir, { kind: 'todo', chief: { ...A, dir }, title: 'やること1' });
    const td2 = createItem(dir, { kind: 'todo', chief: B, title: '他の CoS のやること' });
    const tl2 = createItem(dir, { kind: 'tell', chief: B, title: 'T2' });
    const lt = api('GET', '/api/items').json;
    assert(lt.counts.todo === 2 && lt.counts.tell === 1 && lt.waiting === 2 && lt.items.filter((x) => x.status === 'open').map((x) => x.kind).join() === 'todo,todo,tell', `inbox API: やることは読むだけの前・返事待ちに数える ${JSON.stringify(lt.counts)}`);
    assert(api('POST', `/api/items/${td1.id}/read`).status === 400 && getItem(dir, td1.id).status === 'open', 'inbox API: やることは既読では終わらない');
    assert(api('POST', `/api/items/${td1.id}/answer`, { body: { choice: 'cannot' } }).status === 400 && api('POST', `/api/items/${td1.id}/answer`, { body: { text: '文章だけ' } }).status === 400 && api('POST', `/api/items/${td1.id}/answer`, { body: { choice: 'approve' } }).status === 400 && getItem(dir, td1.id).status === 'open', 'inbox API: できないはコメント必須・done か cannot だけ');
    const ta = api('POST', `/api/items/${td1.id}/answer`, { body: { choice: 'done', text: '有効にして、取得できた' } });
    assert(ta.status === 200 && ta.json.status === 'answered' && ta.json.answer.choice === 'done' && ta.json.answer.text === '有効にして、取得できた' && ta.json.answer.via === 'ui' && api('POST', `/api/items/${td1.id}/answer`, { body: { choice: 'done' } }).status === 409, 'inbox API: やった（一言つき）・二度目は 409');
    assert(answeredFor(listItems(dir).items, dir).map((x) => x.id).join() === td1.id && !answeredFor(listItems(dir).items, '/r/it').some((x) => x.id === td1.id), 'inbox: やることの答えは出した CoS の見張りだけが拾う');
    assert(answerItem(dir, td2.id, { choice: 'cannot', text: '権限が無い', via: 'cli' }).answer.choice === 'cannot' && answeredFor(listItems(dir).items, '/r/it').some((x) => x.id === td2.id) && !answeredFor(listItems(dir).items, dir).some((x) => x.id === td2.id), 'inbox: 他の CoS のやることでは起きない');
    markDelivered(dir, [td1.id]);
    assert(answeredFor(listItems(dir).items, dir).length === 0 && api('GET', '/api/items').json.waiting === 0, 'inbox: 渡したやることの答えは二度出ない・終われば返事待ちから外れる');
    readItem(dir, tl2.id);

    // CoS の記録（一時ディレクトリ）: 書く・書き足す・見張りの印・消えたディレクトリは出さない
    const cdir = join(dir, '.chiefs');
    const dA = join(dir, 'repo-a');
    const dB = join(dir, 'repo-b');
    mkdirSync(dA);
    mkdirSync(dB);
    noteChief(cdir, { name: 'cos-a', dir: dA }, { stateDir: '/s/a', retroIntervalDays: 7, via: 'ask' });
    noteChief(cdir, { name: 'cos-b', dir: dB }, { stateDir: '/s/b', watch: { pid: process.pid, startedAt: 'S', beatAt: new Date().toISOString() } });
    noteChief(cdir, { name: 'gone', dir: join(dir, 'no-such') }, {});
    noteChief(cdir, { name: 'cos-a', dir: dA }, { via: 'watch' });
    writeFileSync(join(cdir, 'broken.json'), '{');
    const cs = listChiefs(cdir);
    assert(cs.map((c) => c.name).join() === 'cos-a,cos-b' && cs[0].stateDir === '/s/a' && cs[0].retroIntervalDays === 7 && cs[0].watch.alive === false && cs[1].watch.alive === true && cs[1].watch.since === 'S', `inbox: CoS の記録 ${JSON.stringify(cs)}`);
    noteChief(cdir, { name: 'cos-b', dir: dB }, (r) => ({ ...r, watch: null, watchEndedAt: 'E' }));
    assert(listChiefs(cdir)[1].watch.alive === false && listChiefs(cdir)[1].watch.lastAt === 'E' && listChiefs(join(dir, 'none')).length === 0, 'inbox: 見張りが終わった印');
    assert(noteChief(join(dir, 'memo.txt', 'x'), { name: 'n', dir: dA }) === null, 'inbox: 記録に失敗しても投げない');

    // 指示の API: 作る → 宛先の CoS の見張りだけが拾う → ack → 返事（reply-to）
    const capi = (m, p, o = {}) => handleApi(dir, m, p, { ...o, chiefs: () => listChiefs(cdir), chiefStatus: (c) => (c.name === 'cos-b' ? (() => { throw new Error('台帳が壊れている'); })() : { workers: [{ id: 'w1' }], retro: { due: false } }) });
    assert(capi('POST', '/api/messages', { body: { to: '/nope', text: 'x' } }).status === 400 && capi('POST', '/api/messages', { body: { to: dA, text: ' ' } }).status === 400 && capi('POST', '/api/messages', { body: {} }).status === 400 && capi('GET', '/api/messages').status === 405, 'inbox API: 宛先が無い・空の指示は断る');
    const before = listItems(dir).items.length;
    const pm = capi('POST', '/api/messages', { body: { to: dA, text: 'A への指示\n2行目' } });
    assert(pm.status === 200 && pm.json.kind === 'message' && pm.json.chief.name === 'cos-a' && pm.json.status === 'open' && pm.json.title === 'A への指示' && listItems(dir).items.length === before + 1, `inbox API: 指示を作る ${JSON.stringify(pm.json)}`);
    const mid = pm.json.id;
    assert(messagesFor(listItems(dir).items, dA).map((x) => x.id).join() === mid && messagesFor(listItems(dir).items, dB).length === 0 && messagesFor(listItems(dir).items, dir).length === 0, 'inbox: 指示は宛先の CoS の見張りだけが拾う');
    const ch = capi('GET', '/api/chiefs').json;
    assert(ch.chiefs.length === 2 && ch.chiefs[0].unread === 1 && ch.chiefs[1].unread === 0 && ch.chiefs[0].workers[0].id === 'w1' && ch.chiefs[0].error === null && ch.chiefs[1].error === '台帳が壊れている' && ch.chiefs[1].workers.length === 0 && !('stateDir' in ch.chiefs[0]), `inbox API: CoS の状況 ${JSON.stringify(ch)}`);
    assert(handleApi(dir, 'GET', '/api/chiefs', { chiefs: () => listChiefs(cdir) }).json.chiefs[0].retro === null, 'inbox API: 状況を作る関数が無ければ名前と見張りだけ');
    assert(api('GET', '/api/items').json.unreadMessages === 1 && JSON.stringify(api('GET', '/api/items').json.counts) === JSON.stringify(openCounts(listItems(dir).items)), 'inbox API: 未読の指示の件数');
    markDelivered(dir, [mid]);
    assert(messagesFor(listItems(dir).items, dA).length === 0 && getItem(dir, mid).status === 'open', 'inbox: 渡した指示は二度出ない（既読は ack まで付かない）');
    assert(api('POST', `/api/items/${mid}/answer`, { body: { text: 'x' } }).status === 400 && api('POST', `/api/items/${mid}/read`).status === 400, 'inbox API: 指示には画面から返事・既読できない');
    assert(throws(() => ackItem(dir, mid, { chiefDir: dB }), 400) && getItem(dir, mid).status === 'open', 'inbox: 他の CoS 宛ての指示は ack できない');
    assert(ackItem(dir, mid, { chiefDir: dA }).status === 'read' && ackItem(dir, mid).status === 'read' && capi('GET', '/api/chiefs').json.chiefs[0].unread === 0 && throws(() => ackItem(dir, q2.id), 400), 'inbox: ack（二度目も通る・指示でなければ断る）');
    const rp = createItem(dir, { kind: 'tell', chief: { name: 'cos-a', dir: dA }, title: '返事', replyTo: mid });
    assert(getItem(dir, rp.id).replyTo === mid && api('GET', `/api/items/${rp.id}`).json.replyTo === mid, 'inbox: 返事から元の指示をたどれる');
    assert(throws(() => createItem(dir, { kind: 'tell', chief: { name: 'cos-b', dir: dB }, title: 'x', replyTo: mid }), 400) && throws(() => createItem(dir, { kind: 'tell', chief: { name: 'cos-a', dir: dA }, title: 'x', replyTo: q2.id }), 400) && throws(() => createItem(dir, { kind: 'tell', chief: { name: 'cos-a', dir: dA }, title: 'x', replyTo: 'nope' }), 404), 'inbox: reply-to は自分宛ての指示だけ');
    const pm2 = capi('POST', '/api/messages', { body: { to: dA, text: '未読のまま返事される指示' } }).json;
    createItem(dir, { kind: 'ask', chief: { name: 'cos-a', dir: dA }, title: '聞き返し', replyTo: pm2.id });
    assert(getItem(dir, pm2.id).status === 'read', 'inbox: 返事を出したら元の指示は既読になる');

    // 作業セッションの質問のカード（inbox-ui/wq.js。画面と同じ関数を読んで試す）: 出る → 答えを送る → CoS が ask を出したら消える
    {
      const workerQuestions = new Function(`${readFileSync(fileURLToPath(new URL('../inbox-ui/wq.js', import.meta.url)), 'utf8')}\nreturn workerQuestions;`)();
      const t0 = new Date(Date.now() - 60000).toISOString();
      const [rA, rB] = ['cos-a', 'cos-b'].map((n) => listChiefs(cdir).find((c) => c.name === n).dir); // GET /api/chiefs と同じ dir（項目の chief.dir もこれ）
      const chs = (since = t0) => [
        { name: 'cos-a', dir: `${rA}/`, workers: [{ id: 'wq1', label: '色決め', report: '質問', reportUpdated: since, question: '青か緑か（推奨 青）' }, { id: 'wq2', report: '進行中' }, { id: 'wq3', report: '完了' }] },
        { name: 'cos-b', dir: rB, workers: [{ id: 'wq1', report: '質問', reportUpdated: since, question: null }] },
      ];
      const wqOf = (since) => workerQuestions(chs(since), listItems(dir).items);
      let q = wqOf();
      assert(q.map((x) => `${x.chief.name}/${x.worker.id}`).join() === 'cos-a/wq1,cos-b/wq1' && q[0].question === '青か緑か（推奨 青）' && q[0].since === t0 && !q[0].answered && q[0].answers.length === 0 && q[0].id !== q[1].id, `inbox wq: 報告書が「質問」で、CoS が受け箱に出していなければカードを出す ${JSON.stringify(q.map((x) => x.id))}`);
      assert(capi('POST', '/api/messages', { body: { to: dA, text: '青で', worker: '../x' } }).status === 400, 'inbox wq: 作業セッションの ID が不正なら断る');
      const ans = capi('POST', '/api/messages', { body: { to: dA, text: ' 青で \n理由は見やすさ', worker: 'wq1' } });
      assert(ans.status === 200 && ans.json.kind === 'message' && ans.json.worker === 'wq1' && ans.json.body === '作業セッション wq1 の質問への答え: 青で \n理由は見やすさ' && ans.json.title.startsWith('作業セッション wq1 の質問への答え: 青で') && messagesFor(listItems(dir).items, dA).some((x) => x.id === ans.json.id), `inbox wq: 答えは worker 付きの指示（本文の先頭に誰の質問への答えか）として CoS に届く ${JSON.stringify(ans.json)}`);
      q = wqOf();
      assert(q[0].answered && q[0].answers.map((x) => x.id).join() === ans.json.id && q[0].answers[0].status === 'open' && !q[1].answered, 'inbox wq: 答えを送ったら、その CoS のカードだけ「送った」（別の CoS の同じ ID は別）');
      ackItem(dir, ans.json.id, { chiefDir: dA });
      assert(wqOf()[0].answers[0].status === 'read', 'inbox wq: CoS が読んだら answers の状態が read');
      assert(!wqOf(new Date(Date.now() + 60000).toISOString())[0].answered, 'inbox wq: 前の質問（止まった時刻より前）への答えは数えない');
      createItem(dir, { kind: 'tell', chief: { name: 'cos-a', dir: rA }, worker: 'wq1', title: '進めています' });
      assert(wqOf().length === 2, 'inbox wq: 読むだけの項目では消えない');
      const ca = createItem(dir, { kind: 'ask', chief: { name: 'cos-a', dir: rA }, worker: 'wq1', title: '色は青か緑か', options: [{ key: 'b', label: '青' }, { key: 'g', label: '緑' }] });
      q = wqOf();
      assert(q.map((x) => `${x.chief.name}/${x.worker.id}`).join() === 'cos-b/wq1', 'inbox wq: CoS が cos ask --worker で出したら、自動のカードは消える（二重にしない）');
      answerItem(dir, ca.id, { choice: 'b', text: null });
      assert(wqOf().length === 1 && wqOf(new Date(Date.now() + 60000).toISOString()).length === 2, 'inbox wq: CoS の要返事に答えた後も、同じ質問のカードは戻らない（次の質問では出る）');
      assert(workerQuestions([{ name: 'cos-a', dir: rA, workers: [{ id: 'wq9', report: '質問' }] }], []).length === 1 && workerQuestions(null, null).length === 0, 'inbox wq: 止まった時刻が無くても出す・状況が無ければ空');
    }

    // スレッド: 指示 → tell（開始）→ 作業セッションの件として ask。前の tell は既読になり、画面の組み立てで1つにまとまる
    {
      const cA = { name: 'cos-a', dir: dA };
      const tm = capi('POST', '/api/messages', { body: { to: dA, text: 'ここ1ヶ月の動きも調べられる？' } }).json;
      const now0 = Date.parse(tm.createdAt);
      assert(pendingThreads(listItems(dir).items, dA, now0).every((m) => m.id !== tm.id), 'inbox thread: 未読の指示は注意の対象にしない（まだ読んでいない）');
      ackItem(dir, tm.id, { chiefDir: dA });
      assert(pendingThreads(listItems(dir).items, dA, now0)[0].id === tm.id && pendingThreads(listItems(dir).items, dB, now0).length === 0, 'inbox thread: ack 済みで返事の無い指示は続きが出そう（宛先の CoS だけ）');
      const st = createItem(dir, { kind: 'tell', chief: cA, title: '調査を始めました', replyTo: tm.id });
      assert(pendingThreads(listItems(dir).items, dA, now0)[0].id === tm.id, 'inbox thread: 返事が tell だけならまだ続きが出そう');
      const hint = threadHint(listItems(dir).items, dA, 'この項目', now0);
      assert(hint.includes(tm.id) && hint.includes('--reply-to') && hint.includes('ここ1ヶ月の動きも調べられる？') && threadHint(listItems(dir).items, dB, 'この項目', now0) === null, `inbox thread: 付け忘れの注意 ${hint}`);
      assert(pendingThreads(listItems(dir).items, dA, now0 + THREAD_HINT_HOURS * 3600000 + 1).every((m) => m.id !== tm.id), 'inbox thread: 24 時間を過ぎた指示は注意しない');
      assert(replyTarget(dir, tm.id, dA).id === tm.id && throws(() => replyTarget(dir, tm.id, dB), 400) && throws(() => replyTarget(dir, st.id, dA), 400) && throws(() => replyTarget(dir, 'nope', dA), 404), 'inbox thread: reply-to に書けるのは自分宛ての指示だけ');
      const res = createItem(dir, { kind: 'ask', chief: cA, worker: 'w9', title: '調査結果', replyTo: tm.id, options: [{ key: 'a', label: 'A' }] });
      const st2 = getItem(dir, st.id);
      assert(st2.status === 'read' && st2.readVia === 'thread' && st2.readAt === res.createdAt, 'inbox thread: 続きが出たら、同じ指示への前の tell は既読になる');
      assert(pendingThreads(listItems(dir).items, dA, now0).every((m) => m.id !== tm.id), 'inbox thread: 要返事が reply-to 付きで出たら注意しない');
      // 同じ題の未対応の項目
      const li = listItems(dir).items;
      assert(duplicateOpen(li, { chiefDir: dA, kind: 'ask', title: ' 調査結果 ', worker: 'w9' })?.id === res.id, 'inbox thread: 同じ CoS・種類・題・作業セッションの未対応の項目を見つける');
      assert(duplicateOpen(li, { chiefDir: dA, kind: 'ask', title: '調査結果' }) === null && duplicateOpen(li, { chiefDir: dA, kind: 'review', title: '調査結果', worker: 'w9' }) === null && duplicateOpen(li, { chiefDir: dB, kind: 'ask', title: '調査結果', worker: 'w9' }) === null && duplicateOpen(li, { chiefDir: dA, kind: 'ask', title: '別の題', worker: 'w9' }) === null, 'inbox thread: 作業セッション・種類・CoS・題のどれかが違えば別の項目');
      assert(duplicateOpen(li.map((x) => (x.id === res.id ? { ...x, status: 'answered' } : x)), { chiefDir: dA, kind: 'ask', title: '調査結果', worker: 'w9' }) === null, 'inbox thread: 済んだ項目は置き換えの対象にしない');

      // 画面の組み立て（inbox-ui/thread.js。画面と同じ関数を読んで試す）
      const buildThreads = new Function(`${readFileSync(fileURLToPath(new URL('../inbox-ui/thread.js', import.meta.url)), 'utf8')}\nreturn buildThreads;`)();
      const loose = createItem(dir, { kind: 'tell', chief: cA, title: '指示と関係ない知らせ' });
      const T1 = buildThreads(listItems(dir).items);
      const th = T1.threads.find((t) => t.id === tm.id);
      assert(th && th.column === 'ask' && th.focus.map((x) => x.id).join() === res.id && th.prev.map((x) => x.id).join() === st.id && th.items.length === 2 && th.at === res.createdAt, `inbox thread: 要返事のあるスレッドは要返事の列・前の tell は畳む側 ${JSON.stringify(th && [th.column, th.focus.length, th.prev.length])}`);
      assert(T1.inThread.has(st.id) && T1.inThread.has(res.id) && !T1.inThread.has(loose.id) && !T1.inThread.has(tm.id), 'inbox thread: スレッドの項目は列に二重に出さない（つながっていない項目はそのまま）');
      assert(T1.byRoot.get(tm.id) === th && T1.byRoot.get(mid).column === 'tell' && T1.inThread.has(rp.id), 'inbox thread: 未読の tell だけのスレッドは読むだけの列');
      readItem(dir, rp.id);
      assert(buildThreads(listItems(dir).items).byRoot.get(mid).column === null && !buildThreads(listItems(dir).items).inThread.has(rp.id), 'inbox thread: 済んだスレッド（既読の tell だけ）は列に出さない');
      // tell だけのスレッド: 未読があれば読むだけの列。この画面で開いて既読にした直後（kept）も残す
      const m3 = capi('POST', '/api/messages', { body: { to: dA, text: '状況を教えて' } }).json;
      const t3a = createItem(dir, { kind: 'tell', chief: cA, title: '受け取りました', replyTo: m3.id });
      const t3b = createItem(dir, { kind: 'tell', chief: cA, title: '答えです', replyTo: m3.id });
      const T2 = buildThreads(listItems(dir).items).byRoot.get(m3.id);
      assert(T2.column === 'tell' && T2.focus.length === 0 && T2.prev.map((x) => x.id).join() === [t3a.id, t3b.id].join() && getItem(dir, t3a.id).status === 'read' && T2.at === t3b.createdAt, 'inbox thread: tell だけのスレッドは読むだけの列（前の tell は既読）');
      readItem(dir, t3b.id);
      assert(buildThreads(listItems(dir).items).byRoot.get(m3.id).column === null && buildThreads(listItems(dir).items, { kept: new Set([t3b.id]) }).byRoot.get(m3.id).column === 'tell', 'inbox thread: 読み終えたら列から外す（開いている最中は残す）');
      // 答えたらスレッドは済み。取り下げた項目・元の指示が無い項目は入れない
      answerItem(dir, res.id, { choice: 'a' });
      const T3 = buildThreads(listItems(dir).items);
      assert(T3.byRoot.get(tm.id).column === null && !T3.inThread.has(res.id), 'inbox thread: 要返事に答えたらスレッドは済んだものへ');
      const rv2 = createItem(dir, { kind: 'review', chief: cA, title: '直しました', replyTo: tm.id });
      const td3 = createItem(dir, { kind: 'todo', chief: cA, title: '試す', replyTo: tm.id });
      const T4 = buildThreads(listItems(dir).items).byRoot.get(tm.id);
      assert(T4.column === 'review' && T4.focus.map((x) => x.kind).join() === 'review,todo' && T4.prev.map((x) => x.id).join() === [st.id, res.id].join(), 'inbox thread: 手が要る項目が複数あれば、要返事 → 確認依頼 → やること の先の列にまとめる');
      withdrawItem(dir, rv2.id);
      withdrawItem(dir, td3.id);
      const orphan = { ...loose, id: 'orphan', replyTo: 'no-such-message' };
      const T5 = buildThreads([...listItems(dir).items, orphan]);
      assert(T5.byRoot.get(tm.id).items.length === 2 && T5.byRoot.get(tm.id).column === null && !T5.inThread.has('orphan') && T5.threads.every((t) => t.root.kind === 'message'), 'inbox thread: 取り下げた項目・元の指示が見つからない項目はスレッドに入れない');
      withdrawItem(dir, loose.id);

      // Markdown（inbox-ui/md.js。最小の DOM の代わりを用意して、画面と同じ関数を読んで試す）
      class FakeEl {
        constructor(tag) { this.tagName = tag.toUpperCase(); this.kids = []; this.attrs = {}; this.className = ''; this.textContent = ''; }
        append(...ks) { this.kids.push(...ks); }
        get lastChild() { return this.kids[this.kids.length - 1] || null; }
        setAttribute(k, v) { this.attrs[k] = v; }
        addEventListener() {}
        html() {
          const t = this.tagName.toLowerCase();
          const inner = (this.textContent || '') + this.kids.map((k) => (typeof k === 'string' ? k : k.html())).join('');
          if (t === '#frag') return inner;
          const at = Object.entries(this.attrs).map(([k, v]) => ` ${k}="${v}"`).join('');
          return ['br', 'hr'].includes(t) ? `<${t}>` : `<${t}${at}>${inner}</${t}>`;
        }
      }
      const fakeDoc = { createElement: (t) => new FakeEl(t), createDocumentFragment: () => new FakeEl('#frag') };
      const mdOf = new Function('document', `${readFileSync(fileURLToPath(new URL('../inbox-ui/md.js', import.meta.url)), 'utf8')}\nreturn (s) => markdown(s).html();`)(fakeDoc);
      const nested = mdOf('1. **赤**\n   - デプロイは\n   - **決めること:**\n     - どちら\n     - 次\n2. **手段**\n   - 中\n3. **テナント**');
      assert(nested === '<ol><li><strong>赤</strong><ul><li>デプロイは</li><li><strong>決めること:</strong><ul><li>どちら</li><li>次</li></ul></li></ul></li><li><strong>手段</strong><ul><li>中</li></ul></li><li><strong>テナント</strong></li></ol>', `md: 入れ子のリストで番号が続く ${nested}`);
      assert(mdOf('3. a\n4. b') === '<ol start="3"><li>a</li><li>b</li></ol>' && mdOf('1. a') === '<ol><li>a</li></ol>', 'md: 番号付きリストは最初の番号を start に入れる');
      assert(mdOf('- a\n\tb\n\t- c') === '<ul><li>a<br>b<ul><li>c</li></ul></li></ul>', 'md: タブの字下げで入れ子・項目の続きの行はその項目の中');
      assert(mdOf('- a\n\n- b') === '<ul><li>a</li><li>b</li></ul>' && mdOf('- a\n1. b') === '<ul><li>a</li></ul><ol><li>b</li></ol>', 'md: 項目間の空行ではリストを続ける・同じ階層で種類が変われば別のリスト');
      assert(['---', '***', '___', '- - -', '  ----'].every((x) => mdOf(`a\n\n${x}\n\nb`) === '<p>a</p><hr><p>b</p>'), 'md: ---・***・___ だけの行は横線');
      assert(!mdOf('| a | b |\n|---|---|\n| 1 | 2 |').includes('<hr>') && mdOf('| a | b |\n|---|---|\n| 1 | 2 |').includes('<th>'), 'md: 表の区切りの行は横線にしない');
      assert(mdOf('> 引用\n> 二行目\n\n本文') === '<blockquote><p>引用<br>二行目</p></blockquote><p>本文</p>', 'md: > は引用');
    }

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

// TODO ファイルの API（/api/todos）と、受け箱の項目とのつながり（todoLine）。cos self-test から呼ぶ。
export function selfTestTodoApi(assert) {
  const D = '2026-11-25';
  const root = mkdtempSync(join(tmpdir(), 'cos-todoapi-'));
  try {
    const dir = join(root, 'inbox');
    const hub = join(root, 'hub');
    const other = join(root, 'other');
    mkdirSync(join(hub, '.claude'), { recursive: true });
    mkdirSync(other, { recursive: true });
    const file = join(hub, 'TODO.md');
    const file2 = join(hub, 'notes', 'T2.md');
    mkdirSync(join(hub, 'notes'));
    writeFileSync(join(hub, '.claude', 'cos.json'), JSON.stringify({ todoFiles: ['TODO.md', 'notes/T2.md', 'none.md'] }));
    writeFileSync(file, '## 未完了\n\n- [ ] **いつでも: 机**\n- [ ] **11/20: 請求書**（封筒）\n- [ ] **11/25: 今日の分**\n- [ ] 読めない行\n- [x] **11/1: 済んだ**（済 2026-11-02）\n');
    writeFileSync(file2, '- [ ] **12/1: 二つ目**\n- [ ] **11/6〜 公開後: 様子を見る**\n- [ ] **11/4 見つかった: 表示の崩れ**\n- [ ] **12/3 以降: 古い設定を消す**\n- [ ] **11/22 まで: 書類**\n');
    const H = { name: 'hub', dir: hub };
    const O = { name: 'other', dir: other };
    const opts = (body = null) => ({ body, chiefs: () => [H, O], today: D, commit: false });
    const get = () => handleApi(dir, 'GET', '/api/todos', opts());
    const g0 = get();
    assert(g0.status === 200 && g0.json.today === D && g0.json.chiefs.length === 1 && g0.json.chiefs[0].name === 'hub', `todo api: TODO ファイルを持つ CoS だけを返す ${JSON.stringify(g0.json).slice(0, 200)}`);
    const [f1, f2, f3] = g0.json.chiefs[0].files;
    assert(f1.label === 'TODO.md' && f2.label === 'notes/T2.md' && f3.error === 'ENOENT' && f3.todos.length === 0, `todo api: ファイルごと・読めないファイルは error ${JSON.stringify([f1.label, f2.label, f3.error])}`);
    assert(f1.todos.map((t) => t.state).join() === 'overdue,today,anytime,unreadable,done' && f1.todos[0].title === '請求書' && f1.todos[0].note === '（封筒）' && f1.todos[4].doneOn === '2026-11-02', `todo api: 期日の近い順・state ${f1.todos.map((t) => t.state)}`);
    // 期日の種類: 着手日（以降・〜）は来ても赤くしない（startable）、締切は過ぎたら overdue、起きた日は noted。並びは 過ぎた → 着手できる → 先 → 起きた日
    assert(f2.todos.map((t) => `${t.state}:${t.dueKind}`).join() === 'overdue:deadline,startable:after,future:deadline,future:after,noted:since', `todo api: dueKind と state ${f2.todos.map((t) => `${t.state}:${t.dueKind}`)}`);
    assert(f1.todos[2].dueKind === null && f1.todos[3].dueKind === null, 'todo api: いつでも・読めない行の dueKind は null');
    writeFileSync(file2, '- [ ] **12/1: 二つ目**\n');
    // 足す
    const a1 = handleApi(dir, 'POST', '/api/todos', opts({ to: hub, text: '11/28 銀行に行く' }));
    assert(a1.status === 200 && a1.json.file === file && a1.json.todo.due === '2026-11-28' && a1.json.todo.state === 'future' && readFileSync(file, 'utf8').includes('- [ ] **11/28: 銀行に行く**\n'), `todo api: 足す（文頭の期日） ${JSON.stringify(a1.json)}`);
    const a2 = handleApi(dir, 'POST', '/api/todos', opts({ to: hub, file: file2, text: '靴', due: '12/2', note: '黒' }));
    assert(a2.status === 200 && readFileSync(file2, 'utf8') === '- [ ] **12/1: 二つ目**\n- [ ] **12/2: 靴**（黒）\n', 'todo api: ファイルを選んで足す');
    assert(handleApi(dir, 'POST', '/api/todos', opts({ to: hub, text: ' ' })).status === 400 && handleApi(dir, 'POST', '/api/todos', opts({ to: hub, text: 'x', due: '来週' })).status === 400, 'todo api: 空・読めない期日は 400');
    assert(handleApi(dir, 'POST', '/api/todos', opts({ to: other, text: 'x' })).status === 400 && handleApi(dir, 'POST', '/api/todos', opts({ to: '/nowhere', text: 'x' })).status === 400, 'todo api: TODO ファイルの無い CoS・知らない CoS には足せない');
    writeFileSync(join(root, 'secret.md'), '- [ ] **いつでも: x**\n');
    assert(handleApi(dir, 'POST', '/api/todos', opts({ to: hub, file: join(root, 'secret.md'), text: 'x' })).status === 400 && handleApi(dir, 'POST', '/api/todos/done', opts({ to: hub, file: join(root, 'secret.md'), id: '1', done: true })).status === 400 && readFileSync(join(root, 'secret.md'), 'utf8') === '- [ ] **いつでも: x**\n', 'todo api: todoFiles に無いファイルは書き換えない');
    // 済にする・戻す
    const id = f1.todos[0].id;
    const d1 = handleApi(dir, 'POST', '/api/todos/done', opts({ to: hub, file, id, done: true }));
    assert(d1.status === 200 && d1.json.changed && d1.json.todo.state === 'done' && d1.json.todo.doneOn === D && readFileSync(file, 'utf8').includes('- [x] **11/20: 請求書**（封筒）（済 2026-11-25）\n'), `todo api: 済にする ${JSON.stringify(d1.json)}`);
    const d2 = handleApi(dir, 'POST', '/api/todos/done', opts({ to: hub, file, id, done: false }));
    assert(d2.status === 200 && d2.json.todo.state === 'overdue' && readFileSync(file, 'utf8').includes('- [ ] **11/20: 請求書**（封筒）\n'), 'todo api: 戻す');
    assert(handleApi(dir, 'POST', '/api/todos/done', opts({ to: hub, file, id: 'zzzzzz', done: true })).status === 404 && handleApi(dir, 'GET', '/api/todos/done', opts()).status === 405 && handleApi(dir, 'POST', '/api/todos/x/y', opts({})).status === 404, 'todo api: 無い行は 404・形の違う呼び出しは断る');
    assert(listItems(dir).items.length === 0, 'todo api: TODO を足しても済にしても、受け箱の項目（＝CoS を起こすもの）は作らない');
    // 受け箱の「やること」とのつながり（cos todo --todo-line）
    const ref = todoLineRef([file, file2], id.slice(0, 5), D);
    assert(ref.file === file && ref.id === id && ref.title === '請求書', `todo api: --todo-line は行を探して持たせる ${JSON.stringify(ref)}`);
    let bad = null;
    try {
      todoLineRef([file, file2], 'zzzzzz', D);
    } catch (e) {
      bad = e;
    }
    assert(bad instanceof InboxError && bad.status === 400, 'todo api: --todo-line の行が無ければ断る');
    const it = createItem(dir, { kind: 'todo', chief: { ...H, session: null }, title: '請求書を郵送する', body: 'b', todoLine: ref });
    const it2 = createItem(dir, { kind: 'todo', chief: { ...H, session: null }, title: '別の件', body: 'b' });
    assert(it.todoLine.id === id && it2.todoLine === undefined, 'todo api: 項目に todoLine を持たせる（無ければ持たない）');
    assert(get().json.chiefs[0].files[0].todos.find((t) => t.id === id).items.join() === it.id, 'todo api: 行に、そこから出た未対応の項目をつなぐ');
    const no = handleApi(dir, 'POST', `/api/items/${it.id}/answer`, opts({ choice: 'cannot', text: '切手が無い' }));
    assert(no.status === 200 && !readFileSync(file, 'utf8').includes('[x] **11/20'), 'todo api: 「できない」では TODO の行は済にしない');
    const it3 = createItem(dir, { kind: 'todo', chief: { ...H, session: null }, title: '請求書を郵送する（もう一度）', body: 'b', todoLine: ref });
    const yes = handleApi(dir, 'POST', `/api/items/${it3.id}/answer`, opts({ choice: 'done', text: '郵送した' }));
    assert(yes.status === 200 && readFileSync(file, 'utf8').includes('- [x] **11/20: 請求書**（封筒）（済 2026-11-25: 郵送した）\n'), `todo api: 「やった」で、もとの TODO の行も済にする ${readFileSync(file, 'utf8')}`);
    assert(get().json.chiefs[0].files[0].todos.find((t) => t.id === id).items.length === 0, 'todo api: 済んだ項目はつながない');
    assert(closeTodoLine({ kind: 'todo', answer: { choice: 'done' }, todoLine: { file: join(root, 'gone.md'), id: 'x' } }) === null && closeTodoLine(it2) === null, 'todo api: もとの行が無くても投げない');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
