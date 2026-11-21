#!/bin/bash

if ! command -v brew &> /dev/null; then
    echo "Installing Homebrew..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi
# Homebrew のインストーラーは PATH を書き換えないので、入れた直後でも brew を使えるようにする
for b in /opt/homebrew/bin/brew /usr/local/bin/brew; do [ -x "$b" ] && eval "$("$b" shellenv)" && break; done

# どこから流してもスクリプトの隣の Brewfile を使う
brew bundle --file="$(cd "$(dirname "$0")" && pwd)/Brewfile"

echo "Dockerは手でインストールしましょう"
