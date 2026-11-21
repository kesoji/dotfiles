#!/bin/bash
# 版と sha256 を固定した formula（homebrew/Formula/*.rb）を、ローカルの tap 経由で入れる。
# Brewfile（brew bundle）は版を固定できないので、固定したいものはこちらで入れる。何度流してもよい。
set -euo pipefail
cd "$(dirname "$0")"
TAP="local/pinned"
TAP_DIR="$(brew --repository)/Library/Taps/local/homebrew-pinned"

[ -d "$TAP_DIR" ] || brew tap-new --no-git "$TAP" >/dev/null
mkdir -p "$TAP_DIR/Formula"
for f in Formula/*.rb; do
	name="$(basename "$f" .rb)"
	cp "$f" "$TAP_DIR/Formula/"
	if brew list --formula "$name" >/dev/null 2>&1; then
		echo "入っている: $name"
	else
		echo "入れる: $name"
		brew install --build-from-source "$TAP/$name"
	fi
done
