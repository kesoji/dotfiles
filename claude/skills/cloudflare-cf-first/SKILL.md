---
description: Cloudflare の操作（accounts/zones/DNS/registrar/Workers/KV/R2/Pages/Builds など）を CLI から行うときは、wrangler より先に公式の `cf` CLI を検討する。Cloudflare API、Workers、DNSレコード操作、ゾーン管理、ビルドログ取得など Cloudflare 関連タスク全般で発火。
allowed-tools: Bash(cf *), Bash(npx cf *), Bash(npx -y cf *), Bash(wrangler *), Bash(npx wrangler *), Bash(curl *)
---

# Cloudflare: prefer `cf` over `wrangler`

Cloudflare 公式の新 CLI `cf` は 2026/04/13 (Agents Week) で発表された wrangler 後継。
**エージェントが叩く前提で設計**されており、JSON 出力・スキーマ introspection・`CLOUDFLARE_API_TOKEN` 優先などが標準化されている。
ユーザーは今後 cf を主力にしたいので、**cf でできることは cf で実装**し、未対応領域だけ wrangler / 直接 API を使う。

## 判断フロー

1. まず `cf <product> --help` または `cf schema --list` で対応有無を確認する
2. 対応していれば cf を使う
3. 未対応 → wrangler または `curl` で REST API を直接叩く

**思い込みで「cf にまだ無いはず」と決めない**。technical preview なので機能は急速に増える。1日に1回程度は `cf --help` で確認する価値がある。

## 現時点 (2026-05-05) で cf がカバーする領域

`cf --help` トップレベル:

```
accounts       アカウント・メンバー・ロール・サブスク・APIトークン
agent-context  エージェント向けスキル/コンテキスト出力
auth           login / logout / whoami
completions    シェル補完
context        デフォルト account / zone のセット
dns            DNS レコード CRUD・DNSSEC・analytics・ゾーン転送
registrar      ドメイン登録・移管
schema         API スキーマ照会
zones          ゾーン一覧・作成・設定
```

→ **Workers / Workers Builds / KV / R2 / Pages / D1 / Queues / Email / Turnstile などはまだ未対応**。これらは wrangler か API token + curl で。

## 認証

優先順位:

1. `CLOUDFLARE_API_TOKEN` 環境変数 ← **これが最優先・推奨**
2. `cf auth login` (OAuth)

```bash
cf auth whoami      # 動作確認
```

`CLOUDFLARE_API_TOKEN` がセットされていれば cf も wrangler もそれを使うので、
**API Token 方式で統一しておくと cf / wrangler / curl すべてで使い回せる**。

wrangler の OAuth トークン (`~/.config/.wrangler/config/default.toml`) は scope が固定で
Workers Builds API などにアクセスできないので、用途が広いタスクではトークン方式に切り替える。
