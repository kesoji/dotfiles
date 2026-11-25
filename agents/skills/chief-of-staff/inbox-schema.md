# 受け箱の項目の形と API

CoS の受け箱の項目の形は、このファイルだけに書く。形を変えるときは、ここと `scripts/inbox.mjs` の `upgradeItem`（`v` の読み分け）を一緒に直す。

- 置き場所: `~/.cos/inbox/<id>.json`（1件1ファイル・全 CoS 共通）。環境変数 `COS_INBOX_DIR` で差し替えられる（試験用）。
- CoS → ユーザーの項目はコマンド（`cos ask` / `cos review` / `cos tell`）でしか作らない。ユーザー → CoS の指示（`message`）は API（`POST /api/messages`）でしか作らない。書き換えもコマンドと API だけがする。
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
| `v` | 形の版。今は `1`。読めない版のファイルは一覧から外し、件数だけ知らせる |
| `id` | `<ローカルの年月日>-<時分>-<CoS の短い名前>-<乱数3桁>`。ファイル名と URL にそのまま使う（英数字・`-`・`_`） |
| `kind` | `ask`（要返事）／`review`（確認依頼）／`tell`（読むだけ）＝CoS → ユーザー。`message`（指示）＝ユーザー → CoS |
| `chief` | 出した CoS（`message` では宛先の CoS）。`name` は画面に出す名前（cos.json の `chiefName`、無ければリポジトリの名前）。`dir` は cos.json のあるディレクトリで、`cos watch` が自分の項目かどうかを見る鍵。`session` は出したセッション（無ければ `null`） |
| `worker` | 関係する作業セッションの ID（無ければ `null`） |
| `title`・`body` | 題と本文（本文は Markdown） |
| `options` | `ask` だけ。`{ key, label, detail? }` の配列（空でもよい）。`review`・`tell` は `null` |
| `recommend` | `ask` だけ。おすすめの `key`（無ければ `null`） |
| `freeText` | `ask` だけ。選ばずに文章だけで返してよいか（既定 `true`）。選んだうえでの一言はいつでも付けられる |
| `links` | `{ label, href }` の配列。`href` は `http:`・`https:`・`file:` |
| `createdAt` | 作った時刻（ISO・UTC）。並びと「3日以上」の判定に使う |
| `status` | `open` → `answered`（ask・review に返事）／`read`（tell を開いた・message を CoS が ack した）／`withdrawn`（取り下げ・置き換え） |
| `answer` | 返事。`{ "choice": "rec", "text": "一言", "at": "…", "via": "ui" }`。`choice` は ask なら選択肢の `key`（文章だけなら `null`）、review なら `approve`／`reject`（`reject` は `text` が必須）。`via` は `ui` か `cli` |
| `supersedes` | 置き換えた前の項目の `id`（無ければ `null`） |

状態が変わると足される項目:

| 項目 | いつ |
| --- | --- |
| `readAt` | `tell` を既読にした時刻。`message` では CoS が ack した時刻 |
| `withdrawnAt` | 取り下げた時刻 |
| `supersededBy` | 置き換えられた項目に、新しい項目の `id` |
| `deliveredAt` | `cos watch` が `answered`（`message` の項目なら `message`）の出来事として CoS に渡した時刻（同じ答え・同じ指示で二度起こさない印） |
| `replyTo` | ユーザーからの指示への返事として出した項目に、元の指示（`message`）の `id`（`--reply-to`） |
| `tag` | 機械が出した項目の重複よけの鍵（例 `stale-done:<作業セッションの ID>`） |

決まり:

- 済んだ項目（`open` でない）には返事・既読・取り下げ・置き換えができない（API は 409）。
- 置き換え（`supersedes`）は、同じ CoS の `open` の項目にだけできる。前の項目は `withdrawn` になり、`supersededBy` が付く。
- `cos watch` の `answered` は、`chief.dir` が自分で、`status` が `answered`、`deliveredAt` が無い項目で起きる。

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

- 書くのは、CoS だけが打つコマンド（`cos watch`・`cos spawn`・`cos ask` / `review` / `tell`・`cos inbox ack`）と `cos chief` の起動フック。作業セッションは書かない。サーバーは読むだけ。
- `dir` は cos.json のあるディレクトリ（項目の `chief.dir` と同じ鍵）。`stateDir` は台帳（`ledger.json`）・`retro.json` のある場所で、サーバーはここを読むだけ（書かない）。
- `watch` は動いている `cos watch` の印。見張りが 30 秒ごとに `beatAt` を打ち直し、終わるときに `watch` を `null` にして `watchEndedAt` を書く。`pid` が生きていて `beatAt` が 120 秒以内なら「見張り中」。
- `dir` が無くなった記録は一覧に出さない。

## API（`cos inbox serve`・127.0.0.1 だけ・JSON）

| 呼び出し | 中身 |
| --- | --- |
| `GET /api/items` | `{ v, now, staleAskDays, counts: { ask, review, tell }, unreadMessages, chiefs: [名前], items: [...], skipped }`。`items` は未対応を「要返事 → 確認依頼 → 読むだけ → 指示（CoS が未読）」・古い順で先に、済んだものを新しい順で後ろに並べる。`counts` はユーザーの未対応の件数（指示は入らない）、`unreadMessages` は CoS がまだ読んでいない指示の件数。`?status=open` で未対応だけ |
| `GET /api/items/:id` | 1件 |
| `GET /api/items/:id/links/:n` | `links[n]` が手元のファイル（`file:`）のとき、その中身をテキストで返す。項目に書かれたファイルしか読めない |
| `POST /api/items/:id/answer` | 本文 `{ "choice": …, "text": … }`。返事を付けて、項目を返す |
| `POST /api/items/:id/read` | `tell` を既読にして、項目を返す（もう既読なら何も変えない） |
| `GET /api/chiefs` | `{ v, now, chiefs: [{ name, dir, seenAt, watch: { alive, since, lastAt }, unread, workers: [...], retro, error }] }`。記録されている CoS（名前順）と今の状況。`watch.alive` は見張りが動いているか、`since` は動いている見張りの開始、`lastAt` は最後に見張りが動いていた時刻。`unread` はその CoS 宛ての未読の指示の件数。`workers` は閉じていない作業セッション `{ id, label, title, state, status, statusAt, report, reportUpdated, createdAt, staleDone? }`（`state` は台帳の状態、`status` は見張りが最後に見た herdr の状態＝`working`／`idle`／`done`／`blocked`／`gone`、`report` は報告書の「状態」、`staleDone` は取り込み待ちの経過ミリ秒）。`retro` は `{ dueAt, due, intervalDays }`。その CoS の台帳が読めないときは `error` に理由（ほかの CoS は出す） |
| `POST /api/messages` | 本文 `{ "to": CoS の dir, "text": 指示 }`。`to` は `GET /api/chiefs` の `dir`。指示（`kind: "message"`）を作って、項目を返す。宛先が記録に無い・空・長すぎる（4000 字超）は 400 |
| `GET /api/events` | 押し出し（SSE）。つないだときに `hello`、受け箱が変わるたびに `change` が届く（データは `{ "rev": 数 }`）。受け取ったら `GET /api/items` で全件を取り直す |

- API が返す項目の `links` には `url` が足されている。`file:` のリンクは `/api/items/:id/links/:n`、それ以外は `href` と同じ。画面は `url` を開く（ブラウザは http のページから `file:` を開けないため）。
- 誤りは `{ "error": "文" }` と HTTP の状態で返す。400＝入力が違う・404＝無い・409＝もう済んでいる。
- `POST` は `Content-Type: application/json` が要る。`Host` が `127.0.0.1:<port>`・`localhost:<port>` でない要求と、よその `Origin` からの `POST` は断る（ほかのサイトのページから叩かれないように）。
- CoS → ユーザーの項目を作る・取り下げる API は無い（CoS がコマンドでする）。API で作れるのはユーザーからの指示だけ。
- CoS の状況（`GET /api/chiefs`）の変化は `GET /api/events` では知らされない（受け箱のファイルが変わらないため）。画面は 15 秒ごとに取り直している。

## 画面を作り直すとき

画面は `inbox-ui/`（`index.html`・`style.css`・`app.js`・`md.js`、報告書の表示の `view.html`・`view.js`、PWA の `manifest.webmanifest`・`icon.svg`・`icon-192.png`・`icon-512.png`。ビルド不要）。上の API だけを使っている。

- PWA として入れられるように、`index.html` が `manifest.webmanifest`（`display: standalone`・`id` と `start_url` は `/`）を指している。service worker は置いていない（Chrome は無くても入れられる。サーバーが常に動いているので、オフライン用のキャッシュは要らない）。アイコンを変えるなら `icon.svg` を直して PNG を作り直す（`qlmanage -t -s 512 -o <出力先> icon.svg` → `sips -z 192 192`）。
- アプリのアイコンのバッジ（`navigator.setAppBadge`）には、返事待ち（`counts.ask + counts.review`）を出している。

- 見た目や操作を変えるなら `inbox-ui/` のファイルを直す。サーバーは静的ファイルを毎回読むので、再読み込みで反映される。
- まるごと作り直すなら、別のディレクトリに `index.html` を置いて `cos inbox serve --ui-dir <ディレクトリ>` で指す。良ければ `inbox-ui/` と差し替える。
