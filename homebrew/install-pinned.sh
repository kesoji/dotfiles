#!/bin/bash
# 版と sha256 を固定した formula（homebrew/Formula/*.rb）を、ローカルの tap 経由で入れる。
# Brewfile（brew bundle）は版を固定できないので、固定したいものはこちらで入れる。何度流してもよい。
# .rb の version を上げてから流し直すと、その版に上げる。
set -euo pipefail
# 単独で流したときも、Homebrew を入れた直後でも brew を使えるようにする
for b in /opt/homebrew/bin/brew /usr/local/bin/brew; do [ -x "$b" ] && eval "$("$b" shellenv)" && break; done
cd "$(dirname "$0")"
TAP="local/pinned"
TAP_DIR="$(brew --repository)/Library/Taps/local/homebrew-pinned"

[ -d "$TAP_DIR" ] || brew tap-new --no-git "$TAP" >/dev/null
mkdir -p "$TAP_DIR/Formula"
for f in Formula/*.rb; do
	name="$(basename "$f" .rb)"
	want="$(sed -nE 's/^[[:space:]]*version "([^"]+)".*/\1/p' "$f" | head -1)"
	cp "$f" "$TAP_DIR/Formula/"
	# 固定版と衝突する formula（conflicts_with。例: homebrew/core の版）が入っていれば外す
	while read -r c; do
		if [ -n "$c" ] && brew list --formula "$c" >/dev/null 2>&1; then
			echo "外す: ${c}（${name} と衝突する）"
			brew uninstall "$c" </dev/null
		fi
	done < <(sed -nE 's/^[[:space:]]*conflicts_with "([^"]+)".*/\1/p' "$f")
	if have="$(brew list --versions "$name" 2>/dev/null)" && [ -n "$have" ]; then
		if [ -z "$want" ] || [[ " ${have#"$name"} " == *" $want "* ]]; then
			echo "入っている: $have"
		else
			echo "上げる: ${have} -> ${want}"
			brew upgrade --build-from-source "$TAP/$name"
		fi
	else
		echo "入れる: ${name} ${want}"
		brew install --build-from-source "$TAP/$name"
	fi
done
