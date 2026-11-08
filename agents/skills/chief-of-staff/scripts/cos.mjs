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
//   cos self-test
//
// 状態の正本（git 管理外・worktree をまたいで1つ）:
//   <git-common-dir>/cos/ledger.json    作業セッションの台帳
//   <git-common-dir>/cos/events.jsonl   見張りが拾った出来事
//   <git-common-dir>/cos/archive/       片付けた依頼の依頼書・報告書の控え
// 依頼書と報告書は作業セッションの作業ツリーの `.cos/<slug>/` に置く（info/exclude で git から外す）。
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
};

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
  const dir = join(common, 'cos');
  return { top, common, main, cfg, dir, ledgerFile: join(dir, 'ledger.json'), eventsFile: join(dir, 'events.jsonl') };
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
  const where = opt['no-worktree'] ? 'tab' : 'worktree';
  const s = slug(id);
  const agent = agentName(ctx.cfg.agentPrefix, s);
  const title = opt.title ?? id;
  // サイドバーに出るのはワークスペース（調査ならタブ）の名前＝ID ではなく中身が分かる短い名前にする。
  // ID はタブの名前（worktree のとき）と台帳・エージェント名に残る。
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
    r = herdr(['tab', 'create', '--workspace', process.env.HERDR_WORKSPACE_ID, '--cwd', cwd, '--label', label, '--no-focus']).result;
  }
  const pane = r.root_pane.pane_id;
  const workspace = r.root_pane.workspace_id ?? r.tab.workspace_id;
  const tab = r.tab.tab_id;
  if (where === 'worktree') herdr(['tab', 'rename', tab, id]); // ワークスペースの中のタブには ID を出す

  const mbox = join(cwd, '.cos', s);
  mkdirSync(mbox, { recursive: true });
  ensureExcluded(ctx.common, '.cos/');
  const briefFile = join(mbox, 'brief.md');
  const reportFile = join(mbox, 'report.md');
  writeFileSync(briefFile, renderBrief(ctx, { id, title, where, cwd, branch, reportFile, brief }));
  if (!existsSync(reportFile)) writeFileSync(reportFile, reportTemplate(id));

  const entry = {
    id, title, label, agent, kind, model: opt.model ?? null, where, cwd, branch, base,
    workspace, tab, pane, brief: briefFile, report: reportFile,
    createdAt: now(), state: 'starting', lastSeen: null,
  };
  updateLedger(ctx, (l) => {
    l.workers[id] = entry;
  });
  logEvent(ctx, { id, kind: 'spawned', where, agent, pane });

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

  console.log(`立てました: ${id} → エージェント ${agent}（${where === 'worktree' ? 'ワークスペース' : 'タブ'}「${label}」${fitted.cut ? `＝幅 ${ctx.cfg.labelWidth} に切りました（cos rename で付け直せます）` : ''}・ワークスペース ${workspace}・タブ ${tab}・ペイン ${pane}）`);
  if (where === 'worktree') console.log(`  作業ツリー: ${cwd}（ブランチ ${branch}・base ${base.slice(0, 10)}）`);
  else console.log(`  作業ツリー: ${cwd}（本体と共有・タブ「${id}」）`);
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
  console.log(`${id}（${w.agent}）に送りました`);
}

function cmdWatch(argv) {
  const { opt } = parseArgs(argv, []);
  const timeoutMs = Number(opt.timeout ?? 3000) * 1000;
  const intervalMs = Number(opt.interval ?? 5) * 1000;
  requireHerdr();
  const ctx = repoCtx();
  const t0 = Date.now();
  for (;;) {
    const led = readLedger(ctx);
    const ws = Object.values(led.workers).filter((w) => WATCHED.has(w.state));
    if (ws.length === 0) {
      console.log(JSON.stringify({ event: 'no-workers' }));
      console.log('見張る作業セッションがありません。');
      return;
    }
    const { events, seen } = detectEvents(ws, herdr(['agent', 'list']).result.agents);
    if (Object.keys(seen).length > 0) {
      updateLedger(ctx, (l) => {
        for (const [id, st] of Object.entries(seen)) if (l.workers[id]) l.workers[id].lastSeen = st;
      });
    }
    if (events.length > 0) {
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
    if (Date.now() - t0 > timeoutMs) {
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
    console.log(JSON.stringify({ workers: rows, herdrError: herdrErr }, null, 2));
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
      console.log(`      ${r.where === 'tab' ? '本体のツリーのタブ' : r.cwd}  ワークスペース ${r.workspace}・ペイン ${r.pane}`);
    }
  }
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
  if (w.where === 'worktree') herdr(['workspace', 'rename', w.workspace, label]);
  else herdr(['tab', 'rename', w.tab, label]);
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
    try {
      herdr(['tab', 'get', w.tab]);
      herdr(['tab', 'close', w.tab]);
    } catch {
      // タブはユーザーが閉じ済み
    }
    rmSync(mbox, { recursive: true, force: true });
  }
  setWorker(ctx, id, { state: 'closed', closedAt: now(), archive });
  logEvent(ctx, { id, kind: 'closed', forced: Boolean(opt.force) });
  console.log(`片付けました: ${id}（控え ${archive}）`);
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
  console.log('cos self-test: ok');
}

const HELP = `cos — chief of staff の作業セッション管理（herdr）
  cos spawn <ID> --brief <file> --label <短い名前> [--title T] [--model M] [--kind claude] [--base REF] [--no-worktree] [--no-setup] [--force] [-- 引数]
  cos rename <ID> <短い名前>                サイドバーの名前を付け直す
  cos send <ID> (<text> | --file <file> | --first)
  cos watch [--timeout 秒] [--interval 秒]     出来事が起きるまで待つ（CoS は裏で走らせる）
  cos status [--all] [--json]
  cos report <ID>
  cos read <ID> [--lines N]
  cos close <ID> [--force] [--keep-branch]
  cos self-test`;

const isMain = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const [cmd, ...rest] = process.argv.slice(2);
  const table = {
    spawn: cmdSpawn, send: cmdSend, watch: cmdWatch, status: cmdStatus, ls: cmdStatus,
    report: cmdReport, read: cmdRead, close: cmdClose, rename: cmdRename, 'self-test': selfTest,
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
