#!/usr/bin/env bash
# chief of staff（CoS）のセッションを、いまの herdr のペインで起動する（入口は `cos chief`）。
#
#   cos chief [claude への追加の引数...]
#
# - リポジトリの本体の作業ツリーで動かす（worktree の中なら注意を出す）。
# - 長く聞き続ける前提なので、コンテキストが 60% で自動要約（auto compact）する
#   （CLAUDE_AUTOCOMPACT_PCT_OVERRIDE。COS_AUTOCOMPACT_PCT で変えられる）。
# - 要約や /clear のあとに、CoS であることと立て直す手順を文脈に戻すフックを足す（chief-settings.json）。
# - 起動したら chief-of-staff スキルを読み込む。
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[ "${HERDR_ENV:-}" = 1 ] || { echo "cos chief: herdr のペインの中で実行してください" >&2; exit 1; }
top="$(git rev-parse --show-toplevel 2>/dev/null)" || { echo "cos chief: git リポジトリの中で実行してください" >&2; exit 1; }
main="$(git worktree list --porcelain | awk '/^worktree /{print $2; exit}')"
if [ "$top" != "$main" ]; then
  echo "cos chief: 注意: ここは本体の作業ツリーではありません（$top）。CoS はふつう本体（$main）で動かします。" >&2
fi
cd "$top"

export COS_CHIEF=1
export CLAUDE_AUTOCOMPACT_PCT_OVERRIDE="${COS_AUTOCOMPACT_PCT:-60}"
exec claude --name "CoS $(basename "$main")" --settings "$here/chief-settings.json" "$@" "/chief-of-staff"
