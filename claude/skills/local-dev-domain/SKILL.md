---
name: local-dev-domain
description: >
  ローカル開発で `https://<repo>.test`（例 myapp.test）を使えるようにする個人標準。
  mac に1つの共有 Caddy ＋ dnsmasq(*.test→127.0.0.1) を立て、各リポは caddy/site.caddy を登録するだけ。
  「ローカルドメインを足したい」「.test で開発したい」「<name>.test みたいにしたい」
  「新しい mac でローカルドメイン環境を作る」「このリポに dev ドメインを生やす」等で発火。
  実体は単一コマンド `devproxy`（~/dotfiles/bin・bootstrap/generate/register/status）。Apple Container は不採用（理由は下記）。
---

# local-dev-domain

ネイティブの dev サーバ（Vite / wrangler / その他 http 1ポート）に `https://<repo>.test` を被せる個人標準。
コマンドは dotfiles 同期（`~/dotfiles/bin`・PATH 済み）なのでどの mac でも同じ。日本語で対応する。

## モデル（なぜこの形か）

- **mac に共有 Caddy 1つ**（launchd 常駐・80/443 を握る）が `import ~/.config/devproxy/sites/*.caddy` で各リポの宣言を読む。Host 振り分けなので**複数リポ同時起動でも 443 衝突しない**。https はローカル CA（`caddy trust`）で自動発行＝mkcert 不要。
- **dnsmasq `*.test`→127.0.0.1**（ユーザー LaunchAgent・**5300**）＋ `/etc/resolver/test`（`nameserver 127.0.0.1` ＋ `port 5300`）が名前解決を担う。ワイルドカードなので**リポ追加で DNS は触らない**＋テナントのサブドメイン（`*.<repo>.test`）も効く。`/etc/hosts` だと固定名しか書けず、これが dnsmasq を選ぶ唯一の理由。
- **パッケージは devbox(Nix) 管理**（`devbox_global` に `caddy`/`dnsmasq`）。brew は使わない。Nix にはグローバル常駐の仕組みが無いので**常駐は launchd**。**dnsmasq は非 root のユーザー LaunchAgent**（`~/Library/LaunchAgents/com.devproxy.dnsmasq.plist`・5300 は非特権。**5353 は mDNS(Bonjour) 予約で mDNSResponder が `/etc/resolver` 経由の転送をしないため不可**＝5300 等を使う）、**caddy は root LaunchDaemon**（`/Library/LaunchDaemons/com.devproxy.caddy.plist`・443 は macOS では root 必須）。設定は **`~/.config/devproxy/`**（Caddyfile・dnsmasq.conf・caddy-data・sites/）に集約（Nix store は read-only なので `$(brew --prefix)/etc` は使わない）。
- **Apple Container は不採用**: dev サーバは mac ネイティブで、コンテナ→ホスト到達が未解決（apple/container#346）。共有 Caddy がネイティブ dev に被せる最小構成。
- 本番は無関係（CF エッジ等が終端）。これは**手元 dev 専用**ツール。

## コマンド（実体 = `~/dotfiles/bin/devproxy` 1本のサブコマンド）

| コマンド | いつ | 何を |
| --- | --- | --- |
| `devproxy bootstrap` | **mac ごとに一度** | `~/.config/devproxy` 設定生成・`/etc/resolver/test`・launchd（caddy=root Daemon / dnsmasq=ユーザー Agent）登録・`caddy trust`。caddy/dnsmasq は devbox 導入済み前提。冪等。sudo を数回求める |
| `devproxy generate <domain> <port>` | **リポを標準に組み込むとき** | `caddy/site.caddy` 生成＋`package.json` の `predev` に `devproxy register \|\| true` 配線＋即登録 |
| `devproxy register` | 各リポの `pnpm dev` 頭（predev）で自動 | カレントリポの `caddy/site.caddy` を sites へ symlink＋`caddy reload`。未 bootstrap でも exit0 |
| `devproxy status` | 確認 | 常駐（dnsmasq/caddy）と sites・dnsmasq 応答を表示 |

## 手順

### A. 新しい mac（一度だけ）
前提: `devbox_global` に `caddy`・`dnsmasq` がある（無ければ `devbox global add caddy dnsmasq` → 新シェル）。
```bash
devproxy bootstrap
devproxy status                                          # 常駐と解決の確認
# dig +short myapp.test @127.0.0.1 -p 5300  #=> 127.0.0.1（OS経路は dscacheutil -q host -a name myapp.test）
```

### B. リポを標準に組み込む
1. dev サーバの**入口ポート**を確認（Vite なら vite.config の port、wrangler なら dev のポート）。入口が1ポートに集約されている前提（例: Vite が /rpc・/api・/ws を API へ proxy 済みなら Vite のポートだけ）。
2. リポのルートで:
   ```bash
   devproxy generate <repo>.test <port>     # 例: devproxy generate myapp.test 5173
   ```
3. **Vite を使うリポだけ**: `vite.config` の `server` に `allowedHosts: ['.<repo>.test']` を追加（Host チェック許可。自動編集はしない＝設定が多様なため手で）。
4. `caddy/site.caddy` はコミットする（リポの宣言）。`predev` も package.json に入る。
5. `pnpm dev` → `https://<repo>.test`。HMR が https 越しで繋がらないときだけ `server.hmr`（host/protocol:wss/clientPort:443）を足す（Caddy が ws upgrade を中継するので通常は無設定で可）。

### C. トラブルシュート
- 名前が引けない: `dig +short <repo>.test @127.0.0.1 -p 5300`、`launchctl print gui/$(id -u)/com.devproxy.dnsmasq`、`/etc/resolver/test`（`port 5300` 行も）の有無。OS 経路は `dscacheutil -q host -a name <repo>.test`。
- TLS `internal error`／`no peer certificate`: 共有 Caddyfile の global に `local_certs` があるか（`.test` は公的 ACME が失敗するので全サイトをローカル CA で発行する必要がある。`devproxy bootstrap` が書く）。`caddy trust` も済んでいるか。
- https にならない/警告: `caddy trust --config ~/.config/devproxy/Caddyfile --adapter caddyfile` をやり直し、`sudo launchctl print system/com.devproxy.caddy`。
- 反映されない: `caddy reload --config ~/.config/devproxy/Caddyfile --adapter caddyfile`、`ls ~/.config/devproxy/sites`。
- 常駐の再起動: caddy=`sudo launchctl kickstart -k system/com.devproxy.caddy` / dnsmasq=`launchctl kickstart -k gui/$(id -u)/com.devproxy.dnsmasq`。
- devbox 更新でバイナリパスが変わり起動しない: `devproxy bootstrap` を再実行（plist のパスを貼り直す）。
- Vite が Host を弾く（Blocked request）: `allowedHosts` 追加漏れ。

## メンテ
- ロジックは全部 `~/dotfiles/bin/devproxy`（1本・サブコマンド dispatch・単一の真実）。各リポはスクリプトを持たず `caddy/site.caddy` ＋ `predev: devproxy register || true` のみ。
- 関連 memory: `local-dev-domains-shared-caddy`（プロジェクト側に経緯あり）。
