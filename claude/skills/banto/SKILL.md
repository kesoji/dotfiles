---
name: banto
description: >
  家にある常時稼働の Mac「番頭（banto）」＝ m1pro（M1 Pro / M1 / 家の Mac / 常時稼働機 / サーバー機）で処理を動かすための個人標準。
  「番頭に仕込んで」「番頭さんで回して」「banto で」は、この機械で定期実行・常駐させる指示。
  「定期処理にしたい」「毎朝/毎週/毎時 回したい」「cron で」「launchd で」「無人で回したい」「放置で動かしたい」
  「寝てる間に」「番頭で」「banto で」「m1pro で」「M1 で動かして」「常時稼働のほうで」等で発火。
  特に、クラウドの routine（/schedule）や Cloudflare の cron ではできない**ローカルでしかできない処理**
  （ログイン済みのブラウザを使う、LAN 内の機器や NAS に触る、ローカルの dev サーバーに繋ぐ、重い動画処理、herdr でエージェントを立てる）
  を定期実行したいとき。手元のノート PC（持ち歩く・スリープする）には定期ジョブを置かない。
---

# banto（番頭）— 常時稼働機 m1pro でジョブを動かす

**番頭＝banto＝m1pro は同じ機械。** 店に常駐して、主人の留守中も帳場を回す人、という役回り。

日本語で対応する。**この機械の IP・鍵・載っているジョブの正本は非公開の台帳**
`~/go/src/github.com/kesoji/cockpit/hosts/m1pro.md`（無ければ本人に聞く）。このスキルは公開前提なので、具体値はここに書かない。

## 1. どこで動かすかを先に決める

| 必要なもの | 置き場 |
|---|---|
| ネットに出るだけ（API を叩く、メールを読む、Web を取得） | クラウドの routine（`/schedule`）か Cloudflare の cron。**m1pro は使わない** |
| ログイン済みの Chrome、LAN・NAS、ローカルの dev サーバー、herdr、重い処理 | **m1pro** |
| 手元のノート PC | **定期ジョブは置かない**（スリープ・持ち出しで止まる） |

迷ったら本人に「クラウドで足りるか、m1pro が要るか」を1行で確認する。

## 2. 入り方

手元の Mac から Claude 専用鍵で SSH（`~/.ssh` はサンドボックスで読めないので別の場所に置いてある）。

```bash
ssh -F ~/.config/cockpit-ssh/config banto      # LAN（m1pro でも同じ）
ssh -F ~/.config/cockpit-ssh/config banto-ts   # 外出先（Tailscale。m1pro-ts でも同じ）
```

- **非対話の SSH では devbox/Nix の PATH が載らない。** `herdr` `node` `pnpm` などは `zsh -lc '...'` で包む。
- ログインシェルが devbox の注意書き等を出すことがある（実害なし）。出力を解析するときは除外する。
- `Permission denied` になったら、再起動直後で FileVault が解除されていない可能性が高い。**本人にパスワードで SSH してもらう**（Claude はパスワードを受け取らない）。外出先からは解除できないので、**リモートで再起動しない**。

## 3. 仕込み方

- **ユーザーの LaunchAgent**（`~/Library/LaunchAgents/<reverse-dns>.<name>.plist`）を基本にする。GUI ログインセッションで動くので、Chrome・herdr・キーチェーンが使える。
  - root が要るもの（特権ポート等）だけ LaunchDaemon。cron は使わない。
  - `StartCalendarInterval` で時刻指定、`StandardOutPath` / `StandardErrorPath` にログ、`ProgramArguments` は `/bin/zsh -lc "<コマンド>"` にして PATH を揃える。
  - 登録は `launchctl bootstrap gui/$(id -u) <plist>`、止めるのは `launchctl bootout gui/$(id -u) <plist>`、手動実行は `launchctl kickstart gui/$(id -u)/<label>`。
- リポのスクリプトを回すなら、**m1pro 側にもクローンが必要**。無ければ作る（場所は手元と同じ `~/go/src/github.com/<org>/<repo>`）。
- エージェント（Claude Code 等）を立てる処理は、**m1pro にその CLI が入っているか先に確認**する（`zsh -lc 'command -v claude herdr'`）。
- 仕込んだら**一度 `kickstart` で手動実行して、ログで成功を確かめてから**完了とする。

## 4. 本人に確認すること（勝手にやらない）

- 常駐ジョブの追加・削除、ソフトのインストール、ログイン項目の変更。やる内容を1〜3行で示してから進める。
- ブラウザで**外部に送信する操作**（投稿・申請・購入等）を含むジョブ。
- 電源・スリープ・再起動に関わる設定。

## 5. 最後に台帳を更新する

ジョブを足した／止めたら、非公開台帳 `hosts/m1pro.md` の「載っているジョブ」に1行（ジョブ・種類・起動方法・状態・関連リポ）。
台帳のリポが手元に無いセッションなら、本人に「台帳に追記が要る」と伝えて終える。
