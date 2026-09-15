---
name: web-launch-checklist
description: >
  Web サイト／Web ページを「本物として公開できる状態」にするための個人標準チェックリスト（20項目＋α）。
  新しいサイトを作る、LP やページを追加する、テンプレートを作る、公開・ローンチ前に仕上げる時に必ず発火。
  「サイト作って」「ページを追加」「LP を作りたい」「公開前チェック」「ローンチ前に見て」「ちゃんとしたサイトにしたい」
  「SEO 周り大丈夫？」「足りないものある？」等で発火。既存サイトの監査にも使う。
  404 / meta title・description / OGP / favicon / robots.txt / sitemap / alt / レスポンシブ / CTA /
  フォームの送信中・エラー・完了 / プライバシーポリシー・利用規約 / Cookie・外部送信 / アナリティクス / 所在地 / 画像圧縮。
---

# web-launch-checklist

見た目ができた＝完成、ではない。公開前に下の項目を**全部**確認する。日本語で対応する。

## 使い方

- **新規作成時**: 最初のテンプレート（共通 head・ヘッダー・フッター）を作る段階で「共通で済むもの」を仕込む。1ページずつ後付けすると漏れる。
- **ページ追加時**: 「ページ単位」の項目だけ確認する。
- **監査時**: 各項目を 実装済み / 一部 / 未対応 / 対象外（理由付き）で表にして報告する。推測で「OK」にせず、ファイルか本番 URL で確かめる。
- 対象外にしてよいのは理由を言える時だけ（例: フォームが無いサイトのフォーム項目）。

## チェックリスト

### A. サイト共通（テンプレート・インフラで一度やる）

1. **カスタム 404 ページ**
   - ステータスコードが本当に **404** で返ること（200 で 404 風ページを返すソフト 404 は NG）。
   - 空ボディではなく、ヘッダー・トップへの導線・問い合わせ導線があるページ。`noindex` 推奨。
   - 確認: `curl -s -o /dev/null -w '%{http_code}' https://<site>/no-such-page` とボディの中身。
2. **ファビコン**: `favicon.ico`（sizes="any"）＋ `favicon.svg` ＋ `apple-touch-icon.png`（180x180）。参照先が実在して 200 を返すか確認。
3. **robots.txt**: 実在し、`Sitemap: https://<site>/sitemap.xml` 行を含む。ステージング等で `Disallow: /` が残っていないこと。CDN（Cloudflare の managed robots.txt 等）が自動生成している場合は、その中身に Sitemap 行があるか確認する。
4. **sitemap.xml**: 公開ページを全部含み、URL は canonical と完全一致（末尾スラッシュ・`.html` の有無・www の有無）。できればビルドで生成し、手書きしない。Search Console に送信。
5. **OGP / Open Graph 画像**: `og:title` `og:description` `og:image`（1200x630・絶対 URL）`og:url` `og:type` `twitter:card=summary_large_image`。サイト共通のデフォルト画像を用意し、重要ページは個別画像。
6. **canonical**: 各ページに自己参照 canonical（絶対 URL）。クエリ付き URL・www/apex の揺れを集約。
7. **モバイルブレークポイント**: `<meta name="viewport" content="width=device-width, initial-scale=1">`。375px 前後・768px・1024px 付近で横スクロールが出ないか、タップ領域 44px 以上、文字 16px 以上（iOS のフォーム拡大防止）を実機幅で確認。
8. **アナリティクス**: GA4 等を全ページに入れる。問い合わせ送信・予約クリック等の**コンバージョンイベント**も送る。本番のみで計測し、ローカル/プレビューは除外。
9. **本物の連絡先・所在地**: 会社概要／フッターに実在の住所・会社名・連絡手段。通販・有料サービスがあれば**特定商取引法に基づく表記**も。ダミー（〒000-0000、example.com、090-xxxx）が残っていないか grep する。
10. **画像圧縮**: WebP/AVIF 優先、表示サイズに合わせてリサイズ、目安 1枚 200–300KB 以下（ヒーローも 500KB 以下）。`width`/`height` 指定で CLS 防止、ファーストビュー外は `loading="lazy"`、LCP 画像は `fetchpriority="high"`（lazy にしない）。

### B. ページ単位（ページを足すたびに）

11. **meta title**: 全ページで**固有**（重複禁止）。「ページ名 | サイト名」、全角 30 文字前後。
12. **meta description**: 全ページで固有。全角 80–120 文字程度でページ内容を要約。未設定だと検索結果の抜粋が Google 任せになる。
13. **alt テキスト**: 意味のある画像は内容を説明する alt、装飾画像は `alt=""`（属性自体の省略は NG）。人物写真は「誰が何をしているか」。
14. **ファーストビューの CTA**: スクロールせずに見える位置に、そのページの主目的のボタン（問い合わせ・予約・購入等）を置く。ヘッダーナビのリンクだけでは弱い。スライダーだけのヒーローにしない。

### C. モバイル・インタラクション

15. **スティッキーモバイル CTA**: コンバージョンが目的のページ（LP・サービス・公演／商品詳細）ではモバイルで下部固定の CTA バーを出す。フッター到達時やフォーム入力中は隠す、`env(safe-area-inset-bottom)` を考慮、本文が隠れないよう下余白を足す。純粋な情報ページでは不要（対象外と明記）。
16. **ローディング状態**: 非同期処理中はボタンを disabled＋「送信中…」表示で二重送信防止。遅い画像や一覧はスケルトン/プレースホルダ。スクリーンリーダー向けに `aria-live`／`aria-busy`。

### D. フォーム

17. **フォームのエラー状態**
    - クライアント側: `required` / `type="email"` 等 + 項目ごとのエラーメッセージを**その項目の近く**に表示、`aria-invalid` と `aria-describedby` で関連付け、最初のエラー項目にフォーカス。
    - サーバー側: 同じ検証を必ずサーバーでもやる。エラー種別ごとに人間向けメッセージ。通信失敗時もメッセージ。入力内容は消さない。
    - スパム対策（Turnstile / reCAPTCHA / ハニーポット）。
18. **サンクスページ**: 送信完了は専用 URL（例 `/contact/thanks`）に遷移させる。理由: 計測（GA のページビューでコンバージョン計測・広告タグ）、リロードでの再送防止、完了がはっきり伝わる。`noindex`、sitemap から除外、次の導線（トップ・関連コンテンツ）を置く。インライン完了表示で済ませる場合は、代わりにコンバージョンイベントを送っていることを確認する。

### E. 法務・プライバシー

19. **プライバシーポリシー**: 取得する個人情報・利用目的・第三者提供・問い合わせ窓口。使っている**全ての**外部送信（GA、広告タグ、ピクセル、埋め込み動画、フォームの送信先 SaaS 等）を列挙する。タグを足したらポリシーも更新。フォームには同意チェック＋ポリシーへのリンク。
20. **利用規約**: 会員登録・購入・投稿・予約など**ユーザーと契約関係が生じる機能**があるなら必須。純粋な会社案内サイトなら「サイトポリシー／免責事項・著作権」ページで代替可（判断理由を明記）。
21. **Cookie バナー／外部送信の通知**
    - EU/英国向け・越境 EC なら GDPR 準拠の同意バナー（同意前は計測タグを発火させない、Google Consent Mode v2）。
    - 日本国内向けのみなら、法的に必須なのは電気通信事業法の**外部送信規律**（送信先・送信される情報・利用目的の公表）。バナーは必須ではないが、ポリシー内に「外部送信」の一覧があることを確認する。
    - どちらにするかは対象ユーザーの地域で決め、ユーザーに確認する。

### F. あると良い（20項目に無いが漏れやすい）

- `<html lang="ja">`、構造化データ（Organization / LocalBusiness / Event / BreadcrumbList）。
- HTTPS 強制、セキュリティヘッダ（HSTS / X-Content-Type-Options / Referrer-Policy / CSP）。
- 本番以外（ステージング・プレビュー URL）は `noindex`。
- Lighthouse（モバイル）で Performance / Accessibility / SEO / Best Practices を確認。
- Search Console 登録とサイトマップ送信。

## 監査用のコマンド例（静的 HTML の場合）

```bash
# ページごとの title / description / og:image の有無
for f in $(git ls-files '*.html'); do
  echo "$f title=$(grep -c '<title>' $f) desc=$(grep -c 'name="description"' $f) og=$(grep -c 'og:image' $f)"
done
# title の重複
grep -ho '<title>[^<]*' $(git ls-files '*.html') | sort | uniq -d
# alt の無い img
grep -o '<img[^>]*>' $(git ls-files '*.html') | grep -v 'alt='
# 大きい画像（300KB 超）
git ls-files -z '*.jpg' '*.JPG' '*.jpeg' '*.png' '*.webp' | xargs -0 stat -f '%z %N' 2>/dev/null | awk '$1>300000' | sort -rn
# 本番の特殊ファイル
for p in robots.txt sitemap.xml no-such-page; do curl -s -o /dev/null -w "$p %{http_code}\n" https://<site>/$p; done
curl -s https://<site>/robots.txt | grep -i sitemap
```

head をサーバー／エッジ（Worker の HTMLRewriter、テンプレートエンジン等）で注入している場合、ソースの grep では 0 件でも本番では入っていることがある。**最終判断は本番（またはローカル dev サーバー）のレスポンス HTML で行う**: `curl -s https://<site>/ | grep -i 'description\|og:\|canonical\|icon'`。
