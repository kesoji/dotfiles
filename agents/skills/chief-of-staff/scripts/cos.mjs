#!/usr/bin/env node
// cos — chief of staff（CoS）が herdr の上で作業セッション（別の Claude Code など）を立て、
// 依頼書を渡し、状態の変化を見張り、終わったら片付けるための CLI。依存は node・git・herdr だけ。
//
//   cos spawn <ID> --brief <file> --label <短い名前> [--title T] [--model M] [--kind claude] [--base REF]
//                  [--repo <名前|パス>] [--no-worktree] [--no-setup] [--setup] [--force] [-- <エージェントへの引数>]
//   cos rename <ID> <短い名前>
//   cos send <ID> (<text> | --file <file> | --first) [--seen]
//   cos watch [--timeout 秒(既定 3000)] [--interval 秒(既定 5)]
//   cos deploy-watch <repo> <sha> [--workflow W] [--label 名前] [--event E,...] | --cancel <ID>
//   cos status [--all] [--json]
//   cos report <ID>
//   cos read <ID> [--lines N]
//   cos check <ID>
//   cos close <ID> [--force] [--keep-branch]
//   cos retro status | collect [--since ISO] [--until ISO] [--session ID,...] [--out F] [--force] | done [--file F]
//   cos reorient [--hook]   （フック用）起動時は振り返りの期限を、要約・/clear のあとは CoS の立て直しの手順を文脈に戻す
//   cos reorient --hook --known-only   （ユーザー全体の設定のフック用）chief.json にあるセッションを `cos chief` 無しで再開したときだけ戻す
//   cos alert "<件>" "<一言>" [--level urgent|info] [--window 分]
//   cos self-test
//   cos chief               CoS のセッションを起動する（bin/cos が scripts/chief.sh へ渡す）
//   cos root [--sub]        この場所の CoS のディレクトリ（chief.sh 用）
//
// 状態の正本（git 管理外・worktree をまたいで1つ）:
//   <git-common-dir>/cos/ledger.json    作業セッションの台帳
//   <git-common-dir>/cos/events.jsonl   見張りが拾った出来事
//   <git-common-dir>/cos/archive/       片付けた依頼の依頼書・報告書の控え
//   <git-common-dir>/cos/retro.json     週1回の振り返りの期限（since＝今の期間の始まり・知らせた日・履歴）
//   <git-common-dir>/cos/retros/        振り返りの記録（材料の下書き＋CoS の判断＋改善案の採否）
//   <git-common-dir>/cos/chief.json     CoS だったセッションの記録（振り返りで会話ログを読むため）
//   <git-common-dir>/cos/alerts.json    急ぎの知らせを最後に鳴らした時刻（同じ件を短い間に二度鳴らさない）
//   <git-common-dir>/cos/deploys.json   見張り中のデプロイ（cos deploy-watch で登録・cos watch が出来事を出したら消す）
// 依頼書と報告書は作業セッションの作業ツリーの `.cos/<slug>/` に置く（info/exclude で git から外す）。
// 環境変数 COS_DIR で状態の置き場所を差し替えられる（試験用＝本物の台帳を触らずに watch などを試す）。
//
// 設定は `.claude/cos.json`（無くてもよい）。項目は SKILL.md を参照。cwd から git の最上位まで上へ探し、
// 最初に見つかったものを使う（どこにも無ければ最上位の CoS）。サブディレクトリ <sub> で見つかったら、
// そのサブディレクトリ専用の CoS＝状態は <git-common-dir>/cos/sub/<encodeURIComponent(sub)>/ に分ける
// （最上位の CoS の置き場所は今までと同じ）。COS_ROOT が設定されていれば cwd の代わりにそこから探す
// （`cos chief` が入れる＝CoS が cd しても同じ CoS のまま）。COS_DIR があればそれが最優先。
//
// --repo: 作業ツリーを CoS のリポジトリ（ハブ）ではなく別のリポジトリ（対象）に作る。台帳・依頼書の決まり・
// 見張りはハブに置いたまま、worktree・ブランチ・準備・マージ済みの判定・片付けは対象のリポジトリで行う。
// 作業セッションは対象の worktree で起動する＝対象の .claude/（フック・権限）がそのまま効く。
import { execFileSync } from 'node:child_process';
import {
  cpSync,
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
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ALERT_KINDS_DEFAULT = ['blocked', 'start-blocked', 'deploy-failed', 'stalled', 'gone', 'question'];
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
  // --base を付けなかったときの土台（例 "origin/staging"）。空なら CoS のツリーの HEAD。<リモート>/<ブランチ> なら立てる前に fetch する。
  defaultBase: '',
  // herdr のサイドバーで読める幅（半角＝1・全角＝2）。ワークスペースの名前はこの幅に収める。
  labelWidth: 10,
  // 週1回の振り返りの間隔（日）。前回の振り返りを終えてからこの日数で期限になる。
  retroIntervalDays: 7,
  // cos check: 報告書の「検証」に必ず要る語・残っていてはいけない語・実行したコマンドとみなす書き出し。
  requireInReport: [],
  forbidInReport: [],
  reportCommands: ['pnpm ', 'npm ', 'yarn ', 'go test', 'make ', 'cargo ', 'pytest', 'node --test'],
  // cos check: ブランチの土台が defaultBase の最新からこのコミット数以上遅れていたら警告する。
  baseLagWarn: 30,
  // cos deploy-watch: GitHub Actions に問い合わせる間隔（秒。cos watch の --interval の方が長ければそちら）と、
  // 登録から run が1つも見つからないまま deploy-missing を出すまでの秒数。
  deployPollSec: 20,
  deployMissingSec: 300,
  // cos watch: ターンが終わったのに報告書が「進行中」のまま、この分数動かない作業セッションを stalled として出す
  // （API の接続切れなどで応答の途中で止まり、入力待ちのまま放置されるのを拾うため）。
  stallMin: 20,
  // cos watch: 音と通知で知らせる出来事の種類（ALERT_KINDS のうち。[] で鳴らさない）と、同じ件を二度鳴らさない分数。
  alertOn: ALERT_KINDS_DEFAULT,
  alertWindowMin: 10,
};
const DAY_MS = 86_400_000;

// ───────── 純関数（self-test の対象） ─────────

// `cos reorient --known-only` で文脈を戻すか。ユーザー全体の設定のフックから全セッションで呼ばれるので、
// chief.json に CoS として記録済みのセッションを `cos chief` を通らずに開いたときだけ 'emit' にする。
// - 作業セッション（COS_WORKER_ID）: 戻さない。
// - `cos chief` で起動（COS_CHIEF=1）: chief-settings.json のフックが同じ文脈を戻すので、二重に出さない。
//   2つのフックは並んで走るので、印のファイルでは前後が決まらない。環境変数なら必ず判定できる。
// - 記録に無いセッション: 戻さず、登録もしない（普通のセッションを CoS にしない）。
export function knownOnlyDecision({ env = {}, sid, sessions }) {
  if (env.COS_WORKER_ID) return 'worker';
  if (env.COS_CHIEF === '1') return 'chief';
  if (!sid) return 'no-session';
  if (!sessions || !Object.hasOwn(sessions, sid)) return 'unknown';
  return 'emit';
}

// cos.json を探す: rel（git の最上位から cwd への相対・'/' 区切り・'' は最上位）から上へ、
// hasCfg(dir) が真になる最初のディレクトリ（最上位からの相対）。どこにも無ければ ''（最上位）。
export function findCosSub(rel, hasCfg) {
  const parts = rel ? rel.split('/').filter((x) => x && x !== '.') : [];
  for (let n = parts.length; n > 0; n--) {
    const r = parts.slice(0, n).join('/');
    if (hasCfg(r)) return r;
  }
  return '';
}

// 状態の置き場所。COS_DIR → サブディレクトリの CoS は cos/sub/<sub を1段に符号化> → 最上位は cos/（今までと同じ）。
// sub を1段にするのは、入れ子のサブディレクトリ（a と a/archive）が互いの archive/・retros/ とぶつからないため。
export function stateDirFor(common, sub, envDir) {
  if (envDir) return resolve(envDir);
  return sub ? join(common, 'cos', 'sub', encodeURIComponent(sub)) : join(common, 'cos');
}

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

// 画面の末尾に API のエラーが出ているか（応答の途中で切れて、入力待ちのまま止まった印）。
export const API_ERROR_RE = /API Error|Connection lost mid-response|Request timed out|overloaded_error|Internal server error/i;
export function screenShowsApiError(text) {
  return API_ERROR_RE.test(text ?? '');
}

// ターンが終わった（idle/done）のに報告書が「進行中」のまま stallMs 以上動かない作業セッション＝止まった疑い。
// 終わった直後の idle は detectEvents が出すが、CoS が「途中経過」と読んで張り直すと、そのまま誰も気づかない。
// 同じ止まり（lastSeen.seq）では一度だけ出す。lastSeenAt が無い（前の版の台帳）ときは startedAt から数える。
export function detectStalled(workers, nowMs, stallMs, reportStateOf) {
  const out = [];
  for (const w of workers) {
    const ls = w.lastSeen;
    if (!ls || (ls.status !== 'idle' && ls.status !== 'done')) continue;
    const since = Date.parse(w.lastSeenAt ?? w.startedAt ?? '');
    if (!Number.isFinite(since) || nowMs - since < stallMs) continue;
    if (w.stallNotified === String(ls.seq)) continue;
    if (reportStateOf(w) !== '進行中') continue;
    out.push({ id: w.id, agent: w.agent, status: 'stalled', seq: ls.seq });
  }
  return out;
}

// ───── 急ぎの知らせ（cos alert） ─────

// 見張りの出来事のうち、ユーザーの手が要るので音と通知で知らせる種類（cos.json の alertOn の既定）。
// start-blocked＝起動時の承認・質問の画面。stalled は画面に API のエラーがあるときだけ・gone は報告書が完了以外のときだけ・
// question は done/idle で報告書が「質問」になったとき（info の音）。timeout・deploy-done・完了は鳴らさない。
export const ALERT_KINDS = ALERT_KINDS_DEFAULT;

// 見張りの出来事1つ → 鳴らす知らせ（{ kind, level, title, body }）か null。
// title は通知の件名で、重複の抑え（alertThrottle）の鍵にもなる。ev は cmdWatch が report・startBlocked・apiError を足したもの。
export function alertFor(ev, alertOn = ALERT_KINDS) {
  const on = new Set(alertOn ?? []);
  const who = `${ev.id}${ev.agent && ev.agent !== ev.id ? `（${ev.agent}）` : ''}`;
  let a = null;
  if (ev.event === 'deploy-failed') {
    const wf = (ev.failed ?? []).map((r) => r.workflow).join('・');
    a = { kind: 'deploy-failed', level: 'urgent', title: `デプロイ失敗 ${ev.id}`, body: `${ev.repo ?? ''} ${String(ev.sha ?? '').slice(0, 7)}${wf ? `: ${wf}` : ''}`.trim() };
  } else if (ev.event) {
    return null; // deploy-done・deploy-missing・retro-due・timeout
  } else if (ev.status === 'blocked') {
    a = ev.startBlocked
      ? { kind: 'start-blocked', level: 'urgent', title: `${ev.id} 起動時に承認待ち`, body: `${who}が起動の画面で止まっています（片付けたら cos send --first）` }
      : { kind: 'blocked', level: 'urgent', title: `${ev.id} 承認待ち`, body: `${who}が承認・質問の画面で止まっています` };
  } else if (ev.status === 'stalled') {
    if (ev.apiError) a = { kind: 'stalled', level: 'urgent', title: `${ev.id} API エラーで停止`, body: `${who}が API のエラーで止まったままです` };
  } else if (ev.status === 'gone') {
    if (ev.report !== '完了') a = { kind: 'gone', level: 'urgent', title: `${ev.id} 途中で終了`, body: `${who}がいなくなりました（報告書「${ev.report ?? '読めない'}」）` };
  } else if (ev.status === 'idle' || ev.status === 'done') {
    if (ev.report === '質問') a = { kind: 'question', level: 'info', title: `${ev.id} 質問`, body: `${who}の報告書が「質問」です` };
  }
  return a && on.has(a.kind) ? a : null;
}

// 同じ件（title）を windowMs のうちに二度鳴らさない。last は { [title]: 最後に鳴らした ISO }。
// 返す next は窓を過ぎた古い記録を捨てたもの（鳴らすなら title を今に更新済み）。
export function alertThrottle(last, title, nowMs, windowMs) {
  const next = {};
  for (const [k, at] of Object.entries(last ?? {})) {
    const t = Date.parse(at);
    if (Number.isFinite(t) && nowMs - t < windowMs) next[k] = at;
  }
  const fire = !Object.hasOwn(next, title);
  if (fire) next[title] = new Date(nowMs).toISOString();
  return { fire, next };
}

// 知らせの出し方。urgent は request の音・info は done の音。herdr が無いときの予備に macOS の通知。
export function alertCommands(level, title, body, platform) {
  const sound = level === 'info' ? 'done' : 'request';
  const cmds = [['herdr', ['notification', 'show', title, '--body', body, '--sound', sound]]];
  if (platform === 'darwin') {
    const q = (s) => `"${String(s).replace(/[\\"]/g, '\\$&')}"`;
    cmds.push(['osascript', ['-e', `display notification ${q(body)} with title ${q(title)} sound name ${q(level === 'info' ? 'Glass' : 'Sosumi')}`]]);
  }
  return cmds;
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

// 作業セッションの herdr 上の置き場所。worktree の依頼も、ブランチを作らない依頼（where: detached）も
// 1本につき1つのワークスペース（サイドバーでリポジトリの下に字下げして出る）。
// where: shared（本体の作業ツリーを共有する前の版の --no-worktree）と where: tab（さらに前の版、
// CoS のワークスペースの中のタブ）は、台帳に残っている分を片付けられるように読むだけ。
export function herdrPlace(w) {
  if (w.where === 'worktree' || w.where === 'detached' || w.where === 'shared') return { kind: 'workspace', id: w.workspace };
  if (w.where === 'tab') return { kind: 'tab', id: w.tab };
  throw new Error(`台帳の where が分かりません: ${w.where}`);
}

// git の worktree を持つ依頼か（片付けで worktree を消す・status で未コミットを数える）。
export function hasOwnWorktree(w) {
  return w.where === 'worktree' || w.where === 'detached';
}

// 作業セッションを立てる前に流す準備（cos.json の setup）。worktree の依頼は既定で流し（--no-setup で止める）、
// ブランチを作らない調査・レビューの依頼は既定で流さない（依存を入れないことが多い＝速さを取る。--setup で流す）。
export function setupFor(where, opt, cfgSetup) {
  if (!cfgSetup) return null;
  if (where === 'worktree') return opt['no-setup'] ? null : cfgSetup;
  if (where === 'detached') return opt.setup && !opt['no-setup'] ? cfgSetup : null;
  return null;
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

// ───── cos check（取り込み前の機械検査）の判定 ─────

// 禁止語を含む行が「片付いた」と書いているか。数えないのは、語の直後が「無い」（例「`[停止]` なし」「[停止]: 0 件」）
// の行と、直したと書いた行（例「直したもの: `[停止]` …」「[停止] … → 修正済み」）。
// ただし「未解消」「解消していない」「修正済みではない」のように打ち消していれば残っているとみなす。
function settledLine(line, term) {
  if (/未(解消|修正|対応)|(直|解消|修正済み?)(して)?(い)?ない|(解消|修正済み?)(では|じゃ)ない/.test(line)) return false;
  if (/直した|修正した|修正済|解消/.test(line)) return true;
  const i = line.indexOf(term);
  return /^[\s`'"」）):：]*(は|が|も)?\s*(なし|無し|ない|無い|0\s*件|ゼロ)/.test(line.slice(i + term.length));
}

// 報告書の検査。返すのは警告（1件1行）。code はブランチを持つ依頼（コードを変える依頼）か＝検証の記録まで見るか。
export function checkReportText(text, cfg, { code = true } = {}) {
  if (text === null) return ['報告書が読めません'];
  const warns = [];
  const state = reportState(text);
  if (state !== '完了') warns.push(`報告書の状態が「${state ?? 'なし'}」（完了ではない）`);
  if (!code) return warns;
  const v = recordSection(text, '検証');
  if (!v) return [...warns, '報告書の「## 検証」が空です'];
  for (const term of cfg.requireInReport ?? []) {
    if (!v.includes(term)) warns.push(`「検証」に「${term}」がありません`);
  }
  for (const term of cfg.forbidInReport ?? []) {
    const lines = v.split('\n').filter((l) => l.includes(term) && !settledLine(l, term));
    if (lines.length) warns.push(`「検証」に「${term}」が残っています: ${lines[0].trim().slice(0, 80)}`);
  }
  const cmds = cfg.reportCommands ?? [];
  if (cmds.length && !cmds.some((c) => v.includes(c))) {
    warns.push(`「検証」に実行したコマンドの行がありません（${cmds.map((c) => `「${c.trim()}」`).join('')}を探しました）`);
  }
  return warns;
}

// Claude-Session の値（URL か ID）を session_… の形にそろえる。
export function sessionKey(v) {
  return /session_[A-Za-z0-9]+/.exec(v)?.[0] ?? v.trim();
}

// `git log --format=%H%x00%s%x00%(trailers:key=Claude-Session,valueonly,separator=%x2C)%x1e` の出力を分ける。
export function parseSessionLog(out) {
  return out
    .split('\x1e')
    .map((r) => r.replace(/^\n+/, ''))
    .filter(Boolean)
    .map((r) => {
      const [sha, subject, trailers = ''] = r.split('\x00');
      return { sha, subject, sessions: [...new Set(trailers.split(',').map((s) => s.trim()).filter(Boolean).map(sessionKey))] };
    });
}

// Claude Code の会話ログ（jsonl の生の文字列）から、そのセッション自身の Claude-Session を拾う。
// 帰属の指示（「End git commit messages with: … Claude-Session: <URL>」）の中だけを見る
// （git log の出力など、会話に出てきた他のセッションの値を拾わないため）。
export function ownSessionsInTranscript(raw) {
  const re = /End git commit messages with:(?:\\n|\n)[^"]{0,300}?Claude-Session: https:\/\/claude\.ai\/code\/(session_[A-Za-z0-9]+)/g;
  return new Set([...raw.matchAll(re)].map((m) => m[1]));
}

// コミットの Claude-Session を作業セッションのもの（own）と照らす。own が空＝特定できなかった。
export function sessionFindings(commits, own) {
  const warns = [];
  const info = [];
  const fmt = (c) => `${c.sha.slice(0, 9)} ${c.subject.slice(0, 50)}${c.sessions.length ? `（${c.sessions.join(',')}）` : ''}`;
  const list = (cs) => cs.slice(0, 10).map(fmt).join(' / ') + (cs.length > 10 ? ` ほか ${cs.length - 10} 件` : '');
  const none = commits.filter((c) => !c.sessions.length);
  if (none.length) warns.push(`Claude-Session の無いコミットが ${none.length} 件: ${list(none)}`);
  const all = [...new Set(commits.flatMap((c) => c.sessions))];
  if (own.size) {
    const foreign = commits.filter((c) => c.sessions.some((s) => !own.has(s)));
    if (foreign.length) warns.push(`この作業セッション（${[...own].join(',')}）以外の Claude-Session のコミットが ${foreign.length} 件: ${list(foreign)}`);
    else if (commits.length) info.push(`Claude-Session: どのコミットもこの作業セッション（${[...own].join(',')}）のもの`);
  } else if (all.length > 1) {
    warns.push(`作業セッションの Claude-Session を特定できず、コミットに ${all.length} 種類が混ざっています: ${all.join(', ')}`);
  } else if (all.length === 1) {
    info.push(`Claude-Session は ${all[0]} の1種類（作業セッションのものかは照合できませんでした）`);
  }
  return { warns, info };
}

// ───── デプロイの見張り（cos deploy-watch）の判定 ─────

// 成功とみなす run の結論。cancelled・failure・timed_out・action_required などは失敗として知らせる
// （同じブランチへの次の push で取り消された run も、CoS が見て判断できるよう失敗に入れる）。
const DEPLOY_OK = new Set(['success', 'skipped', 'neutral']);
// 既定で数える run の event。既定ブランチのコミットには schedule・issues・issue_comment などの run も付き、
// 後から増え続ける＝数えるといつまでも終わらず、関係ない失敗も拾う。push と、それに続く workflow_run だけを見る。
export const DEPLOY_EVENTS = ['push', 'workflow_run'];

// 見張り中のデプロイの ID（cos status と --cancel で使う）。
export function deployId(repo, sha, workflow) {
  return `${repo.split('/').pop()}@${sha.slice(0, 7)}${workflow ? `:${workflow}` : ''}`;
}

// git の origin の URL から GitHub の owner/name を引く。GitHub でなければ null。
export function parseGithubRemote(url) {
  const m = /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(String(url).trim());
  return m ? `${m[1]}/${m[2]}` : null;
}

// そのコミットの run の一覧（`gh run list --json …` の配列）から、見張りの次の手を決める。
// - error: gh が失敗した（ネットワーク・認証）。最後に問い合わせられた時から missingMs たっていれば missing。
// - run が無い: 登録から missingMs たっていれば missing（path のフィルタで走らなかった・workflow 名の違い）。
// - 1つでも終わっていなければ wait。
// - 全部終わった: 前の問い合わせでも同じ顔ぶれで全部終わっていたら done / failed。初めてなら settling
//   （workflow_run で続けて起動する workflow があると、前の run が終わった直後にはまだ一覧に出ていないため）。
// 数える run は event が entry.events（無ければ DEPLOY_EVENTS）のものだけ。
export function deployDecision({ runs, error = null, entry, nowMs, missingMs }) {
  const created = Date.parse(entry.createdAt);
  if (error) {
    const okAt = entry.lastOkAt ? Date.parse(entry.lastOkAt) : created;
    return nowMs - okAt >= missingMs ? { state: 'missing', error } : { state: 'wait', error };
  }
  const events = entry.events?.length ? entry.events : DEPLOY_EVENTS;
  const rs = runs.filter((r) => events.includes(r.event));
  const total = rs.length;
  const done = rs.filter((r) => r.status === 'completed').length;
  if (!total) return nowMs - created >= missingMs ? { state: 'missing', total, done } : { state: 'wait', total, done };
  if (done < total) return { state: 'wait', total, done };
  const ids = rs.map((r) => String(r.databaseId)).sort().join(',');
  if (entry.settleIds !== ids) return { state: 'settling', ids, total, done };
  const brief = (r) => ({ workflow: r.workflowName || r.name, conclusion: r.conclusion, url: r.url });
  const failed = rs.filter((r) => !DEPLOY_OK.has(r.conclusion)).map(brief);
  return { state: failed.length ? 'failed' : 'done', total, done, runs: rs.map(brief), failed };
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

// cos のコマンドが CoS の場所として見るディレクトリ。`cos chief` は COS_ROOT を入れる（CoS が cd しても変わらない）。
function startDir() {
  const r = process.env.COS_ROOT;
  if (!r) return process.cwd();
  if (!existsSync(r)) die(`COS_ROOT（${r}）がありません`);
  return r;
}

// git の最上位・共有の git ディレクトリ・CoS のサブディレクトリ（cos.json を上へ探す）・状態の置き場所。
// envDir は COS_DIR（ハブが別のリポジトリの台帳を読むときは渡さない）。
function locate(cwd, envDir) {
  const top = git(['rev-parse', '--show-toplevel'], cwd);
  const common = git(['rev-parse', '--path-format=absolute', '--git-common-dir'], top);
  let rel = relative(realpathSync(top), realpathSync(cwd));
  if (rel.startsWith('..') || isAbsolute(rel)) rel = '';
  const sub = findCosSub(rel.split(sep).join('/'), (r) => existsSync(join(top, r, '.claude', 'cos.json')));
  return { top, common, sub, root: sub ? join(top, sub) : top, dir: stateDirFor(common, sub, envDir) };
}

function repoCtx(cwd = startDir()) {
  let loc;
  try {
    loc = locate(cwd, process.env.COS_DIR);
  } catch {
    die('git リポジトリの中で実行してください');
  }
  const { top, common, sub, root, dir } = loc;
  const main = git(['worktree', 'list', '--porcelain'], top)
    .split('\n')
    .find((l) => l.startsWith('worktree '))
    .slice('worktree '.length);
  const cfgFile = join(root, '.claude', 'cos.json');
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
  return {
    // root: cos.json のあるディレクトリ（workerRules・chiefRules の基準）。sub: 最上位からの相対（'' は最上位の CoS）。
    // worktreeDir は最上位（本体）の基準のまま（worktree はリポジトリ全体の写しなので）。
    top, common, main, cfg, dir, sub, root, cfgFile,
    ledgerFile: join(dir, 'ledger.json'),
    eventsFile: join(dir, 'events.jsonl'),
    retroFile: join(dir, 'retro.json'),
    retrosDir: join(dir, 'retros'),
    chiefFile: join(dir, 'chief.json'),
    deploysFile: join(dir, 'deploys.json'),
    answersFile: join(dir, 'answers.json'),
    alertsFile: join(dir, 'alerts.json'),
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

// ── 見張り中のデプロイ（deploys.json） ──

function readDeploys(ctx) {
  if (!existsSync(ctx.deploysFile)) return { version: 1, deploys: {} };
  return JSON.parse(readFileSync(ctx.deploysFile, 'utf8')); // 壊れていたら止める（黙って空にすると見張りを失う）
}

function updateDeploys(ctx, fn) {
  return withLock(ctx, () => {
    const d = readDeploys(ctx);
    const r = fn(d);
    writeAtomic(ctx.deploysFile, `${JSON.stringify(d, null, 2)}\n`);
    return r;
  });
}

function gh(args) {
  try {
    return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000, maxBuffer: 16 << 20 });
  } catch (e) {
    if (e.code === 'ENOENT') throw new Error('gh が見つかりません');
    throw new Error(String(e.stderr || e.message).trim().split('\n')[0] || 'gh が失敗しました');
  }
}

// そのコミットの workflow run の一覧（gh を1回呼ぶ）。
function ghRuns(d) {
  const args = ['run', 'list', '-R', d.repo, '--commit', d.sha, '--limit', '50', '--json', 'databaseId,name,workflowName,status,conclusion,url,event,createdAt'];
  if (d.workflow) args.push('--workflow', d.workflow);
  return JSON.parse(gh(args));
}

// <repo> を GitHub の owner/name にする。cos.json の repos の名前 → 手元のパス（origin から引く） → owner/name の順。
function resolveGhRepo(ctx, spec) {
  const ent = ctx.cfg.repos?.[spec];
  const raw = typeof ent === 'string' ? ent : ent?.path ?? spec;
  const abs = resolve(raw.replace(/^~(?=\/|$)/, homedir()));
  if (ent || existsSync(abs)) {
    if (!existsSync(abs)) die(`${spec}: ${abs} がありません`);
    let url;
    try {
      url = git(['remote', 'get-url', 'origin'], abs);
    } catch {
      die(`${abs} に origin がありません（owner/name で指定してください）`);
    }
    const repo = parseGithubRemote(url);
    if (!repo) die(`${abs} の origin（${url}）が GitHub ではありません`);
    return { repo, local: abs };
  }
  if (/^[\w.-]+\/[\w.-]+$/.test(spec)) return { repo: spec, local: null };
  die(`リポジトリが分かりません: ${spec}（owner/name・cos.json の repos の名前・手元のパス のどれか）`);
}

// <sha> を 40 桁にする（gh run list --commit は 40 桁でないと一致しない）。手元のパスならブランチ名・HEAD も可。
function resolveSha(repo, local, spec) {
  if (local && gitOk(['rev-parse', '--verify', '--quiet', `${spec}^{commit}`], local)) return git(['rev-parse', `${spec}^{commit}`], local);
  if (/^[0-9a-f]{40}$/i.test(spec)) return spec.toLowerCase();
  try {
    return gh(['api', `repos/${repo}/commits/${spec}`, '--jq', '.sha']).trim();
  } catch (e) {
    die(`${repo} のコミット ${spec} が見つかりません（${e.message}）`);
  }
}

function deploySummary(dec) {
  if (dec.error) return `問い合わせ失敗: ${dec.error}`;
  if (!dec.total) return 'run はまだありません';
  return `${dec.done}/${dec.total} 件が終了${dec.state === 'settling' ? '（続く run が無いか確かめ中）' : ''}`;
}

// 見張りの1周で、問い合わせ時期の来たデプロイを gh で見て、終わったものの出来事を返す（台帳からは消す）。
// 見張りが2本走っていても、出来事を出すのはロックの中で台帳から消せた方だけ（同じ出来事を二度出さない）。
function pollDeploys(ctx, { pollMs, missingMs }) {
  if (!existsSync(ctx.deploysFile)) return [];
  const due = Object.values(readDeploys(ctx).deploys).filter((d) => !d.checkedAt || Date.now() - Date.parse(d.checkedAt) >= pollMs);
  if (!due.length) return [];
  const results = due.map((d) => {
    try {
      return { id: d.id, runs: ghRuns(d), error: null };
    } catch (e) {
      return { id: d.id, runs: null, error: e.message };
    }
  });
  return updateDeploys(ctx, (x) => {
    const out = [];
    for (const r of results) {
      const d = x.deploys[r.id];
      if (!d) continue; // 別の見張りが出した・--cancel で消された
      const nowMs = Date.now();
      const dec = deployDecision({ runs: r.runs, error: r.error, entry: d, nowMs, missingMs });
      const at = new Date(nowMs).toISOString();
      d.checkedAt = at;
      if (!r.error) d.lastOkAt = at;
      d.lastError = r.error;
      d.summary = deploySummary(dec);
      if (dec.state === 'settling') d.settleIds = dec.ids;
      if (dec.state === 'done' || dec.state === 'failed' || dec.state === 'missing') {
        delete x.deploys[r.id];
        out.push({
          event: `deploy-${dec.state}`, id: d.id, repo: d.repo, sha: d.sha, workflow: d.workflow ?? undefined, label: d.label ?? undefined,
          ...(dec.state === 'missing'
            ? { afterSec: Math.round((nowMs - Date.parse(d.createdAt)) / 1000), error: dec.error ?? undefined }
            : { runs: dec.runs, failed: dec.failed.length ? dec.failed : undefined }),
        });
      }
    }
    return out;
  });
}

function deployLine(ev) {
  const name = `デプロイ ${ev.id}${ev.label ? `「${ev.label}」` : ''}（${ev.repo} ${ev.sha.slice(0, 7)}）`;
  if (ev.event === 'deploy-done') return `${name}: 成功（${ev.runs.map((r) => r.workflow).join('・')}）`;
  if (ev.event === 'deploy-failed') return `${name}: 失敗 — ${ev.failed.map((r) => `${r.workflow}（${r.conclusion}） ${r.url}`).join(' / ')}`;
  if (ev.error) return `${name}: ${Math.round(ev.afterSec / 60)} 分 gh に問い合わせられません（${ev.error}）。見張りをやめました`;
  return `${name}: 登録から ${Math.round(ev.afterSec / 60)} 分たっても run が見つかりません（path のフィルタで走らなかった・workflow 名の違い・まだ push していない など）。見張りをやめました`;
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

function ensureExcluded(common, pattern, note = '依頼書・報告書') {
  const file = join(common, 'info', 'exclude');
  const text = existsSync(file) ? readFileSync(file, 'utf8') : '';
  if (text.split('\n').some((l) => l.trim() === pattern)) return;
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${text && !text.endsWith('\n') ? '\n' : ''}# cos（chief of staff）の${note}\n${pattern}\n`);
}

// 作業ツリーを作るリポジトリ。--repo が無ければ CoS のリポジトリ（ハブ）自身。
// sub はそのリポジトリの CoS のサブディレクトリ（作業セッションは worktree の中の同じサブディレクトリで起動する）。
// --repo はハブの cos.json の repos にある名前か、パス（~ 可）。repos の値はパスか {path, setup}。
// 対象の準備は repos の setup → 対象の cos.json の setup の順で選ぶ。worktree の置き場所は対象の cos.json の worktreeDir（既定 .claude/worktrees）。
function repoFor(ctx, spec) {
  const self = { name: null, top: ctx.top, main: ctx.main, common: ctx.common, sub: ctx.sub, worktreeDir: ctx.cfg.worktreeDir, setup: ctx.cfg.setup, defaultBase: ctx.cfg.defaultBase };
  if (!spec) return self;
  const ent = ctx.cfg.repos?.[spec];
  const raw = typeof ent === 'string' ? ent : ent?.path ?? spec;
  const abs = resolve(raw.replace(/^~(?=\/|$)/, homedir()));
  if (!existsSync(abs)) die(`--repo ${spec}: ${abs} がありません${ent ? '' : `（cos.json の repos にもありません: ${Object.keys(ctx.cfg.repos ?? {}).join(', ') || 'なし'}）`}`);
  const t = repoCtx(abs);
  if (realpathSync(t.main) === realpathSync(ctx.main)) return self;
  return {
    name: ent ? spec : basename(t.main), top: t.main, main: t.main, common: t.common, sub: t.sub,
    worktreeDir: t.cfg.worktreeDir, setup: (typeof ent === 'object' && ent?.setup) || t.cfg.setup || '',
    defaultBase: t.cfg.defaultBase,
  };
}

// 土台のコミット。--base → cos.json の defaultBase → HEAD の順。<リモート>/<ブランチ> の形なら先に fetch して最新を使う
// （本体の作業ツリーのブランチは古いことがあり、古い土台から立てると入っているはずの変更が無い）。
function resolveBase(R, optBase) {
  const ref = optBase || R.defaultBase || 'HEAD';
  const m = /^([^/]+)\/(.+)$/.exec(ref);
  if (m && gitOk(['remote', 'get-url', m[1]], R.top)) {
    if (!gitOk(['fetch', '--quiet', m[1], m[2]], R.top)) die(`git fetch ${m[1]} ${m[2]} に失敗しました（土台 ${ref}）`);
  }
  return git(['rev-parse', '--verify', `${ref}^{commit}`], R.top);
}

// 対象のリポジトリで worktree の置き場所が git 管理外になっていなければ info/exclude に足す
// （ハブは cos.json の worktreeDir を自分で .gitignore に入れる前提。対象とサブディレクトリの CoS はそうとは限らない）。
function ensureIgnored(R) {
  if (gitOk(['check-ignore', '-q', join(R.worktreeDir, 'x')], R.main)) return;
  ensureExcluded(R.common, `/${R.worktreeDir.replace(/^\/+|\/+$/g, '')}/`, '作業 worktree の置き場所');
}

// 台帳の依頼の git 操作をするツリー（--repo の依頼は対象の本体・それ以外は CoS のツリー）。
function gitDirOf(ctx, w) {
  return w.repo ?? ctx.top;
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
      : '6. **追跡されているファイルを変更せず、コミットしない**（調査・レビューの依頼＝ブランチの無い作業ツリー。片付けると消える）。成果は報告書に書く。';
  let text = renderTemplate(tpl, {
    ID: v.id,
    TITLE: v.title,
    CWD: v.cwd,
    WHERE: (v.repo ? `リポジトリ ${v.repo} の、` : '') + (v.where === 'worktree'
      ? `この依頼専用の git worktree・ブランチ \`${v.branch}\``
      : `この依頼専用の git worktree（ブランチなし・${v.repo ? 'そのリポジトリ' : 'CoS のツリー'}の ${v.base.slice(0, 10)} を detached で見る）`),
    REPORT: v.reportFile,
    BRANCH_RULE: branchRule,
  });
  if (ctx.cfg.workerRules) {
    const f = join(ctx.root, ctx.cfg.workerRules);
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
  const { pos, opt } = parseArgs(argv, ['no-worktree', 'no-setup', 'setup', 'force']);
  const id = checkId(pos[0]);
  if (!opt.brief) throw new UsageError('--brief <依頼書のファイル> が要ります');
  const brief = readFileSync(opt.brief, 'utf8').trim();
  if (!brief) die('依頼書が空です');
  requireHerdr();
  const ctx = repoCtx();
  const R = repoFor(ctx, opt.repo);
  // herdr でどこに worktree を作るか: ハブなら CoS のワークスペースの下（サイドバーで字下げ）、対象なら対象のリポジトリ。
  const herdrWhere = R.name ? ['--cwd', R.main] : ['--workspace', process.env.HERDR_WORKSPACE_ID];
  const herdrHint = R.name ? `対象のリポジトリ ${R.main}` : `CoS のワークスペース ${process.env.HERDR_WORKSPACE_ID} の場所`;
  const kind = opt.kind ?? 'claude';
  // --no-worktree は「ブランチを作らない」の意味（調査・レビュー用・コミットしない前提）。作業ツリーは
  // detached の linked worktree（CoS のツリーの HEAD か --base）。本体を共有しないのは、herdr のサイドバーが
  // linked worktree のワークスペースしかリポジトリの下に字下げしてまとめないため（本体は1つのワークスペースしか持てない）。
  const where = opt['no-worktree'] ? 'detached' : 'worktree';
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
    if (gitOk(['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], R.top)) die(`ブランチ ${branch} がすでにあります${R.name ? `（${R.name}）` : ''}`);
    base = resolveBase(R, opt.base);
    cwd = join(R.main, R.worktreeDir, `cos-${s}`);
    if (existsSync(cwd)) die(`${cwd} がすでにあります`);
    if (R.name || R.sub) ensureIgnored(R);
    r = herdr([
      'worktree', 'create', ...herdrWhere,
      '--branch', branch, '--base', base, '--path', cwd, '--label', label, '--no-focus',
    ]).result;
    const root = r.workspace?.worktree?.repo_root;
    if (!root || realpathSync(root) !== realpathSync(R.main)) {
      die(`herdr が別のリポジトリ（${root}）に worktree を作りました。${herdrHint}を確かめてください（作られたワークスペース: ${r.workspace?.workspace_id}）`);
    }
  } else {
    // herdr の worktree create は必ずブランチを作る＝detached は git で作ってから herdr で開く（開くとグループの子になる）。
    base = resolveBase(R, opt.base);
    cwd = join(R.main, R.worktreeDir, `cos-${s}`);
    if (existsSync(cwd)) die(`${cwd} がすでにあります`);
    if (R.name || R.sub) ensureIgnored(R);
    git(['worktree', 'add', '--detach', cwd, base], R.top);
    try {
      r = herdr([
        'worktree', 'open', ...herdrWhere,
        '--path', cwd, '--label', label, '--no-focus',
      ]).result;
    } catch (e) {
      git(['worktree', 'remove', '--force', cwd], R.top);
      die(`herdr で worktree を開けませんでした（${e.code}: ${e.message}）。作った worktree は消しました`);
    }
    const root = r.workspace?.worktree?.repo_root;
    if (!root || realpathSync(root) !== realpathSync(R.main)) {
      die(`herdr が別のリポジトリ（${root}）の worktree として開きました。${herdrHint}を確かめてください（ワークスペース: ${r.workspace?.workspace_id}・worktree: ${cwd}）`);
    }
  }
  const pane = r.root_pane.pane_id;
  const workspace = r.root_pane.workspace_id ?? r.tab.workspace_id;
  const tab = r.tab.tab_id;
  herdr(['tab', 'rename', tab, id]); // ワークスペースの中のタブには ID を出す

  // サブディレクトリの CoS の作業セッションは、worktree の中の同じサブディレクトリで起動する
  // （そこの CLAUDE.md・.claude/ が効く）。土台にそのサブディレクトリが無ければ worktree の最上位。
  const startCwd = R.sub && existsSync(join(cwd, R.sub)) ? join(cwd, R.sub) : cwd;
  const mbox = join(cwd, '.cos', s);
  mkdirSync(mbox, { recursive: true });
  ensureExcluded(R.common, '.cos/');
  const briefFile = join(mbox, 'brief.md');
  const reportFile = join(mbox, 'report.md');
  writeFileSync(briefFile, renderBrief(ctx, { id, title, where, cwd: startCwd, branch, base, reportFile, brief, repo: R.name ? R.main : null }));
  if (!existsSync(reportFile)) writeFileSync(reportFile, reportTemplate(id));

  const chiefSession = chiefSessionFromEnv();
  const entry = {
    id, title, label, agent, kind, model: opt.model ?? null, where, cwd, branch, base,
    sub: startCwd === cwd ? null : R.sub, // 起動したサブディレクトリ（cwd は worktree の最上位のまま＝git の操作と片付けの基準）
    repo: R.name ? R.main : null, // --repo の依頼: worktree・ブランチは対象のリポジトリにある
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
  // COS_REPO_MAIN は worktree の元のリポジトリの本体＝準備で git 管理外の設定（.dev.vars など）を写すのに使う。
  const exportsLine = `export COS_WORKER_ID=${shq(id)} COS_WORKER_REPORT=${shq(reportFile)} COS_WORKER_MODE=${where} COS_REPO_MAIN=${shq(R.main)}`;
  const setup = setupFor(where, opt, R.setup) ?? 'true';
  // 打った行がそのまま画面に出ても一致しないよう、目印は printf で組み立てる。
  // pane run は受け付けたことしか返さない（JSON も無い）＝結果は下の wait-output で見る。
  const cdLine = startCwd === cwd ? '' : `cd ${shq(startCwd)} && `;
  herdr(['pane', 'run', pane, `${cdLine}${exportsLine}; ${setup} && printf 'COS_${nonce}_%s\\n' OK || printf 'COS_${nonce}_%s\\n' NG`], { json: false });
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
  if (R.name) console.log(`  リポジトリ: ${R.name}（${R.main}）`);
  if (startCwd !== cwd) console.log(`  起動した場所: ${startCwd}（サブディレクトリの CoS）`);
  if (where === 'worktree') console.log(`  作業ツリー: ${cwd}（ブランチ ${branch}・base ${base.slice(0, 10)}）`);
  else console.log(`  作業ツリー: ${cwd}（ブランチなし・detached ${base.slice(0, 10)}・準備 ${setup === 'true' ? 'なし' : setup}）`);
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
  const { pos, opt } = parseArgs(argv, ['first', 'seen']);
  const id = checkId(pos[0]);
  requireHerdr();
  const ctx = repoCtx();
  const w = getWorker(ctx, id);
  // 作業中の作業セッションへ向きを変える指示を、画面を見ずに送らない（報告書は古いことがある＝実際に進んでいた操作を止めた事故）。
  // working のときは画面の最後を出して止まる。見てから送るなら --seen。
  if (!opt.first && !opt.seen) {
    const a = findAgent(w, herdr(['agent', 'list']).result.agents);
    if (a && !SETTLED.has(a.agent_status)) {
      let tail = '';
      try {
        tail = herdr(['agent', 'read', a.pane_id, '--source', 'recent-unwrapped', '--lines', '20'], { json: false });
      } catch (e) {
        tail = `（画面を読めませんでした: ${e.message}）`;
      }
      process.stdout.write(tail);
      die(`${w.agent} はいま作業中（${a.agent_status}）です。上の画面で、何をしている最中か・報告書より先に進んでいないかを確かめてください。それでも送るなら cos send ${id} --seen …（ユーザーの「かも」程度の訂正なら、送る前に画面の事実を伝えて確かめ直す）`);
    }
  }
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
    const agents = ws.length > 0 ? herdr(['agent', 'list']).result.agents : [];
    const { events, seen } = ws.length > 0 ? detectEvents(ws, agents) : { events: [], seen: {} };
    if (Object.keys(seen).length > 0) {
      updateLedger(ctx, (l) => {
        for (const [id, st] of Object.entries(seen)) if (l.workers[id]) Object.assign(l.workers[id], { lastSeen: st, lastSeenAt: now() });
      });
    }
    // 終わったまま「進行中」で動かない作業セッション（同じ周で出来事が出ている作業セッションは除く）
    for (const ev of detectStalled(ws, Date.now(), ctx.cfg.stallMin * 60_000, (w) => readReport(w).state)) {
      if (!seen[ev.id]) events.push(ev);
    }
    // 見張り中のデプロイ（登録が無ければ gh を呼ばない・問い合わせは deployPollSec ごと）
    const deployEvents = pollDeploys(ctx, { pollMs: Math.max(ctx.cfg.deployPollSec * 1000, intervalMs), missingMs: ctx.cfg.deployMissingSec * 1000 });
    let retroNotify = false;
    if (events.length === 0 && deployEvents.length === 0 && retroDue(peekRetro(ctx), interval, Date.now()).notify) {
      // 同じ日に二度出さない。見張りが2本走っていても1本だけが出すよう、ロックの中で確かめ直して印を付ける。
      retroNotify = updateRetro(ctx, (r) => {
        if (!retroDue(r, interval, Date.now()).notify) return false;
        r.notifiedAt = now();
        return true;
      });
    }
    const step = watchStep({ events: [...events, ...deployEvents], retroNotify, timedOut: Date.now() - t0 > timeoutMs });
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
        if (ev.status === 'idle' || ev.status === 'done' || ev.status === 'stalled') {
          const a = findAgent(w, agents);
          try {
            if (a) ev.apiError = screenShowsApiError(herdr(['agent', 'read', a.pane_id, '--source', 'recent-unwrapped', '--lines', '15'], { json: false })) || undefined;
          } catch {
            // 画面が読めなくても出来事は出す
          }
        }
        if (ev.status === 'stalled') {
          updateLedger(ctx, (l) => {
            if (l.workers[ev.id]) l.workers[ev.id].stallNotified = String(ev.seq);
          });
        }
        logEvent(ctx, { kind: 'event', ...ev });
        console.log(JSON.stringify(ev));
      }
      for (const ev of deployEvents) {
        logEvent(ctx, { kind: ev.event, id: ev.id, repo: ev.repo, sha: ev.sha });
        console.log(JSON.stringify(ev));
      }
      console.log('');
      for (const ev of events) {
        const what = {
          idle: 'ターンが終わった',
          done: 'ターンが終わった',
          blocked: '承認や質問の画面で止まっている',
          gone: 'エージェントがいなくなった',
          stalled: `ターンが終わったまま ${ctx.cfg.stallMin} 分以上動いていない（止まった疑い。cos read で画面を見る）`,
        }[ev.status];
        console.log(`${ev.id}（${ev.agent}）: ${what}・報告書の状態「${ev.report ?? '読めない'}」${ev.startBlocked ? '・まだ依頼書を渡していない（片付いたら cos send --first）' : ''}${ev.apiError ? `・画面に API のエラー（応答の途中で切れて止まった。cos send ${ev.id} --seen で続きを促す）` : ''}`);
      }
      for (const ev of deployEvents) console.log(deployLine(ev));
      // 急ぐ種類は音と通知で知らせる（ユーザーが CoS の画面を見ていなくても気づけるように）
      const rang = [];
      // cos close で片付けた直後の作業セッションは gone として拾われるが、CoS が自分で終わらせたので鳴らさない
      const closedNow = new Set(Object.values(readLedger(ctx).workers).filter((w) => !WATCHED.has(w.state)).map((w) => w.id));
      for (const ev of [...events, ...deployEvents]) {
        if (ev.status === 'gone' && closedNow.has(ev.id)) continue;
        const a = alertFor(ev, ctx.cfg.alertOn);
        if (!a) continue;
        const r = sendAlert(ctx, { title: a.title, body: a.body, level: a.level, source: 'watch', windowMs: ctx.cfg.alertWindowMin * 60_000 });
        rang.push(`${a.title}（${r.suppressed ? '同じ件を鳴らし済み' : r.fired ? a.level : '鳴らせなかった'}）`);
      }
      if (rang.length) console.log(`\n音と通知: ${rang.join('・')}。同じ件で cos alert を打ち直さなくてよい`);
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

// 急ぎの知らせを鳴らす。失敗しても投げない（見張りや監視のスクリプトを止めない）。
// ctx が null（git の外）なら重複の抑えと記録は飛ばす。返すのは { fired, via, suppressed }。
function sendAlert(ctx, { title, body = '', level = 'urgent', source = 'cli', windowMs }) {
  let fire = true;
  if (ctx) {
    try {
      fire = withLock(ctx, () => {
        let last = {};
        try {
          if (existsSync(ctx.alertsFile)) last = JSON.parse(readFileSync(ctx.alertsFile, 'utf8')).last ?? {};
        } catch {
          // 壊れた記録は捨てて鳴らす（鳴らし損ねる方が悪い）
        }
        const r = alertThrottle(last, title, Date.now(), windowMs);
        writeAtomic(ctx.alertsFile, `${JSON.stringify({ version: 1, last: r.next }, null, 2)}\n`);
        return r.fire;
      });
    } catch (e) {
      console.error(`cos alert: 重複の記録を読めないまま鳴らします（${e.message}）`);
    }
  }
  let via = null;
  const errs = [];
  if (fire) {
    for (const [bin, args] of alertCommands(level, title, body, process.platform)) {
      try {
        execFileSync(bin, args, { stdio: ['ignore', 'ignore', 'pipe'], timeout: 10_000 });
        via = bin;
        break;
      } catch (e) {
        const msg = e.code === 'ENOENT' ? '見つかりません' : String(e.stderr ?? '').trim().split('\n')[0] || `終了コード ${e.status ?? e.signal ?? '?'}`;
        errs.push(`${bin}: ${msg}`);
      }
    }
    if (!via) {
      console.error(`cos alert: 知らせを出せませんでした（${errs.join(' / ')}）`);
      // 鳴らせなかった件は重複の記録から外す（次に打ったときは鳴らす）
      if (ctx) {
        try {
          withLock(ctx, () => {
            const j = JSON.parse(readFileSync(ctx.alertsFile, 'utf8'));
            delete j.last?.[title];
            writeAtomic(ctx.alertsFile, `${JSON.stringify(j, null, 2)}\n`);
          });
        } catch {
          // 外せなくても止めない
        }
      }
    }
  }
  if (ctx) {
    try {
      logEvent(ctx, { kind: 'alert', title, body, level, source, via: via ?? undefined, suppressed: fire ? undefined : true, failed: fire && !via ? true : undefined });
    } catch {
      // 記録できなくても止めない
    }
  }
  return { fired: Boolean(via), via, suppressed: !fire };
}

function cmdAlert(argv) {
  const { pos, opt } = parseArgs(argv, []);
  const [title, body = ''] = pos;
  if (!title) throw new UsageError('cos alert "<件>" "<一言>" [--level urgent|info] [--window 分]');
  const level = opt.level ?? 'urgent';
  if (level !== 'urgent' && level !== 'info') throw new UsageError(`--level は urgent か info です: ${level}`);
  let ctx = null;
  try {
    ctx = repoCtxSoft();
  } catch (e) {
    console.error(`cos alert: CoS の状態の置き場所が分からないので、重複の抑えと記録をしません（${String(e.message).split('\n').find((l) => l.startsWith('fatal:')) ?? String(e.message).split('\n')[0]}）`);
  }
  const min = Number(opt.window ?? ctx?.cfg.alertWindowMin ?? 10);
  const r = sendAlert(ctx, { title, body, level, source: 'cli', windowMs: (Number.isFinite(min) ? min : 10) * 60_000 });
  if (r.suppressed) console.log(`鳴らしませんでした（同じ件「${title}」を ${min} 分のうちに鳴らし済み）`);
  else if (r.fired) console.log(`知らせました（${r.via}・${level}）: ${title}`);
}

// repoCtx の die しない版（cos alert は git の外や cos.json が壊れていても鳴らす）。
function repoCtxSoft() {
  const cwd = process.env.COS_ROOT && existsSync(process.env.COS_ROOT) ? process.env.COS_ROOT : process.cwd();
  const { root, dir } = locate(cwd, process.env.COS_DIR);
  let user = {};
  try {
    const f = join(root, '.claude', 'cos.json');
    if (existsSync(f)) user = JSON.parse(readFileSync(f, 'utf8'));
  } catch {
    // 設定が読めなくても既定値で鳴らす
  }
  return { cfg: { ...DEFAULT_CFG, ...user }, dir, eventsFile: join(dir, 'events.jsonl'), alertsFile: join(dir, 'alerts.json') };
}

function cmdDeployWatch(argv) {
  const { pos, opt } = parseArgs(argv, []);
  const ctx = repoCtx();
  if (opt.cancel) {
    const gone = updateDeploys(ctx, (x) => {
      const had = Boolean(x.deploys[opt.cancel]);
      delete x.deploys[opt.cancel];
      return had;
    });
    if (!gone) die(`${opt.cancel} は見張っていません（cos status で一覧）`);
    logEvent(ctx, { kind: 'deploy-cancel', id: opt.cancel });
    console.log(`見張りをやめました: ${opt.cancel}`);
    return;
  }
  if (pos.length !== 2) throw new UsageError('cos deploy-watch <repo> <sha> [--workflow W] [--label 名前] [--event E,...] | --cancel <ID>');
  const { repo, local } = resolveGhRepo(ctx, pos[0]);
  const sha = resolveSha(repo, local, pos[1]);
  const workflow = opt.workflow ?? null;
  const id = deployId(repo, sha, workflow);
  if (readDeploys(ctx).deploys[id]) {
    console.log(`すでに見張っています: ${id}`);
    return;
  }
  // 最初に1回問い合わせる＝リポジトリ・認証・workflow の名前の誤りをここで知らせる（見張りの中で黙って失敗させない）。
  let runs;
  try {
    runs = ghRuns({ repo, sha, workflow });
  } catch (e) {
    die(`gh run list が失敗しました（${repo} ${sha.slice(0, 7)}${workflow ? ` --workflow ${workflow}` : ''}）: ${e.message}`);
  }
  const at = now();
  const entry = {
    id, repo, sha, workflow, label: opt.label ?? null,
    events: opt.event ? opt.event.split(',').map((x) => x.trim()).filter(Boolean) : null,
    createdAt: at, checkedAt: at, lastOkAt: at, lastError: null, settleIds: null, summary: null,
  };
  const dec = deployDecision({ runs, entry, nowMs: Date.parse(at), missingMs: ctx.cfg.deployMissingSec * 1000 });
  if (dec.state === 'settling') entry.settleIds = dec.ids;
  entry.summary = deploySummary(dec);
  updateDeploys(ctx, (x) => {
    x.deploys[id] = entry;
  });
  logEvent(ctx, { kind: 'deploy-watch', id, repo, sha, workflow: workflow ?? undefined });
  noteChiefSession(ctx, chiefSessionFromEnv(), 'deploy-watch');
  console.log(`見張りに足しました: ${id}（${repo} ${sha.slice(0, 10)}${workflow ? `・workflow ${workflow}` : ''}）・いま ${entry.summary}`);
  console.log(`終わったら cos watch が deploy-done / deploy-failed を出します（${ctx.cfg.deployMissingSec} 秒 run が無ければ deploy-missing）。cos watch が裏で動いていなければ張ってください。`);
}

// 台帳の依頼を cos status の行にする。ctx は台帳を持つ CoS のリポジトリ（top＝--repo の無い依頼の git 操作をするツリー）。
function statusRows(ctx, led, agents, all, headOf) {
  return Object.values(led.workers)
    .filter((w) => all || w.state !== 'closed')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((w) => {
      const a = w.state === 'closed' ? null : findAgent(w, agents);
      const rep = w.state === 'closed' ? { state: null, mtime: null } : readReport(w);
      const row = {
        id: w.id, title: w.title, label: w.label ?? null, agent: w.agent, state: w.state, where: w.where,
        status: a ? a.agent_status : w.state === 'closed' ? '-' : 'gone',
        report: rep.state, reportUpdated: rep.mtime, workspace: w.workspace, pane: w.pane,
        branch: w.branch, cwd: w.cwd, repo: w.repo ?? null,
      };
      if (w.where === 'detached' && w.state !== 'closed' && existsSync(w.cwd)) {
        row.dirty = git(['status', '--porcelain'], w.cwd).split('\n').filter(Boolean).length;
      }
      if (w.where === 'worktree' && w.state !== 'closed' && existsSync(w.cwd)) {
        const gdir = gitDirOf(ctx, w);
        row.commits = Number(git(['rev-list', '--count', `${w.base}..${w.branch}`], gdir));
        row.merged = gitOk(['merge-base', '--is-ancestor', w.branch, headOf(gdir)], gdir);
        row.dirty = git(['status', '--porcelain'], w.cwd).split('\n').filter(Boolean).length;
      }
      return row;
    });
}

// ハブの cos.json の repos に並べた各リポジトリの CoS の台帳（ハブから --repo で立てた依頼はハブの台帳にあるので別物）。
// 読むだけ。対象の cos.json は読まない（壊れていてもハブの status を止めない）。COS_DIR はハブにだけ効く。
// 台帳の無いリポジトリは返さない。同じ台帳は1回だけ。パスがサブディレクトリなら、そこから上へ cos.json を探した CoS の台帳。
function otherLedgers(ctx, agents, all, headOf) {
  const real = (d) => (existsSync(d) ? realpathSync(d) : resolve(d));
  const seen = new Set([real(ctx.dir)]);
  const out = [];
  for (const [name, ent] of Object.entries(ctx.cfg.repos ?? {})) {
    const raw = typeof ent === 'string' ? ent : ent?.path;
    const abs = raw ? resolve(raw.replace(/^~(?=\/|$)/, homedir())) : null;
    const r = { name, path: abs, ledger: null, workers: [], error: null };
    try {
      if (!abs) throw new Error('パスがありません');
      if (!existsSync(abs)) throw new Error(`${abs} がありません`);
      const loc = locate(abs, null);
      const key = real(loc.dir);
      if (seen.has(key)) continue;
      seen.add(key);
      const main = git(['worktree', 'list', '--porcelain'], abs).split('\n').find((l) => l.startsWith('worktree ')).slice('worktree '.length);
      r.ledger = join(loc.dir, 'ledger.json');
      if (!existsSync(r.ledger)) continue;
      r.workers = statusRows({ top: main }, JSON.parse(readFileSync(r.ledger, 'utf8')), agents, all, headOf);
    } catch (e) {
      r.error = String(e.stderr || e.message).trim().split('\n')[0];
    }
    out.push(r);
  }
  return out;
}

function printRows(rows) {
  if (rows.length === 0) console.log('  （なし）');
  for (const r of rows) {
    const rep = r.report ? `報告「${r.report}」${r.reportUpdated ? `（${ago(r.reportUpdated)}）` : ''}` : '報告なし';
    const st = r.state === 'running' ? r.status : `${r.state}${r.status !== '-' ? `／${r.status}` : ''}`;
    console.log(`  ${r.id}「${r.label ?? '-'}」${r.repo ? ` [${basename(r.repo)}]` : ''}  ${r.agent}  ${st}  ${rep}  ${r.title !== r.id ? r.title : ''}`);
    if (r.where === 'worktree' && r.commits !== undefined) {
      console.log(`      ${r.branch}  コミット ${r.commits}${r.commits ? (r.merged ? '（マージ済み）' : '（未マージ）') : ''}・未コミット ${r.dirty}  ワークスペース ${r.workspace}・ペイン ${r.pane}`);
    } else if (r.where === 'detached' && r.dirty !== undefined) {
      console.log(`      ${r.cwd}（ブランチなし）・未コミット ${r.dirty}  ワークスペース ${r.workspace}・ペイン ${r.pane}`);
    } else if (r.state !== 'closed') {
      const place = r.where === 'tab' ? '本体の作業ツリー（共有）・CoS のワークスペースのタブ' : r.where === 'shared' ? '本体の作業ツリー（共有）' : r.cwd;
      console.log(`      ${place}  ワークスペース ${r.workspace}・ペイン ${r.pane}`);
    }
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
  const heads = new Map(); // git 操作をするツリー → その HEAD（--repo の依頼は対象の本体の HEAD でマージ済みを見る）
  const headOf = (dir) => {
    if (!heads.has(dir)) heads.set(dir, git(['rev-parse', 'HEAD'], dir));
    return heads.get(dir);
  };
  const rows = statusRows(ctx, led, agents, opt.all, headOf);
  const repos = otherLedgers(ctx, agents, opt.all, headOf);
  if (opt.json) {
    const r = peekRetro(ctx);
    const { dueAt, due } = retroDue(r, ctx.cfg.retroIntervalDays, Date.now());
    const retro = { since: r.since, dueAt: new Date(dueAt).toISOString(), due, notifiedAt: r.notifiedAt, draft: r.draft, stored: r.stored };
    console.log(JSON.stringify({ workers: rows, herdrError: herdrErr, retro, repos, deploys: Object.values(readDeploys(ctx).deploys) }, null, 2));
    return;
  }
  if (herdrErr) console.log(`（herdr に問い合わせられません: ${herdrErr}）`);
  const live = rows.filter((r) => r.state !== 'closed').length;
  if (ctx.sub) console.log(`サブディレクトリ ${ctx.sub}/ の CoS（設定 ${ctx.cfgFile}）`);
  console.log(`作業セッション ${live} 本（上限 ${ctx.cfg.maxWorkers}）・台帳 ${ctx.ledgerFile}`);
  printRows(rows);
  for (const o of repos) {
    if (o.error) {
      console.log(`[${o.name}] の台帳を読めません: ${o.error}`);
      continue;
    }
    console.log(`[${o.name}] の CoS: 作業セッション ${o.workers.filter((r) => r.state !== 'closed').length} 本・台帳 ${o.ledger}`);
    printRows(o.workers);
  }
  const deploys = Object.values(readDeploys(ctx).deploys).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (deploys.length) {
    console.log(`見張り中のデプロイ ${deploys.length} 件・台帳 ${ctx.deploysFile}`);
    for (const d of deploys) {
      console.log(`  ${d.id}${d.label ? `「${d.label}」` : ''}  ${d.repo} ${d.sha.slice(0, 7)}${d.workflow ? `  workflow ${d.workflow}` : ''}  ${d.summary ?? '-'}・登録 ${ago(d.createdAt)}・確認 ${ago(d.checkedAt)}`);
    }
  }
  console.log(retroLine(ctx));
  { const al = answersLine(ctx); if (al) console.log(al); }
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

// Claude Code の設定の置き場所（会話ログ・セッションの記録）。
function claudeHome() {
  return process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
}

// 作業セッション（Claude Code）自身の Claude-Session。動いているあいだは ~/.claude/sessions/*.json の
// bridgeSessionId（cwd が作業ツリーのもの）、終わっていても作業ツリーの会話ログの帰属の指示から拾う。
function workerSessions(w) {
  const own = new Set();
  if (w.kind !== 'claude' || !w.cwd) return own;
  const home = claudeHome();
  const sdir = join(home, 'sessions');
  for (const f of existsSync(sdir) ? readdirSync(sdir) : []) {
    if (!f.endsWith('.json')) continue;
    try {
      const j = JSON.parse(readFileSync(join(sdir, f), 'utf8'));
      if (j.cwd === w.cwd && j.bridgeSessionId) own.add(sessionKey(j.bridgeSessionId));
    } catch {
      // 書きかけ・別の形のファイルは飛ばす
    }
  }
  const pdir = join(home, 'projects', w.cwd.replace(/[^A-Za-z0-9]/g, '-'));
  for (const f of existsSync(pdir) ? readdirSync(pdir) : []) {
    if (!f.endsWith('.jsonl')) continue;
    for (const s of ownSessionsInTranscript(readFileSync(join(pdir, f), 'utf8'))) own.add(s);
  }
  return own;
}

// cos check の本体。返すのは { warns, info }。台帳・作業ツリーは変えない（defaultBase の fetch だけする）。
function runCheck(ctx, w) {
  const code = w.where === 'worktree';
  const warns = checkReportText(readReport(w).text, ctx.cfg, { code });
  const info = [];
  if (!code) return { warns, info: ['ブランチの無い依頼（コミットと土台は見ていません）'] };
  const gdir = gitDirOf(ctx, w);
  if (!gitOk(['show-ref', '--verify', '--quiet', `refs/heads/${w.branch}`], gdir)) {
    return { warns: [...warns, `ブランチ ${w.branch} がありません`], info };
  }
  const upstream = repoFor(ctx, w.repo ?? undefined).defaultBase;
  let from = w.base;
  if (upstream) {
    const m = /^([^/]+)\/(.+)$/.exec(upstream);
    if (m && gitOk(['remote', 'get-url', m[1]], gdir) && !gitOk(['fetch', '--quiet', m[1], m[2]], gdir)) {
      warns.push(`git fetch ${m[1]} ${m[2]} に失敗しました（手元の ${upstream} で数えています）`);
    }
    if (gitOk(['rev-parse', '--verify', '--quiet', `${upstream}^{commit}`], gdir)) {
      from = upstream;
      const behind = Number(git(['rev-list', '--count', `${w.branch}..${upstream}`], gdir));
      info.push(`土台: ${upstream} の最新から ${behind} コミット遅れ`);
      if (behind >= Number(ctx.cfg.baseLagWarn)) warns.push(`ブランチの土台が ${upstream} の最新から ${behind} コミット遅れています（取り込みでぶつからないか見る）`);
    } else warns.push(`defaultBase の ${upstream} が見つかりません`);
  } else info.push('土台: defaultBase が無いので遅れは数えていません');
  if (!from) return { warns, info };
  // マージ済みの土台の変更（作業セッションが upstream を取り込んだもの）は数えない＝upstream に無いコミットだけ見る。
  const commits = parseSessionLog(git(['log', '--no-merges', '--format=%H%x00%s%x00%(trailers:key=Claude-Session,valueonly,separator=%x2C)%x1e', `${from}..${w.branch}`], gdir));
  info.push(`コミット: ${commits.length} 件（${from.length === 40 ? from.slice(0, 9) : from}..${w.branch}・マージを除く）`);
  const s = sessionFindings(commits, workerSessions(w));
  return { warns: [...warns, ...s.warns], info: [...info, ...s.info] };
}

function printCheck(id, r) {
  console.log(`cos check ${id}: ${r.warns.length ? `警告 ${r.warns.length} 件` : 'OK'}`);
  for (const x of r.warns) console.log(`  ! ${x}`);
  for (const x of r.info) console.log(`  - ${x}`);
}

function cmdCheck(argv) {
  const { pos } = parseArgs(argv);
  const id = checkId(pos[0]);
  const ctx = repoCtx();
  const r = runCheck(ctx, getWorker(ctx, id));
  printCheck(id, r);
  if (r.warns.length) process.exitCode = 1;
}

function cmdClose(argv) {
  const { pos, opt } = parseArgs(argv, ['force', 'keep-branch']);
  const id = checkId(pos[0]);
  requireHerdr();
  const ctx = repoCtx();
  const w = getWorker(ctx, id);
  const s = slug(id);
  // 片付ける前に検査の結果を残す（警告があっても止めない＝取り込みの判断は済んでいる）。
  try {
    printCheck(id, runCheck(ctx, w));
  } catch (e) {
    console.log(`cos check ${id}: 検査できませんでした（${e.message}）`);
  }

  let merged = true;
  if (hasOwnWorktree(w) && existsSync(w.cwd)) {
    const dirty = git(['status', '--porcelain'], w.cwd);
    if (dirty && !opt.force) die(`未コミットの変更があります（捨ててよければ --force）:\n${dirty}`);
  }
  const gdir = gitDirOf(ctx, w);
  if (w.where === 'worktree') {
    const hasBranch = gitOk(['show-ref', '--verify', '--quiet', `refs/heads/${w.branch}`], gdir);
    merged = !hasBranch || gitOk(['merge-base', '--is-ancestor', w.branch, 'HEAD'], gdir);
    if (!merged && !opt.force) die(`${w.branch} は${w.repo ? ` ${w.repo} の` : 'このツリーの'} HEAD にマージされていません（捨ててよければ --force）`);
  }

  // 控えを先に取る（worktree を消すと依頼書・報告書も消える）。
  const archive = join(ctx.dir, 'archive', `${s}-${now().replace(/[:.]/g, '').slice(0, 15)}`);
  mkdirSync(archive, { recursive: true });
  const mbox = dirname(w.report);
  // 作業セッションが受け箱の下にフォルダ（スクリーンショット等）を作ることがある＝丸ごと写す。
  if (existsSync(mbox)) cpSync(mbox, archive, { recursive: true });

  // エージェントを止める前に見張りの対象から外す。止めてから closed を書くまでの間に cos watch が gone を拾い、誤って急ぎの知らせを鳴らしていた
  setWorker(ctx, id, { state: 'closing' });
  stopAgent(w);
  if (hasOwnWorktree(w)) {
    if (workspaceExists(w.workspace)) {
      herdr(['worktree', 'remove', '--workspace', w.workspace, ...(opt.force ? ['--force'] : [])]);
    } else if (existsSync(w.cwd)) {
      // ワークスペースはユーザーが閉じ済み。worktree だけ残っている。
      git(['worktree', 'remove', ...(opt.force ? ['--force'] : []), w.cwd], gdir);
    }
    if (w.where === 'worktree' && !opt['keep-branch'] && gitOk(['show-ref', '--verify', '--quiet', `refs/heads/${w.branch}`], gdir)) {
      git(['branch', merged ? '-d' : '-D', w.branch], gdir);
    }
  } else {
    // 前の版の作業ツリーを分けない依頼（shared・tab）: そのワークスペース（tab はタブ）を閉じ、受け箱を消す（控えは取ってある）。
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
//
// --known-only: ユーザー全体の設定（matcher resume|compact|clear）から全セッションで呼ばれる。
// `claude --resume` で `cos chief` を通らずに開くと chief-settings.json のフックも自動要約の設定も効かないので、
// chief.json に記録済みのセッションだけ、上の compact / clear と同じ文脈と「`cos chief --resume` で開き直す」注意を戻す。
// それ以外（判定は knownOnlyDecision）・git の外・chief.json が無い／読めないときは、何も出さず何も書かずに終わる。
function cmdReorient(argv = []) {
  const { opt } = parseArgs(argv, ['hook', 'known-only']);
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
  if (opt['known-only']) return reorientKnownOnly(input);
  const source = input.source ?? 'manual';
  const inRepo = gitOk(['rev-parse', '--git-dir'], startDir());
  let ctx = null;
  if (inRepo) {
    ctx = repoCtx();
    if (input.session_id) noteChiefSession(ctx, input.session_id, `hook:${source}`, input.transcript_path ?? null);
  }
  const { retro, retroIsDue } = retroInfo(ctx);
  if (source === 'startup' || source === 'resume') {
    emitHookContext([`[chief of staff] ${retro}`, inputErr ? `（フックの入力が読めませんでした: ${inputErr}）` : ''].filter(Boolean).join('\n'));
    return;
  }
  emitHookContext(reorientText(ctx, {
    header: '[chief of staff] このセッションは CoS（chief of staff）です（`cos chief` で起動）。会話が要約または消去されたので、続ける前に次を行ってください。',
    retroIsDue,
    inputErr,
  }));
}

function emitHookContext(text) {
  console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text } }));
}

function retroInfo(ctx) {
  try {
    return {
      retro: ctx ? retroLine(ctx) : '振り返り: （git リポジトリの外なので分かりません）',
      retroIsDue: ctx ? retroDue(peekRetro(ctx), ctx.cfg.retroIntervalDays, Date.now()).due : false,
    };
  } catch (e) {
    return { retro: `振り返り: （期限の記録が読めません: ${e.message}）`, retroIsDue: false };
  }
}

// CoS を立て直す手順と今の一覧（振り返りの期限を含む）。
function reorientText(ctx, { header, notes = [], retroIsDue, inputErr }) {
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
  const rules = ctx?.cfg.chiefRules ? join(ctx.root, ctx.cfg.chiefRules) : '';
  return [
    header,
    ...notes,
    '1. chief-of-staff スキル（~/.claude/skills/chief-of-staff/SKILL.md）を読み直す。',
    rules ? `2. このリポジトリの CoS の決まり（${rules}）を読み直す。` : '2. リポジトリに .claude/cos.json の chiefRules があれば読み直す。',
    '3. 下の一覧で依頼中の作業セッションを確かめ、`cos watch` が裏で動いていなければ run_in_background で張り直す（作業セッションが0本でも張る＝振り返りの期限も見張っている）。',
    '4. ユーザーとの決定は ROADMAP などの耐久層に残っているので、要約に無いことは推測せずそこから引く。',
    ...(retroIsDue ? ['5. 週1回の振り返りの期限を過ぎています。ユーザーとの話の区切りで、スキルの「週1回の振り返り」に沿って進める。'] : []),
    ...(inputErr ? [`（フックの入力が読めませんでした: ${inputErr}）`] : []),
    '',
    status,
  ].join('\n');
}

function reorientKnownOnly(input) {
  const sid = input.session_id;
  const env = process.env;
  let sessions = null;
  try {
    const cwd = env.COS_ROOT || process.cwd();
    if (gitOk(['rev-parse', '--git-dir'], cwd)) {
      const chiefFile = join(locate(cwd, env.COS_DIR).dir, 'chief.json');
      if (existsSync(chiefFile)) sessions = JSON.parse(readFileSync(chiefFile, 'utf8')).sessions;
    }
  } catch {
    // 読めなければ CoS かどうか分からない＝記録に無いのと同じく何もしない
  }
  if (knownOnlyDecision({ env, sid, sessions }) !== 'emit') return;
  // ここから先は CoS のセッション（.claude/cos.json が壊れていれば、通常の reorient と同じく止めて知らせる）。
  const ctx = repoCtx();
  const source = input.source ?? 'resume';
  noteChiefSession(ctx, sid, `known:${source}`, input.transcript_path ?? null);
  const { retroIsDue } = retroInfo(ctx);
  const what = source === 'resume' ? '再開された' : '会話が要約または消去された';
  const missing = env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE
    ? '起動の設定（chief-settings.json のフック）'
    : '起動の設定（chief-settings.json のフック）と自動要約（CLAUDE_AUTOCOMPACT_PCT_OVERRIDE）';
  emitHookContext(reorientText(ctx, {
    header: `[chief of staff] このセッションは CoS（chief of staff）です（chief.json に記録あり）。${what}ので、続ける前に次を行ってください。`,
    notes: [
      `注意: \`cos chief\` を通らずに開いているので、${missing}が入っていません。ユーザーとの話の区切りで「このペインの claude を終了して \`cos chief --resume ${sid}\` で立ち上げ直すと入る」と伝える。`,
    ],
    retroIsDue,
  }));
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
  const base = join(claudeHome(), 'projects');
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
  L.push(`- リポジトリ: ${ctx.main}${ctx.sub ? `（サブディレクトリ ${ctx.sub}/ の CoS）` : ''}`);
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

// `cos root`: この場所の CoS のディレクトリ（cos.json のあるディレクトリ・無ければ git の最上位）を出す。
// --sub は最上位からの相対（最上位の CoS なら空行）。chief.sh が起動する場所と名前を決めるのに使う。
// ---- ユーザーの質問への回答を、読んだと確かめるまで追う（cos answer）----
// 途中で答えた回答は、そのあとの報告に押し流されてユーザーの目に入らないことがある。
// CoS が答えたら `cos answer add` で登録し、ユーザーが読んだと言うまで「返事を待っているもの」に並べる。
// Stop フック（`cos answer hook`）が、「返事を待っているもの」を出した報告に未確認の回答の ID が
// 載っていなければ1回だけ止める＝文章の決まりでなく機械で忘れを止める。
function readAnswers(ctx) {
  if (!existsSync(ctx.answersFile)) return { version: 1, next: 1, items: [] };
  return JSON.parse(readFileSync(ctx.answersFile, 'utf8'));
}

function updateAnswers(ctx, fn) {
  return withLock(ctx, () => {
    const a = readAnswers(ctx);
    const out = fn(a);
    writeAtomic(ctx.answersFile, `${JSON.stringify(a, null, 2)}\n`);
    return out;
  });
}

function pendingAnswers(ctx) {
  return readAnswers(ctx).items.filter((x) => !x.readAt);
}

function answersLine(ctx) {
  const p = pendingAnswers(ctx);
  if (p.length === 0) return null;
  return `読んだか確かめていない回答: ${p.length} 件（${p.map((x) => `[${x.id}] ${x.question}`).join('／')}）＝報告の「返事を待っているもの」に並べ、読んだと言われたら cos answer read <ID>`;
}

// 最後のユーザーの発言（ツールの結果・差し込みを除く）より後の、assistant の文を全部つなぐ。
function lastTurnAssistantText(lines) {
  return lastTurnAssistantTexts(lines).join('\n');
}

// 同じく、assistant の記録ごとの文の並び（空の記録は除く）。最後の要素が、そのターンで最後に出した文。
function lastTurnAssistantTexts(lines) {
  let texts = [];
  for (const line of lines) {
    let rec;
    try { rec = JSON.parse(line); } catch { continue; }
    if (rec.isSidechain) continue;
    const content = rec.message?.content;
    if (rec.type === 'user' && !rec.isMeta) {
      const isHuman = typeof content === 'string'
        ? !content.startsWith('<')
        : Array.isArray(content) && !content.some((c) => c?.type === 'tool_result')
          && content.some((c) => c?.type === 'text' && !String(c.text).startsWith('<'));
      if (isHuman) texts = [];
      continue;
    }
    if (rec.type === 'assistant' && Array.isArray(content)) {
      const t = content.filter((c) => c?.type === 'text' && c.text).map((c) => c.text);
      if (t.some((x) => x.trim())) texts.push(t.join('\n'));
    }
  }
  return texts;
}

// 判定だけの純関数（自己テスト用）。止めるなら理由の文、通すなら null。
function answerHookDecision(text, pending, marker = '返事を待っているもの') {
  if (pending.length === 0) return null;
  if (!text.includes(marker)) return null; // 報告でないターン（張り直しだけ等）は止めない
  const idx = text.lastIndexOf(marker);
  const tail = text.slice(idx);
  const missing = pending.filter((x) => !tail.includes(`[${x.id}]`));
  if (missing.length === 0) return null;
  return [
    'ユーザーが読んだと確かめていない回答があります。「返事を待っているもの」の中に、次の回答を ID 付きで並べ直してください（答えの要点を1〜2行・「読んだら教えてください」）。',
    ...missing.map((x) => `- [${x.id}] ${x.question}${x.answer ? `（答え: ${x.answer}）` : ''}`),
    'ユーザーが読んだと言ったら `cos answer read <ID>`。もう要らない回答なら `cos answer read <ID> --note 理由`。',
  ].join('\n');
}

// ---- 「進めているもの」の各項目に、実際に動いているものの印を求める（同じ Stop フックで見る）----
// ある CoS が一度も始めていない確認を、報告のたびに3時間「進めているもの」に書き写し続けた。誰も動いていない
// 項目を、ユーザーは進んでいると受け取る。報告の最後の文に「進めているもの」の見出しがあれば、その下の箇条書きを
// 1項目ずつ見て、次の印のどれも無い項目があれば止める。
// - 動いている裏のコマンドの ID（b＋英数字8文字。tasks/<ID>.output があり、終わっても止められてもいない）
// - 台帳にある、閉じていない作業セッションの ID
// - #番号（PR / Issue。CI 待ちなどは GitHub と見張りが動いているので、ここまでは確かめない）
// - ほかの人が動いている印（「ユーザーが」「〇〇さんから」「…の返事」「…待ち」）。名前が出るだけでは通さない
const PROGRESS_HEADING = /^\s*(?:#{1,6}\s*|\*\*)?進めているもの(?:[（(][^）)]*[）)])?\s*(?:\*\*)?\s*[:：]?\s*$/;
const PROGRESS_BULLET = /^(?:[-*+・]|\d+[.)])\s+/;
const BG_ID_RE = /(?<![0-9A-Za-z])(b[0-9a-z]{8})(?![0-9A-Za-z])/g;
const ISSUE_RE = /(?<![0-9A-Za-z&])#\d+(?![0-9A-Za-z])/;
const PERSON_RE = /(?:ユーザー|ご自身|[\u3005\u3007\u4e00-\u9fa5\u30a1-\u30f6\u30fc]{1,8}さん)(?:が|から|の返事|の作業|の確認|待ち)/;

// 「進めているもの」の見出しの下の箇条書きを、子の行も含めて1項目ずつ返す。
// 次の見出しか、箇条書きでない段落で終わる。続けて別の「進めているもの」があれば読み直す。
export function progressItems(text) {
  const items = [];
  let cur = null;
  let inside = false;
  for (const line of String(text).split(/\r?\n/)) {
    if (!inside) {
      if (PROGRESS_HEADING.test(line)) inside = true;
      continue;
    }
    if (!line.trim()) continue;
    if (PROGRESS_BULLET.test(line)) {
      cur = [line.trim()];
      items.push(cur);
    } else if ((line[0] === ' ' || line[0] === '\t') && cur) {
      cur.push(line.trim());
    } else {
      inside = PROGRESS_HEADING.test(line);
      cur = null;
    }
  }
  return items.map((i) => i.join('\n'));
}

// 項目に印があるか。isLiveBg(ID) は裏のコマンドがまだ動いているか、workers は閉じていない作業セッションの ID。
export function hasProgressAnchor(item, isLiveBg, workers) {
  if (ISSUE_RE.test(item) || PERSON_RE.test(item)) return true;
  for (const m of item.matchAll(BG_ID_RE)) if (isLiveBg(m[1])) return true;
  for (const w of workers) {
    if (!w) continue;
    const esc = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(?<![0-9A-Za-z_-])${esc}(?![0-9A-Za-z_-])`).test(item)) return true;
  }
  return false;
}

// 判定だけの純関数。止めるなら理由の文、通すなら null。
export function progressHookDecision(text, isLiveBg, workers) {
  const bad = progressItems(text).filter((i) => !hasProgressAnchor(i, isLiveBg, workers));
  if (bad.length === 0) return null;
  return [
    '「進めているもの」に、実際に動いているものの印が無い項目があります。',
    ...bad.map((i) => `- 「${i.split('\n')[0].slice(0, 200)}」`),
    '各項目は、実際に始めて裏のコマンドの ID を書く・作業セッションを立てる・返事を待っているものに移す・消す、のどれかにしてください。'
      + '印として認めるのは、動いている裏のコマンドの ID（b＋英数字8文字）・台帳にある閉じていない作業セッションの ID・#番号・'
      + '「ユーザーが」「〇〇さんから」のようにほかの人が動いている書き方です。',
    'なぜ駄目か: 書き写しているだけで誰も動いていない項目を、ユーザーが進んでいると誤解します（一度も始めていない確認を、3時間載せ続けたことがある）。',
  ].join('\n');
}

// 2つの検査の理由を1つにまとめる（両方 null なら null）。
export function stopHookReason(...reasons) {
  const r = reasons.filter(Boolean);
  return r.length ? r.join('\n\n') : null;
}

// 「進めているもの」の検査をするセッションか。`cos chief` で起動した CoS だけ（作業セッション・普通のセッションは止めない）。
export function progressCheckApplies(env) {
  return env.COS_CHIEF === '1' && !env.COS_WORKER_ID;
}

// Stop フックの判定（配線ごと純関数）。止めるなら block の理由の文、通すなら null。
// texts はターンの assistant の文を記録ごとに並べたもの。未確認の回答はターン全体の文から、「進めているもの」は
// 最後の文から探す。pending・isLiveBg・workers は読めなかったら null（その検査だけ飛ばす）。
export function stopHookDecision({ env, input, texts, pending, isLiveBg, workers }) {
  if (input.stop_hook_active) return null; // このフックで止めた続きの Stop＝1ターンに1回まで
  const answerReason = pending?.length ? answerHookDecision(texts.join('\n'), pending) : null;
  const progressReason = progressCheckApplies(env) && texts.length && isLiveBg && workers
    ? progressHookDecision(texts[texts.length - 1], isLiveBg, workers)
    : null;
  const reason = stopHookReason(answerReason, progressReason);
  return reason ? `${reason}\n（この Stop フックは同じターンで1回だけ止めます）` : null;
}

// 裏のコマンドの出力の置き場所（<tmp>/claude-<uid>/<project>/<session>/tasks）。
// 会話ログの置き場所と tmp 側のプロジェクト名が違うことがあるので、見つからなければセッションで探す。
export function bgTasksDirs(transcript, session, env = process.env, uid = process.getuid?.() ?? 0) {
  const root = join(env.CLAUDE_CODE_TMPDIR || '/tmp', `claude-${uid}`);
  const first = join(root, basename(dirname(transcript)), session, 'tasks');
  if (existsSync(first)) return [first];
  try {
    return readdirSync(root).map((p) => join(root, p, session, 'tasks')).filter((d) => existsSync(d));
  } catch {
    return [];
  }
}

// 裏のコマンドがまだ動いているか。終わると最後の行が「[exited with code N]」、止める（KillShell）と「[killed]」になる。
// sinceMs（今の Claude Code のプロセスが起動した時刻）より前に作られた出力は、動いていないとみなす。
// `claude --resume` は同じセッション ID を使うので、前のプロセスと一緒に死んで終わりの印を残さなかった
// 出力が同じ tasks に残り、印が無いまま「動いている」に見えるため。sinceMs が null なら作られた時刻は見ない。
export function liveBgIn(dirs, sinceMs = null) {
  return (id) => {
    for (const d of dirs) {
      const p = join(d, `${id}.output`);
      if (!existsSync(p)) continue;
      if (sinceMs != null) {
        const st = statSync(p);
        if ((st.birthtimeMs || st.mtimeMs) < sinceMs) return false;
      }
      const out = readFileSync(p, 'utf8');
      // 最後の行だけを見る（動き続けるコマンドが途中に子の「exited with code」を書いても死んだことにしない）
      const last = out.trimEnd().split('\n').pop();
      return !/^\[exited with code -?\d+\]$/.test(last) && last !== '[killed]';
    }
    return false;
  };
}

// このフックを呼んだ Claude Code のプロセスが起動した時刻（ミリ秒）。親をたどって claude を探す。分からなければ null。
// ps の lstart は秒までなので、同じ秒に作られた出力を落とさないよう秒の頭に切り下げたまま使う。
function claudeStartMs() {
  try {
    let pid = process.ppid;
    for (let i = 0; i < 8 && pid > 1; i++) {
      const line = execFileSync('ps', ['-o', 'ppid=,lstart=,comm=', '-p', String(pid)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000 }).trim();
      const m = line.match(/^(\d+)\s+(\S+\s+\S+\s+\d+\s+[\d:]+\s+\d{4})\s+(.*)$/);
      if (!m) return null;
      if (/(^|\/)claude$/.test(m[3].trim())) {
        const t = Date.parse(m[2]);
        return Number.isFinite(t) ? t : null;
      }
      pid = Number(m[1]);
    }
  } catch { /* 分からなければ作られた時刻は見ない */ }
  return null;
}

// 台帳のうち閉じていない作業セッションの ID。
export function openWorkerIds(ledger) {
  return Object.entries(ledger?.workers || {})
    .filter(([, w]) => (w || {}).state !== 'closed')
    .map(([k, w]) => w?.id || k);
}

function cmdAnswer(argv) {
  const [sub, ...rest] = argv;
  if (sub === 'hook') return answerHook();
  const ctx = repoCtx();
  if (sub === 'add') {
    const { pos, opt } = parseArgs(rest);
    const question = pos.join(' ').trim();
    if (!question) throw new UsageError('cos answer add "<質問の要約>" [--answer "<答えの要点>"]');
    const id = updateAnswers(ctx, (s) => {
      const id = `A${s.next++}`;
      s.items.push({ id, question, answer: opt.answer ?? null, answeredAt: now(), readAt: null });
      return id;
    });
    console.log(`登録しました: [${id}] ${question}＝読んだと言われるまで報告の「返事を待っているもの」に [${id}] 付きで並べる（Stop フックが確かめる）`);
    return;
  }
  if (sub === 'read') {
    const { pos, opt } = parseArgs(rest, ['all']);
    const ids = opt.all ? pendingAnswers(ctx).map((x) => x.id) : pos;
    if (ids.length === 0) throw new UsageError('cos answer read <ID...> | --all [--note 理由]');
    const done = updateAnswers(ctx, (s) => {
      const hit = [];
      for (const id of ids) {
        const x = s.items.find((y) => y.id === id);
        if (!x) die(`回答 ${id} がありません（cos answer list）`);
        if (!x.readAt) { x.readAt = now(); if (opt.note) x.note = opt.note; hit.push(id); }
      }
      return hit;
    });
    console.log(done.length ? `読んだことにしました: ${done.join(' ')}` : '変わったものはありません');
    return;
  }
  if (sub === 'list' || sub === undefined) {
    const { opt } = parseArgs(rest, ['all', 'json']);
    const items = opt.all ? readAnswers(ctx).items : pendingAnswers(ctx);
    if (opt.json) { console.log(JSON.stringify(items, null, 2)); return; }
    if (items.length === 0) { console.log('読んだか確かめていない回答はありません'); return; }
    for (const x of items) console.log(`[${x.id}] ${x.readAt ? '読んだ' : '未確認'}  ${x.question}${x.answer ? `\n      答え: ${x.answer}` : ''}  （${ago(x.answeredAt)}）`);
    return;
  }
  throw new UsageError('cos answer (add|read|list|hook)');
}

// CoS の Stop フック（`cos answer hook`）。未確認の回答の検査と「進めているもの」の印の検査を両方見て、
// 止めたい理由があれば1つにまとめて1回だけ止める。壊れていても止めない（例外は通す）。
// stop_hook_active（このフックで止めた続きの Stop）なら止めない＝1ターンに1回まで。
function answerHook() {
  try {
    let input = {};
    try { input = JSON.parse(readFileSync(0, 'utf8') || '{}'); } catch { input = {}; }
    if (input.stop_hook_active) return;
    if (!input.transcript_path || !existsSync(input.transcript_path)) return;
    let ctx;
    try { ctx = repoCtx(input.cwd || startDir()); } catch { return; }
    const env = process.env;
    const texts = lastTurnAssistantTexts(readFileSync(input.transcript_path, 'utf8').split('\n'));
    // 片方の材料が読めなくても、もう片方は見る
    let pending = null;
    try { pending = pendingAnswers(ctx); } catch { /* 回答の検査だけ飛ばす */ }
    let isLiveBg = null;
    let workers = null;
    if (progressCheckApplies(env)) {
      try { isLiveBg = liveBgIn(bgTasksDirs(input.transcript_path, input.session_id || 'unknown', env), claudeStartMs()); } catch { /* 印の検査だけ飛ばす */ }
      try { workers = openWorkerIds(readLedger(ctx)); } catch { workers = []; }
    }
    const reason = stopHookDecision({ env, input, texts, pending, isLiveBg, workers });
    if (reason) process.stdout.write(JSON.stringify({ decision: 'block', reason }));
  } catch {
    // 壊れていても CoS を止めない
  }
}

function cmdRoot(argv) {
  const { opt } = parseArgs(argv, ['sub']);
  const ctx = repoCtx();
  console.log(opt.sub ? ctx.sub : ctx.root);
}

function selfTestStall(assert) {
  const T = Date.parse('2026-11-21T10:00:00Z');
  const w = (o) => ({ id: 'A', agent: 'a', lastSeen: { status: 'idle', seq: 3 }, lastSeenAt: '2026-11-21T09:00:00Z', ...o });
  const prog = () => '進行中';
  assert(detectStalled([w()], T, 20 * 60_000, prog).length === 1, '1時間「進行中」のまま idle なら stalled');
  assert(detectStalled([w({ lastSeenAt: '2026-11-21T09:50:00Z' })], T, 20 * 60_000, prog).length === 0, '10分なら出さない');
  assert(detectStalled([w()], T, 20 * 60_000, () => '完了').length === 0, '完了なら出さない');
  assert(detectStalled([w({ lastSeen: { status: 'working', seq: 3 } })], T, 20 * 60_000, prog).length === 0, '作業中なら出さない');
  assert(detectStalled([w({ stallNotified: '3' })], T, 20 * 60_000, prog).length === 0, '同じ止まりは一度だけ');
  assert(detectStalled([w({ stallNotified: '2' })], T, 20 * 60_000, prog).length === 1, '別の止まりはまた出す');
  assert(detectStalled([w({ lastSeenAt: undefined, startedAt: '2026-11-21T08:00:00Z' })], T, 20 * 60_000, prog).length === 1, 'lastSeenAt が無ければ startedAt');
  assert(screenShowsApiError('⏺ API Error: Connection lost mid-response.'), 'API Error を見つける');
  assert(!screenShowsApiError('ラベルをつなぎました'), '普通の画面は API エラーでない');
}

function selfTestAlert(assert) {
  const kind = (ev, on) => alertFor(ev, on)?.kind ?? null;
  const lvl = (ev) => alertFor(ev)?.level ?? null;
  // 鳴らす
  assert(kind({ id: 'A', status: 'blocked' }) === 'blocked' && lvl({ id: 'A', status: 'blocked' }) === 'urgent', 'alert: 承認待ちは urgent');
  assert(kind({ id: 'A', status: 'blocked', startBlocked: true }) === 'start-blocked', 'alert: 起動時の承認待ち');
  assert(kind({ event: 'deploy-failed', id: 'app@1', repo: 'o/r', sha: 'abcdef123', failed: [{ workflow: 'deploy' }] }) === 'deploy-failed', 'alert: デプロイ失敗');
  assert(kind({ id: 'A', status: 'stalled', apiError: true }) === 'stalled', 'alert: API エラーで止まった');
  assert(kind({ id: 'A', status: 'gone', report: '進行中' }) === 'gone', 'alert: 途中でいなくなった');
  assert(kind({ id: 'A', status: 'gone', report: null }) === 'gone', 'alert: 報告書が読めずいなくなった');
  assert(lvl({ id: 'A', status: 'done', report: '質問' }) === 'info' && lvl({ id: 'A', status: 'idle', report: '質問' }) === 'info', 'alert: 質問は info');
  // 鳴らさない
  assert(kind({ id: 'A', status: 'stalled' }) === null, 'alert: API エラーの無い stalled は鳴らさない');
  assert(kind({ id: 'A', status: 'gone', report: '完了' }) === null, 'alert: 完了していなくなったのは鳴らさない');
  assert(kind({ id: 'A', status: 'done', report: '完了' }) === null && kind({ id: 'A', status: 'idle', report: '進行中' }) === null, 'alert: 完了・進行中のターン終わりは鳴らさない');
  assert(kind({ event: 'deploy-done', id: 'x', repo: 'o/r', sha: 'a', runs: [] }) === null, 'alert: deploy-done は鳴らさない');
  assert(kind({ event: 'deploy-missing', id: 'x', repo: 'o/r', sha: 'a' }) === null && kind({ event: 'timeout' }) === null && kind({ event: 'retro-due' }) === null, 'alert: missing・timeout・retro-due は鳴らさない');
  // alertOn で切る
  assert(kind({ id: 'A', status: 'blocked' }, ['deploy-failed']) === null, 'alert: alertOn に無い種類は鳴らさない');
  assert(kind({ id: 'A', status: 'blocked' }, []) === null, 'alert: alertOn が空なら鳴らさない');
  assert(kind({ id: 'A', status: 'blocked' }, ['blocked']) === 'blocked', 'alert: alertOn にあれば鳴らす');
  // 重複の抑え
  const T = Date.parse('2026-11-22T10:00:00Z');
  const W = 10 * 60_000;
  let r = alertThrottle({}, 'X', T, W);
  assert(r.fire && r.next.X === new Date(T).toISOString(), 'alert: 初めては鳴らす');
  r = alertThrottle(r.next, 'X', T + 5 * 60_000, W);
  assert(!r.fire && r.next.X === new Date(T).toISOString(), 'alert: 10 分のうちの同じ件は鳴らさない（時刻も延ばさない）');
  assert(alertThrottle(r.next, 'Y', T + 5 * 60_000, W).fire, 'alert: 別の件は鳴らす');
  r = alertThrottle(r.next, 'X', T + 11 * 60_000, W);
  assert(r.fire, 'alert: 10 分を過ぎたらまた鳴らす');
  assert(!Object.hasOwn(alertThrottle({ Z: new Date(T - 60 * 60_000).toISOString() }, 'X', T, W).next, 'Z'), 'alert: 古い記録は捨てる');
  assert(alertThrottle({ X: 'こわれた' }, 'X', T, W).fire, 'alert: 読めない時刻は鳴らす');
  // 出し方
  const c = alertCommands('urgent', 'T', 'B', 'darwin');
  assert(c[0][0] === 'herdr' && c[0][1].join(' ') === 'notification show T --body B --sound request', 'alert: urgent は request の音');
  assert(alertCommands('info', 'T', 'B', 'linux')[0][1].at(-1) === 'done' && alertCommands('info', 'T', 'B', 'linux').length === 1, 'alert: info は done の音・macOS 以外は予備なし');
  assert(c[1][0] === 'osascript' && c[1][1][1].includes('with title "T"'), 'alert: macOS の予備');
  assert(alertCommands('urgent', 'a"b', 'c\\d', 'darwin')[1][1][1].startsWith('display notification "c\\\\d" with title "a\\"b"'), 'alert: osascript の引用');
}

function selfTest() {
  const assert = (c, m) => {
    if (!c) throw new Error(`self-test 失敗: ${m}`);
  };
  selfTestStall(assert);
  selfTestAlert(assert);
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
  assert(herdrPlace({ where: 'detached', workspace: 'wC', tab: 'wC:t1' }).id === 'wC', 'ブランチなしの依頼もワークスペース');
  assert(hasOwnWorktree({ where: 'detached' }) && hasOwnWorktree({ where: 'worktree' }), 'detached も worktree を片付ける');
  assert(!hasOwnWorktree({ where: 'shared' }) && !hasOwnWorktree({ where: 'tab' }), '前の版の共有の依頼は worktree を消さない');
  assert(setupFor('worktree', {}, 'make') === 'make' && setupFor('worktree', { 'no-setup': true }, 'make') === null, 'worktree は既定で準備を流す');
  assert(setupFor('detached', {}, 'make') === null && setupFor('detached', { setup: true }, 'make') === 'make', 'detached は --setup のときだけ');
  assert(setupFor('worktree', {}, undefined) === null, 'setup が無ければ流さない');

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
  // --known-only の判定（ユーザー全体の設定のフック）
  const ss = { 'cos-1': { via: ['hook:startup'] } };
  assert(knownOnlyDecision({ env: {}, sid: 'cos-1', sessions: ss }) === 'emit', 'known-only 記録あり');
  assert(knownOnlyDecision({ env: {}, sid: 'other', sessions: ss }) === 'unknown', 'known-only 記録に無い');
  assert(knownOnlyDecision({ env: {}, sid: 'toString', sessions: ss }) === 'unknown', 'known-only 継承したキーは無いとみなす');
  assert(knownOnlyDecision({ env: {}, sid: 'cos-1', sessions: undefined }) === 'unknown', 'known-only chief.json の形が違う');
  assert(knownOnlyDecision({ env: {}, sid: undefined, sessions: ss }) === 'no-session', 'known-only session_id 無し');
  assert(knownOnlyDecision({ env: { COS_WORKER_ID: 'x' }, sid: 'cos-1', sessions: ss }) === 'worker', 'known-only 作業セッション');
  assert(knownOnlyDecision({ env: { COS_CHIEF: '1' }, sid: 'cos-1', sessions: ss }) === 'chief', 'known-only cos chief で起動＝二重に出さない');
  assert(knownOnlyDecision({ env: { CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: '60' }, sid: 'cos-1', sessions: ss }) === 'emit', 'known-only 自動要約だけでは cos chief とみなさない');
  // cos check: 報告書の検査
  const ckCfg = { requireInReport: ['決裁書'], forbidInReport: ['[停止]'], reportCommands: ['pnpm ', 'go test', 'make '] };
  const rpt = (state, verify) => `# 報告書 x\n\n状態: ${state}\n<!-- 状態は 着手前／進行中 -->\n\n## 要約\n\n## 検証\n\n${verify}\n\n## コミット\n\n- abc\n`;
  assert(checkReportText(rpt('完了', '- `pnpm typecheck` 通過\n- 決裁書: 全員 OK・`[停止]` なし'), ckCfg).length === 0, 'check 揃っていれば警告なし（「[停止] なし」は残りと数えない）');
  assert(checkReportText(rpt('完了', '- 決裁書: [停止] は0件\n- make lint 通過'), ckCfg).length === 0, 'check 「[停止] は0件」も数えない');
  assert(checkReportText(rpt('完了', '- 決裁書\n  - `[停止]`: なし\n  - 直したもの: `[QA][停止]` テストが無い → abc で足した\n- pnpm test'), ckCfg).length === 0, 'check 「[停止]: なし」「直したもの」は数えない');
  for (const left of ['`[停止]` 1件 未解消', '`[停止]` 修正済みではない', '`[停止]` 解消していない', '`[停止]` まだ直していない', '`[停止]` 1件']) {
    const lw = checkReportText(rpt('完了', `- 決裁書: ${left}\n- pnpm test`), ckCfg);
    assert(lw.length === 1 && /\[停止\]/.test(lw[0]), `check 残っている [停止] を数える: ${left}`);
  }
  let cw = checkReportText(rpt('進行中', '- 決裁書: QA [停止] テストが無い\n- pnpm test'), ckCfg);
  assert(cw.length === 2 && /進行中/.test(cw[0]) && /\[停止\]/.test(cw[1]), `check 状態と [停止]: ${cw.join('|')}`);
  cw = checkReportText(rpt('完了', '- 画面で確かめた'), ckCfg);
  assert(cw.length === 2 && /決裁書/.test(cw[0]) && /コマンド/.test(cw[1]), `check 決裁書とコマンドが無い: ${cw.join('|')}`);
  assert(/空/.test(checkReportText(rpt('完了', '<!-- 書き方 -->'), ckCfg)[0]), 'check 検証が空');
  assert(checkReportText(rpt('完了', ''), ckCfg, { code: false }).length === 0, 'check ブランチの無い依頼は状態だけ');
  assert(checkReportText(null, ckCfg).length === 1, 'check 報告書が読めない');
  // cos check: コミットの Claude-Session
  assert(sessionKey('https://claude.ai/code/session_01AbC') === 'session_01AbC' && sessionKey(' x ') === 'x', 'sessionKey');
  const slog = 'a1\x00one\x00https://claude.ai/code/session_A\n\x1e\nb2\x00two\x00\x1e\nc3\x00three\x00https://claude.ai/code/session_B,https://claude.ai/code/session_A\n\x1e';
  const cs = parseSessionLog(slog);
  assert(cs.length === 3 && cs[0].sessions.join() === 'session_A' && cs[1].sessions.length === 0 && cs[2].sessions.join() === 'session_B,session_A', `parseSessionLog: ${JSON.stringify(cs)}`);
  let sf = sessionFindings(cs, new Set(['session_A']));
  assert(sf.warns.length === 2 && /無い/.test(sf.warns[0]) && /c3 three/.test(sf.warns[1]) && !/a1/.test(sf.warns[1]), `sessionFindings 混ざり: ${sf.warns.join('|')}`);
  sf = sessionFindings([cs[0], cs[2]], new Set());
  assert(sf.warns.length === 1 && /2 種類/.test(sf.warns[0]), 'sessionFindings 特定できず複数');
  sf = sessionFindings([cs[0]], new Set());
  assert(sf.warns.length === 0 && sf.info.length === 1, 'sessionFindings 特定できず1種類');
  assert(sessionFindings([cs[0]], new Set(['session_A'])).warns.length === 0, 'sessionFindings 自分のだけ');
  const tr = '{"content":"- End git commit messages with:\\nCo-Authored-By: X <n@e.com>\\nClaude-Session: https://claude.ai/code/session_Own1\\n- End pull"}\n{"content":"commit abc\\n    Claude-Session: https://claude.ai/code/session_Other"}';
  assert([...ownSessionsInTranscript(tr)].join() === 'session_Own1', 'ownSessionsInTranscript は帰属の指示だけ');
  // デプロイの見張り: run の一覧 → 出来事
  assert(deployId('o/app', 'abcdef0123456789', null) === 'app@abcdef0' && deployId('o/app', 'abcdef0123', 'deploy.yml') === 'app@abcdef0:deploy.yml', 'deployId');
  assert(parseGithubRemote('git@github.com:o/n.git') === 'o/n' && parseGithubRemote('https://github.com/o/n') === 'o/n' && parseGithubRemote('https://github.com/o/n.git/') === 'o/n', 'parseGithubRemote');
  assert(parseGithubRemote('ssh://git@github.com/o/n.git') === 'o/n' && parseGithubRemote('https://gitlab.com/o/n.git') === null, 'parseGithubRemote ssh・GitHub 以外');
  const T0 = Date.parse('2026-11-20T00:00:00Z');
  const de = (o = {}) => ({ createdAt: new Date(T0).toISOString(), lastOkAt: null, settleIds: null, events: null, ...o });
  const run = (id, status, conclusion = '', o = {}) => ({ databaseId: id, name: `wf${id}`, workflowName: `wf${id}`, status, conclusion, url: `https://example.invalid/runs/${id}`, event: 'push', ...o });
  const MISS = 300_000;
  const dd = (runs, entry = de(), nowMs = T0 + 60_000, error = null) => deployDecision({ runs, error, entry, nowMs, missingMs: MISS });
  assert(dd([]).state === 'wait', 'deploy run がまだ無い→待つ');
  assert(dd([], de(), T0 + MISS).state === 'missing', 'deploy run が現れないまま時間切れ→missing');
  assert(dd([run(1, 'completed', 'success', { event: 'schedule' }), run(2, 'in_progress', '', { event: 'issues' })], de(), T0 + MISS).state === 'missing', 'deploy 定期実行・issues の run は数えない');
  assert(dd([run(1, 'completed', 'success'), run(2, 'completed', 'success', { event: 'workflow_run' })], de({ settleIds: '1,2' })).state === 'done', 'deploy 続く workflow_run は数える');
  let dz = dd([run(1, 'completed', 'success'), run(2, 'in_progress')]);
  assert(dz.state === 'wait' && dz.done === 1 && dz.total === 2, 'deploy 終わっていない run があれば待つ');
  assert(dd([run(1, 'queued')], de(), T0 + MISS * 3).state === 'wait', 'deploy run があれば missing にしない');
  dz = dd([run(2, 'completed', 'success'), run(1, 'completed', 'skipped')]);
  assert(dz.state === 'settling' && dz.ids === '1,2', 'deploy 全部終わった初回は確かめ中');
  dz = dd([run(1, 'completed', 'skipped'), run(2, 'completed', 'success')], de({ settleIds: '1,2' }));
  assert(dz.state === 'done' && dz.runs.length === 2 && !dz.failed.length, 'deploy 同じ顔ぶれで2回終わっていれば done（skipped は成功）');
  assert(dd([run(1, 'completed', 'success'), run(2, 'completed', 'success'), run(3, 'completed', 'success')], de({ settleIds: '1,2' })).state === 'settling', 'deploy 続く run が増えたら確かめ直す');
  dz = dd([run(1, 'completed', 'success'), run(2, 'completed', 'failure')], de({ settleIds: '1,2' }));
  assert(dz.state === 'failed' && dz.failed.length === 1 && dz.failed[0].workflow === 'wf2' && /runs\/2$/.test(dz.failed[0].url), 'deploy 失敗した workflow と URL');
  assert(dd([run(1, 'completed', 'cancelled')], de({ settleIds: '1' })).state === 'failed', 'deploy 取り消しも失敗として知らせる');
  assert(dd([run(1, 'completed', 'success'), run(2, 'in_progress', '', { event: 'workflow_run' })], de({ settleIds: '1', events: ['push'] })).state === 'done', 'deploy --event で絞る');
  assert(dd([run(1, 'completed', 'success', { event: 'workflow_dispatch' })], de({ settleIds: '1', events: ['workflow_dispatch'] })).state === 'done', 'deploy --event で足す');
  dz = dd(null, de(), T0 + 60_000, 'HTTP 502');
  assert(dz.state === 'wait' && dz.error === 'HTTP 502', 'deploy gh の失敗は待つ');
  assert(dd(null, de({ lastOkAt: new Date(T0 + 10_000).toISOString() }), T0 + 10_000 + MISS, 'x').state === 'missing', 'deploy gh の失敗が続けば missing');
  // cos.json を cwd から上へ探す（最上位・サブディレクトリ・両方・COS_DIR 優先）
  const has = (...dirs) => (r) => dirs.includes(r);
  assert(findCosSub('', has('')) === '' && findCosSub('a/b', has()) === '', 'findCosSub 無し・最上位は今と同じ');
  assert(findCosSub('a/b', has('')) === '', 'findCosSub 最上位だけ');
  assert(findCosSub('a/b', has('a')) === 'a' && findCosSub('a', has('a')) === 'a', 'findCosSub サブディレクトリ');
  assert(findCosSub('a/b', has('', 'a')) === 'a' && findCosSub('c', has('', 'a')) === '', 'findCosSub 両方＝近い方');
  assert(findCosSub('a/b/c', has('a', 'a/b')) === 'a/b', 'findCosSub 入れ子');
  assert(stateDirFor('/g', '', null) === '/g/cos', 'stateDirFor 最上位');
  assert(stateDirFor('/g', 'a/b', null) === '/g/cos/sub/a%2Fb', 'stateDirFor サブディレクトリは1段');
  assert(stateDirFor('/g', 'a/archive', null) !== join(stateDirFor('/g', 'a', null), 'archive'), 'stateDirFor 入れ子が archive/ とぶつからない');
  assert(stateDirFor('/g', 'a', '/x/y') === '/x/y' && stateDirFor('/g', '', '/x/y') === '/x/y', 'stateDirFor COS_DIR 優先');
  // 一時リポジトリで locate を通しで（git の最上位・サブディレクトリ・worktree の中）
  const tmp = realpathSync(execFileSync('mktemp', ['-d', join(process.env.TMPDIR || '/tmp', 'cos-selftest.XXXXXX')], { encoding: 'utf8' }).trim());
  try {
    const g = (...a) => execFileSync('git', a, { cwd: tmp, stdio: 'ignore' });
    g('init', '-q');
    mkdirSync(join(tmp, 'app', 'src', '.claude'), { recursive: true });
    mkdirSync(join(tmp, 'other'), { recursive: true });
    const common = join(tmp, '.git');
    let l = locate(join(tmp, 'app', 'src'), null);
    assert(l.sub === '' && l.dir === join(common, 'cos') && l.root === tmp, `locate cos.json 無し: ${JSON.stringify(l)}`);
    mkdirSync(join(tmp, '.claude'));
    writeFileSync(join(tmp, '.claude', 'cos.json'), '{}');
    l = locate(join(tmp, 'app', 'src'), null);
    assert(l.sub === '' && l.dir === join(common, 'cos'), 'locate 最上位の cos.json');
    mkdirSync(join(tmp, 'app', '.claude'));
    writeFileSync(join(tmp, 'app', '.claude', 'cos.json'), '{}');
    l = locate(join(tmp, 'app', 'src'), null);
    assert(l.sub === 'app' && l.root === join(tmp, 'app') && l.dir === join(common, 'cos', 'sub', 'app'), `locate 両方＝サブディレクトリ: ${JSON.stringify(l)}`);
    l = locate(join(tmp, 'other'), null);
    assert(l.sub === '' && l.dir === join(common, 'cos'), 'locate 別のサブディレクトリは最上位');
    assert(locate(join(tmp, 'app'), join(tmp, 'x')).dir === join(tmp, 'x'), 'locate COS_DIR 優先');
    // 作業セッションの worktree の中（サブディレクトリに cos.json がコミットされている）でも同じ台帳
    g('add', '-A');
    g('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-qm', 'x');
    g('worktree', 'add', '-q', '--detach', join(tmp, '.claude', 'worktrees', 'w'));
    l = locate(join(tmp, '.claude', 'worktrees', 'w', 'app'), null);
    assert(l.sub === 'app' && realpathSync(l.common) === realpathSync(common) && l.dir === join(l.common, 'cos', 'sub', 'app'), `locate worktree の中: ${JSON.stringify(l)}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  // cos answer の判定
  {
    const P = [{ id: 'A1', question: 'q1' }, { id: 'A2', question: 'q2' }];
    assert(answerHookDecision('ただの張り直し', P) === null, 'answer: 報告でないターンは止めない');
    assert(answerHookDecision('x\n**返事を待っているもの**\n1. [A1] q1\n2. [A2] q2', P) === null, 'answer: 全部あれば通す');
    const r = answerHookDecision('[A2] 本文で触れた\n**返事を待っているもの**\n1. [A1] q1', P);
    assert(r && r.includes('[A2]') && !r.includes('[A1] q1'), 'answer: 一覧に無いものだけ挙げる');
    assert(answerHookDecision('返事を待っているもの', []) === null, 'answer: 未確認0件は止めない');
    const lines = [
      JSON.stringify({ type: 'user', message: { content: '前の質問' } }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: '古い' }] } }),
      JSON.stringify({ type: 'user', message: { content: '新しい質問' } }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'A' }] } }),
      JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', content: 'x' }] } }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'B' }] } }),
    ];
    assert(lastTurnAssistantText(lines) === 'A\nB', 'answer: 最後のターンの文だけ');
  }
  // 「進めているもの」の印の判定
  {
    const live = new Set(['bd20j5n0z', 'bk3m9q2xa']);
    const isLive = (id) => live.has(id);
    const W = ['dep-fix'];
    const D = (t) => progressHookDecision(t, isLive, W);
    const failed = '- **app@2026-01-01.1:** 一覧画面の表示を、これから確かめます。';
    const r = D(`PR をマージしました。\n\n## 進めているもの\n\n${failed}\n- **PR #123:** CI が走っています。\n\n## 返事を待っているもの\n\n**86. 設計**`);
    assert(r && r.includes('一覧画面') && !r.includes('PR #123') && r.includes('返事を待っているものに移す') && r.includes('誤解'), `progress: 印の無い項目だけを引用し、直し方と理由を書く: ${r}`);
    for (const good of [
      '- **端末の見守り:** 5分ごとに確認しています（bd20j5n0z）。',
      '- **Dependabot（dep-fix）:** 作業セッションが直しています。',
      '- **dep-fix**: 作業セッションが直しています。',
      '- **PR #123:** CI が走っています。',
      '- **nightly-job:** ユーザーが流すのを待っています。',
      '- **先方への依頼:** 〇〇さんから先方に頼んでいただいています。',
      '- **確認:** 甲々さんの返事を待っています。',
    ]) assert(D(`## 進めているもの\n\n${good}`) === null, `progress: 印があれば通る: ${good}`);
    for (const bad of [
      '- **端末の見守り:** 確認しています（b0b8dj5bs）。',
      '- **端末の見守り:** 確認しています（bzzzzzzzz）。',
      '- **old-work:** 作業セッションが直しています。',
      '- **dep-fixer:** 作業セッションが直しています。',
      '- **画面:** ユーザーに見せる画面を確かめます。',
      '- **cos-chief.md の PR:** まだ作っていません。',
    ]) assert(D(`## 進めているもの\n\n${bad}`) !== null, `progress: 印にならないものは止める: ${bad}`);
    assert(D('**進めているもの**\n- **PR #123:** CI が走っています。\n  - 子の行: 通ったらマージを聞きます\n- **リリースの確認**\n  - 子の行: 見守りは bd20j5n0z で動いています') === null, 'progress: 太字の見出しでも読み、子の行の印も数える');
    assert(D('## 進めているもの\n\n- **PR #123:** CI が走っています。\n次の段落: これは項目ではありません。\n- 段落のあとの箇条書きは別の一覧') === null, 'progress: 箇条書きでない段落で一覧は終わる');
    assert(D('## 進めているもの（2件）\n\n- **PR #123:** CI が走っています。\n- **一覧:** これから確かめます。') !== null, 'progress: 見出しに件数が付いていても読む');
    assert(D(`## 進めているもの\n\n- **PR #123:** CI が走っています。\n\n## 進めているもの\n\n${failed}`) !== null, 'progress: 見出しが2回あれば2つ目も読む');
    assert(D('PR をマージしました。一覧画面はこれから確かめます。') === null, 'progress: 見出しが無ければ通る');
    assert(D('1. 進めているもの は下のとおり') === null, 'progress: 見出しでない行の「進めているもの」は読まない');
    assert(progressItems('### 進めているもの：\n1. a #1\n2) b').length === 2, 'progress: 番号付きの箇条書きと「：」付きの見出し');
    // 裏のコマンドの出力の読み方（動いている／終わった／止めた／無い）
    const tmp = join(homedir(), '.cache', `cos-selftest-${process.pid}`);
    try {
      mkdirSync(join(tmp, 'tasks'), { recursive: true });
      writeFileSync(join(tmp, 'tasks', 'bd20j5n0z.output'), 'watching...\n');
      writeFileSync(join(tmp, 'tasks', 'b0b8dj5bs.output'), 'done\n[exited with code 0]\n');
      writeFileSync(join(tmp, 'tasks', 'bk1lled00.output'), 'watching...\n[killed]\n');
      const lb = liveBgIn([join(tmp, 'nope'), join(tmp, 'tasks')]);
      assert(lb('bd20j5n0z') && !lb('b0b8dj5bs') && !lb('bk1lled00') && !lb('bzzzzzzzz'), 'progress: 裏のコマンドの生死');
      assert(liveBgIn([join(tmp, 'tasks')], 0)('bd20j5n0z'), 'progress: 今のプロセスの起動より後に作られた出力は動いている');
      assert(!liveBgIn([join(tmp, 'tasks')], Date.now() + 60_000)('bd20j5n0z'), 'progress: 今のプロセスの起動より前に作られた出力は（resume の前に死んだもの）動いていない');
      assert(progressHookDecision('## 進めているもの\n- 見守り（bk1lled00）', lb, []) !== null, 'progress: 止めた裏の ID は印にならない');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
    // 会話ログから、ターンの最後の文だけを読む（途中の文・前のターンの一覧は見ない）
    const lines = [
      JSON.stringify({ type: 'user', message: { content: '前のターン' } }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: '## 進めているもの\n\n- 前のターンの印の無い項目' }] } }),
      JSON.stringify({ type: 'user', message: { content: 'もう3時間くらいやってませんか？' } }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: '途中のテキスト' }, { type: 'tool_use', id: 't1', name: 'Bash', input: {} }] } }),
      JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } }),
      JSON.stringify({ type: 'user', message: { content: '<system-reminder>差し込み</system-reminder>' } }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't2', name: 'Bash', input: {} }] } }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: '最後の報告' }] } }),
    ];
    const ts = lastTurnAssistantTexts(lines);
    assert(ts.length === 2 && ts[1] === '最後の報告', `progress: ターンの最後の文: ${JSON.stringify(ts)}`);
    // 生死は最後の行だけで見る（途中に子の「exited with code」があっても動いている）
    {
      const tmp2 = join(homedir(), '.cache', `cos-selftest-b-${process.pid}`);
      try {
        mkdirSync(join(tmp2, 'tasks'), { recursive: true });
        writeFileSync(join(tmp2, 'tasks', 'bloop0001.output'), 'child [exited with code 1]\n[exited with code 1]\nretrying...\n');
        writeFileSync(join(tmp2, 'tasks', 'bneg00001.output'), 'x\n[exited with code -1]\n');
        const lb2 = liveBgIn([join(tmp2, 'tasks')]);
        assert(lb2('bloop0001') && !lb2('bneg00001'), 'progress: 生死は最後の行だけで見る');
        // 出力の置き場所: <CLAUDE_CODE_TMPDIR>/claude-<uid>/<会話ログの親ディレクトリ名>/<session>/tasks、無ければセッションで探す
        const env = { CLAUDE_CODE_TMPDIR: tmp2 };
        mkdirSync(join(tmp2, 'claude-7', 'proj', 's1', 'tasks'), { recursive: true });
        mkdirSync(join(tmp2, 'claude-7', 'other', 's2', 'tasks'), { recursive: true });
        const d1 = bgTasksDirs('/x/projects/proj/s1.jsonl', 's1', env, 7);
        assert(d1.length === 1 && d1[0] === join(tmp2, 'claude-7', 'proj', 's1', 'tasks'), `progress: tasks の置き場所 ${d1}`);
        const d2 = bgTasksDirs('/x/projects/proj/s2.jsonl', 's2', env, 7);
        assert(d2.length === 1 && d2[0] === join(tmp2, 'claude-7', 'other', 's2', 'tasks'), `progress: プロジェクト名が違ってもセッションで探す ${d2}`);
        assert(bgTasksDirs('/x/p/s9.jsonl', 's9', env, 7).length === 0 && bgTasksDirs('/x/p/s1.jsonl', 's1', env, 8).length === 0, 'progress: 無ければ空');
      } finally {
        rmSync(tmp2, { recursive: true, force: true });
      }
    }
    // 台帳のうち閉じていないものだけ
    const ow = openWorkerIds({ workers: { a: { id: 'a', state: 'running' }, b: { id: 'b', state: 'closed' }, c: { state: 'idle' }, d: null } });
    assert(JSON.stringify(ow) === '["a","c","d"]', `progress: 閉じた作業セッションは外す ${ow}`);
    assert(openWorkerIds(null).length === 0 && openWorkerIds({}).length === 0, 'progress: 台帳が空');
    // Stop フックの配線
    {
      const CHIEF = { COS_CHIEF: '1' };
      const T = ['途中', '## 進めているもの\n- **確認:** これから。'];
      const base = { env: CHIEF, input: {}, texts: T, pending: [], isLiveBg: () => false, workers: [] };
      const S = (o) => stopHookDecision({ ...base, ...o });
      assert(S({})?.includes('印が無い'), 'stop: CoS では印の検査をする');
      assert(S({ env: {} }) === null, 'stop: COS_CHIEF が無ければ印の検査はしない');
      assert(S({ env: { COS_CHIEF: '1', COS_WORKER_ID: 'x' } }) === null, 'stop: 作業セッションでは印の検査はしない');
      assert(S({ input: { stop_hook_active: true } }) === null, 'stop: stop_hook_active なら止めない');
      assert(S({ texts: ['## 進めているもの\n- **確認:** これから。', '最後の報告（一覧なし）'] }) === null, 'stop: 印の検査は最後の文だけ');
      assert(S({ isLiveBg: null }) === null && S({ workers: null }) === null, 'stop: 材料が読めなければ印の検査は飛ばす');
      const P = [{ id: 'A1', question: 'q1' }];
      const both = S({ texts: ['[A1] 本文で触れた', '## 進めているもの\n- **確認:** これから。\n\n## 返事を待っているもの\n- なし'], pending: P });
      assert(both && both.includes('[A1] q1') && both.includes('印が無い') && both.split('1回だけ止めます').length === 2, `stop: 2つの理由は1つにまとめる ${both}`);
      assert(S({ env: {}, pending: P, texts: ['返事を待っているもの\n- なし'] })?.includes('[A1]'), 'stop: 回答の検査は COS_CHIEF に関係なく今までどおり');
      assert(S({ env: {}, pending: null, texts: ['返事を待っているもの'] }) === null, 'stop: 回答が読めなければ回答の検査は飛ばす');
    }
    // 2つの検査の理由は1つにまとめる
    assert(stopHookReason(null, null) === null, 'stop: どちらも無ければ通す');
    assert(stopHookReason('A', null) === 'A' && stopHookReason(null, 'B') === 'B', 'stop: 片方だけ');
    assert(stopHookReason('A', 'B') === 'A\n\nB', 'stop: 両方は1つにまとめる');
  }
  console.log('cos self-test: ok');
}

const HELP = `cos — chief of staff の作業セッション管理（herdr）
  cos spawn <ID> --brief <file> --label <短い名前> [--title T] [--model M] [--kind claude] [--base REF] [--repo <名前|パス>] [--no-worktree] [--no-setup] [--setup] [--force] [-- 引数]
                                            --repo: 作業ツリーを別のリポジトリに作る（台帳はこのリポジトリ・cos.json の repos で名前を付けられる）
  cos rename <ID> <短い名前>                サイドバーの名前を付け直す
  cos send <ID> (<text> | --file <file> | --first) [--seen]   作業中の相手には画面を出して止まる（見たら --seen）
  cos watch [--timeout 秒] [--interval 秒]     出来事か振り返りの期限まで待つ（作業セッション0本でも待つ・CoS は裏で走らせる）
  cos deploy-watch <repo> <sha> [--workflow W] [--label 名前] [--event E,...]
                                            push のあとに打つ（--event の既定は push,workflow_run）。そのコミットの workflow run を cos watch が見て deploy-done / deploy-failed / deploy-missing を出す
                                            repo は owner/name・cos.json の repos の名前・手元のパス。sha は手元のパスならブランチ名・HEAD も可
  cos deploy-watch --cancel <ID>            デプロイの見張りをやめる（ID は cos status に出る）
  cos status [--all] [--json]
  cos report <ID>
  cos read <ID> [--lines N]
  cos check <ID>                            取り込み前の機械検査（報告書の状態と検証の記録・他のセッションのコミット・土台の遅れ）。PR を作る前に打つ
  cos close <ID> [--force] [--keep-branch]  （先に cos check の結果を出す。警告があっても止めない）
  cos retro status                          週1回の振り返りの期限・前回
  cos retro collect [--since ISO] [--until ISO] [--session ID,...] [--out F] [--force]
                                            期間の材料（依頼ごとの数字・CoS の会話のユーザーの発言）を集めて記録の下書きを作る
  cos retro done [--file F]                 振り返りを締めて期限を進める（[未定] の改善案が残っていると断る）
  cos reorient [--hook]                     （フック用）起動時・要約や /clear のあとに文脈を戻す
  cos reorient --hook --known-only          （ユーザー全体の設定のフック用）記録済みの CoS を cos chief 無しで再開したときだけ戻す
  cos chief [claude への引数]                CoS のセッションをいまのペインで起動する（60% で自動要約）
  cos answer add "<質問の要約>" [--answer "<答えの要点>"]   ユーザーの質問に答えたら登録（読んだと言われるまで報告に並べる）
  cos answer read <ID...> | --all [--note 理由]   ユーザーが読んだ
  cos answer list [--all] [--json]
  cos answer hook                           （CoS の Stop フック用）報告に未確認の回答が載っていない・「進めているもの」に印の無い項目があれば1回止める
  cos alert "<件>" "<一言>" [--level urgent|info] [--window 分]
                                            ユーザーの手が要る急ぎの件を音と通知で知らせる（同じ件は既定 10 分に1回・失敗しても終了コード 0）
  cos root [--sub]                          この場所の CoS のディレクトリ（cos.json を上へ探す）。--sub は最上位からの相対
  cos self-test`;

const isMain = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const [cmd, ...rest] = process.argv.slice(2);
  const table = {
    spawn: cmdSpawn, send: cmdSend, watch: cmdWatch, 'deploy-watch': cmdDeployWatch, status: cmdStatus, ls: cmdStatus,
    report: cmdReport, read: cmdRead, check: cmdCheck, close: cmdClose, rename: cmdRename, reorient: cmdReorient, retro: cmdRetro, root: cmdRoot, answer: cmdAnswer,
    'self-test': selfTest, alert: cmdAlert,
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
