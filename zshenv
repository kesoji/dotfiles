# ここをコメントインするとプロファイリングできる
#zmodload zsh/zprof && zprof
# Ensure that a non-login, non-interactive shell has a defined environment.
if [[ "$SHLVL" -eq 1 && ! -o LOGIN && -s "${ZDOTDIR:-$HOME}/.zprofile" ]]; then
  source "${ZDOTDIR:-$HOME}/.zprofile"
fi
# Rust
if [[ -e $HOME/.cargo ]]; then
    . "$HOME/.cargo/env"
fi
export PATH="/Users/kesoji/.local/share/flutter/bin:$PATH"
