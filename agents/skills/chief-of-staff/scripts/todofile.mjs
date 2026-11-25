// CoS の TODO ファイル（cos.json の todoFiles・Markdown）の読み取りと書き換え。
// CLI（cos todo-file）・受け箱の画面（/api/todos）・cos reorient の「期日の来た確認」が、同じこの関数を通る。
// 書式は変えない（ユーザーが手でも直せる Markdown のまま）:
//   - [ ] **<期日>: <やること>**（補足）     期日は `11/28`・`2026-12-01`・`いつでも`
//   - [x] **<期日>: <やること>**（補足）（済 2026-11-25）
// 読めない行（チェックボックスはあるが、頭の太字が期日でも「いつでも」でもない）は「読めない行」として返し、文字は変えない。
// 形と id の決め方は ../inbox-schema.md の「TODO ファイル」。

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, watch, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DAY_MS = 86_400_000;
export const ANYTIME = 'いつでも';

export class TodoError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ───────── 純関数 ─────────

// 文字列の頭の日付（YYYY-MM-DD）。「2026-11-22」「11/22」「11/22 16:30 以降」「11/21(金) 以降」など。読めなければ null。
// 年が無ければ today の年とみなす。ただし年の境目では、today から半年より先なら去年、300 日より前なら来年とみなす
// （1月に読む「12/30」は去年の約束＝期日が来ている。12月に読む「1/5」は来年＝まだ先）。来年とみなす側を狭くするのは、
// 期日を大きく過ぎた古い約束を「まだ先」と取り違えて黙って消すより、出しすぎる方がましだから。
export function dueDayFromHead(head, today) {
  const m = String(head).match(/^\s*(?:(\d{4})-(\d{1,2})-(\d{1,2})|(\d{1,2})\/(\d{1,2}))(?![\d/])/);
  if (!m) return null;
  let [y, mo, d] = m[1] ? [Number(m[1]), Number(m[2]), Number(m[3])] : [Number(today.slice(0, 4)), Number(m[4]), Number(m[5])];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  if (!m[1]) {
    const diffDays = (Date.UTC(y, mo - 1, d) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS;
    if (diffDays > 183) y -= 1;
    else if (diffDays < -300) y += 1;
  }
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// 期日の種類（太字の期日の文字 dueText から決める。ファイルの書式は変えない）:
//   after     着手日（その日まではやらない）。「以降」を含む、または `11/6〜`・`12/1(月)〜 毎月…` のように日付のすぐ後が 〜／~ で、
//             その後に日付が続かない（`10/29〜11/5` のような期間は after にしない）
//   since     起きた日（約束ではなく経緯）。「見つかった」「判明」「発覚」「発生」「起きた」「済」を含む
//   deadline  締切。「まで」を含むもの・日付だけ（時刻や曜日、「朝」「頃」が付くだけ）・それ以外の語が付いたもの
export function dueKindOf(dueText) {
  const s = String(dueText ?? '');
  if (/以降/.test(s)) return 'after';
  if (/^\s*(?:\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\/\d{1,2})(?:\s*[（(][月火水木金土日][）)])?\s*[〜~](?!\s*\d)/.test(s)) return 'after';
  if (/まで/.test(s)) return 'deadline';
  if (/見つかった|見つけた|判明|発覚|発生|起きた|済/.test(s)) return 'since';
  return 'deadline';
}

// cos.json の todoFiles の1つを絶対パスにする（`~` は家・相対は base から）。
export function resolveTodoPath(p, base, home) {
  if (p === '~') return home;
  if (p.startsWith('~/')) return join(home, p.slice(2));
  return isAbsolute(p) ? p : join(base, p);
}

const BOX_RE = /^(\s*[-*+]\s+\[)([ xX])(\]\s+)(.*)$/;
// 済にしたときに行末へ足す印（この形だけを、戻すときに外す。手で書いた日付には触らない）。
const DONE_MARK_RE = /\s*（済 (\d{4}-\d{2}-\d{2})(?:: (.*))?）\s*$/;
// 太字の中の「期日: やること」の区切り。時刻（16:30）の : では切らない。
const SEP_RE = /[:：](?!\d)/;

function hashOf(s) {
  return createHash('sha1').update(s).digest('hex').slice(0, 8);
}

// 行の id のもと: チェックの有無と済の印を除いた行（前後の空白も除く）。済にしても戻しても id は変わらない。
function idSource(line) {
  const m = line.match(BOX_RE);
  return `${m[1].trim()} ${m[3].trim()} ${m[4].replace(DONE_MARK_RE, '').trim()}`;
}

// TODO の本文を読む。返すのはチェックボックスの行だけ（見出しや説明の行は todos に入らない）。
//   { id, n, line, done, readable, anytime, due, dueText, title, note, doneOn, doneNote, raw }
//   id       行の中身のハッシュ（8桁）。同じ中身の行が複数あれば、2つ目から -2・-3 を付ける（ファイルの順）
//   n        チェックボックスの行の通し番号（1 から・ファイルの順）。行を足したり消したりするとずれる
//   line     ファイルの中の行（0 から）
//   readable 頭の太字が期日か「いつでも」で始まる（false は「読めない行」。title は行の中身そのまま）
//   due      期日（YYYY-MM-DD）。いつでも・読めない行は null
//   dueKind  期日の種類（dueKindOf: after＝着手日・deadline＝締切・since＝起きた日）。いつでも・読めない行は null
//   dueText  書かれている期日の文字（「11/22 16:30 以降」など）
//   note     太字の後ろの文字（補足。済の印は除く）
export function parseTodos(text, today) {
  const lines = String(text).split(/\r?\n/);
  const todos = [];
  const seen = new Map();
  lines.forEach((raw, line) => {
    const m = raw.match(BOX_RE);
    if (!m) return;
    const base = hashOf(idSource(raw));
    const k = (seen.get(base) ?? 0) + 1;
    seen.set(base, k);
    const done = m[2] !== ' ';
    let rest = m[4];
    let doneOn = null;
    let doneNote = null;
    const dm = rest.match(DONE_MARK_RE);
    if (dm) {
      doneOn = dm[1];
      doneNote = dm[2] ?? null;
      rest = rest.slice(0, dm.index);
    }
    const t = { id: k === 1 ? base : `${base}-${k}`, n: todos.length + 1, line, done, readable: false, anytime: false, due: null, dueKind: null, dueText: null, title: rest.trim(), note: '', doneOn, doneNote, raw };
    const b = rest.match(/^\*\*\s*(.+?)\s*\*\*(.*)$/);
    if (b) {
      const bold = b[1];
      const anytime = bold.startsWith(ANYTIME);
      const due = anytime ? null : dueDayFromHead(bold, today);
      if (anytime || due) {
        const sep = bold.search(SEP_RE);
        t.readable = true;
        t.anytime = anytime;
        t.due = due;
        t.dueText = sep < 0 ? (anytime ? ANYTIME : bold) : bold.slice(0, sep).trim();
        t.dueKind = anytime ? null : dueKindOf(t.dueText);
        t.title = sep < 0 ? (anytime ? bold.slice(ANYTIME.length).trim() || bold : bold) : bold.slice(sep + 1).trim();
        t.note = b[2].replace(/^\s*[:：]\s*/, '').trim();
      }
    }
    todos.push(t);
  });
  return { lines, todos, eol: /\r\n/.test(text) ? '\r\n' : '\n' };
}

// 期日の様子（未完了の行）:
//   overdue（締切を過ぎた）・today（締切が今日）・startable（着手日が今日か過ぎた＝着手できる。急ぎではない）・
//   future（締切も着手日もまだ先）・noted（起きた日が書いてあるだけ）・anytime・unreadable
export function dueState(t, today) {
  if (!t.readable) return 'unreadable';
  if (t.anytime) return 'anytime';
  if (t.dueKind === 'since') return 'noted';
  if (t.dueKind === 'after') return t.due <= today ? 'startable' : 'future';
  return t.due < today ? 'overdue' : t.due === today ? 'today' : 'future';
}

// 並びの順（画面の app.js の TF_RANK も同じ）。
export const STATE_RANK = { overdue: 0, today: 1, startable: 2, future: 3, noted: 4, anytime: 5, unreadable: 6, done: 7 };

// 並び: 未完了を先に（締切を過ぎた → 今日 → 着手できる → 先のもの → 起きた日だけ → いつでも → 読めない行）、それぞれ期日の近い順。
// 済んだものは最後（終えた日の新しい順）。同じならファイルの順。today が無ければ過ぎた・今日・着手・先を分けず期日の順。
export function sortTodos(todos, today = null) {
  const rank = (t) => {
    if (t.done) return STATE_RANK.done;
    const st = dueState(t, today ?? '');
    return !today && ['overdue', 'today', 'startable', 'future'].includes(st) ? 0 : STATE_RANK[st];
  };
  return [...todos].sort((a, b) => rank(a) - rank(b)
    || (a.done ? String(b.doneOn ?? '').localeCompare(String(a.doneOn ?? '')) : String(a.due ?? '').localeCompare(String(b.due ?? '')))
    || a.n - b.n);
}

function addDays(today, n) {
  const d = new Date(Date.parse(`${today}T00:00:00Z`) + n * DAY_MS);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}
const WORD_DAYS = { 今日: 0, きょう: 0, 明日: 1, あした: 1, あす: 1, 明後日: 2, あさって: 2 };

// 1行の入力の文頭から期日を拾う（画面の入力欄と cos todo-file add が使う）。
// 「11/28 請求書を出す」「11/28〜 …」「2026-12-01: …」「明日 …」「いつでも …」。拾えなければ due は null（＝いつでも）。
// 返す due は TODO に書く文字（「11/28」「2026-12-01」「いつでも」）。
export function splitDue(input, today) {
  const s = String(input ?? '').trim();
  const tail = (rest) => rest.replace(/^\s*(?:まで(?:に)?|〜|~|[:：、,])?\s*/, '').trim();
  const d = s.match(/^(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\/\d{1,2})(?![\d/])(?:\s*[（(][月火水木金土日][）)])?/);
  if (d && dueDayFromHead(d[1], today)) return { due: d[1], title: tail(s.slice(d[0].length)) };
  const w = s.match(/^(今日|きょう|明日|あした|あす|明後日|あさって)(?=[\s:：、,〜~ま]|$)/);
  if (w) return { due: addDays(today, WORD_DAYS[w[1]]), title: tail(s.slice(w[0].length)) };
  if (s.startsWith(ANYTIME)) return { due: ANYTIME, title: tail(s.slice(ANYTIME.length)) };
  return { due: null, title: s };
}

const oneLine = (s) => String(s ?? '').replace(/\s*\r?\n\s*/g, ' ').trim();

// 足す行を作る。due は「11/28」「2026-12-01」「いつでも」（無ければ、やることの文頭から拾う。拾えなければ いつでも）。
export function todoLine({ title, due = null, note = null }, today) {
  let t = oneLine(title);
  let d = oneLine(due);
  if (!d) ({ due: d, title: t } = splitDue(t, today));
  d = d || ANYTIME;
  if (d !== ANYTIME && !dueDayFromHead(d, today)) throw new TodoError(400, `期日が読めません: ${d}（11/28・2026-12-01・いつでも のどれかで書く）`);
  d = d.replaceAll('**', '');
  t = t.replaceAll('**', '');
  if (!t) throw new TodoError(400, 'やることが空です');
  const n = oneLine(note).replace(/^[（(]\s*/, '').replace(/\s*[）)]$/, '');
  return `- [ ] **${d}: ${t}**${n ? `（${n}）` : ''}`;
}

const isHeading = (l, word) => new RegExp(`^#{1,6}\\s*${word}`).test(l);

// 行を足した本文を返す。置き場所は、「済」の見出しより前の最後のチェックボックスの行の次。
// チェックボックスの行がまだ無ければ「未完了」の見出しの下、見出しも無ければ（「済」の見出しの前の）末尾。
export function addTodo(text, input, today) {
  const p = parseTodos(text, today);
  const line = todoLine(input, today);
  const L = p.lines;
  let end = L.findIndex((l) => isHeading(l, '済'));
  if (end < 0) end = L.length;
  const last = p.todos.filter((t) => t.line < end).at(-1);
  const isList = (l) => /^\s*[-*+]\s/.test(l);
  let at;
  if (last) {
    at = last.line + 1;
    while (at < end && /^\s+\S/.test(L[at]) && !BOX_RE.test(L[at])) at++; // 字下げした続きの行は、その行のもの
  } else {
    const head = L.findIndex((l, i) => i < end && isHeading(l, '未完了'));
    if (head >= 0) at = L[head + 1] === '' ? head + 2 : head + 1;
    else {
      at = end;
      while (at > 0 && L[at - 1].trim() === '') at--;
    }
  }
  const add = [line];
  if (at > 0 && L[at - 1].trim() !== '' && !isList(L[at - 1]) && !/^\s+\S/.test(L[at - 1])) add.unshift('');
  if (at < L.length && L[at].trim() !== '' && !isList(L[at])) add.push('');
  const out = [...L.slice(0, at), ...add, ...L.slice(at)];
  if (out.at(-1) !== '') out.push('');
  const next = out.join(p.eol);
  const made = parseTodos(next, today).todos.find((t) => t.line === at + add.indexOf(line));
  return { text: next, todo: made };
}

// id か番号（cos todo-file list の #n）で行を探す。id は前方一致でもよい（4桁以上・1つに決まるとき）。
export function findTodo(todos, key) {
  const k = String(key ?? '').trim().replace(/^#/, '');
  if (!k) throw new TodoError(400, 'どの行か（id か番号）がありません');
  const exact = todos.find((t) => t.id === k);
  if (exact) return exact;
  if (/^\d{1,4}$/.test(k)) {
    const t = todos.find((x) => x.n === Number(k));
    if (!t) throw new TodoError(404, `${k} 番の行はありません（1〜${todos.length}）`);
    return t;
  }
  const hit = k.length >= 4 ? todos.filter((t) => t.id.startsWith(k)) : [];
  if (hit.length === 1) return hit[0];
  throw new TodoError(hit.length ? 409 : 404, hit.length ? `${k} で始まる行が ${hit.length} つあります（${hit.map((t) => t.id).join('・')}）` : `その行はありません: ${k}（行を手で直すと id は変わります。cos todo-file list で見直す）`);
}

// 済にする・戻す。変えるのはチェックの1文字と、行末の済の印（（済 YYYY-MM-DD: 一言））だけ。
export function setTodoDone(text, key, done, { today, note = null } = {}) {
  const p = parseTodos(text, today);
  const t = findTodo(p.todos, key);
  if (t.done === done) return { text, todo: t, changed: false };
  const m = t.raw.match(BOX_RE);
  let rest = m[4].replace(DONE_MARK_RE, '');
  if (done) rest = `${rest.trimEnd()}（済 ${today}${oneLine(note) ? `: ${oneLine(note).replaceAll('）', ')')}` : ''}）`;
  p.lines[t.line] = `${m[1]}${done ? 'x' : ' '}${m[3]}${rest}`;
  const next = p.lines.join(p.eol);
  return { text: next, todo: parseTodos(next, today).todos.find((x) => x.line === t.line), changed: true };
}

// ───────── ファイル ─────────

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// ファイルごとのロック（隣に .<名前>.lock のディレクトリを作る）。落ちたプロセスの残骸は 30 秒で片付ける。
function withFileLock(file, fn) {
  const lock = join(dirname(file), `.${basename(file)}.lock`);
  const t0 = Date.now();
  for (;;) {
    try {
      mkdirSync(lock);
      break;
    } catch (e) {
      if (e.code !== 'EEXIST') throw new TodoError(500, `TODO のロックが作れません: ${lock}: ${e.code || e.message}`);
      try {
        if (Date.now() - statSync(lock).mtimeMs > 30_000) {
          rmSync(lock, { recursive: true, force: true });
          continue;
        }
      } catch {
        continue;
      }
      if (Date.now() - t0 > 10_000) throw new TodoError(503, `TODO のロックが取れません: ${lock}`);
      sleep(20);
    }
  }
  try {
    return fn();
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

export function readTodoFile(file, today) {
  return parseTodos(readFileSync(file, 'utf8'), today).todos;
}

// そのファイルだけをコミットする（git 管理下のときだけ・push はしない）。できなければ理由を返す（書き換えは残す）。
// 返すのは { committed: true, sha } | { committed: false, reason }。git の外・git が追っていないファイル・差分なしは reason: null（することが無い）。
export function commitTodoFile(file, message) {
  const dir = dirname(file);
  const git = (args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  try {
    git(['rev-parse', '--is-inside-work-tree']);
  } catch {
    return { committed: false, reason: null };
  }
  const name = basename(file);
  try {
    git(['ls-files', '--error-unmatch', '--', name]);
  } catch {
    return { committed: false, reason: null }; // git が追っていないファイルはコミットしない
  }
  try {
    if (!git(['status', '--porcelain', '--', name])) return { committed: false, reason: null };
    git(['commit', '--only', '-m', message, '--', name]);
    return { committed: true, sha: git(['rev-parse', '--short', 'HEAD']) };
  } catch (e) {
    return { committed: false, reason: String(e.stderr || e.message || e).trim().split('\n').slice(-2).join(' ') };
  }
}

// TODO ファイルを書き換える。ロックの中で読み直してから fn（今の本文 → { text, … }）を当て、一時ファイル → rename で置き換える。
// 本文が変わったら、そのファイルだけをコミットする（message は fn の結果から作る）。返すのは fn の結果に commit を足したもの。
export function mutateTodoFile(file, fn, { message = null, commit = true } = {}) {
  return withFileLock(file, () => {
    let cur;
    try {
      cur = readFileSync(file, 'utf8');
    } catch (e) {
      throw new TodoError(e.code === 'ENOENT' ? 404 : 500, `TODO が読めません: ${file}: ${e.code || e.message}`);
    }
    const r = fn(cur);
    if (r.text === cur) return { ...r, changed: false, commit: { committed: false, reason: null } };
    const tmp = join(dirname(file), `.${basename(file)}.tmp-${process.pid}`);
    writeFileSync(tmp, r.text, { mode: statSync(file).mode });
    renameSync(tmp, file);
    const msg = typeof message === 'function' ? message(r) : message;
    return { ...r, changed: true, commit: commit && msg ? commitTodoFile(file, msg) : { committed: false, reason: null } };
  });
}

const short = (s, n = 60) => (s.length > n ? `${s.slice(0, n)}…` : s);

export function addTodoToFile(file, input, { today, commit = true }) {
  return mutateTodoFile(file, (text) => addTodo(text, input, today), { commit, message: (r) => `TODO: 足す: ${short(r.todo.title)}` });
}

export function setTodoDoneInFile(file, key, done, { today, note = null, commit = true }) {
  return mutateTodoFile(file, (text) => setTodoDone(text, key, done, { today, note }), { commit, message: (r) => `TODO: ${done ? '済にする' : '戻す'}: ${short(r.todo.title)}` });
}

// CoS のディレクトリ（cos.json のある場所）の TODO ファイル（絶対パス）。設定が無い・読めないなら空。
export function todoFilesOf(chiefDir, home, read = (f) => readFileSync(f, 'utf8')) {
  try {
    const cfg = JSON.parse(read(join(chiefDir, '.claude', 'cos.json')));
    if (!Array.isArray(cfg.todoFiles)) return [];
    return [...new Set(cfg.todoFiles.filter((f) => typeof f === 'string' && f).map((f) => resolveTodoPath(f, chiefDir, home)))];
  } catch {
    return [];
  }
}

// TODO ファイルの変更を拾う（CoS がコマンドで・ユーザーが手で・画面から）。files() は今の TODO ファイルの一覧（CoS が増減するので毎回聞く）。
// エディタも cos todo-file も rename で置き換えるので、ファイルではなく親ディレクトリを fs.watch で見て、取りこぼしに備えて更新時刻も見る。
export function watchTodoFiles(files, onChange, { pollMs = 1000, listMs = 5000, debounceMs = 40 } = {}) {
  const stampOf = (list) => list.map((f) => {
    try {
      const s = statSync(f);
      return `${f}:${s.mtimeMs}:${s.size}:${s.ino}`;
    } catch {
      return `${f}:-`;
    }
  }).join('|');
  let list = [];
  let stamp = '';
  let timer = null;
  const watchers = new Map(); // 親ディレクトリ → watcher
  const check = () => {
    const next = stampOf(list);
    if (next === stamp) return;
    stamp = next;
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      onChange();
    }, debounceMs);
  };
  const relist = () => {
    try {
      list = files();
    } catch {
      return;
    }
    const dirs = new Set(list.map((f) => dirname(f)));
    for (const [d, w] of watchers) {
      if (dirs.has(d)) continue;
      try { w.close(); } catch { /* 閉じられなくても止める */ }
      watchers.delete(d);
    }
    for (const d of dirs) {
      if (watchers.has(d)) continue;
      try {
        const names = () => new Set(list.filter((f) => dirname(f) === d).map((f) => basename(f)));
        const w = watch(d, (_ev, name) => {
          if (name == null || names().has(String(name))) check();
        });
        w.on('error', () => {});
        watchers.set(d, w);
      } catch {
        // fs.watch が使えなければ更新時刻だけで見る
      }
    }
  };
  relist();
  stamp = stampOf(list);
  const poll = setInterval(check, pollMs);
  const lister = setInterval(() => { relist(); check(); }, listMs);
  return () => {
    clearInterval(poll);
    clearInterval(lister);
    if (timer) clearTimeout(timer);
    for (const w of watchers.values()) {
      try { w.close(); } catch { /* 閉じられなくても止める */ }
    }
  };
}

// ───────── 自己テスト（cos self-test から呼ぶ） ─────────

export function selfTestTodoFile(assert) {
  const D = '2026-11-25';
  const throws = (fn, status) => {
    try {
      fn();
    } catch (e) {
      return e instanceof TodoError && (status === undefined || e.status === status);
    }
    return false;
  };
  const SRC = [
    '# TODO',
    '',
    '- 書き方: `- [ ] **<期日>: <やること>**（補足）`',
    '',
    '## 未完了',
    '',
    '- [ ] **いつでも: 机を片付ける**（引き出しも）',
    '- [ ] **11/20: 請求書を出す**',
    '- [ ] **11/25 16:30 以降: 定時実行を確かめる**: ログを見る',
    '- [ ] **2026-12-03: 歯医者の予約**',
    '- [ ] 期日の無い作業（太字なし）',
    '- [ ] **11月初め: 読めない期日**',
    '',
    '## 済',
    '',
    '- [x] **11/10: 古い用事** 11/11',
    '- [x] **11/12: 印つきの用事**（済 2026-11-13: 電話で済んだ）',
    '',
  ].join('\n');
  const P = parseTodos(SRC, D);
  const by = (title) => P.todos.find((t) => t.title === title);
  // パース
  assert(P.todos.length === 8 && P.todos.every((t, i) => t.n === i + 1), `todofile: チェックボックスの行だけを読む（説明の行は読まない） ${P.todos.length}`);
  const a = by('机を片付ける');
  assert(a.anytime && a.readable && a.due === null && a.dueText === 'いつでも' && a.note === '（引き出しも）' && !a.done, `todofile: いつでも ${JSON.stringify(a)}`);
  assert(by('請求書を出す').due === '2026-11-20' && by('請求書を出す').dueText === '11/20', 'todofile: 月/日の期日');
  const c = by('定時実行を確かめる');
  assert(c.due === '2026-11-25' && c.dueText === '11/25 16:30 以降' && c.note === 'ログを見る', `todofile: 時刻付きの期日は時刻の : で切らない ${JSON.stringify(c)}`);
  assert(by('歯医者の予約').due === '2026-12-03', 'todofile: 年付きの期日');
  const u1 = P.todos[4];
  const u2 = P.todos[5];
  assert(!u1.readable && u1.title === '期日の無い作業（太字なし）' && !u2.readable && u2.title === '**11月初め: 読めない期日**', `todofile: 読めない行は中身をそのまま持つ ${JSON.stringify([u1.title, u2.title])}`);
  const d1 = by('古い用事');
  const d2 = by('印つきの用事');
  assert(d1.done && d1.due === '2026-11-10' && d1.doneOn === null && d1.note === '11/11', 'todofile: 手で書いた済の行');
  assert(d2.done && d2.doneOn === '2026-11-13' && d2.doneNote === '電話で済んだ' && d2.note === '', `todofile: 済の印（終えた日と一言） ${JSON.stringify(d2)}`);
  assert(['overdue', 'startable', 'future', 'anytime', 'unreadable'].join() === [by('請求書を出す'), c, by('歯医者の予約'), a, u1].map((t) => dueState(t, D)).join(), 'todofile: 期日の様子');
  assert(sortTodos(P.todos).map((t) => t.n).join() === '2,3,4,1,5,6,8,7' && sortTodos(P.todos, D).map((t) => t.n).join() === '2,3,4,1,5,6,8,7', `todofile: 期日の近い順 → いつでも → 読めない行 → 済（終えた日の新しい順） ${sortTodos(P.todos).map((t) => t.n).join()}`);
  // 期日の種類（着手日・締切・起きた日）。書式は変えずに、太字の期日の文字から決める
  const K = parseTodos([
    '- [ ] **12/01 以降: 古い設定を消す**',
    '- [ ] **11/6〜 新しい版の公開後: 様子を見る**',
    '- [ ] **12/1(月)〜 毎月の最初の平日: 請求をまとめる**',
    '- [ ] **11/28 まで: 書類を出す**',
    '- [ ] **11/28: 本を返す**',
    '- [ ] **11/27(金) 10:00: 電話する**',
    '- [ ] **11/26 朝: 鉢に水をやる**',
    '- [ ] **10/29〜11/5 の平日: 窓口に行く**',
    '- [ ] **11/4 見つかった: 表示の崩れ**',
    '- [ ] **11/9 確認済み: 古い通知**',
    '- [ ] **11/20 以降: 着手済みの片付け**',
    '- [ ] **いつでも: 机を片付ける**',
  ].join('\n'), D).todos;
  assert(K.map((t) => t.dueKind ?? '-').join() === 'after,after,after,deadline,deadline,deadline,deadline,deadline,since,since,after,-', `todofile: 期日の種類（以降・〜は着手日、まで・日付だけ・期間は締切、見つかった・済は起きた日） ${K.map((t) => t.dueKind)}`);
  assert(dueKindOf('11/6 〜') === 'after' && dueKindOf('11/6~11/8') === 'deadline' && dueKindOf('2026-12-01〜') === 'after' && dueKindOf('11/30 以降に再開') === 'after' && dueKindOf('12/1 から 12/5 まで') === 'deadline', 'todofile: 〜の後に日付が無ければ着手日・あれば期間');
  // D は 2026-11-25。着手日は当日から startable（赤くしない）、締切は過ぎたら overdue、起きた日は noted
  const KS = K.map((t) => dueState(t, D));
  assert(KS.join() === 'future,startable,future,future,future,future,future,overdue,noted,noted,startable,anytime', `todofile: 種類ごとの様子 ${KS}`);
  assert(dueState(parseTodos('- [ ] **11/25 以降: 今日から**', D).todos[0], D) === 'startable' && dueState(parseTodos('- [ ] **11/25: 今日まで**', D).todos[0], D) === 'today', 'todofile: 着手日の当日は startable・締切の当日は today');
  const KO = sortTodos(K, D).map((t) => t.n).join();
  assert(KO === '8,2,11,7,6,4,5,1,3,9,10,12', `todofile: 締切を過ぎた → 今日 → 着手できる → 先のもの → 起きた日 → いつでも ${KO}`);
  // 年の境目（cos reorient と同じ読み方）
  assert(parseTodos('- [ ] **12/30: 年末**\n- [ ] **1/5: 年明け**', '2027-01-02').todos.map((t) => t.due).join() === '2026-12-30,2027-01-05', 'todofile: 1月に読む 12/30 は去年・1/5 は今年');
  assert(parseTodos('- [ ] **1/5: 年明け**', '2026-12-20').todos[0].due === '2027-01-05', 'todofile: 12月に読む 1/5 は来年');
  assert(dueDayFromHead('13/40 の何か', D) === null && dueDayFromHead('1/2/3', D) === null && dueDayFromHead('12:30', D) === null, 'todofile: ありえない日付・分数・時刻は期日にしない');
  // id: 中身で決まる。行を足しても並べ替えても、済にしても変わらない。同じ中身の行は -2 が付く
  assert(/^[0-9a-f]{8}$/.test(a.id) && new Set(P.todos.map((t) => t.id)).size === 8, 'todofile: id は 8 桁で重ならない');
  const moved = parseTodos(SRC.split('\n').toSpliced(7, 1).toSpliced(11, 0, '- [ ] **11/20: 請求書を出す**', '- [ ] **12/1: 新しい行**').join('\n'), D);
  assert(moved.todos.find((t) => t.title === '請求書を出す').id === by('請求書を出す').id && moved.todos.find((t) => t.title === '机を片付ける').id === a.id, 'todofile: 行を動かしても足しても id は同じ');
  assert(parseTodos('- [x] **11/20: 請求書を出す**（済 2026-11-25: 郵送）', D).todos[0].id === by('請求書を出す').id, 'todofile: 済にしても id は同じ');
  const dup = parseTodos('- [ ] **いつでも: 同じ**\n- [ ] **いつでも: 同じ**\n- [ ] **いつでも: 同じ**', D).todos.map((t) => t.id);
  assert(dup[1] === `${dup[0]}-2` && dup[2] === `${dup[0]}-3`, `todofile: 同じ中身の行は 2 つ目から番号が付く ${dup}`);
  // 探す
  assert(findTodo(P.todos, a.id) === a && findTodo(P.todos, '2') === by('請求書を出す') && findTodo(P.todos, '#3') === c && findTodo(P.todos, a.id.slice(0, 5)) === a, 'todofile: id・番号・#番号・id の頭で探す');
  assert(throws(() => findTodo(P.todos, '99'), 404) && throws(() => findTodo(P.todos, 'zzzzzz'), 404) && throws(() => findTodo(P.todos, ''), 400), 'todofile: 無い行は断る');
  // 文頭の期日
  const sd = (x) => JSON.stringify(splitDue(x, D));
  assert(sd('11/28 請求書を出す') === '{"due":"11/28","title":"請求書を出す"}' && sd('11/28〜 請求書') === '{"due":"11/28","title":"請求書"}' && sd('2026-12-01: 本を返す') === '{"due":"2026-12-01","title":"本を返す"}', `todofile: 文頭の日付を拾う ${sd('11/28〜 請求書')}`);
  assert(sd('11/28(土)までに出す') === '{"due":"11/28","title":"出す"}' && sd('明日 牛乳') === '{"due":"11/26","title":"牛乳"}' && sd('今日: 電話') === '{"due":"11/25","title":"電話"}' && sd('あさって、掃除') === '{"due":"11/27","title":"掃除"}', `todofile: 曜日・まで・今日・明日 ${sd('11/28(土)までに出す')}`);
  assert(sd('いつでも 靴を磨く') === '{"due":"いつでも","title":"靴を磨く"}' && sd('靴を磨く') === '{"due":null,"title":"靴を磨く"}' && sd('3/4 拍子の練習') === '{"due":"3/4","title":"拍子の練習"}' && sd('明日香に電話') === '{"due":null,"title":"明日香に電話"}', `todofile: いつでも・期日なし ${sd('明日香に電話')}`);
  assert(splitDue('明日 x', '2026-12-31').due === '1/1', 'todofile: 年末の「明日」');
  // 足す行
  assert(todoLine({ title: '11/28 請求書を出す' }, D) === '- [ ] **11/28: 請求書を出す**' && todoLine({ title: '靴を磨く', note: '黒いほう' }, D) === '- [ ] **いつでも: 靴を磨く**（黒いほう）', 'todofile: 足す行（文頭の期日・補足）');
  assert(todoLine({ title: '11/28 請求書', due: '2026-12-01' }, D) === '- [ ] **2026-12-01: 11/28 請求書**' && todoLine({ title: 'a\n**b**', due: 'いつでも', note: '（c）' }, D) === '- [ ] **いつでも: a b**（c）', 'todofile: --due があれば文頭は拾わない・改行と太字の印は落とす');
  assert(throws(() => todoLine({ title: 'x', due: '来週' }, D), 400) && throws(() => todoLine({ title: '  ' }, D), 400) && throws(() => todoLine({ title: '11/28' }, D), 400), 'todofile: 読めない期日・空のやることは断る');
  // 足す場所
  const A1 = addTodo(SRC, { title: '12/1 本を返す' }, D);
  const L1 = A1.text.split('\n');
  assert(L1[12] === '- [ ] **12/1: 本を返す**' && L1[11] === '- [ ] **11月初め: 読めない期日**' && L1[13] === '' && L1[14] === '## 済' && A1.todo.due === '2026-12-01' && A1.todo.n === 7, `todofile: 「済」の見出しの前の、最後の行の次に足す ${JSON.stringify(L1.slice(10, 15))}`);
  assert(A1.text.split('\n').toSpliced(12, 1).join('\n') === SRC, 'todofile: 足しても、ほかの行は1文字も変わらない');
  assert(addTodo('# TODO\n\n## 未完了\n\n## 済\n', { title: 'a' }, D).text === '# TODO\n\n## 未完了\n\n- [ ] **いつでも: a**\n\n## 済\n', `todofile: 行が無ければ「未完了」の見出しの下 ${JSON.stringify(addTodo('# TODO\n\n## 未完了\n\n## 済\n', { title: 'a' }, D).text)}`);
  assert(addTodo('', { title: 'a' }, D).text === '- [ ] **いつでも: a**\n' && addTodo('# メモ\n説明', { title: 'a' }, D).text === '# メモ\n説明\n\n- [ ] **いつでも: a**\n', `todofile: 空のファイル・見出しの無いファイル ${JSON.stringify(addTodo('# メモ\n説明', { title: 'a' }, D).text)}`);
  assert(addTodo('- [ ] **いつでも: a**\n  続きの行\n\n後ろの文\n', { title: 'b' }, D).text === '- [ ] **いつでも: a**\n  続きの行\n- [ ] **いつでも: b**\n\n後ろの文\n', 'todofile: 字下げした続きの行の後ろに足す');
  assert(addTodo('- [ ] **いつでも: a**\r\n', { title: 'b' }, D).text === '- [ ] **いつでも: a**\r\n- [ ] **いつでも: b**\r\n', 'todofile: 改行コードを保つ');
  // 済にする・戻す
  const S1 = setTodoDone(SRC, by('請求書を出す').id, true, { today: D, note: '郵送した' });
  assert(S1.changed && S1.text.includes('- [x] **11/20: 請求書を出す**（済 2026-11-25: 郵送した）\n') && S1.todo.done && S1.todo.doneOn === D && S1.todo.id === by('請求書を出す').id, `todofile: 済にする ${S1.text.split('\n')[7]}`);
  assert(setTodoDone(S1.text, S1.todo.id, false, { today: D }).text === SRC, 'todofile: 戻すと元の本文と同じ');
  assert(!setTodoDone(SRC, a.id, false, { today: D }).changed && !setTodoDone(SRC, d1.id, true, { today: D }).changed, 'todofile: もうその状態なら変えない');
  assert(setTodoDone(SRC, d1.id, false, { today: D }).text.includes('- [ ] **11/10: 古い用事** 11/11\n'), 'todofile: 手で書いた日付は、戻しても消さない');
  const S2 = setTodoDone(SRC, u1.id, true, { today: D });
  assert(S2.text.includes('- [x] 期日の無い作業（太字なし）（済 2026-11-25）\n') && setTodoDone(S2.text, u1.id, false, { today: D }).text === SRC, 'todofile: 読めない行も、チェックと済の印だけを変える');
  assert(resolveTodoPath('~/a.md', '/r', '/h') === '/h/a.md' && resolveTodoPath('TODO.md', '/r', '/h') === '/r/TODO.md' && resolveTodoPath('/x/y.md', '/r', '/h') === '/x/y.md', 'todofile: パス');
  assert(todoFilesOf('/r', '/h', () => '{"todoFiles":["TODO.md","~/t.md","TODO.md",3]}').join() === '/r/TODO.md,/h/t.md' && todoFilesOf('/r', '/h', () => '{}').length === 0 && todoFilesOf('/r', '/h', () => { throw new Error('x'); }).length === 0, 'todofile: cos.json の todoFiles（重なりを除く・無ければ空）');

  // ファイル（原子的な書き換え・同時の書き換え・そのファイルだけのコミット）
  const dir = mkdtempSync(join(tmpdir(), 'cos-todofile-'));
  try {
    const file = join(dir, 'TODO.md');
    writeFileSync(file, SRC);
    const r1 = addTodoToFile(file, { title: '11/28 銀行' }, { today: D });
    assert(r1.changed && r1.commit.committed === false && r1.commit.reason === null && readTodoFile(file, D).some((t) => t.title === '銀行'), 'todofile: git の外でも書き換える（コミットは無し）');
    assert(!setTodoDoneInFile(file, a.id, false, { today: D }).changed && throws(() => setTodoDoneInFile(join(dir, 'none.md'), '1', true, { today: D }), 404) && throws(() => setTodoDoneInFile(file, 'zzzzzz', true, { today: D }), 404), 'todofile: 変わらない・ファイルが無い・行が無い');
    // 同時の書き換え: 8 個のプロセスが同時に1行ずつ足す。1行も失わない
    const me = fileURLToPath(import.meta.url);
    const code = `import(${JSON.stringify(me)}).then((m) => m.addTodoToFile(process.argv[1], { title: 'p' + process.argv[2] }, { today: ${JSON.stringify(D)} }))`;
    const sh = spawnSync('sh', ['-c', 'for i in 1 2 3 4 5 6 7 8; do "$0" -e "$1" "$2" $i & done; wait', process.execPath, code, file], { encoding: 'utf8' });
    const after = readTodoFile(file, D);
    assert(sh.status === 0 && [1, 2, 3, 4, 5, 6, 7, 8].every((i) => after.some((t) => t.title === `p${i}`)) && after.length === 8 + 1 + 8, `todofile: 同時に足しても1行も失わない ${after.length} ${sh.stderr}`);
    assert(readFileSync(file, 'utf8').split('\n').filter((l) => !/^- \[ \] \*\*(?:いつでも: p\d|11\/28: 銀行)\*\*$/.test(l)).join('\n') === SRC, 'todofile: 同時に足しても、ほかの行は変わらない');
    // git: そのファイルだけをコミットする
    const g = (...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    let gitOk = true;
    try {
      g('init', '-q');
      g('config', 'user.email', 'self-test@example.invalid');
      g('config', 'user.name', 'self-test');
      g('config', 'commit.gpgsign', 'false');
    } catch {
      gitOk = false; // git が無い環境では飛ばす
    }
    if (gitOk) {
      writeFileSync(join(dir, 'other.txt'), 'a\n');
      const r2 = addTodoToFile(file, { title: '追っていない' }, { today: D });
      assert(r2.changed && !r2.commit.committed && r2.commit.reason === null, 'todofile: git が追っていないファイルはコミットしない');
      g('add', 'TODO.md', 'other.txt');
      g('commit', '-q', '-m', 'init');
      writeFileSync(join(dir, 'other.txt'), 'b\n');
      g('add', 'other.txt');
      const r3 = setTodoDoneInFile(file, by('請求書を出す').id, true, { today: D });
      assert(r3.commit.committed && g('log', '-1', '--format=%s') === 'TODO: 済にする: 請求書を出す' && g('show', '--name-only', '--format=', 'HEAD') === 'TODO.md', `todofile: そのファイルだけをコミットする ${JSON.stringify(r3.commit)}`);
      assert(g('status', '--porcelain') === 'M  other.txt', `todofile: ほかのファイルの変更（ステージ済み）は残す ${g('status', '--porcelain')}`);
      const r4 = addTodoToFile(file, { title: '12/5 コミットしない' }, { today: D, commit: false });
      assert(r4.changed && !r4.commit.committed && g('status', '--porcelain', '--', 'TODO.md') === 'M TODO.md', 'todofile: commit: false なら書き換えだけ');
      const r5 = setTodoDoneInFile(file, by('請求書を出す').id, false, { today: D });
      assert(r5.commit.committed && g('log', '-1', '--format=%s') === 'TODO: 戻す: 請求書を出す', 'todofile: 戻すのもコミットする（手の変更も一緒に入る）');
      // コミットできなくても書き換えは残す
      mkdirSync(join(dir, '.git', 'hooks'), { recursive: true });
      writeFileSync(join(dir, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\necho no >&2\nexit 1\n', { mode: 0o755 });
      const r6 = addTodoToFile(file, { title: 'フックが断る' }, { today: D });
      assert(r6.changed && !r6.commit.committed && r6.commit.reason && readTodoFile(file, D).some((t) => t.title === 'フックが断る'), `todofile: コミットできなくても書き換えは残す ${JSON.stringify(r6.commit)}`);
    }
    // 変更の見張り: 見るファイルの一覧と、止める関数
    const stop = watchTodoFiles(() => [file], () => {});
    stop();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
