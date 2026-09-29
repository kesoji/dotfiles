---
description: Cloudflare の操作（Workers/D1/KV/R2/Queues/DNS/zones/Zero Trust/Builds など）を CLI から行うときは、wrangler より先に公式の `cf` CLI を使う。Cloudflare API、Workers のデプロイ、DNSレコード操作、ゾーン管理、D1 クエリ、ビルドログ取得など Cloudflare 関連タスク全般で発火。
allowed-tools: Bash(cf *), Bash(npx cf *), Bash(npx -y cf *), Bash(wrangler *), Bash(npx wrangler *), Bash(curl *)
---

# Cloudflare: `cf` を既定、wrangler は例外

v3（2026-09-29）。`cf` は 2026/04/13 発表の wrangler 後継で、**2026-09 に 1.0 ベータ系列**に入った。
**エージェントが叩く前提**の設計（JSON 出力・スキーマ introspection・`CLOUDFLARE_API_TOKEN` 優先）。
**原則 cf で実装**し、cf で無理なところだけ wrangler / 直接 API に落とす。

## 番頭（m1pro）の導入状態

- `cf` はグローバル導入済み＝`~/.local/bin/cf`、**v1.0.0-beta.5**（2026-09-29 時点）。
- **`npm i -g cf` だと 0.15.0 が入る**。1.x は prerelease 扱いなので、
  入れる／上げるときは **バージョン明示**（例 `npm i -g cf@1.0.0-beta.5`）。
- 依存の `workerd` の postinstall は allowScripts 方針で走っていない。
  **`cf dev` / `--local`（ローカル実行）は未検証**。必要になったら
  `npm i -g --allow-scripts=workerd cf@<ver>` を本人に確認してから。
- **publish からの経過時間で弾く柵（サプライチェーン対策）の状態に注意**（2026-09-29 実測）:
  - **npm のキーは `min-release-age`（単位＝日）。npm 11.19.0 が正式に持つ**
    （`npm config ls -l` に `min-release-age` と `min-release-age-exclude` が出る）。
  - **pnpm のキーは `minimum-release-age`（単位＝分）**。別物なので混同しない。
    pnpm 側は `~/.config/pnpm/rc` に `minimum-release-age=2880`（＝2日）で有効。
  - pnpm 用の設定を分離したときに **npmrc の `min-release-age` が一緒に消され、npm 側だけ
    柵が外れていた**（2026-09-29 に発見し、同日 `min-release-age=2` を戻した）。
  - **柵の有無は `npm view` では確かめられない**（view は柵を通らず、publish 直後の版も表示する）。
    `npm config get min-release-age` か、`npm i --dry-run <pkg>@<新しい版>` が
    `notarget ... with a date before <2日前>` で落ちるかで見る。
- 柵が有効なときに新しいバージョンを入れるなら **その場だけ `--min-release-age=0`**:
  `npm i -g cf@<ver> --min-release-age=0`（tarball 直指定でも通る）。
  `npm config set min-release-age 0` は**柵ごと外すのでやらない**。
  **`npm i --min-release-age=0` は依存全部の柵を外す**ので、他の依存が想定外に最新化されないよう、
  同時に触る依存はバージョンを完全固定にしておく（実測: home-power で wrangler が
  `^4.141.0` → 4.143.0 まで上がってしまい、`4.141.0` 固定に直した）。

## 判断フロー

1. `cf <product> --help` または `cf schema <command>` で対応を確認する
2. 対応していれば cf を使う
3. 未対応 → wrangler または `curl` で REST API

**思い込みで「cf にまだ無いはず」と決めない**。ベータなので機能が速く増える。

**コマンド探索は `--help` を掘らず `cf cli search "<やりたいこと>"`**（beta.5 が明示的に案内する。
5件の JSON が返る）。**検索語に名前・メールアドレス・ドメイン・アカウントやリソースの ID・
トークンを入れない**（cf 自身の指示）。API の詳細は先頭の `cf` を `cf schema` に置き換える。

## 対応領域（2026-09-29 / v1.0.0-beta.5 で実測）

トップレベルが約70コマンドあり、**主要プロダクトはほぼ揃った**。

| 種別 | コマンド |
|---|---|
| プロジェクト | `build` `deploy` `dev` `migrate` `previews` `builds` |
| Workers | `workers`（list/get/delete/secrets/versions/deployments/triggers/types/check/placement）`durable-objects` `workflows` `workers-for-platforms` `containers` |
| データ | `d1` `kv`（bulk/keys/metadata/namespaces）`r2` `queues` `hyperdrive` `pipelines` `secrets-store` |
| ネットワーク | `dns` `zones` `registrar` `cache` `rulesets` `firewall` `load-balancers` `waiting-rooms` `snippets` `cloud-connector` |
| AI | `ai` `ai-gateway` `ai-search` `agent-memory` `browser-run` |
| メディア | `images` `stream` `realtime` |
| メール | `email-routing` `email-sending` |
| 運用・セキュリティ | `accounts` `billing` `observability` `logs` `logpush` `analytics` `speed` `zero-trust` `security-center` `intel` `mcp` |

旧版のこのスキルには「Workers / KV / R2 / Pages / D1 / Queues は未対応」と書いてあったが、**もう誤り**。

### 重要：cf は wrangler を置き換えず、条件つきで wrangler に「委譲」する

- **プロジェクトに `@cloudflare/vite-plugin` があれば cf 自身がビルドする。無ければ
  wrangler に委譲する**（`Delegating to Wrangler` と出る）。つまり **Vite を使わない
  素の Worker は wrangler 依存が残る**。
- 委譲先の wrangler には**バージョン要求がある**。cf 1.0.0-beta.x は **wrangler ≥ 4.136.0**。
  古いと `not compatible with cf's local runtime` で Build 段階で止まる
  （実測: home-power は 4.131.1 固定だったので 4.141.0 に上げて解決）。
- **cf は `wrangler.jsonc` を読まない。`cloudflare.config.ts` が必須**
  （`cloudflare.config.ts is required when --experimental-new-config is enabled`）。
  つまり cf で build / deploy するなら移行は必須で、選べるのは時期だけ。
- 一方 **API を叩くだけの読み書き（`cf workers list` `cf d1 query` `cf dns` `cf r2` など）は
  wrangler もプロジェクトも不要**。トークンだけで動く。**日常の調査・確認はここが本命**。
- **`cf` にライブ tail は無い**（`cf logs` は保存ログ・retention・ray ID 用）。
  ログを流して見るのは **`wrangler tail` を維持**する。
- cf は **cwd に `.cloudflare/`** を作る（`cache/cloudflare-account.json` にアカウント id・name、
  `types/index.d.ts` に生成した型）。リポジトリでは `.gitignore` に `.cloudflare/` を入れる。

## `cloudflare.config.ts` への移行

`cf migrate` で `wrangler.jsonc` → `cloudflare.config.ts`（`cf/config` の `defineConfig` /
`bindings.*` / `triggers.*`）に変換できる。`package.json` への `cf` 追加と `.gitignore` の
`.cloudflare` 追記も自動。型は `cf workers types` が **設定ファイルから逆算**して
`.cloudflare/types/index.d.ts` に出す（`tsconfig.json` の `include` を差し替え、
旧 `worker-configuration.d.ts` は削除）。

- **`cf migrate` は beta.1 には無い。beta.2 以降。**
- **git worktree が clean でないと動かない**（`--force` で無視できるが、codemod の差分が
  自分の変更に混ざるので使わない）。まだコミットしたくないときは、一時的な無視を
  `.git/info/exclude` に書けば worktree を汚さずに clean にできる。
- プレビュー環境は `defineConfig((ctx) => ...)` ＋ `ctx.isPreview` の分岐に変換される。
- migrate は `wrangler.config.ts`（`defineWranglerConfig`・`types.generate: false`）も置く。
  **wrangler 側の設定はこれになるので `wrangler.jsonc` は消していい**。
- ただし **消す前に CI / E2E / 検証スクリプトの参照を確認する**（参照があるなら並行維持し、
  スクリプト側を直すのが先）。README や コード中のコメントの参照も grep する。
- **移行で消える情報がある。** `wrangler.jsonc` のコメント（なぜこの設定なのか）は
  引き継がれないので、**手で `cloudflare.config.ts` に書き写す**。
- `tsconfig.json` は `types` を `./.cloudflare/types/index.d.ts` に差し替え、
  `include` に `cloudflare.config.ts` を入れる（**設定ファイル自体を型検査に載せないと
  移行の旨みが半分無い**）。旧 `worker-configuration.d.ts` は削除。

### 設定の対応表（home-power の移行で実測・2026-09-29）

| 旧 `wrangler.jsonc` | 新 `cloudflare.config.ts` |
|---|---|
| `account_id` | `accountId`（`worker` の外側） |
| `main` | `worker.entrypoint` |
| `compatibility_date` | `worker.compatibilityDate` |
| `workers_dev` / `preview_urls` | `workersDev` / `previewUrls` |
| `triggers.crons: [...]` | `triggers: [triggers.scheduled({ schedule })]` を1件ずつ |
| `routes: [{ pattern, custom_domain: true }]` | `domains: ["example.com"]` |
| `vars` | `env` に `bindings.text(...)` |
| `d1_databases` | `env` に `bindings.d1({ name, id })` |
| `d1_databases[].migrations_dir` | **設定から消え CLI フラグへ**（`cf d1 migrations apply <id> --dir ./migrations`、既定は `./migrations`） |
| （secret は設定に書かない運用だった） | `bindings.secret()` を明示＝**デプロイ時に存在を検証される** |

### 移行の罠（2026-09 時点のベータ）

| 罠 | 中身 |
|---|---|
| `bindings.secret()` | 書いた分は**デプロイ時に「必須シークレット」として検証される**。本番に無いキーを書くと `The following required secrets have not been set` で止まる。本番で実在するものだけ書く |
| `cf deploy --var` | **無い**。非シークレットの動的注入は `--secrets-file`（加算継承）か、設定側で `process.env` を読んで `bindings.text()` に渡す |
| Vite 連携 | `@cloudflare/vite-plugin` は既定で `wrangler.json(c)` を探すので、`cloudflare.config.ts` を読ませるには `experimental: { newConfig: true }` が必要（無いと dev が 404） |
| BOS の出力先 | `cf deploy` は `CLOUDFLARE_VITE_FORCE_BUILD_OUTPUT=true` を付け、クライアント出力を `.cloudflare/output/v0/workers/default/assets` に変える。React Router 等は `build/client/.vite/manifest.json` を探すので ENOENT。writeBundle でコピーする同期プラグインが要る |
| Windows | Vite なしの Worker で wrangler へ委譲するとき `spawn EFTYPE` で死ぬ（`.js` を直接 spawn するため）。Windows ローカルからは wrangler を使う。**Linux の CI / WSL2 では問題ない**（WINKESO の runner は WSL2 なので該当しない） |
| D1 の指定 | **`cf d1 *` はデータベース ID のみ。名前も binding 名も受け付けない**（`Expected a D1 database ID`）。`wrangler d1 ... <name>` からの移行時はスクリプトを書き換える |
| Worker の指定 | `cf workers secrets list` 等は **ID の位置引数ではなく `--worker <name>`**（ID を位置引数に渡すと `Unknown command`） |
| Docker | `cf deploy` は Containers の確認で docker ソケットを見に行き、無いと警告を出す。**Build は成功するので無害** |

参考: [Cloudflare の新CLI `cf` への移行（zenn / sora_kumo）](https://zenn.dev/sora_kumo/articles/cloudflare-to-cf)

## 認証

優先順位:

1. `CLOUDFLARE_API_TOKEN` 環境変数（**設定されていれば常にこれが勝つ**。実測済み）
2. 名前付きプロファイル（`cf auth create <name>` → `cf auth activate <name> <dir>` でディレクトリに紐付け）
3. `cf auth login`（OAuth・グローバル）

**アカウント検証は `cf auth whoami`。トークン運用でも効く**（`wrangler whoami` と違い、
JSON で `authSource` と **アカウント id ＋ name** を返す）。従来の curl 直叩きは不要。

```bash
set -a; source ~/.config/cockpit/env.d/cloudflare-kesoprivate.env; set +a
cf auth whoami          # → {"authenticated":true,"accounts":[{"id":"...","name":"kesoprivate",...}]}
```

`CLOUDFLARE_API_TOKEN` は cf も wrangler も読む。ただしこのマシンは複数アカウントを扱うので、
**シェル全体に常設せず、そのコマンドの env で渡す**（`cloudflare-account-guard` と同じ方針）。
**人が打つ CLI では、トークンを渡さずディレクトリに紐付けたプロファイルに任せるのが既定。**

wrangler の OAuth トークン（`~/.config/.wrangler/config/default.toml`）は scope が固定で
Workers Builds API などに届かないので、wrangler 側で用途が広いタスクをやるときはトークン方式に切り替える。

## 変更履歴

- v2（2026-09-29）: cf が 1.0 ベータ系列に。対応領域を実測で全面差し替え、番頭の導入状態・
  `npm i -g` の落とし穴・`cf auth whoami` によるアカウント検証・
  「Vite が無ければ wrangler に委譲（≥4.136.0 必須）」を追記。
- v2.1（2026-09-29）: `cloudflare.config.ts` への移行（`cf migrate` は beta.2 以降）と
  移行の罠5件を追記。ライブ tail が無いので `wrangler tail` を残すことも明記。
- v3（2026-09-29）: home-power を実際に移行して実測を反映。**「wrangler.jsonc も読める」は誤りで
  `cloudflare.config.ts` は必須**と訂正。設定の対応表、`min-release-age` の外し方と副作用、
  D1 は ID 指定のみ・Worker は `--worker` 指定、migrate は clean worktree 必須、
  コメントは手で書き写すこと、を追記。npm と pnpm で release-age のキー名が違うこと、
  npm 側の柵が今オフであることも実測して明記。
- v1（2026-05-05）: 初版。
