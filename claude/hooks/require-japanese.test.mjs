// node --test ~/dotfiles/claude/hooks/require-japanese.test.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { decide, isEnglishProse, REASON } from "./require-japanese.mjs";

const user = (content) => ({ type: "user", message: { role: "user", content } });
const toolResult = () => user([{ type: "tool_result", tool_use_id: "x", content: "ok" }]);
const assistant = (text) => ({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text }] } });
const toolUse = () => ({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: "x", name: "Bash", input: {} }] } });

const ENGLISH_REPORT = `Done. I updated the hook so that it reads the transcript and checks the final reply.
The tests pass locally and I committed the change to the branch. The remaining work is to
wire the setting into the global configuration and confirm that it does not block replies
that only contain code or log output. Let me know if you want me to continue with the review gate.`;

const JAPANESE_REPORT = `Stop フックを入れました。transcript の最後の返答を読み、英語なら書き直させます。
テストは node --test で12件とも通りました。GitHub Actions の CI・Claude Code の settings.json・PR #1999 のような
固有名詞が多い文でも止まらないことを確かめています。残りは review-gate を通してコミットすることです。`;

// 英語の固有名詞と識別子が多いが、日本語の報告
const JAPANESE_WITH_MANY_NAMES = `GitHub Actions の CI が落ちた原因は pnpm の allowBuilds です。Prisma Client と
Vitest、Playwright、Biome、TypeScript の型検査は通っています。AWS の ECS Fargate ARM64 の remix タスクと
go-api タスクは CloudWatch Logs と Sentry で見ても ERROR は出ていません。ALB の 5xx も Athena で 0 件でした。`;

test("英語の報告は英語と判定する", () => {
  assert.equal(isEnglishProse(ENGLISH_REPORT), true);
});

test("日本語の報告は通す", () => {
  assert.equal(isEnglishProse(JAPANESE_REPORT), false);
});

test("固有名詞の多い日本語は通す", () => {
  assert.equal(isEnglishProse(JAPANESE_WITH_MANY_NAMES), false);
});

test("短い英語（Done. など）は通す", () => {
  assert.equal(isEnglishProse("Done. Committed abc1234 on cos/mg-rules."), false);
});

test("コードブロックだけの返答は通す", () => {
  const text = "```ts\n" + "export function foo(bar: string): string { return bar.trim().toLowerCase(); }\n".repeat(10) + "```";
  assert.equal(isEnglishProse(text), false);
});

test("日本語の説明＋英語のログを貼った返答は通す", () => {
  const log = "Error: connect ECONNREFUSED 127.0.0.1:3306 at TCPConnectWrap.afterConnect as oncomplete\n".repeat(8);
  const fenced = `ローカルの MySQL につながっていません。ログは次のとおりです。\n\n\`\`\`\n${log}\`\`\`\n`;
  const quoted = `ログを引用します。\n${log.split("\n").map((l) => `> ${l}`).join("\n")}`;
  assert.equal(isEnglishProse(fenced), false);
  assert.equal(isEnglishProse(quoted), false);
});

test("英語の文の間にインラインコードやパスがあっても英語と判定する", () => {
  const text = `${ENGLISH_REPORT}\nSee \`require-japanese.mjs\` and /Users/someone/dotfiles/claude/settings.json for details.`;
  assert.equal(isEnglishProse(text), true);
});

test("日本語のセッションで最後の返答が英語なら止める", () => {
  const entries = [user("Stop フックを作って"), toolUse(), toolResult(), assistant(ENGLISH_REPORT)];
  assert.equal(decide({}, entries), REASON);
});

test("ターンの途中の英語の経過報告も止める", () => {
  const entries = [user("進めて"), assistant(ENGLISH_REPORT), toolUse(), toolResult(), assistant("終わりました。")];
  assert.equal(decide({}, entries), REASON);
});

test("前のターンの英語は見ない", () => {
  const entries = [user("進めて"), assistant(ENGLISH_REPORT), user("日本語で"), assistant(JAPANESE_REPORT)];
  assert.equal(decide({}, entries), null);
});

test("英語で話しているセッションは止めない", () => {
  const entries = [user("Please write the hook."), assistant(ENGLISH_REPORT)];
  assert.equal(decide({}, entries), null);
});

test("日本語のセッションに英語の通知が差し込まれても止める", () => {
  const entries = [
    user("見張って"),
    assistant("見張りを始めました。"),
    user("<task-notification>Background command completed with exit code 0</task-notification>"),
    assistant(ENGLISH_REPORT),
  ];
  assert.equal(decide({}, entries), REASON);
});

test("stop_hook_active のときは通す（2回目は止めない）", () => {
  const entries = [user("作って"), assistant(ENGLISH_REPORT)];
  assert.equal(decide({ stop_hook_active: true }, entries), null);
});

test("transcript に最後の返答がまだ無くても last_assistant_message で止める", () => {
  const entries = [user("作って"), toolUse(), toolResult()];
  assert.equal(decide({ last_assistant_message: ENGLISH_REPORT }, entries), REASON);
});

test("isMeta の user 行は発言として数えない", () => {
  const entries = [user("作って"), assistant(ENGLISH_REPORT), { ...user("Caveat: meta"), isMeta: true }];
  assert.equal(decide({}, entries), REASON);
});

// 要約（compact）の後の形。実際の transcript から形だけ写した（中身は架空）。
// 要約の前の行は同じファイルに残り、要約本文は isCompactSummary の user 行として入る。
const compactBoundary = () => ({ type: "system", subtype: "compact_boundary", content: "Conversation compacted", isMeta: false });
const compactSummary = (text) => ({ ...user(text), isCompactSummary: true, isVisibleInTranscriptOnly: true });
const SUMMARY_EN = "This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.";

test("要約の直後に英語で報告したら止める（前の日本語の発言が同じファイルに残る）", () => {
  const entries = [user("フックを作って"), assistant("作ります。"), compactBoundary(), compactSummary(SUMMARY_EN), toolUse(), toolResult(), assistant(ENGLISH_REPORT)];
  assert.equal(decide({}, entries), REASON);
});

test("要約の本文しか無いファイルでも、要約に引かれた日本語の発言で日本語のセッションとみなす", () => {
  const summary = `${SUMMARY_EN}\n\nUser messages:\n- 「フックを作って」\n- 「全部すすめましょう」`;
  const entries = [compactBoundary(), compactSummary(summary), assistant(ENGLISH_REPORT)];
  assert.equal(decide({}, entries), REASON);
});

test("要約の前のターンの英語は見ない", () => {
  const entries = [user("進めて"), assistant(ENGLISH_REPORT), compactBoundary(), compactSummary(SUMMARY_EN), assistant(JAPANESE_REPORT)];
  assert.equal(decide({}, entries), null);
});

// 境目: 日本語の地の文に英語の行を囲まずに並べたとき。英語の行が主なら止める（1回だけ。REASON でコードブロックか引用に入れるよう伝える）
const SUBJECTS = [
  "fix: handle the error when the upload is cancelled by the client",
  "feat: add a filter for students who left the group last month",
  "chore: bump the version of the test runner used in the pipeline",
  "refactor: move the session helpers into a shared module for reuse",
  "test: cover the case where the reminder is sent after the deadline",
];

test("日本語の説明に英語のコミット件名を2行だけ並べた返答は通す", () => {
  const text = `今日マージした PR のうち、本番に関係するのは次の2つです。どちらも検証環境で動作を確かめました。\n${SUBJECTS.slice(0, 2).map((l) => `- ${l}`).join("\n")}\n残りは文書の変更だけなので、リリースの対象から外しています。明日の朝に出します。`;
  assert.equal(isEnglishProse(text), false);
});

test("英語の行を囲まずに5行並べた返答は止める（囲めば通る）", () => {
  const head = "今日のコミットです。";
  const bare = `${head}\n${SUBJECTS.map((l) => `- ${l}`).join("\n")}`;
  const fenced = `${head}\n\`\`\`\n${SUBJECTS.join("\n")}\n\`\`\`\n`;
  assert.equal(isEnglishProse(bare), true);
  assert.equal(isEnglishProse(fenced), false);
});

test("頼まれた英文の下書きは、引用かコードブロックに入れれば通す", () => {
  const draft = ENGLISH_REPORT.split("\n").map((l) => `> ${l}`).join("\n");
  assert.equal(isEnglishProse(`英文の下書きです。\n\n${draft}\n\n直したいところがあれば言ってください。`), false);
  assert.equal(isEnglishProse(`英文の下書きです。\n\n${ENGLISH_REPORT}`), true);
});

// 実際に node で起動して、標準入出力の形を確かめる
const script = fileURLToPath(new URL("./require-japanese.mjs", import.meta.url));
function runHook(input, entries) {
  const dir = mkdtempSync(join(tmpdir(), "require-japanese-"));
  const transcript = join(dir, "t.jsonl");
  writeFileSync(transcript, `${entries.map((e) => JSON.stringify(e)).join("\n")}\n{"broken`);
  return spawnSync("node", [script], { input: JSON.stringify({ ...input, transcript_path: transcript }), encoding: "utf8" });
}

test("起動: 英語なら decision: block を返して exit 0", () => {
  const r = runHook({ hook_event_name: "Stop", stop_hook_active: false }, [user("作って"), assistant(ENGLISH_REPORT)]);
  assert.equal(r.status, 0);
  assert.deepEqual(JSON.parse(r.stdout), { decision: "block", reason: REASON });
});

test("起動: 日本語なら何も出さずに exit 0", () => {
  const r = runHook({ hook_event_name: "Stop" }, [user("作って"), assistant(JAPANESE_REPORT)]);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, "");
});

test("起動: 入力が壊れていても通す", () => {
  const r = spawnSync("node", [script], { input: "not json", encoding: "utf8" });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, "");
});
