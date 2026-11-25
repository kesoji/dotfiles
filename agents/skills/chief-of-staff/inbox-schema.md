# 受け箱の項目の形と API

CoS の受け箱の項目の形は、このファイルだけに書く。形を変えるときは、ここと `scripts/inbox.mjs` の `upgradeItem`（`v` の読み分け）を一緒に直す。

- 置き場所: `~/.cos/inbox/<id>.json`（1件1ファイル・全 CoS 共通）。環境変数 `COS_INBOX_DIR` で差し替えられる（試験用）。
- 項目はコマンド（`cos ask` / `cos review` / `cos tell`）でしか作らない。書き換えもコマンドと API だけがする。
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
| `kind` | `ask`（要返事）／`review`（確認依頼）／`tell`（読むだけ） |
| `chief` | 出した CoS。`name` は画面に出す名前（cos.json の `chiefName`、無ければリポジトリの名前）。`dir` は cos.json のあるディレクトリで、`cos watch` が自分の項目かどうかを見る鍵。`session` は出したセッション（無ければ `null`） |
| `worker` | 関係する作業セッションの ID（無ければ `null`） |
| `title`・`body` | 題と本文（本文は Markdown） |
| `options` | `ask` だけ。`{ key, label, detail? }` の配列（空でもよい）。`review`・`tell` は `null` |
| `recommend` | `ask` だけ。おすすめの `key`（無ければ `null`） |
| `freeText` | `ask` だけ。選ばずに文章だけで返してよいか（既定 `true`）。選んだうえでの一言はいつでも付けられる |
| `links` | `{ label, href }` の配列。`href` は `http:`・`https:`・`file:` |
| `createdAt` | 作った時刻（ISO・UTC）。並びと「3日以上」の判定に使う |
| `status` | `open` → `answered`（ask・review に返事）／`read`（tell を開いた）／`withdrawn`（取り下げ・置き換え） |
| `answer` | 返事。`{ "choice": "rec", "text": "一言", "at": "…", "via": "ui" }`。`choice` は ask なら選択肢の `key`（文章だけなら `null`）、review なら `approve`／`reject`（`reject` は `text` が必須）。`via` は `ui` か `cli` |
| `supersedes` | 置き換えた前の項目の `id`（無ければ `null`） |

状態が変わると足される項目:

| 項目 | いつ |
| --- | --- |
| `readAt` | `tell` を既読にした時刻 |
| `withdrawnAt` | 取り下げた時刻 |
| `supersededBy` | 置き換えられた項目に、新しい項目の `id` |
| `deliveredAt` | `cos watch` が `answered` の出来事として CoS に渡した時刻（同じ答えで二度起こさない印） |
| `tag` | 機械が出した項目の重複よけの鍵（例 `stale-done:<作業セッションの ID>`） |

決まり:

- 済んだ項目（`open` でない）には返事・既読・取り下げ・置き換えができない（API は 409）。
- 置き換え（`supersedes`）は、同じ CoS の `open` の項目にだけできる。前の項目は `withdrawn` になり、`supersededBy` が付く。
- `cos watch` の `answered` は、`chief.dir` が自分で、`status` が `answered`、`deliveredAt` が無い項目で起きる。

## API（`cos inbox serve`・127.0.0.1 だけ・JSON）

| 呼び出し | 中身 |
| --- | --- |
| `GET /api/items` | `{ v, now, staleAskDays, counts: { ask, review, tell }, chiefs: [名前], items: [...], skipped }`。`items` は未対応を「要返事 → 確認依頼 → 読むだけ」・古い順で先に、済んだものを新しい順で後ろに並べる。`counts` は未対応の件数。`?status=open` で未対応だけ |
| `GET /api/items/:id` | 1件 |
| `GET /api/items/:id/links/:n` | `links[n]` が手元のファイル（`file:`）のとき、その中身をテキストで返す。項目に書かれたファイルしか読めない |
| `POST /api/items/:id/answer` | 本文 `{ "choice": …, "text": … }`。返事を付けて、項目を返す |
| `POST /api/items/:id/read` | `tell` を既読にして、項目を返す（もう既読なら何も変えない） |
| `GET /api/events` | 押し出し（SSE）。つないだときに `hello`、受け箱が変わるたびに `change` が届く（データは `{ "rev": 数 }`）。受け取ったら `GET /api/items` で全件を取り直す |

- API が返す項目の `links` には `url` が足されている。`file:` のリンクは `/api/items/:id/links/:n`、それ以外は `href` と同じ。画面は `url` を開く（ブラウザは http のページから `file:` を開けないため）。
- 誤りは `{ "error": "文" }` と HTTP の状態で返す。400＝入力が違う・404＝無い・409＝もう済んでいる。
- `POST` は `Content-Type: application/json` が要る。`Host` が `127.0.0.1:<port>`・`localhost:<port>` でない要求と、よその `Origin` からの `POST` は断る（ほかのサイトのページから叩かれないように）。
- 項目を作る・取り下げる API は無い（CoS がコマンドでする）。

## 画面を作り直すとき

画面は `inbox-ui/`（`index.html`・`style.css`・`app.js`。ビルド不要）。上の API だけを使っている。

- 見た目や操作を変えるなら `inbox-ui/` のファイルを直す。サーバーは静的ファイルを毎回読むので、再読み込みで反映される。
- まるごと作り直すなら、別のディレクトリに `index.html` を置いて `cos inbox serve --ui-dir <ディレクトリ>` で指す。良ければ `inbox-ui/` と差し替える。
