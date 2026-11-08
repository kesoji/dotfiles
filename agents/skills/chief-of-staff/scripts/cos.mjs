#!/usr/bin/env node
// cos — chief of staff（CoS）が herdr の上で作業セッション（別の Claude Code など）を立て、
// 依頼書を渡し、状態の変化を見張り、終わったら片付けるための CLI。依存は node・git・herdr だけ。
//
//   cos spawn <ID> --brief <file> --label <短い名前> [--title T] [--model M] [--kind claude] [--base REF]
//                  [--no-worktree] [--no-setup] [--force] [-- <エージェントへの引数>]
//   cos rename <ID> <短い名前>
//   cos send <ID> (<text> | --file <file> | --first)
//   cos watch [--timeout 秒(既定 3000)] [--interval 秒(既定 5)]
//   cos status [--all] [--json]
//   cos report <ID>
//   cos read <ID> [--lines N]
//   cos close <ID> [--force] [--keep-branch]
//   cos retro status | collect [--since ISO] [--until ISO] [--session ID,...] [--out F] [--force] | done [--file F]
//   cos reorient [--hook]   （フック用）起動時は振り返りの期限を、要約・/clear のあとは CoS の立て直しの手順を文脈に戻す
//   cos self-test
//   cos chief               CoS のセッションを起動する（bin/cos が scripts/chief.sh へ渡す）
//
// 状態の正本（git 管理外・worktree をまたいで1つ）:
//   <git-common-dir>/cos/ledger.json    作業セッションの台帳
//   <git-common-dir>/cos/events.jsonl   見張りが拾った出来事
//   <git-common-dir>/cos/archive/       片付けた依頼の依頼書・報告書の控え
//   <git-common-dir>/cos/retro.json     週1回の振り返りの期限（since＝今の期間の始まり・知らせた日・履歴）
//   <git-common-dir>/cos/retros/        振り返りの記録（材料の下書き＋CoS の判断＋改善案の採否）
//   <git-common-dir>/cos/chief.json     CoS だったセッションの記録（振り返りで会話ログを読むため）
// 依頼書と報告書は作業セッションの作業ツリーの `.cos/<slug>/` に置く（info/exclude で git から外す）。
// 環境変数 COS_DIR で状態の置き場所を差し替えられる（試験用＝本物の台帳を触らずに watch などを試す）。
//
// 設定は CoS が動いている作業ツリーの `.claude/cos.json`（無くてもよい）。項目は SKILL.md を参照。
import { execFileSync } from 'node:child_process';
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SETTLED = new Set(['idle', 'done', 'blocked']);
// 見張りの対象にする台帳の状態。setup-failed / start-failed は人が見るまで動かないので見張らない。
const WATCHED = new Set(['running', 'start-blocked']);
const DEFAULT_CFG = {
  worktreeDir: '.claude/worktrees',
  branchPrefix: 'cos/',
  agentPrefix: '',
  setup: '',
  setupTimeoutSec: 1200,
  workerRules: '',
  chiefRules: '',
  maxWorkers: 3,
  // herdr のサイドバーで読める幅（半角＝1・全角＝2）。ワークスペースの名前はこの幅に収める。
  labelWidth: 10,
  // 週1回の振り返りの間隔（日）。前回の振り返りを終えてからこの日数で期限になる。
  retroIntervalDays: 7,
};
const DAY_MS = 86_400_000;

// ───────── 純関数（self-test の対象） ─────────

export function slug(id) {
  return id.toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
}

// herdr のエージェント名は [a-z][a-z0-9_-]{0,31}。
export function agentName(prefix, s) {
  let n = `${prefix}${s}`.toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
  if (!/^[a-z]/.test(n)) n = `w-${n}`;
  return n.slice(0, 32);
}

export function checkId(id) {
  if (!id || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,40}$/.test(id)) {
    throw new UsageError(`ID が不正です: ${id ?? '(なし)'}（英数字・. _ - の 1〜41 文字）`);
  }
  return id;
}

export function reportState(text) {
  const m = text.match(/^状態:\s*(\S+)/m);
  return m ? m[1] : null;
}

// 台帳の作業セッションと herdr のエージェント一覧から「CoS が対応すべき出来事」を拾う。
// 出来事 = ターンが終わった（idle/done）・承認や質問の画面で止まった（blocked）・エージェントがいなくなった（gone）。
// 同じ状態（status と state_change_seq）は二度出さない。working への変化は記録するだけ。
export function detectEvents(workers, agents) {
  const events = [];
  const seen = {};
  for (const w of workers) {
    const a =
      agents.find((x) => x.name === w.agent) ??
      agents.find((x) => x.pane_id === w.pane && x.agent === w.kind);
    const cur = a ? { status: a.agent_status, seq: a.state_change_seq ?? null } : { status: 'gone', seq: null };
    const prev = w.lastSeen;
    if (prev && prev.status === cur.status && prev.seq === cur.seq) continue;
    seen[w.id] = cur;
    if (SETTLED.has(cur.status) || cur.status === 'gone') {
      events.push({ id: w.id, agent: w.agent, status: cur.status, seq: cur.seq });
    }
  }
  return { events, seen };
}

export function renderTemplate(tpl, vars) {
  return tpl.replace(/\{\{(\w+)\}\}/g, (m, k) => {
    if (!(k in vars)) throw new Error(`テンプレートの変数 ${k} がありません`);
    return vars[k];
  });
}

// 表示幅（半角1・全角2）。herdr のサイドバーは幅で切れるので、文字数でなく幅で数える。
export function displayWidth(str) {
  let w = 0;
  for (const ch of str) w += isWide(ch) ? 2 : 1;
  return w;
}

function isWide(ch) {
  const c = ch.codePointAt(0);
  return (
    (c >= 0x1100 && c <= 0x115f) || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) ||
    (c >= 0xf900 && c <= 0xfaff) || (c >= 0xfe30 && c <= 0xfe4f) || (c >= 0xff00 && c <= 0xff60) ||
    (c >= 0xffe0 && c <= 0xffe6) || (c >= 0x1f300 && c <= 0x1faff) || (c >= 0x20000 && c <= 0x3fffd)
  );
}

// 幅に収める（はみ出したら切る）。切ったかどうかも返す＝黙って切らずに知らせるため。
export function fitLabel(label, width) {
  const t = label.trim().replace(/\s+/g, ' ');
  if (displayWidth(t) <= width) return { label: t, cut: false };
  let out = '';
  for (const ch of t) {
    if (displayWidth(out + ch) > width) break;
    out += ch;
  }
  return { label: out, cut: true };
}

export function shq(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

// 作業セッションの herdr 上の置き場所。worktree の依頼も、作業ツリーを分けない依頼（where: shared）も
// 1本につき1つのワークスペース（サイドバーに出る）。where: tab は古い形（CoS のワークスペースの中のタブ）で、
// 台帳に残っている分を片付けられるように読むだけ。
export function herdrPlace(w) {
  if (w.where === 'worktree' || w.where === 'shared') return { kind: 'workspace', id: w.workspace };
  if (w.where === 'tab') return { kind: 'tab', id: w.tab };
  throw new Error(`台帳の where が分かりません: ${w.where}`);
}

// ── 週1回の振り返り ──

// ローカル時刻の日付（YYYY-MM-DD）。「同じ日に二度知らせない」の判定に使う。
export function localDay(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// 振り返りの期限。since（今の期間の始まり＝前回の振り返りを終えた時）から intervalDays 日。
// notify＝見張りが retro-due を出すか。期限を過ぎていても、同じ日（ローカル）にもう知らせていれば出さない。
export function retroDue(retro, intervalDays, nowMs) {
  const dueAt = Date.parse(retro.since) + intervalDays * DAY_MS;
  const due = nowMs >= dueAt;
  const notify = due && (!retro.notifiedAt || localDay(Date.parse(retro.notifiedAt)) !== localDay(nowMs));
  return { dueAt, due, notify };
}

// 見張りの1周の判断。作業セッションが0本でも終わらない（期限の知らせを待つ＝起動しっぱなしの CoS でも週1回起こす）。
// 作業セッションの出来事を先に出す（急ぐ）。振り返りは次の見張りで拾える。
export function watchStep({ events, retroNotify, timedOut }) {
  if (events.length > 0) return 'events';
  if (retroNotify) return 'retro-due';
  if (timedOut) return 'timeout';
  return 'wait';
}

// 依頼書のうち CoS が書いた部分（前置き・リポジトリの決まりを除く）。renderBrief が最初の「## 依頼」の後ろに置く。
export function briefBody(rendered) {
  const mark = '\n## 依頼\n\n';
  const i = rendered.indexOf(mark);
  return i < 0 ? null : rendered.slice(i + mark.length).trim();
}

// 台帳の1件と出来事の記録から、振り返りの数字を出す。
// 同じ ID を立て直したときに前の回の出来事を数えないよう、台帳の createdAt より前は捨てる
// （spawned の出来事は台帳を書いた直後に記録されるので 1 秒の幅を持たせる）。
export function requestStats(w, events) {
  const t0 = Date.parse(w.createdAt) - 1000;
  const mine = events.filter((e) => e.id === w.id && Date.parse(e.at) >= t0);
  const turns = mine.filter((e) => e.kind === 'event');
  const closed = mine.find((e) => e.kind === 'closed');
  return {
    sends: mine.filter((e) => e.kind === 'sent').length,
    questions: new Set(turns.filter((e) => e.report === '質問').map((e) => e.seq)).size,
    blocked: turns.filter((e) => e.status === 'blocked').length,
    doneAt: turns.find((e) => e.report === '完了')?.at ?? null,
    forced: w.forced ?? closed?.forced ?? null,
  };
}

// CoS の会話ログ（Claude Code の jsonl を1行ずつ JSON にしたもの）から、ユーザーが打った発言だけを拾う。
// 打った発言＝type:user で origin.kind が human のもの・ターンの途中で届いた発言（attachment の queued_command で
// origin.kind が human）。ツールの結果・スキルの本文（isMeta）・要約・スラッシュコマンド・他のセッションからの
// メッセージ・バックグラウンドの通知は入れない。同じ文が 2 分以内に二重に記録されていれば1つにする。
const NOT_TYPED = /^\s*<(command-message|command-name|command-args|local-command-|task-notification|cross-session-message|agent-message|system-reminder)/;
export function humanUtterances(entries, sinceMs, untilMs) {
  const out = [];
  for (const o of entries) {
    let content;
    let at;
    if (o.type === 'user' && o.origin?.kind === 'human' && !o.isMeta && !o.isCompactSummary) {
      content = o.message?.content;
      at = o.timestamp;
    } else if (o.type === 'attachment' && o.attachment?.type === 'queued_command' && o.attachment.origin?.kind === 'human') {
      content = o.attachment.prompt;
      at = o.attachment.timestamp ?? o.timestamp;
    } else continue;
    const text = textOf(content).trim();
    if (!text || NOT_TYPED.test(text)) continue;
    const t = Date.parse(at);
    if (!(t >= sinceMs && t < untilMs)) continue;
    if (out.some((u) => u.text === text && Math.abs(u.t - t) < 120_000)) continue;
    out.push({ t, text });
  }
  return out.sort((a, b) => a.t - b.t);
}

function textOf(c) {
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.filter((x) => x?.type === 'text').map((x) => x.text).join('\n');
  return '';
}

// 訂正・問い直しらしい発言（下書きで ★ を付けて目立たせるだけ。判断は CoS がする）。
const PUSHBACK = /違う|ちがう|訂正|じゃなくて|ではなく|そうじゃ|べきなの|べき[？?]|べきでは|てない[？?]|のでは[？?]|なの[？?]|なんで|なぜ|どうして|おかしい|やめて|戻して|勝手に|聞いてない|言ったのに|確認[:：]/;
export function looksLikePushback(text) {
  return PUSHBACK.test(text);
}

// 振り返りの記録の見出しごとの本文（HTML コメントは除く＝下書きの書き方の説明を中身と数えない）。
export function recordSection(text, heading) {
  const body = text.replace(/<!--[\s\S]*?-->/g, '');
  const re = new RegExp(`^## ${heading}\\s*$`, 'm');
  const m = re.exec(body);
  if (!m) return null;
  const rest = body.slice(m.index + m[0].length);
  const next = rest.search(/^## /m);
  return (next < 0 ? rest : rest.slice(0, next)).trim();
}

// cos retro done の前の検査。振り返りが書かれていて、改善案に [未定] が残っていないこと。
export function checkRecord(text) {
  const look = recordSection(text, '振り返り');
  const plan = recordSection(text, '改善案');
  if (!look) return { ok: false, reason: '「## 振り返り」が空です（良かったこと・悪かったことを書く）' };
  if (plan === null) return { ok: false, reason: '「## 改善案」の見出しがありません' };
  if (!plan) return { ok: false, reason: '「## 改善案」が空です（案が無ければ「- なし」と書く）' };
  if (/\[未定\]/.test(plan)) return { ok: false, reason: '改善案に [未定] が残っています（ユーザーに見せて [採用]／[却下]／[保留] に書き換える）' };
  const tally = { 採用: 0, 却下: 0, 保留: 0 };
  for (const m of plan.matchAll(/^\s*[-*]\s*\[(採用|却下|保留)\]/gm)) tally[m[1]]++;
  return { ok: true, tally };
}

// 過去の記録から改善案の行（採否つき）を拾う＝次の振り返りで同じ案を繰り返さないため。
export function pastProposals(text) {
  const plan = recordSection(text, '改善案') ?? '';
  return plan.split('\n').filter((l) => /^\s*[-*]\s*\[(採用|却下|保留)\]/.test(l)).map((l) => l.trim());
}

// ───────── 下回り ─────────

class UsageError extends Error {}
class HerdrError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function die(msg, code = 1) {
  console.error(`cos: ${msg}`);
  process.exit(code);
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function now() {
  return new Date().toISOString();
}

function ago(iso) {
  if (!iso) return '?';
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 90) return `${s}秒前`;
  if (s < 5400) return `${Math.round(s / 60)}分前`;
  if (s < 129600) return `${Math.round(s / 3600)}時間前`;
  return `${Math.round(s / 86400)}日前`;
}

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function gitOk(args, cwd) {
  try {
    execFileSync('git', args, { cwd, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function herdr(args, { json = true } = {}) {
  let out;
  try {
    out = execFileSync('herdr', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 << 20 });
  } catch (e) {
    if (e.code === 'ENOENT') throw new HerdrError('not_installed', 'herdr が見つかりません');
    const err = String(e.stderr ?? '').trim();
    let code = 'error';
    let message = err || e.message;
    try {
      const j = JSON.parse(err);
      code = j.error?.code ?? j.code ?? code;
      message = j.error?.message ?? j.message ?? message;
    } catch {
      // JSON でない stderr（構文エラー等）はそのまま出す
    }
    throw new HerdrError(code, message);
  }
  return json ? JSON.parse(out) : out;
}

function requireHerdr() {
  if (process.env.HERDR_ENV !== '1' || !process.env.HERDR_WORKSPACE_ID) {
    die('herdr のペインの中で実行してください（HERDR_ENV=1 と HERDR_WORKSPACE_ID が要ります）');
  }
}

function writeAtomic(file, text) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
}

function repoCtx(cwd = process.cwd()) {
  let top;
  try {
    top = git(['rev-parse', '--show-toplevel'], cwd);
  } catch {
    die('git リポジトリの中で実行してください');
  }
  const common = git(['rev-parse', '--path-format=absolute', '--git-common-dir'], top);
  const main = git(['worktree', 'list', '--porcelain'], top)
    .split('\n')
    .find((l) => l.startsWith('worktree '))
    .slice('worktree '.length);
  const cfgFile = join(top, '.claude', 'cos.json');
  let user = {};
  if (existsSync(cfgFile)) {
    try {
      user = JSON.parse(readFileSync(cfgFile, 'utf8'));
    } catch (e) {
      die(`${cfgFile} が読めません: ${e.message}`);
    }
  }
  const cfg = { ...DEFAULT_CFG, ...user };
  if (!(Number(cfg.retroIntervalDays) > 0)) die(`${cfgFile} の retroIntervalDays が正の数ではありません: ${cfg.retroIntervalDays}`);
  cfg.retroIntervalDays = Number(cfg.retroIntervalDays);
  const dir = process.env.COS_DIR ? resolve(process.env.COS_DIR) : join(common, 'cos');
  return {
    top, common, main, cfg, dir,
    ledgerFile: join(dir, 'ledger.json'),
    eventsFile: join(dir, 'events.jsonl'),
    retroFile: join(dir, 'retro.json'),
    retrosDir: join(dir, 'retros'),
    chiefFile: join(dir, 'chief.json'),
  };
}

function readLedger(ctx) {
  if (!existsSync(ctx.ledgerFile)) return { version: 1, workers: {} };
  // 壊れていたら止める（黙って空にすると、動いている作業セッションを見失う）。
  return JSON.parse(readFileSync(ctx.ledgerFile, 'utf8'));
}

function withLock(ctx, fn) {
  mkdirSync(ctx.dir, { recursive: true });
  const lock = join(ctx.dir, 'ledger.lock');
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
        continue; // 消えた直後
      }
      if (Date.now() - t0 > 10_000) throw new Error(`台帳のロックが取れません: ${lock}`);
      sleep(50);
    }
  }
  try {
    return fn();
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

function updateLedger(ctx, fn) {
  return withLock(ctx, () => {
    const l = readLedger(ctx);
    const r = fn(l);
    writeAtomic(ctx.ledgerFile, `${JSON.stringify(l, null, 2)}\n`);
    return r;
  });
}

function setWorker(ctx, id, patch) {
  updateLedger(ctx, (l) => {
    if (l.workers[id]) Object.assign(l.workers[id], patch);
  });
}

function logEvent(ctx, ev) {
  mkdirSync(ctx.dir, { recursive: true });
  appendFileSync(ctx.eventsFile, `${JSON.stringify({ at: now(), ...ev })}\n`);
}

function readEvents(ctx) {
  if (!existsSync(ctx.eventsFile)) return [];
  return readFileSync(ctx.eventsFile, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l, i) => {
      try {
        return JSON.parse(l);
      } catch {
        throw new Error(`${ctx.eventsFile} の ${i + 1} 行目が読めません`);
      }
    });
}

// ── 振り返りの期限の記録（retro.json） ──

// 初めての記録の期間の始まりは台帳の最初の依頼（無ければ今）＝それまでの働きも最初の振り返りに入れる。
function initialRetro(ctx) {
  const first = Object.values(readLedger(ctx).workers).map((w) => w.createdAt).sort()[0];
  return { version: 1, since: first ?? now(), notifiedAt: null, draft: null, history: [] };
}

// 読むだけ（無ければ書かずに初期値を返す）。cos status・reorient 用。
function peekRetro(ctx) {
  if (existsSync(ctx.retroFile)) return { ...JSON.parse(readFileSync(ctx.retroFile, 'utf8')), stored: true };
  return { ...initialRetro(ctx), stored: false };
}

// 書き換える（無ければ初期値で作る）。壊れていれば止める（黙って作り直すと期限と履歴を失う）。
function updateRetro(ctx, fn) {
  return withLock(ctx, () => {
    const r = existsSync(ctx.retroFile) ? JSON.parse(readFileSync(ctx.retroFile, 'utf8')) : initialRetro(ctx);
    const out = fn(r);
    writeAtomic(ctx.retroFile, `${JSON.stringify(r, null, 2)}\n`);
    return out;
  });
}

function fmtWhen(ms) {
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function fmtDur(ms) {
  if (!(ms >= 0)) return '?';
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m}分`;
  if (m < 2880) return `${Math.floor(m / 60)}時間${m % 60 ? `${m % 60}分` : ''}`;
  return `${Math.round(m / 1440)}日`;
}

// cos status・reorient・起動時に出す1行。
function retroLine(ctx) {
  const r = peekRetro(ctx);
  const { dueAt, due } = retroDue(r, ctx.cfg.retroIntervalDays, Date.now());
  const last = r.history?.length ? `前回 ${fmtWhen(Date.parse(r.history.at(-1).to))}` : '前回 なし';
  const draft = r.draft ? `・書きかけの記録 ${r.draft}` : '';
  if (due) {
    return `振り返り: 期限を過ぎています（期限 ${fmtWhen(dueAt)}・${ctx.cfg.retroIntervalDays}日ごと・${last}${draft}）→ chief-of-staff スキルの「週1回の振り返り」`;
  }
  return `振り返り: 次は ${fmtWhen(dueAt)}（あと ${fmtDur(dueAt - Date.now())}・${ctx.cfg.retroIntervalDays}日ごと・${last}${draft}）`;
}

// ── CoS だったセッションの記録（chief.json） ──
// 振り返りで CoS の会話ログ（ユーザーの発言）を読むために、どのセッションが CoS だったかを観測で残す。
// 記録するのは `cos chief` の起動フック（session_id と transcript_path が来る）と、CoS だけが打つコマンド
// （spawn / send / watch / close）を打ったセッション（Claude Code が Bash に渡す CLAUDE_CODE_SESSION_ID）。
// 作業セッション（COS_WORKER_ID がある）は記録しない。
function noteChiefSession(ctx, sid, via, transcript = null) {
  if (!sid) return;
  withLock(ctx, () => {
    const c = existsSync(ctx.chiefFile) ? JSON.parse(readFileSync(ctx.chiefFile, 'utf8')) : { version: 1, sessions: {} };
    const s = (c.sessions[sid] ??= { firstSeen: now(), via: [] });
    s.lastSeen = now();
    if (transcript) s.transcript = transcript;
    if (!s.via.includes(via)) s.via.push(via);
    writeAtomic(ctx.chiefFile, `${JSON.stringify(c, null, 2)}\n`);
  });
}

function chiefSessionFromEnv() {
  return process.env.COS_WORKER_ID ? null : process.env.CLAUDE_CODE_SESSION_ID || null;
}

function ensureExcluded(common, pattern) {
  const file = join(common, 'info', 'exclude');
  const text = existsSync(file) ? readFileSync(file, 'utf8') : '';
  if (text.split('\n').some((l) => l.trim() === pattern)) return;
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${text && !text.endsWith('\n') ? '\n' : ''}# cos（chief of staff）の依頼書・報告書\n${pattern}\n`);
}

function readReport(w) {
  try {
    const text = readFileSync(w.report, 'utf8');
    return { text, state: reportState(text), mtime: statSync(w.report).mtime.toISOString() };
  } catch {
    return { text: null, state: null, mtime: null };
  }
}

function getWorker(ctx, id, { allowClosed = false } = {}) {
  const w = readLedger(ctx).workers[id];
  if (!w) die(`${id} は台帳にありません（cos status で一覧）`);
  if (!allowClosed && w.state === 'closed') die(`${id} は片付け済みです（控え: ${w.archive ?? '?'}）`);
  return w;
}

function findAgent(w, agents) {
  return agents.find((x) => x.name === w.agent) ?? agents.find((x) => x.pane_id === w.pane && x.agent === w.kind) ?? null;
}

function parseArgs(argv, booleans = []) {
  const pos = [];
  const opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') {
      opt._rest = argv.slice(i + 1);
      break;
    }
    if (a.startsWith('--')) {
      const k = a.slice(2);
      if (booleans.includes(k)) opt[k] = true;
      else {
        const v = argv[++i];
        if (v === undefined) throw new UsageError(`--${k} に値がありません`);
        opt[k] = v;
      }
    } else pos.push(a);
  }
  return { pos, opt };
}

function reportTemplate(id) {
  return `# 報告書 ${id}

状態: 着手前
<!-- 状態は 着手前／進行中／質問／完了／中断 のどれか1語。CoS はこの行を読んで次の手を決める。 -->

## 要約

## 質問

## 進捗

## 検証

## コミット

## CoS に頼みたいこと

## 見つけたこと（依頼の範囲外）
`;
}

function renderBrief(ctx, v) {
  const tpl = readFileSync(join(SKILL_DIR, 'worker-preamble.md'), 'utf8');
  const branchRule =
    v.where === 'worktree'
      ? `6. **コミットは自分のブランチ \`${v.branch}\` にする。** main へのマージ・ブランチの削除・作業ツリーの片付けはしない（CoS がする）。`
      : '6. **追跡されているファイルを変更しない**（調査・レビューの依頼＝作業ツリーは他のセッションと共有している）。成果は報告書に書く。';
  let text = renderTemplate(tpl, {
    ID: v.id,
    TITLE: v.title,
    CWD: v.cwd,
    WHERE: v.where === 'worktree' ? `この依頼専用の git worktree・ブランチ \`${v.branch}\`` : '本体の作業ツリー（他のセッションと共有）',
    REPORT: v.reportFile,
    BRANCH_RULE: branchRule,
  });
  if (ctx.cfg.workerRules) {
    const f = join(ctx.top, ctx.cfg.workerRules);
    if (!existsSync(f)) die(`cos.json の workerRules（${f}）がありません`);
    text += `\n## このリポジトリの決まり\n\n${readFileSync(f, 'utf8').trim()}\n`;
  }
  text += `\n## 依頼\n\n${v.brief}\n`;
  return text;
}

function firstPrompt(w) {
  return `依頼書 ${w.brief} を読み、その決まりと依頼に従って進めてください。報告書は ${w.report} です。`;
}

// ───────── コマンド ─────────

function cmdSpawn(argv) {
  const { pos, opt } = parseArgs(argv, ['no-worktree', 'no-setup', 'force']);
  const id = checkId(pos[0]);
  if (!opt.brief) throw new UsageError('--brief <依頼書のファイル> が要ります');
  const brief = readFileSync(opt.brief, 'utf8').trim();
  if (!brief) die('依頼書が空です');
  requireHerdr();
  const ctx = repoCtx();
  const kind = opt.kind ?? 'claude';
  // --no-worktree は「git の worktree を作らない（本体の作業ツリーを共有する）」だけの意味。herdr のワークスペースは
  // どちらでも1本につき1つ作る（タブだと CoS のワークスペースに埋もれて気づかれない）。
  const where = opt['no-worktree'] ? 'shared' : 'worktree';
  const s = slug(id);
  const agent = agentName(ctx.cfg.agentPrefix, s);
  const title = opt.title ?? id;
  // サイドバーに出るのはワークスペースの名前＝ID ではなく中身が分かる短い名前にする。
  // ID はワークスペースの中のタブの名前と台帳・エージェント名に残る。
  if (!opt.label) throw new UsageError(`--label <サイドバーに出す短い名前（幅 ${ctx.cfg.labelWidth} まで・全角は2）> が要ります。中身が分かる名前に（例: 通知の既読・CSV出力）`);
  const fitted = fitLabel(opt.label, ctx.cfg.labelWidth);
  const label = fitted.label;

  const led = readLedger(ctx);
  const prev = led.workers[id];
  if (prev && prev.state !== 'closed') die(`${id} はすでに台帳にあります（状態 ${prev.state}）。cos status で確かめてください`);
  const active = Object.values(led.workers).filter((w) => w.state !== 'closed');
  if (active.length >= ctx.cfg.maxWorkers && !opt.force) {
    die(`同時に動かす作業セッションは ${ctx.cfg.maxWorkers} 本まで（いま ${active.length} 本）。超えるなら --force`);
  }
  if (herdr(['agent', 'list']).result.agents.some((a) => a.name === agent)) {
    die(`herdr にすでに ${agent} という名前のエージェントがいます（別のリポジトリの作業セッションかもしれません。cos.json の agentPrefix で分けられます）`);
  }

  let cwd;
  let branch = null;
  let base = null;
  let r;
  if (where === 'worktree') {
    branch = `${ctx.cfg.branchPrefix}${s}`;
    if (gitOk(['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], ctx.top)) die(`ブランチ ${branch} がすでにあります`);
    base = git(['rev-parse', '--verify', `${opt.base ?? 'HEAD'}^{commit}`], ctx.top);
    cwd = join(ctx.main, ctx.cfg.worktreeDir, `cos-${s}`);
    if (existsSync(cwd)) die(`${cwd} がすでにあります`);
    r = herdr([
      'worktree', 'create', '--workspace', process.env.HERDR_WORKSPACE_ID,
      '--branch', branch, '--base', base, '--path', cwd, '--label', label, '--no-focus',
    ]).result;
    const root = r.workspace?.worktree?.repo_root;
    if (!root || realpathSync(root) !== realpathSync(ctx.main)) {
      die(`herdr が別のリポジトリ（${root}）に worktree を作りました。CoS のワークスペース ${process.env.HERDR_WORKSPACE_ID} の場所を確かめてください（作られたワークスペース: ${r.workspace?.workspace_id}）`);
    }
  } else {
    cwd = ctx.top;
    r = herdr(['workspace', 'create', '--cwd', cwd, '--label', label, '--no-focus']).result;
  }
  const pane = r.root_pane.pane_id;
  const workspace = r.root_pane.workspace_id ?? r.tab.workspace_id;
  const tab = r.tab.tab_id;
  herdr(['tab', 'rename', tab, id]); // ワークスペースの中のタブには ID を出す

  const mbox = join(cwd, '.cos', s);
  mkdirSync(mbox, { recursive: true });
  ensureExcluded(ctx.common, '.cos/');
  const briefFile = join(mbox, 'brief.md');
  const reportFile = join(mbox, 'report.md');
  writeFileSync(briefFile, renderBrief(ctx, { id, title, where, cwd, branch, reportFile, brief }));
  if (!existsSync(reportFile)) writeFileSync(reportFile, reportTemplate(id));

  const chiefSession = chiefSessionFromEnv();
  const entry = {
    id, title, label, agent, kind, model: opt.model ?? null, where, cwd, branch, base,
    workspace, tab, pane, brief: briefFile, report: reportFile,
    // 振り返りの材料: CoS が書いた依頼書の長さ・どの CoS のセッションが立てたか
    briefChars: [...brief].length, briefLines: brief.split('\n').length, chiefSession,
    createdAt: now(), state: 'starting', lastSeen: null,
  };
  updateLedger(ctx, (l) => {
    l.workers[id] = entry;
  });
  logEvent(ctx, { id, kind: 'spawned', where, agent, pane });
  noteChiefSession(ctx, chiefSession, 'spawn');

  // 作業セッションの印（環境変数）。リポジトリのフックはこれで「作業セッションには禁止」を判定できる。
  // 準備（setup）はエージェントを起動する前に同じシェルで流す＝失敗を CoS がその場で知れる。
  const nonce = Math.random().toString(36).slice(2, 8).toUpperCase();
  const exportsLine = `export COS_WORKER_ID=${shq(id)} COS_WORKER_REPORT=${shq(reportFile)} COS_WORKER_MODE=${where}`;
  const setup = where === 'worktree' && !opt['no-setup'] && ctx.cfg.setup ? ctx.cfg.setup : 'true';
  // 打った行がそのまま画面に出ても一致しないよう、目印は printf で組み立てる。
  // pane run は受け付けたことしか返さない（JSON も無い）＝結果は下の wait-output で見る。
  herdr(['pane', 'run', pane, `${exportsLine}; ${setup} && printf 'COS_${nonce}_%s\\n' OK || printf 'COS_${nonce}_%s\\n' NG`], { json: false });
  let matched;
  try {
    matched = herdr([
      'pane', 'wait-output', pane, '--regex', `COS_${nonce}_(OK|NG)`,
      '--source', 'recent-unwrapped', '--lines', '400', '--timeout', String(ctx.cfg.setupTimeoutSec * 1000),
    ]).result.matched_line;
  } catch (e) {
    setWorker(ctx, id, { state: 'setup-failed' });
    die(`準備（${setup}）が終わりませんでした（${e.code}: ${e.message}）。画面: herdr pane read ${pane} --source recent-unwrapped --lines 80`);
  }
  if (/_NG$/.test(matched)) {
    setWorker(ctx, id, { state: 'setup-failed' });
    die(`準備（${setup}）が失敗しました。画面: herdr pane read ${pane} --source recent-unwrapped --lines 80`);
  }

  const agentArgs = [...(opt.model ? ['--model', opt.model] : []), ...(opt._rest ?? [])];
  try {
    herdr(['agent', 'start', agent, '--kind', kind, '--pane', pane, '--timeout', '90000', ...(agentArgs.length ? ['--', ...agentArgs] : [])]);
  } catch (e) {
    if (e.code === 'agent_not_ready') {
      setWorker(ctx, id, { state: 'start-blocked' });
      die(`${agent} は起動時の確認画面で止まっています。ユーザーに見てもらい、片付いたら cos send ${id} --first で依頼を渡してください（画面: cos read ${id}）`, 3);
    }
    setWorker(ctx, id, { state: 'start-failed' });
    die(`${agent} を起動できませんでした（${e.code}: ${e.message}）`);
  }

  sendFirst(ctx, { ...entry, state: 'starting' });

  console.log(`立てました: ${id} → エージェント ${agent}（ワークスペース「${label}」${fitted.cut ? `＝幅 ${ctx.cfg.labelWidth} に切りました（cos rename で付け直せます）` : ''}・ワークスペース ${workspace}・タブ ${tab}・ペイン ${pane}）`);
  if (where === 'worktree') console.log(`  作業ツリー: ${cwd}（ブランチ ${branch}・base ${base.slice(0, 10)}）`);
  else console.log(`  作業ツリー: ${cwd}（本体と共有・worktree なし）`);
  console.log(`  依頼書: ${briefFile}\n  報告書: ${reportFile}`);
  console.log('見張りがまだなら cos watch を裏で走らせてください。');
}

// 最初の指示を送り、エージェントが動き出したことを確かめて running にする。
function sendFirst(ctx, w) {
  try {
    herdr(['agent', 'prompt', w.agent, firstPrompt(w), '--wait', '--timeout', '20000']);
  } catch (e) {
    // timeout = まだ動いている（良い知らせ）。それ以外は届いたか分からない＝二重送信を避けて人に見せる。
    if (e.code !== 'timeout') {
      setWorker(ctx, w.id, { state: 'start-failed' });
      die(`最初の指示が届いたか確かめられませんでした（${e.code}: ${e.message}）。もう一度送る前に cos read ${w.id} で画面を見てください`);
    }
  }
  const a = herdr(['agent', 'get', w.agent]).result.agent;
  // すでにターンが終わっていた（速い・承認待ち）なら lastSeen を空けておく＝見張りが出来事として拾う。
  const lastSeen = a.agent_status === 'working' ? { status: a.agent_status, seq: a.state_change_seq ?? null } : null;
  setWorker(ctx, w.id, { state: 'running', lastSeen, startedAt: now() });
}

function cmdSend(argv) {
  const { pos, opt } = parseArgs(argv, ['first']);
  const id = checkId(pos[0]);
  requireHerdr();
  const ctx = repoCtx();
  const w = getWorker(ctx, id);
  if (opt.first) {
    sendFirst(ctx, w);
    console.log(`${id}（${w.agent}）に依頼書を渡しました`);
    return;
  }
  let text;
  if (opt.file) {
    // 長い指示はファイルにして作業セッションの受け箱に置き、短い一文で読ませる（入力欄に長文を流さない・控えが残る）。
    const dir = dirname(w.report);
    const n = readdirSync(dir).filter((f) => /^msg-\d+\.md$/.test(f)).length + 1;
    const dst = join(dir, `msg-${String(n).padStart(2, '0')}.md`);
    copyFileSync(opt.file, dst);
    text = `CoS からの追加の指示です。${dst} を読んで続けてください（報告書は ${w.report}）。`;
  } else {
    text = pos.slice(1).join(' ').trim();
    if (!text) throw new UsageError('送る文（または --file / --first）が要ります');
  }
  try {
    herdr(['agent', 'prompt', w.agent, text]);
  } catch (e) {
    if (e.code === 'agent_blocked') die(`${w.agent} は承認や質問の画面で止まっています。cos read ${id} で内容を見て、ユーザーに伝えてください（CoS は答えない）`);
    throw e;
  }
  logEvent(ctx, { id, kind: 'sent', file: opt.file ? text : undefined });
  noteChiefSession(ctx, chiefSessionFromEnv(), 'send');
  console.log(`${id}（${w.agent}）に送りました`);
}

function cmdWatch(argv) {
  const { opt } = parseArgs(argv, []);
  const timeoutMs = Number(opt.timeout ?? 3000) * 1000;
  const intervalMs = Number(opt.interval ?? 5) * 1000;
  requireHerdr();
  const ctx = repoCtx();
  const interval = ctx.cfg.retroIntervalDays;
  noteChiefSession(ctx, chiefSessionFromEnv(), 'watch');
  // 期限の記録が無ければここで作る（期間の始まり＝台帳の最初の依頼）。
  if (!existsSync(ctx.retroFile)) updateRetro(ctx, () => {});
  const t0 = Date.now();
  for (;;) {
    const led = readLedger(ctx);
    const ws = Object.values(led.workers).filter((w) => WATCHED.has(w.state));
    // 作業セッションが0本なら herdr に問い合わせない（0本でも見張りは終わらない＝振り返りの期限を待つ）。
    const { events, seen } = ws.length > 0 ? detectEvents(ws, herdr(['agent', 'list']).result.agents) : { events: [], seen: {} };
    if (Object.keys(seen).length > 0) {
      updateLedger(ctx, (l) => {
        for (const [id, st] of Object.entries(seen)) if (l.workers[id]) l.workers[id].lastSeen = st;
      });
    }
    let retroNotify = false;
    if (events.length === 0 && retroDue(peekRetro(ctx), interval, Date.now()).notify) {
      // 同じ日に二度出さない。見張りが2本走っていても1本だけが出すよう、ロックの中で確かめ直して印を付ける。
      retroNotify = updateRetro(ctx, (r) => {
        if (!retroDue(r, interval, Date.now()).notify) return false;
        r.notifiedAt = now();
        return true;
      });
    }
    const step = watchStep({ events, retroNotify, timedOut: Date.now() - t0 > timeoutMs });
    if (step === 'retro-due') {
      const r = peekRetro(ctx);
      const { dueAt } = retroDue(r, interval, Date.now());
      const ev = { event: 'retro-due', since: r.since, dueAt: new Date(dueAt).toISOString(), intervalDays: interval };
      logEvent(ctx, { kind: 'retro-due', since: r.since });
      console.log(JSON.stringify(ev));
      console.log(`\n週1回の振り返りの期限です（${fmtWhen(Date.parse(r.since))} から ${interval} 日・期限 ${fmtWhen(dueAt)}）。`);
      console.log('chief-of-staff スキルの「週1回の振り返り」に沿って cos retro collect から始めてください（ユーザーとの話の途中なら区切りで）。今日はもう知らせません。');
      console.log('\n対応したら cos watch を張り直してください。');
      return;
    }
    if (step === 'events') {
      for (const ev of events) {
        const w = led.workers[ev.id];
        ev.report = readReport(w).state;
        ev.startBlocked = w.state === 'start-blocked' || undefined;
        logEvent(ctx, { kind: 'event', ...ev });
        console.log(JSON.stringify(ev));
      }
      console.log('');
      for (const ev of events) {
        const what = {
          idle: 'ターンが終わった',
          done: 'ターンが終わった',
          blocked: '承認や質問の画面で止まっている',
          gone: 'エージェントがいなくなった',
        }[ev.status];
        console.log(`${ev.id}（${ev.agent}）: ${what}・報告書の状態「${ev.report ?? '読めない'}」${ev.startBlocked ? '・まだ依頼書を渡していない（片付いたら cos send --first）' : ''}`);
      }
      console.log('\n対応したら cos watch を張り直してください。');
      return;
    }
    if (step === 'timeout') {
      console.log(JSON.stringify({ event: 'timeout' }));
      console.log('何も起きないまま時間切れ。cos watch を張り直してください。');
      return;
    }
    sleep(intervalMs);
  }
}

function cmdStatus(argv) {
  const { opt } = parseArgs(argv, ['all', 'json']);
  const ctx = repoCtx();
  const led = readLedger(ctx);
  let agents = [];
  let herdrErr = null;
  try {
    agents = herdr(['agent', 'list']).result.agents;
  } catch (e) {
    herdrErr = e.message;
  }
  const head = git(['rev-parse', 'HEAD'], ctx.top);
  const rows = Object.values(led.workers)
    .filter((w) => opt.all || w.state !== 'closed')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((w) => {
      const a = w.state === 'closed' ? null : findAgent(w, agents);
      const rep = w.state === 'closed' ? { state: null, mtime: null } : readReport(w);
      const row = {
        id: w.id, title: w.title, label: w.label ?? null, agent: w.agent, state: w.state, where: w.where,
        status: a ? a.agent_status : w.state === 'closed' ? '-' : 'gone',
        report: rep.state, reportUpdated: rep.mtime, workspace: w.workspace, pane: w.pane,
        branch: w.branch, cwd: w.cwd,
      };
      if (w.where === 'worktree' && w.state !== 'closed' && existsSync(w.cwd)) {
        row.commits = Number(git(['rev-list', '--count', `${w.base}..${w.branch}`], ctx.top));
        row.merged = gitOk(['merge-base', '--is-ancestor', w.branch, head], ctx.top);
        row.dirty = git(['status', '--porcelain'], w.cwd).split('\n').filter(Boolean).length;
      }
      return row;
    });
  if (opt.json) {
    const r = peekRetro(ctx);
    const { dueAt, due } = retroDue(r, ctx.cfg.retroIntervalDays, Date.now());
    const retro = { since: r.since, dueAt: new Date(dueAt).toISOString(), due, notifiedAt: r.notifiedAt, draft: r.draft, stored: r.stored };
    console.log(JSON.stringify({ workers: rows, herdrError: herdrErr, retro }, null, 2));
    return;
  }
  if (herdrErr) console.log(`（herdr に問い合わせられません: ${herdrErr}）`);
  const live = rows.filter((r) => r.state !== 'closed').length;
  console.log(`作業セッション ${live} 本（上限 ${ctx.cfg.maxWorkers}）・台帳 ${ctx.ledgerFile}`);
  if (rows.length === 0) console.log('  （なし）');
  for (const r of rows) {
    const rep = r.report ? `報告「${r.report}」${r.reportUpdated ? `（${ago(r.reportUpdated)}）` : ''}` : '報告なし';
    const st = r.state === 'running' ? r.status : `${r.state}${r.status !== '-' ? `／${r.status}` : ''}`;
    console.log(`  ${r.id}「${r.label ?? '-'}」  ${r.agent}  ${st}  ${rep}  ${r.title !== r.id ? r.title : ''}`);
    if (r.where === 'worktree' && r.commits !== undefined) {
      console.log(`      ${r.branch}  コミット ${r.commits}${r.commits ? (r.merged ? '（マージ済み）' : '（未マージ）') : ''}・未コミット ${r.dirty}  ワークスペース ${r.workspace}・ペイン ${r.pane}`);
    } else if (r.state !== 'closed') {
      const place = r.where === 'tab' ? '本体の作業ツリー（共有）・CoS のワークスペースのタブ' : r.where === 'shared' ? '本体の作業ツリー（共有）' : r.cwd;
      console.log(`      ${place}  ワークスペース ${r.workspace}・ペイン ${r.pane}`);
    }
  }
  console.log(retroLine(ctx));
}

function cmdRename(argv) {
  const { pos } = parseArgs(argv, []);
  const id = checkId(pos[0]);
  const want = pos.slice(1).join(' ');
  if (!want.trim()) throw new UsageError('新しい名前が要ります');
  requireHerdr();
  const ctx = repoCtx();
  const w = getWorker(ctx, id);
  const { label, cut } = fitLabel(want, ctx.cfg.labelWidth);
  const place = herdrPlace(w);
  herdr([place.kind, 'rename', place.id, label]);
  setWorker(ctx, id, { label });
  console.log(`${id} の名前を「${label}」にしました${cut ? `（幅 ${ctx.cfg.labelWidth} に切りました）` : ''}`);
}

function cmdReport(argv) {
  const { pos } = parseArgs(argv, []);
  const id = checkId(pos[0]);
  const ctx = repoCtx();
  const w = getWorker(ctx, id, { allowClosed: true });
  const file = w.state === 'closed' ? join(w.archive, 'report.md') : w.report;
  if (!existsSync(file)) die(`報告書がありません: ${file}`);
  console.log(`# ${file}\n`);
  process.stdout.write(readFileSync(file, 'utf8'));
}

function cmdRead(argv) {
  const { pos, opt } = parseArgs(argv, []);
  const id = checkId(pos[0]);
  requireHerdr();
  const ctx = repoCtx();
  const w = getWorker(ctx, id);
  const lines = String(opt.lines ?? 60);
  const a = findAgent(w, herdr(['agent', 'list']).result.agents);
  const out = a
    ? herdr(['agent', 'read', a.pane_id, '--source', 'recent-unwrapped', '--lines', lines], { json: false })
    : herdr(['pane', 'read', w.pane, '--source', 'recent-unwrapped', '--lines', lines], { json: false });
  process.stdout.write(out);
}

// 作業セッションを穏やかに終わらせる（SessionEnd のフックを走らせるため）。承認待ちなどで届かなければそのまま。
function stopAgent(w) {
  let a;
  try {
    a = findAgent(w, herdr(['agent', 'list']).result.agents);
  } catch {
    return;
  }
  if (!a || a.agent_status === 'blocked') return;
  try {
    herdr(['agent', 'prompt', a.pane_id, '/exit']);
  } catch {
    return;
  }
  for (let i = 0; i < 30; i++) {
    sleep(500);
    try {
      if (!findAgent(w, herdr(['agent', 'list']).result.agents)) return;
    } catch {
      return;
    }
  }
}

function workspaceExists(id) {
  try {
    herdr(['workspace', 'get', id]);
    return true;
  } catch {
    return false;
  }
}

function tabExists(id) {
  try {
    herdr(['tab', 'get', id]);
    return true;
  } catch {
    return false;
  }
}

function cmdClose(argv) {
  const { pos, opt } = parseArgs(argv, ['force', 'keep-branch']);
  const id = checkId(pos[0]);
  requireHerdr();
  const ctx = repoCtx();
  const w = getWorker(ctx, id);
  const s = slug(id);

  let merged = true;
  if (w.where === 'worktree') {
    if (existsSync(w.cwd)) {
      const dirty = git(['status', '--porcelain'], w.cwd);
      if (dirty && !opt.force) die(`未コミットの変更があります（捨ててよければ --force）:\n${dirty}`);
    }
    const hasBranch = gitOk(['show-ref', '--verify', '--quiet', `refs/heads/${w.branch}`], ctx.top);
    merged = !hasBranch || gitOk(['merge-base', '--is-ancestor', w.branch, 'HEAD'], ctx.top);
    if (!merged && !opt.force) die(`${w.branch} はこのツリーの HEAD にマージされていません（捨ててよければ --force）`);
  }

  // 控えを先に取る（worktree を消すと依頼書・報告書も消える）。
  const archive = join(ctx.dir, 'archive', `${s}-${now().replace(/[:.]/g, '').slice(0, 15)}`);
  mkdirSync(archive, { recursive: true });
  const mbox = dirname(w.report);
  if (existsSync(mbox)) for (const f of readdirSync(mbox)) copyFileSync(join(mbox, f), join(archive, f));

  stopAgent(w);
  if (w.where === 'worktree') {
    if (workspaceExists(w.workspace)) {
      herdr(['worktree', 'remove', '--workspace', w.workspace, ...(opt.force ? ['--force'] : [])]);
    } else if (existsSync(w.cwd)) {
      // ワークスペースはユーザーが閉じ済み。worktree だけ残っている。
      git(['worktree', 'remove', ...(opt.force ? ['--force'] : []), w.cwd], ctx.top);
    }
    if (!opt['keep-branch'] && gitOk(['show-ref', '--verify', '--quiet', `refs/heads/${w.branch}`], ctx.top)) {
      git(['branch', merged ? '-d' : '-D', w.branch], ctx.top);
    }
  } else {
    // 作業ツリーを分けない依頼: そのワークスペース（古い形はタブ）を閉じ、受け箱を消す（控えは取ってある）。
    const place = herdrPlace(w);
    const exists = place.kind === 'workspace' ? workspaceExists(place.id) : tabExists(place.id);
    if (exists) herdr([place.kind, 'close', place.id]); // 無ければユーザーが閉じ済み
    rmSync(mbox, { recursive: true, force: true });
  }
  // 片付け方も残す（振り返りの材料）。merged は worktree のときだけ意味がある（作業ツリーを分けない依頼は null）。
  setWorker(ctx, id, {
    state: 'closed', closedAt: now(), archive,
    forced: Boolean(opt.force), merged: w.where === 'worktree' ? merged : null,
  });
  logEvent(ctx, { id, kind: 'closed', forced: Boolean(opt.force) });
  noteChiefSession(ctx, chiefSessionFromEnv(), 'close');
  console.log(`片付けました: ${id}（控え ${archive}）`);
}

// SessionStart のフック。`cos chief` で起動した CoS のセッションだけで動く（chief-settings.json）。
// - どの起動でも、このセッションを CoS として chief.json に記録する（振り返りで会話ログを読むため）。
// - startup / resume: 振り返りの期限を1行だけ戻す（手順は /chief-of-staff で読み込まれる）。
// - compact / clear（と手で打ったとき）: 会話が要約・消去されると、CoS であること・リポジトリの決まり・
//   見張りのことが抜けうる＝手順と今の一覧（振り返りの期限を含む）を戻す。
// フックの出力は JSON 1個だけ。一覧が取れなくても手順は戻す（取れなかったことも書く）。
function cmdReorient(argv = []) {
  const { opt } = parseArgs(argv, ['hook']);
  let input = {};
  let inputErr = null;
  if (opt.hook) {
    // フックは標準入力に JSON（session_id・transcript_path・source）を渡して閉じる。手で打つときは --hook を付けない。
    try {
      input = JSON.parse(readFileSync(0, 'utf8') || '{}');
    } catch (e) {
      inputErr = e.message;
    }
  }
  const source = input.source ?? 'manual';
  const inRepo = gitOk(['rev-parse', '--git-dir'], process.cwd());
  let ctx = null;
  if (inRepo) {
    ctx = repoCtx();
    if (input.session_id) noteChiefSession(ctx, input.session_id, `hook:${source}`, input.transcript_path ?? null);
  }
  let retro;
  let retroIsDue = false;
  try {
    retro = ctx ? retroLine(ctx) : '振り返り: （git リポジトリの外なので分かりません）';
    retroIsDue = ctx ? retroDue(peekRetro(ctx), ctx.cfg.retroIntervalDays, Date.now()).due : false;
  } catch (e) {
    retro = `振り返り: （期限の記録が読めません: ${e.message}）`;
  }
  const emit = (text) =>
    console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text } }));
  if (source === 'startup' || source === 'resume') {
    emit([`[chief of staff] ${retro}`, inputErr ? `（フックの入力が読めませんでした: ${inputErr}）` : ''].filter(Boolean).join('\n'));
    return;
  }
  let status;
  try {
    status = execFileSync(process.execPath, [fileURLToPath(import.meta.url), 'status'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (e) {
    status = `（cos status が失敗しました: ${String(e.stderr || e.message).trim()}）`;
  }
  // git の外なら決まりの場所は分からない（手順だけ戻す）。
  const rules = ctx?.cfg.chiefRules ? join(ctx.top, ctx.cfg.chiefRules) : '';
  const text = [
    '[chief of staff] このセッションは CoS（chief of staff）です（`cos chief` で起動）。会話が要約または消去されたので、続ける前に次を行ってください。',
    '1. chief-of-staff スキル（~/.claude/skills/chief-of-staff/SKILL.md）を読み直す。',
    rules ? `2. このリポジトリの CoS の決まり（${rules}）を読み直す。` : '2. リポジトリに .claude/cos.json の chiefRules があれば読み直す。',
    '3. 下の一覧で依頼中の作業セッションを確かめ、`cos watch` が裏で動いていなければ run_in_background で張り直す（作業セッションが0本でも張る＝振り返りの期限も見張っている）。',
    '4. ユーザーとの決定は ROADMAP などの耐久層に残っているので、要約に無いことは推測せずそこから引く。',
    ...(retroIsDue ? ['5. 週1回の振り返りの期限を過ぎています。ユーザーとの話の区切りで、スキルの「週1回の振り返り」に沿って進める。'] : []),
    ...(inputErr ? [`（フックの入力が読めませんでした: ${inputErr}）`] : []),
    '',
    status,
  ].join('\n');
  emit(text);
}

// ───────── 週1回の振り返り ─────────
// 材料を機械的に集めて下書きにするまでが cos の仕事。何が良くて何が悪かったか・改善案は CoS が書き、
// 改善案はユーザーが承認したものだけ反映する（手順は SKILL.md の「週1回の振り返り」）。

function cmdRetro(argv) {
  const [sub, ...rest] = argv;
  if (sub === 'status') return retroStatus();
  if (sub === 'collect') return retroCollect(rest);
  if (sub === 'done') return retroDone(rest);
  throw new UsageError('cos retro status | collect [--since ISO] [--until ISO] [--session ID,...] [--out F] [--force] | done [--file F]');
}

function retroStatus() {
  const ctx = repoCtx();
  const r = peekRetro(ctx);
  console.log(retroLine(ctx));
  console.log(`  期間の始まり ${fmtWhen(Date.parse(r.since))}（${r.since}）${r.stored ? '' : '・記録はまだありません（最初の cos watch か cos retro collect で作られます）'}`);
  if (r.notifiedAt) console.log(`  最後に知らせた ${fmtWhen(Date.parse(r.notifiedAt))}`);
  for (const h of (r.history ?? []).slice(-5)) {
    const t = h.tally ? `  採用 ${h.tally.採用}・却下 ${h.tally.却下}・保留 ${h.tally.保留}` : '';
    console.log(`  済 ${fmtWhen(Date.parse(h.from))} 〜 ${fmtWhen(Date.parse(h.to))}  ${h.file}${t}`);
  }
  console.log(`  期限の記録 ${ctx.retroFile}`);
}

function parseTime(s, name) {
  const t = Date.parse(s);
  if (Number.isNaN(t)) throw new UsageError(`--${name} が日時として読めません: ${s}`);
  return t;
}

// セッションの会話ログを探す。フックが渡した transcript_path があればそれ、無ければ Claude Code の projects の下を ID で探す。
function findTranscript(sid, known) {
  if (known && existsSync(known)) return known;
  const base = join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects');
  if (!existsSync(base)) return null;
  for (const d of readdirSync(base)) {
    const f = join(base, d, `${sid}.jsonl`);
    if (existsSync(f)) return f;
  }
  return null;
}

// 会話ログは大きい（100MB を超えることもある）ので、人の発言を含みうる行（"human" を含む行）だけを JSON として読む。
// 読めない行（書きかけの最終行など）は数えて下書きに出す（黙って捨てない）。
function readHumanEntries(file) {
  const entries = [];
  let bad = 0;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.includes('"human"')) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      bad++;
    }
  }
  return { entries, bad };
}

function cell(s) {
  return String(s ?? '').replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');
}

// 発言を下書きのリストの1項目にする。長いものは切る。続きの行は字下げして、発言の中の「## 」や
// HTML コメントが記録の見出し・説明として読まれないようにする。
function utterItem(u, star) {
  const MAX = 700;
  const chars = [...u.text];
  let t = chars.length > MAX ? `${chars.slice(0, MAX).join('')}…（全 ${chars.length} 字）` : u.text;
  t = t.replace(/<!--/g, '＜!--').replace(/-->/g, '--＞');
  const [first, ...more] = t.split('\n');
  return [`- ${star ? '★ ' : ''}${fmtWhen(u.t)} [${u.sid.slice(0, 8)}] ${first}`, ...more.map((l) => `  ${l}`)].join('\n');
}

function median(xs) {
  const v = xs.filter((x) => x !== null).sort((a, b) => a - b);
  if (!v.length) return null;
  return v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
}

function retroCollect(argv) {
  const { opt } = parseArgs(argv, ['force']);
  const ctx = repoCtx();
  const r = peekRetro(ctx);
  const sinceMs = opt.since ? parseTime(opt.since, 'since') : Date.parse(r.since);
  const untilMs = opt.until ? parseTime(opt.until, 'until') : Date.now();
  if (!(sinceMs < untilMs)) throw new UsageError('期間の始まりが終わりより後です');
  const out = opt.out ? resolve(opt.out) : join(ctx.retrosDir, `${localDay(untilMs)}.md`);
  if (existsSync(out) && !opt.force) die(`${out} がすでにあります（書きかけの振り返りかもしれません。読み直すか、作り直すなら --force）`);

  // 依頼ごとの数字（期間に重なる依頼＝期間中に立てた・動いていた・片付けたもの）
  const led = readLedger(ctx);
  const events = readEvents(ctx);
  const rows = Object.values(led.workers)
    .filter((w) => Date.parse(w.createdAt) < untilMs && (w.closedAt ? Date.parse(w.closedAt) : Date.now()) >= sinceMs)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((w) => {
      const st = requestStats(w, events);
      let chars = w.briefChars ?? null;
      let lines = w.briefLines ?? null;
      if (chars === null) {
        // 台帳に長さが無い（この記録を足す前の依頼）→ 依頼書（片付け済みなら控え）から CoS が書いた部分を測る
        const f = w.state === 'closed' && w.archive ? join(w.archive, 'brief.md') : w.brief;
        const body = f && existsSync(f) ? briefBody(readFileSync(f, 'utf8')) : null;
        if (body !== null) {
          chars = [...body].length;
          lines = body.split('\n').length;
        }
      }
      let how;
      if (w.state !== 'closed') how = `未完（${w.state}）`;
      else if (st.forced) how = w.merged === false ? '--force（未マージ）' : '--force';
      else how = w.where === 'worktree' ? 'マージ済み' : '片付け（調査）';
      const t0 = Date.parse(w.createdAt);
      return {
        w, st, chars, lines, how,
        toDone: st.doneAt ? Date.parse(st.doneAt) - t0 : null,
        toClose: w.closedAt ? Date.parse(w.closedAt) - t0 : null,
      };
    });

  // CoS の会話ログからユーザーの発言
  const chief = existsSync(ctx.chiefFile) ? JSON.parse(readFileSync(ctx.chiefFile, 'utf8')) : { sessions: {} };
  const sids = new Map(Object.entries(chief.sessions).map(([id, s]) => [id, s.transcript ?? null]));
  for (const id of String(opt.session ?? '').split(',').map((s) => s.trim()).filter(Boolean)) if (!sids.has(id)) sids.set(id, null);
  const sessions = [];
  const utter = [];
  for (const [sid, known] of sids) {
    const f = findTranscript(sid, known);
    if (!f) {
      sessions.push({ sid, file: null, n: 0, bad: 0 });
      continue;
    }
    if (statSync(f).mtimeMs < sinceMs) {
      sessions.push({ sid, file: f, n: 0, bad: 0, old: true }); // 期間より前に終わったログは読まない
      continue;
    }
    const { entries, bad } = readHumanEntries(f);
    const us = humanUtterances(entries, sinceMs, untilMs);
    sessions.push({ sid, file: f, n: us.length, bad });
    for (const u of us) utter.push({ ...u, sid });
  }
  utter.sort((a, b) => a.t - b.t);
  const stars = utter.filter((u) => looksLikePushback(u.text)).length;

  // これまでの改善案
  const past = [];
  for (const h of r.history ?? []) {
    if (h.file && existsSync(h.file)) {
      for (const l of pastProposals(readFileSync(h.file, 'utf8'))) past.push(`- ${localDay(Date.parse(h.to))} ${l.replace(/^[-*]\s*/, '')}`);
    } else past.push(`- ${h.file ?? '?'}: 記録が見つかりません`);
  }

  // モデル別
  const byModel = new Map();
  for (const x of rows) {
    const k = x.w.model ?? '既定';
    if (!byModel.has(k)) byModel.set(k, []);
    byModel.get(k).push(x);
  }
  const sum = (xs, f) => xs.reduce((a, x) => a + f(x), 0);

  const L = [];
  L.push(`# CoS の振り返り ${localDay(untilMs)}`, '');
  L.push(`- 期間: ${fmtWhen(sinceMs)} 〜 ${fmtWhen(untilMs)}（${fmtDur(untilMs - sinceMs)}）`);
  L.push(`- リポジトリ: ${ctx.main}`);
  L.push(`- 下書きを作った時刻: ${fmtWhen(Date.now())}（cos retro collect）`, '');
  L.push('<!-- 「材料」は cos retro collect が機械的に集めたもの（判断は入っていない）。「振り返り」と「改善案」を CoS が書き、', '改善案はユーザーに差分で見せて採否をもらう。終わったら cos retro done。 -->', '');
  L.push('## 材料', '', `### 依頼（${rows.length} 件）`, '');
  if (rows.length) {
    L.push('| ID | 題 | モデル | 場所 | 依頼書 | 追加の指示 | 質問で停止 | 承認待ち | 完了まで | 片付けまで | 片付け方 |');
    L.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const x of rows) {
      L.push(`| ${cell(x.w.id)} | ${cell(x.w.title)} | ${cell(x.w.model ?? '既定')} | ${x.w.where} | ${x.chars === null ? '?' : `${x.chars}字/${x.lines}行`} | ${x.st.sends} | ${x.st.questions} | ${x.st.blocked} | ${x.toDone === null ? '-' : fmtDur(x.toDone)} | ${x.toClose === null ? '-' : fmtDur(x.toClose)} | ${x.how} |`);
    }
    L.push('');
    L.push('- 依頼書＝CoS が書いた部分（前置き・リポジトリの決まりを除く）。追加の指示＝`cos send` の回数（質問への答えも含む）。');
    L.push('- 質問で停止＝報告書が「質問」の状態でターンが終わった回数。承認待ち＝承認や質問の画面で止まった回数。');
    L.push('- 完了まで＝立ててから、報告書が初めて「完了」でターンを終えるまで。片付けまで＝立ててから `cos close` まで。');
    L.push('');
    for (const [k, xs] of byModel) {
      const md = median(xs.map((x) => x.toDone));
      L.push(`- モデル ${k}: ${xs.length} 件・追加の指示 計 ${sum(xs, (x) => x.st.sends)}・質問で停止 計 ${sum(xs, (x) => x.st.questions)}・完了まで 中央値 ${md === null ? '-' : fmtDur(md)}`);
    }
  } else L.push('- なし');
  L.push('', '### これまでの改善案（同じ案を繰り返さない）', '');
  L.push(...(past.length ? past : ['- なし（最初の振り返り）']));
  L.push('', `### ユーザーの発言（CoS の会話・${utter.length} 件・★ は訂正や問い直しらしいもの ${stars} 件）`, '');
  L.push('<!-- ユーザーが打った発言だけ（ツールの出力・作業セッションの画面・他のセッションからのメッセージは入れていない）。 -->');
  for (const s of sessions) {
    const what = !s.file ? '会話ログが見つかりません' : s.old ? '期間より前のログ（読んでいない）' : `${s.n} 件${s.bad ? `・読めない行 ${s.bad}` : ''}`;
    L.push(`- 会話 ${s.sid}: ${what}`);
  }
  if (!sessions.length) L.push('- CoS のセッションの記録がありません（cos chief の起動フックか、cos watch/spawn を打ったセッションが記録されます。--session で足せます）');
  L.push('');
  for (const u of utter) L.push(utterItem(u, looksLikePushback(u.text)));
  L.push('', '## 振り返り', '');
  L.push('<!-- 良かったこと・悪かったこと。材料のどの数字・どの発言からそう言えるかを添える。観点:');
  L.push('- 依頼書: 長さと手戻り（追加の指示）・質問の回数。質問の中身は依頼書で先に決められたか。');
  L.push('- 聞く／聞かない: ★の発言はどの判断の結果か（聞かずに進めた・聞きすぎた・推測で書いた）。');
  L.push('- 自分でやる／投げる: CoS が自分で調べ込んで文脈を使った場面・投げるのが遅れた場面（一次トリアージの線引き）。');
  L.push('- モデルの割り振り: モデルごとの往復・手戻り・所要。軽いモデルに回せた依頼・回して手戻りした依頼。');
  L.push('-->', '', '## 改善案', '');
  L.push('<!-- 1案ずつ次の形で書く（ユーザーに見せる前は [未定]）:');
  L.push('- [未定] <対象のファイル>: <何を変えるか一言>');
  L.push('  - 材料: <どの数字・どの発言から>');
  L.push('  - 差分: ```diff で');
  L.push('ユーザーの答えで [採用]／[却下]／[保留] に書き換え、却下・保留は同じ行の末尾に「— 理由」を足す。');
  L.push('「これまでの改善案」で却下・保留になった案は、状況が変わったと言えるときだけ出し直す（何が変わったかを書く）。');
  L.push('案が無ければ「- なし」と書く。[未定] が残っていると cos retro done は断る。 -->', '');

  mkdirSync(dirname(out), { recursive: true });
  writeAtomic(out, `${L.join('\n')}\n`);
  updateRetro(ctx, (x) => {
    x.draft = out;
  });
  logEvent(ctx, { kind: 'retro-collect', file: out, requests: rows.length, utterances: utter.length });

  console.log(`振り返りの下書きを作りました: ${out}`);
  console.log(`  期間 ${fmtWhen(sinceMs)} 〜 ${fmtWhen(untilMs)}`);
  console.log(`  依頼 ${rows.length} 件（追加の指示 計 ${sum(rows, (x) => x.st.sends)}・質問で停止 計 ${sum(rows, (x) => x.st.questions)}）`);
  console.log(`  ユーザーの発言 ${utter.length} 件（★ ${stars} 件）・CoS の会話 ${sessions.length} 本（見つからない ${sessions.filter((s) => !s.file).length} 本）`);
  console.log(`  これまでの改善案 ${past.length} 件`);
  console.log('中身（会話の本文を含む）はファイルで読んでください。会話に貼り込まない。');
}

function retroDone(argv) {
  const { opt } = parseArgs(argv, []);
  const ctx = repoCtx();
  const r = peekRetro(ctx);
  const file = opt.file ? resolve(opt.file) : r.draft;
  if (!file) die('書きかけの振り返りがありません（cos retro collect で下書きを作るか、--file で記録を指す）');
  if (!existsSync(file)) die(`記録がありません: ${file}`);
  const chk = checkRecord(readFileSync(file, 'utf8'));
  if (!chk.ok) die(`${file}: ${chk.reason}`);
  const to = now();
  updateRetro(ctx, (x) => {
    x.history = [...(x.history ?? []), { from: x.since, to, file, tally: chk.tally }];
    x.since = to;
    x.notifiedAt = null;
    x.draft = null;
  });
  logEvent(ctx, { kind: 'retro-done', file, tally: chk.tally });
  console.log(`振り返りを締めました（採用 ${chk.tally.採用}・却下 ${chk.tally.却下}・保留 ${chk.tally.保留}）。次の期限は ${fmtWhen(Date.parse(to) + ctx.cfg.retroIntervalDays * DAY_MS)}。`);
}

function selfTest() {
  const assert = (c, m) => {
    if (!c) throw new Error(`self-test 失敗: ${m}`);
  };
  assert(slug('T-42') === 't-42', 'slug');
  assert(agentName('', 't-42') === 't-42', 'agentName 素');
  assert(agentName('ab-', 't-42') === 'ab-t-42', 'agentName 接頭辞');
  assert(agentName('', '42') === 'w-42', 'agentName 数字始まり');
  assert(agentName('', 'a'.repeat(40)).length === 32, 'agentName 長さ');
  assert(reportState('# x\n\n状態: 完了\n') === '完了', 'reportState');
  assert(reportState('# x\n') === null, 'reportState 無し');
  let threw = false;
  try {
    checkId('../x');
  } catch {
    threw = true;
  }
  assert(threw, 'checkId 不正');
  assert(shq("a'b") === `'a'\\''b'`, 'shq');
  assert(displayWidth('通知の既読') === 10 && displayWidth('CSV出力') === 7, 'displayWidth');
  assert(fitLabel('通知の既読', 10).cut === false, 'fitLabel 収まる');
  const f = fitLabel('検索の画面を作り直す', 10);
  assert(f.label === '検索の画面' && f.cut, 'fitLabel 全角で切る');
  assert(fitLabel('abcdefghijkl', 10).label === 'abcdefghij', 'fitLabel 半角で切る');

  const w = (o) => ({ id: 'A', agent: 'a', pane: 'w1:p1', kind: 'claude', lastSeen: null, ...o });
  const ag = (o) => ({ name: 'a', pane_id: 'w1:p1', agent: 'claude', agent_status: 'working', state_change_seq: 1, ...o });
  // 起動直後の working は記録だけ
  let r = detectEvents([w()], [ag()]);
  assert(r.events.length === 0 && r.seen.A.status === 'working', 'working は出来事にしない');
  // working → done は出来事
  r = detectEvents([w({ lastSeen: { status: 'working', seq: 1 } })], [ag({ agent_status: 'done', state_change_seq: 2 })]);
  assert(r.events.length === 1 && r.events[0].status === 'done', 'done を拾う');
  // 同じ done は二度出さない
  r = detectEvents([w({ lastSeen: { status: 'done', seq: 2 } })], [ag({ agent_status: 'done', state_change_seq: 2 })]);
  assert(r.events.length === 0, '同じ状態は出さない');
  // 次のターンが終わって seq が進めば再び出す
  r = detectEvents([w({ lastSeen: { status: 'done', seq: 2 } })], [ag({ agent_status: 'done', state_change_seq: 4 })]);
  assert(r.events.length === 1, 'seq が進んだ done は出す');
  // 承認待ち
  r = detectEvents([w({ lastSeen: { status: 'working', seq: 1 } })], [ag({ agent_status: 'blocked', state_change_seq: 2 })]);
  assert(r.events[0]?.status === 'blocked', 'blocked を拾う');
  // いなくなった → 1回だけ
  r = detectEvents([w({ lastSeen: { status: 'working', seq: 1 } })], []);
  assert(r.events[0]?.status === 'gone', 'gone を拾う');
  r = detectEvents([w({ lastSeen: { status: 'gone', seq: null } })], []);
  assert(r.events.length === 0, 'gone は二度出さない');
  // 名前が外れても同じペインの同じ種類なら同じ作業セッション（ユーザーが入れ直した等）
  r = detectEvents([w({ lastSeen: { status: 'working', seq: 1 } })], [ag({ name: undefined, agent_status: 'idle', state_change_seq: 9 })]);
  assert(r.events[0]?.status === 'idle', 'ペインで突き合わせる');
  // 起動直後にもう終わっていた（lastSeen が空）なら拾う
  r = detectEvents([w()], [ag({ agent_status: 'done', state_change_seq: 3 })]);
  assert(r.events.length === 1, 'lastSeen なしの done は拾う');
  let missing = false;
  try {
    renderTemplate('{{X}}', {});
  } catch {
    missing = true;
  }
  assert(missing, 'テンプレートの変数不足は止める');
  // herdr の置き場所: 作業ツリーを分けない依頼もワークスペース・古い形のタブも閉じられる
  assert(herdrPlace({ where: 'worktree', workspace: 'wA', tab: 'wA:t1' }).kind === 'workspace', 'worktree はワークスペース');
  const sp = herdrPlace({ where: 'shared', workspace: 'wB', tab: 'wB:t1' });
  assert(sp.kind === 'workspace' && sp.id === 'wB', '共有の依頼もワークスペース');
  const tp = herdrPlace({ where: 'tab', workspace: 'w4', tab: 'w4:t3' });
  assert(tp.kind === 'tab' && tp.id === 'w4:t3', '古い形はタブ（CoS のワークスペースは閉じない）');

  // 振り返りの期限（ローカル時刻で組む＝タイムゾーンに依らない）
  const day = (d, h, m = 0) => new Date(2026, 10, d, h, m).getTime();
  const iso = (ms) => new Date(ms).toISOString();
  const rb = { since: iso(day(8, 15)), notifiedAt: null };
  let rd = retroDue(rb, 7, day(15, 14, 59));
  assert(!rd.due && !rd.notify, '期限前は出さない');
  rd = retroDue(rb, 7, day(15, 15));
  assert(rd.due && rd.notify, '期限になったら出す');
  rd = retroDue({ ...rb, notifiedAt: iso(day(15, 15, 1)) }, 7, day(15, 23, 59));
  assert(rd.due && !rd.notify, '同じ日には二度出さない');
  rd = retroDue({ ...rb, notifiedAt: iso(day(15, 23, 59)) }, 7, day(16, 0, 1));
  assert(rd.notify, '日が変われば また出す');
  assert(retroDue(rb, 3, day(11, 15)).due && !retroDue(rb, 3, day(11, 14)).due, '間隔を変えられる');
  // 見張りの1周: 作業セッションが0本（出来事なし）でも終わらずに待つ
  assert(watchStep({ events: [], retroNotify: false, timedOut: false }) === 'wait', '0本でも見張りは待つ');
  assert(watchStep({ events: [], retroNotify: true, timedOut: false }) === 'retro-due', '期限なら retro-due');
  assert(watchStep({ events: [{}], retroNotify: true, timedOut: false }) === 'events', '作業セッションの出来事が先');
  assert(watchStep({ events: [], retroNotify: false, timedOut: true }) === 'timeout', '時間切れ');
  // 依頼書のうち CoS が書いた部分
  assert(briefBody('# 依頼書\n\n## 作業セッションの決まり\n\nx\n\n## 依頼\n\n本文\n## 依頼\n\n2\n') === '本文\n## 依頼\n\n2', 'briefBody は最初の「## 依頼」から');
  assert(briefBody('# x\n') === null, 'briefBody 無し');
  // 依頼ごとの数字（同じ ID の前の回は数えない）
  const evs = [
    { at: '2026-11-08T06:34:26Z', id: 'P', kind: 'spawned' },
    { at: '2026-11-08T06:34:40Z', id: 'P', kind: 'sent' },
    { at: '2026-11-08T06:35:23.418Z', id: 'P', kind: 'spawned' },
    { at: '2026-11-08T07:00:00Z', id: 'P', kind: 'event', status: 'done', seq: 5, report: '質問' },
    { at: '2026-11-08T07:01:00Z', id: 'P', kind: 'sent' },
    { at: '2026-11-08T07:30:00Z', id: 'P', kind: 'event', status: 'blocked', seq: 7, report: '進行中' },
    { at: '2026-11-08T07:40:00Z', id: 'P', kind: 'event', status: 'done', seq: 8, report: '質問' },
    { at: '2026-11-08T08:00:00Z', id: 'P', kind: 'event', status: 'done', seq: 9, report: '完了' },
    { at: '2026-11-08T08:00:00Z', id: 'Q', kind: 'sent' },
    { at: '2026-11-08T08:05:00Z', id: 'P', kind: 'closed', forced: false },
  ];
  const rs = requestStats({ id: 'P', createdAt: '2026-11-08T06:35:23.415Z' }, evs);
  assert(rs.sends === 1 && rs.questions === 2 && rs.blocked === 1, 'requestStats 回数');
  assert(rs.doneAt === '2026-11-08T08:00:00Z' && rs.forced === false, 'requestStats 完了と片付け方');
  // 会話ログからユーザーが打った発言だけを拾う
  const at = (hms) => `2026-11-08T12:${hms}.000Z`;
  const ents = [
    { type: 'user', origin: { kind: 'human' }, timestamp: at('01:00'), message: { content: 'これは違う' } },
    { type: 'user', origin: { kind: 'human' }, timestamp: at('02:00'), message: { content: '<command-message>chief-of-staff</command-message>\n<command-name>/chief-of-staff</command-name>' } },
    { type: 'user', isMeta: true, timestamp: at('03:00'), message: { content: [{ type: 'text', text: 'スキルの本文' }] } },
    { type: 'user', timestamp: at('04:00'), message: { content: [{ type: 'tool_result', content: 'ツールの出力' }] } },
    { type: 'attachment', timestamp: at('05:00'), attachment: { type: 'queued_command', origin: { kind: 'human' }, timestamp: at('05:00'), prompt: [{ type: 'text', text: '途中で打った' }, { type: 'image' }] } },
    { type: 'attachment', timestamp: at('05:10'), attachment: { type: 'queued_command', origin: { kind: 'task-notification' }, prompt: '<task-notification>x' } },
    { type: 'user', origin: { kind: 'peer' }, timestamp: at('05:20'), message: { content: '他のセッションから' } },
    { type: 'user', origin: { kind: 'human' }, timestamp: at('05:30'), message: { content: '途中で打った' } },
    { type: 'user', origin: { kind: 'human' }, timestamp: at('30:00'), message: { content: '期間の外' } },
  ];
  const hu = humanUtterances(ents, Date.parse(at('00:00')), Date.parse(at('20:00')));
  assert(hu.map((u) => u.text).join('|') === 'これは違う|途中で打った', `humanUtterances: ${hu.map((u) => u.text).join('|')}`);
  assert(looksLikePushback('それだと夜のあいだは動かないのでは？'), 'pushback のでは？');
  assert(looksLikePushback('それは先に確かめるべきなの？'), 'pushback べきなの');
  assert(looksLikePushback('これは誰に聞くべき？'), 'pushback べき？');
  assert(!looksLikePushback('出して下さい'), 'pushback でないもの');
  // 振り返りの記録を締める前の検査
  const rec = (look, plan) => `# x\n\n## 材料\n\n- a\n  ## 振り返り（発言の中の見出しは字下げされている）\n\n## 振り返り\n\n<!-- 観点 -->\n${look}\n\n## 改善案\n\n<!-- 書き方: - [未定] 対象: 一言 -->\n${plan}\n`;
  assert(!checkRecord(rec('', '- [採用] a')).ok, '振り返りが空なら締めない');
  assert(!checkRecord(rec('良かった', '- [未定] a')).ok, '[未定] が残れば締めない');
  assert(!checkRecord(rec('良かった', '')).ok, '改善案が空なら締めない');
  const ck = checkRecord(rec('良かった', '- [採用] a\n- [却下] b — 理由\n- [保留] c'));
  assert(ck.ok && ck.tally.採用 === 1 && ck.tally.却下 === 1 && ck.tally.保留 === 1, 'コメントの中の [未定] は数えない・採否を数える');
  assert(checkRecord(rec('良かった', '- なし')).ok, '案が無くても締められる');
  assert(pastProposals(rec('x', '- [採用] a\n  - 差分\n- [却下] b — 理由')).join('|') === '- [採用] a|- [却下] b — 理由', 'pastProposals');
  console.log('cos self-test: ok');
}

const HELP = `cos — chief of staff の作業セッション管理（herdr）
  cos spawn <ID> --brief <file> --label <短い名前> [--title T] [--model M] [--kind claude] [--base REF] [--no-worktree] [--no-setup] [--force] [-- 引数]
  cos rename <ID> <短い名前>                サイドバーの名前を付け直す
  cos send <ID> (<text> | --file <file> | --first)
  cos watch [--timeout 秒] [--interval 秒]     出来事か振り返りの期限まで待つ（作業セッション0本でも待つ・CoS は裏で走らせる）
  cos status [--all] [--json]
  cos report <ID>
  cos read <ID> [--lines N]
  cos close <ID> [--force] [--keep-branch]
  cos retro status                          週1回の振り返りの期限・前回
  cos retro collect [--since ISO] [--until ISO] [--session ID,...] [--out F] [--force]
                                            期間の材料（依頼ごとの数字・CoS の会話のユーザーの発言）を集めて記録の下書きを作る
  cos retro done [--file F]                 振り返りを締めて期限を進める（[未定] の改善案が残っていると断る）
  cos reorient [--hook]                     （フック用）起動時・要約や /clear のあとに文脈を戻す
  cos chief [claude への引数]                CoS のセッションをいまのペインで起動する（60% で自動要約）
  cos self-test`;

const isMain = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const [cmd, ...rest] = process.argv.slice(2);
  const table = {
    spawn: cmdSpawn, send: cmdSend, watch: cmdWatch, status: cmdStatus, ls: cmdStatus,
    report: cmdReport, read: cmdRead, close: cmdClose, rename: cmdRename, reorient: cmdReorient, retro: cmdRetro,
    'self-test': selfTest,
  };
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    console.log(HELP);
  } else if (!table[cmd]) {
    console.error(HELP);
    process.exit(2);
  } else {
    try {
      table[cmd](rest);
    } catch (e) {
      if (e instanceof UsageError) {
        console.error(`cos: ${e.message}\n\n${HELP}`);
        process.exit(2);
      }
      if (e instanceof HerdrError) die(`herdr: ${e.code}: ${e.message}`);
      throw e;
    }
  }
}
