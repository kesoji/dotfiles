#!/usr/bin/env node
// Stop フック: このターンの返答が英語になっていたら、日本語で書き直させる。
//
// 日本語で話しているセッション（ユーザーの発言に、かな・漢字が一度でも出てくる）だけを見る。
// コードブロック・インラインコード・引用・URL・パスは数えない。英語の固有名詞やログを貼っただけの返答で止めないため。
// 1回書き直させた後（stop_hook_active）は通す。無限に繰り返さないため。
// 失敗したら何もせず通す（フックの不具合で会話を止めない）。
//
// 文章（memory・CLAUDE.md）だけでは止まらなかった（19回）ので機械にした。

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// 英単語がこれより少ない返答は見ない（「Done.」のような短い返答や、識別子の多い短文で止めすぎないため）
export const MIN_LATIN_WORDS = 25;
// かな・漢字の文字数が英単語数のこの倍率に満たなければ英語とみなす
// 日本語の技術文は識別子1つにつき日本語が数文字〜十数文字つく。英文は 0 に近い。
export const MIN_JA_PER_WORD = 1.0;

export const REASON =
  "返答が英語になっています。ユーザーへの返答・報告は日本語で書き直してください。コマンド・コード・ログの引用は英語のままでかまいません。";

const JA_CHAR = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}ー]/gu;
const LATIN_WORD = /[A-Za-z][A-Za-z'’-]*/g;

/** 数えない部分（コード・引用・URL・パス）を取り除く */
export function stripNonProse(text) {
  return (
    text
      // フェンスで囲んだコードブロック（閉じていないものは末尾まで）
      .replace(/(^|\n)\s*(```|~~~)[\s\S]*?(\n\s*\2|$)/g, "\n")
      // インラインコード
      .replace(/`[^`\n]*`/g, " ")
      // 引用（ログや英語の出力を貼るとき）
      .replace(/^\s*>.*$/gm, " ")
      // インデントしたコード（4スペース・タブ）
      .replace(/^(?: {4}|\t).*$/gm, " ")
      // URL
      .replace(/\bhttps?:\/\/\S+/g, " ")
      // パス・ファイル名（/ を含む語、拡張子つきの語）
      .replace(/\S*\/\S*/g, " ")
      .replace(/\b[\w.-]+\.(?:[a-z]{1,5})\b/gi, " ")
  );
}

export function countJa(text) {
  return (text.match(JA_CHAR) ?? []).length;
}

export function countLatinWords(text) {
  return (text.match(LATIN_WORD) ?? []).length;
}

/** 本文が英語か。短い・コードだけ・日本語が主なら false */
export function isEnglishProse(text) {
  const prose = stripNonProse(text);
  const words = countLatinWords(prose);
  if (words < MIN_LATIN_WORDS) return false;
  return countJa(prose) < words * MIN_JA_PER_WORD;
}

function textOf(content) {
  if (typeof content === "string") return [content];
  if (!Array.isArray(content)) return [];
  return content.filter((b) => b?.type === "text" && typeof b.text === "string").map((b) => b.text);
}

/** 人（またはその代わりの入力）が書いた発言か。tool_result だけの user 行は除く */
function isPrompt(entry) {
  if (entry?.type !== "user" || entry.isMeta) return false;
  return textOf(entry.message?.content).length > 0;
}

/**
 * transcript の行（JSON をパースしたもの）から、判定に使うものを取り出す。
 * - japaneseSession: ユーザーの発言に日本語が一度でも出てくるか
 * - turnTexts: 最後のユーザーの発言より後の assistant の text ブロック
 */
export function extractFromTranscript(entries) {
  let japaneseSession = false;
  let lastPrompt = -1;
  entries.forEach((e, i) => {
    if (!isPrompt(e)) return;
    lastPrompt = i;
    if (textOf(e.message.content).some((t) => countJa(t) > 0)) japaneseSession = true;
  });
  const turnTexts = entries
    .slice(lastPrompt + 1)
    .filter((e) => e?.type === "assistant")
    .flatMap((e) => textOf(e.message?.content));
  return { japaneseSession, turnTexts };
}

function readTranscript(path) {
  const entries = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      // 書きかけの行は飛ばす
    }
  }
  return entries;
}

/** フックの入力から判定する。止めるなら reason の文字列、通すなら null */
export function decide(input, entries) {
  if (input?.stop_hook_active) return null;
  const { japaneseSession, turnTexts } = extractFromTranscript(entries);
  if (!japaneseSession) return null;
  // transcript への書き込みが遅れて最後の返答が入っていないことがあるので、入力の値も見る
  const texts = [...turnTexts];
  if (typeof input?.last_assistant_message === "string") texts.push(input.last_assistant_message);
  return texts.some(isEnglishProse) ? REASON : null;
}

function main() {
  try {
    const input = JSON.parse(readFileSync(0, "utf8") || "{}");
    const entries = input.transcript_path ? readTranscript(input.transcript_path) : [];
    const reason = decide(input, entries);
    if (reason) process.stdout.write(JSON.stringify({ decision: "block", reason }));
  } catch {
    // 通す
  }
  process.exit(0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
