# 受け箱の項目の形と API

CoS の受け箱の項目の形は、このファイルだけに書く。形を変えるときは、ここと `scripts/inbox.mjs` の `upgradeItem`（`v` の読み分け）を一緒に直す。

- 置き場所: `~/.cos/inbox/<id>.json`（1件1ファイル・全 CoS 共通）。環境変数 `COS_INBOX_DIR` で差し替えられる（試験用）。
- CoS → ユーザーの項目はコマンド（`cos ask` / `cos review` / `cos todo` / `cos tell`）でしか作らない。ユーザー → CoS の指示（`message`）は API（`POST /api/messages`）でしか作らない。書き換えもコマンドと API だけがする。
- 読み書きの関数は `scripts/inbox.mjs` に1つずつあり、CLI と API の両方がそれを呼ぶ。画面（`inbox-ui/`）は API だけに依存する。

## 項目（v: 1）

```json
{
  "v": 1,
  "id": "20261125-1612-main-a3f",
  "kind": "ask",
  "chief": { "name": "cos-main", "dir": "/path/to/cos-main", "session": "04465b4e-…" },
  "worker": "search-speed",
  "title": "search-speed: どの案で進めるか",
  "body": "Markdown。前の会話を見なくても答えられるように書く",
  "options": [
    { "key": "rec", "label": "おすすめどおり", "detail": "案 A（索引を足す）" },
    { "key": "b", "label": "案 B（キャッシュ）" }
  ],
  "recommend": "rec",
  "freeText": true,
  "links": [{ "label": "報告書", "href": "file:///…/report.md" }],
  "createdAt": "2026-11-25T07:12:00.000Z",
  "status": "open",
  "answer": null,
  "supersedes": null
}
```

| 項目 | 中身 |
| --- | --- |
| `v` | 形の版。今は `1`。読めない版のファイルは一覧から外し、件数だけ知らせる（上げ方は下の「`v` の扱い」） |
| `id` | `<ローカルの年月日>-<時分>-<CoS の短い名前>-<乱数3桁>`。ファイル名と URL にそのまま使う（英数字・`-`・`_`） |
| `kind` | `ask`（要返事）／`review`（確認依頼）／`todo`（やること＝ユーザーが手を動かす作業）／`tell`（読むだけ）＝CoS → ユーザー。`message`（指示）＝ユーザー → CoS |
| `chief` | 出した CoS（`message` では宛先の CoS）。`name` は画面に出す名前（cos.json の `chiefName`、無ければリポジトリの名前）。`dir` は cos.json のあるディレクトリで、`cos watch` が自分の項目かどうかを見る鍵。`session` は出したセッション（無ければ `null`） |
| `worker` | 関係する作業セッションの ID（無ければ `null`） |
| `title`・`body` | 題と本文（本文は Markdown） |
| `options` | `ask` だけ。`{ key, label, detail? }` の配列（空でもよい）。`review`・`todo`・`tell` は `null` |
| `recommend` | `ask` だけ。おすすめの `key`（無ければ `null`） |
| `freeText` | `ask` だけ。選ばずに文章だけで返してよいか（既定 `true`）。選んだうえでの一言はいつでも付けられる |
| `links` | `{ label, href }` の配列。`href` は `http:`・`https:`・`file:` |
| `createdAt` | 作った時刻（ISO・UTC）。並びと「3日以上」の判定に使う |
| `status` | `open` → `answered`（ask・review・todo に返事）／`read`（tell を開いた・message を CoS が ack した）／`withdrawn`（取り下げ・置き換え） |
| `answer` | 返事。`{ "choice": "rec", "text": "一言", "at": "…", "via": "ui" }`。`choice` は ask なら選択肢の `key`（文章だけなら `null`）、review なら `approve`／`reject`（`reject` は `text` が必須）、todo なら `done`（やった。`text` は任意の一言）／`cannot`（できない。`text` が必須）。`via` は `ui` か `cli` |
| `supersedes` | 置き換えた前の項目の `id`（無ければ `null`） |

状態が変わると足される項目:

| 項目 | いつ |
| --- | --- |
| `readAt` | `tell` を既読にした時刻。`message` では CoS が ack した時刻 |
| `withdrawnAt` | 取り下げた時刻 |
| `supersededBy` | 置き換えられた項目に、新しい項目の `id` |
| `deliveredAt` | `cos watch` が `answered`（`message` の項目なら `message`）の出来事として CoS に渡した時刻（同じ答え・同じ指示で二度起こさない印） |
| `replyTo` | ユーザーからの指示への返事として出した項目に、元の指示（`message`）の `id`（`--reply-to`） |
| `repo` | その件の GitHub のリポジトリ（`owner/name`）。画面が `#123` やコミットをリンクにする宛先。分からなければ持たない（前からある項目にも無い） |
| `tag` | 機械が出した項目の重複よけの鍵（例 `stale-done:<作業セッションの ID>`） |

決まり:

- 済んだ項目（`open` でない）には返事・既読・取り下げ・置き換えができない（API は 409）。
- 置き換え（`supersedes`）は、同じ CoS の `open` の項目にだけできる。前の項目は `withdrawn` になり、`supersededBy` が付く。
- `cos watch` の `answered` は、`chief.dir` が自分で、`status` が `answered`、`deliveredAt` が無い項目で起きる。
- `todo`（やること）は、返事（`done`／`cannot`）が付くまで `open` のまま残る。既読（`read`）では終わらない（API は 400）。返事待ちの件数・通知・`answered` の出来事・3日以上の赤は `ask` と同じ扱い。
- `repo` は `cos ask` / `review` / `todo` / `tell` が入れる。`--repo owner/name` があればそれ。無ければ git の origin の URL から引く（github.com のときだけ）。`--worker` の件はその作業セッションの対象のリポジトリ（`--repo` で立てたなら対象側）、それ以外は CoS のリポジトリ。取れなければ持たない。取り込み待ちの自動の確認依頼も同じ。`repo` も足しただけなので `v` は 1 のまま。

### ユーザーからの指示（kind: "message"）

```json
{
  "v": 1,
  "id": "20261125-1721-main-c33",
  "kind": "message",
  "chief": { "name": "cos-main", "dir": "/path/to/cos-main", "session": null },
  "worker": null,
  "title": "デプロイの状況を教えて",
  "body": "デプロイの状況を教えて\n急ぎではない",
  "options": null, "recommend": null, "freeText": null, "links": [],
  "createdAt": "2026-11-25T08:21:56.482Z",
  "status": "open",
  "answer": null,
  "supersedes": null
}
```

- `chief` は宛先の CoS（`GET /api/chiefs` の1件）。`title` は本文の最初の行（60 字で切る）、`body` はユーザーが書いたまま（Markdown としては扱わない。4000 字まで）。
- `status` は `open`（送った・CoS は未読）→ `read`（CoS が `cos inbox ack <id>` を打った。`readAt` が付く）。返事（`answer`）・画面からの既読はできない（API は 400）。
- `cos watch` の `message` は、`kind` が `message`、`chief.dir` が自分、`status` が `open`、`deliveredAt` が無い項目で起きる（宛先でない CoS は起きない）。渡すと `deliveredAt` が付き、二度は出ない。既読（`read`）になるのは ack したとき。
- CoS の返事は普通の項目（`ask`／`review`／`tell`）で、`replyTo` に元の指示の `id` を持つ。`replyTo` に書けるのは、同じ CoS 宛ての `message` だけ。返事を出すと、元の指示が `open` なら `read` になる。
- `counts`（未対応の件数）と返事待ちの上限（`inboxMaxOpen`）には数えない（ユーザーの番ではないため）。
- **`v` は 1 のまま。** `kind: "message"` と `replyTo` は足しただけで、前からある項目の読み方は変わらない。`message` を知らない前の版は、一覧の最後に並べるだけで、`answered` の出来事や件数には入れない。

### `v` の扱い

- **`v` を上げるのは、前からある項目の読み方が変わるときだけ**（項目の意味を変える・必須の項目を足す・消す）。上げると、古い版のコマンド・見張り・サーバーは新しい項目をすべて読み飛ばす（一覧から外して件数だけ知らせる）。全 CoS が同じ受け箱を別々の版で読むので、上げるのは全部を入れ替えられるときだけにする。上げたら `upgradeItem` に古い形 → 新しい形の直し方を書く。
- **種類（`kind`）や任意の項目を足すだけなら `v` は 1 のまま。** `message`・`todo`・`replyTo`・`repo` はこの扱い。読む側は、知らない `kind`・知らない項目があっても落ちないように書く（知らない `kind` は一覧の最後に並べ、件数と出来事の扱いは分かる種類だけにする）。
- `todo` を知らない前の版での動き（壊れないが、足りない）:
  - 前からある項目（`todo` の無い受け箱）は、新しい版でそのまま読める。`counts` に `todo: 0` が足されるだけ。
  - 前の版の `cos inbox` は、`todo` を一覧の最後に `[todo]` と出す。件数と返事待ちの上限には数えない。
  - 前の版の `cos watch`（張ったままの見張り）も、`todo` に答えが付けば `answered` で終わる（`label` は付かない）。
  - 前の版のサーバー（入れ直していない launchd のサービス）は、`todo` に返事を付けられない（500 を返す。項目は変わらない）。`counts` に `todo` が無いので、新しい画面は自分で数える。**スキルを更新したら `cos inbox service install` を打ち直す。**
  - 前の版の画面（開いたままのタブ）は、`todo` を出さない（再読み込みすれば出る）。

## CoS の記録（`~/.cos/chiefs/<鍵>.json`）

画面が CoS の一覧と場所を知るための記録。1つの CoS に1ファイル（鍵は CoS のディレクトリのハッシュ）。`COS_CHIEFS_DIR` で差し替えられ、`COS_INBOX_DIR` を差し替えているとき（試験）は `<受け箱>/.chiefs/`。

```json
{
  "v": 1,
  "name": "cos-main",
  "dir": "/path/to/cos-main",
  "stateDir": "/path/to/cos-main/.git/cos",
  "retroIntervalDays": 7,
  "seenAt": "2026-11-25T08:21:31.259Z",
  "via": "watch",
  "watch": { "pid": 12345, "startedAt": "…", "beatAt": "…" },
  "watchEndedAt": "…"
}
```

- 書くのは、CoS だけが打つコマンド（`cos watch`・`cos spawn`・`cos ask` / `review` / `todo` / `tell`・`cos inbox ack`）と `cos chief` の起動フック。作業セッションは書かない。サーバーは読むだけ。
- `dir` は cos.json のあるディレクトリ（項目の `chief.dir` と同じ鍵）。`stateDir` は台帳（`ledger.json`）・`retro.json` のある場所で、サーバーはここを読むだけ（書かない）。
- `watch` は動いている `cos watch` の印。見張りが 30 秒ごとに `beatAt` を打ち直し、終わるときに `watch` を `null` にして `watchEndedAt` を書く。`pid` が生きていて `beatAt` が 120 秒以内なら「見張り中」。
- `dir` が無くなった記録は一覧に出さない。

## API（`cos inbox serve`・127.0.0.1 だけ・JSON）

| 呼び出し | 中身 |
| --- | --- |
| `GET /api/items` | `{ v, now, staleAskDays, counts: { ask, review, todo, tell }, waiting, unreadMessages, chiefs: [名前], items: [...], skipped }`。`items` は未対応を「要返事 → 確認依頼 → やること → 読むだけ → 指示（CoS が未読）」・古い順で先に、済んだものを新しい順で後ろに並べる。`counts` はユーザーの未対応の件数（指示は入らない）、`waiting` は返事待ち（`ask + review + todo`）、`staleAskDays` は未対応の要返事・やることを赤く出すまでの日数、`unreadMessages` は CoS がまだ読んでいない指示の件数。`?status=open` で未対応だけ |
| `GET /api/items/:id` | 1件 |
| `GET /api/items/:id/links/:n` | `links[n]` が手元のファイル（`file:`）のとき、その中身を返す。項目に書かれたファイルしか読めない。`.html`／`.htm` は `text/html` で、`Content-Security-Policy: sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox` を付けて返す（下の「手元のファイルのリンク」）。ほかは `text/plain` |
| `POST /api/items/:id/answer` | 本文 `{ "choice": …, "text": … }`。返事を付けて、項目を返す。`choice` は ask なら選択肢の `key`、review なら `approve`／`reject`、todo なら `done`／`cannot` |
| `POST /api/items/:id/read` | `tell` を既読にして、項目を返す（もう既読なら何も変えない） |
| `GET /api/chiefs` | `{ v, now, chiefs: [{ name, dir, seenAt, watch: { alive, since, lastAt }, unread, workers: [...], retro, error }] }`。記録されている CoS（名前順）と今の状況。`watch.alive` は見張りが動いているか、`since` は動いている見張りの開始、`lastAt` は最後に見張りが動いていた時刻。`unread` はその CoS 宛ての未読の指示の件数。`workers` は閉じていない作業セッション `{ id, label, title, state, status, statusAt, report, reportUpdated, createdAt, staleDone? }`（`state` は台帳の状態、`status` は見張りが最後に見た herdr の状態＝`working`／`idle`／`done`／`blocked`／`gone`、`report` は報告書の「状態」、`staleDone` は取り込み待ちの経過ミリ秒）。`retro` は `{ dueAt, due, intervalDays }`。その CoS の台帳が読めないときは `error` に理由（ほかの CoS は出す） |
| `POST /api/messages` | 本文 `{ "to": CoS の dir, "text": 指示 }`。`to` は `GET /api/chiefs` の `dir`。指示（`kind: "message"`）を作って、項目を返す。宛先が記録に無い・空・長すぎる（4000 字超）は 400 |
| `GET /api/events` | 押し出し（SSE）。つないだときに `hello`、受け箱が変わるたびに `change` が届く（データは `{ "rev": 数 }`）。受け取ったら `GET /api/items` で全件を取り直す |

- API が返す項目の `links` には `url` が足されている。`file:` のリンクは `/api/items/:id/links/:n`、それ以外は `href` と同じ。画面は `url` を開く（ブラウザは http のページから `file:` を開けないため）。
- **手元のファイルのリンク**: `.html`／`.htm` は HTML として表示する。CSP の `sandbox` に `allow-same-origin` を付けないので、その文書のオリジンは受け箱と別（`null`）になる。図のための JS は動くが、受け箱の API の応答は読めず、`POST` は `Origin` の検査で断られる（403）。相対パスの画像・CSS・スクリプトは読めない（その URL は API に無い）ので、1ファイルで完結する HTML を前提にする。
- 画面は、手元のファイルのリンク（`.html`・`.md` の表示＝`view.html`・そのほかのテキスト）を、もう片方のホスト名の URL で開く（画面が `127.0.0.1:<port>` なら `localhost:<port>`、`localhost:<port>` なら `127.0.0.1:<port>`）。同じサーバーだがオリジンが別なので、アプリ（PWA）の窓の中ではなくブラウザの別タブで開く。サーバーはどちらの `Host` も受ける。外部の `http(s)` のリンクは、もともと別オリジンなのでそのまま。
- 誤りは `{ "error": "文" }` と HTTP の状態で返す。400＝入力が違う・404＝無い・409＝もう済んでいる。
- `POST` は `Content-Type: application/json` が要る。`Host` が `127.0.0.1:<port>`・`localhost:<port>` でない要求と、よその `Origin` からの `POST` は断る（ほかのサイトのページから叩かれないように）。
- CoS → ユーザーの項目を作る・取り下げる API は無い（CoS がコマンドでする）。API で作れるのはユーザーからの指示だけ。
- CoS の状況（`GET /api/chiefs`）の変化は `GET /api/events` では知らされない（受け箱のファイルが変わらないため）。画面は 15 秒ごとに取り直している。

## 画面を作り直すとき

画面は `inbox-ui/`（`index.html`・`style.css`・`app.js`・`md.js`、報告書の表示の `view.html`・`view.js`、PWA の `manifest.webmanifest`・`icon.svg`・`icon-192.png`・`icon-512.png`。ビルド不要）。上の API だけを使っている。

- GitHub へのリンクは画面（`md.js` の `inline`）が作る。題・本文・報告書の表示（`view.html?src=…&repo=owner/name`）で同じ決まり:
  - 項目に `repo` があるときだけ: `PR #123`・`PR#123` → `/pull/123`、`#123`・`Issue #123` → `/issues/123`（PR なら GitHub が転送する）、コミットの SHA（7〜40 桁の16進で、数字と a-f の両方を含むもの）→ `/commit/<sha>`。
  - `owner/name#123` は、項目の `repo` と関係なくいつもリンクにする。
  - コード（`` `…` ``・```` ``` ````）の中と、すでにリンクになっている文字はリンクにしない。`repo` が無い項目では `owner/name#123` のほかは何もリンクにしない。
- PWA として入れられるように、`index.html` が `manifest.webmanifest`（`display: standalone`・`id` と `start_url` は `/`）を指している。service worker は置いていない（Chrome は無くても入れられる。サーバーが常に動いているので、オフライン用のキャッシュは要らない）。アイコンを変えるなら `icon.svg` を直して PNG を作り直す（`qlmanage -t -s 512 -o <出力先> icon.svg` → `sips -z 192 192`）。
- 返事待ち（`counts.ask + counts.review + counts.todo`）を、タイトルの `(n)`・favicon の赤丸・アプリのアイコンのバッジ（`navigator.setAppBadge`）に出している。`counts.todo` を返さない前の版のサーバーでは、画面が未対応の `todo` を自分で数える。

- 見た目や操作を変えるなら `inbox-ui/` のファイルを直す。サーバーは静的ファイルを毎回読むので、再読み込みで反映される。
- まるごと作り直すなら、別のディレクトリに `index.html` を置いて `cos inbox serve --ui-dir <ディレクトリ>` で指す。良ければ `inbox-ui/` と差し替える。
