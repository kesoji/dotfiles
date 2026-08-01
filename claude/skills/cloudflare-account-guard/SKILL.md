---
name: cloudflare-account-guard
description: >-
  Cloudflare の外向き CLI 操作（wrangler deploy / secret put / delete / d1 --remote /
  kv・r2 の書き込み / cf の write 系）を行う前に、認証中のアカウントがそのリポジトリの
  想定アカウントと一致するか必ず検証する個人標準。複数の Cloudflare アカウントを
  1台のマシンで扱うため、誤アカウントへの deploy・draft Worker 作成事故が起こりやすい。
  「wrangler deploy」「secret put」「Cloudflare にデプロイ」「本番反映」
  「d1 リモート操作」等の前に必ず発火。
---

# Cloudflare アカウント誤り防止ガード

## 背景

ユーザーは複数の Cloudflare アカウントを1台のマシンで使い分けている。wrangler の
OAuth ログインは1つの既定アカウントに固定されがちで、**リポジトリの本番が別アカウント**
のことがある。実際に `wrangler secret put` の「Worker が無いので draft を作るか?」に
Y と答えて、ログイン中の**別アカウント側に draft Worker が作られ secret が入った**事故が起きた
（本番は Workers Builds の push 連動でデプロイされるため、ローカル wrangler が本番アカウントに
入っていないことに気付けなかった）。

## ルール（外向き Cloudflare 操作の前に必ず）

1. **アカウント検証を先に実行**:
   ```bash
   pnpm exec wrangler whoami   # または cf auth whoami
   ```
   表示された Account ID が、そのリポジトリの**想定アカウント**と一致するか確認する。
   一致しない・不明なら**外向き操作を実行しない**でユーザーに報告する。

2. **想定アカウントの正本は wrangler.jsonc の `account_id`**。
   無ければ**先に追記する**（wrangler は `account_id` があると他アカウントへは即エラーになる
   ＝機械的な柵になる）。アカウント ID はダッシュボード（Workers & Pages 概要の右カラム、
   またはゾーン概要）で確認してもらう。どのリポジトリがどのアカウントかは、
   そのプロジェクトの memory / wrangler.jsonc を正とし、このスキルには書かない。

3. **`wrangler secret put` の draft Worker 作成プロンプトに安易に Y しない**。
   「Worker が無い」と言われた時点で、(a) 未デプロイなのか (b) **アカウント違い**なのかを
   whoami で切り分ける。正しい順序は deploy → secret put。

4. **リポジトリの本番が Workers Builds（push 連動）の場合、ローカル wrangler からの
   deploy/secret は原則不要**。CLI でやりたくなったら、そもそも push でやるべきでないか
   先に考える。どうしても CLI が要るときは対象アカウントの `CLOUDFLARE_API_TOKEN` を
   その場の env で渡す（`wrangler login` の切替はマシンの既定認証を壊すので避ける）。
