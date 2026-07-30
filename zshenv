# ここをコメントインするとプロファイリングできる
#zmodload zsh/zprof && zprof

# zprofile / zshrc の両方から使う共通ヘルパー。
# zshenv は .zprofile / .zshrc より先に必ず読まれるため、ここで定義しておく。
function echo_error {
    echo -e "\e[31m$@\e[m"
}
function echo_notice {
    echo -e "\e[33;5;243m$@\e[m"
}
function echo_info {
    echo -e "\e[38;5;243m$@\e[m"
}
function comexec() {
    echo_info ">>> $1"; eval $1
}
function cached_eval {
    CACHE_DIR=~/.local/cache/zshrc-eval
    [[ ! -d "$CACHE_DIR" ]] && mkdir -p "$CACHE_DIR"

    CACHE_FILE="$CACHE_DIR/${1// /_}"
    if [[ ! -e "$CACHE_FILE" ]]; then
        # 生成に失敗 or 出力が空なら壊れたキャッシュを残さない
        # (新PCで nix/devbox 未整備時のエラー出力を掴み続けるのを防ぐ)
        if ! eval "$1" > "$CACHE_FILE" 2>/dev/null || [[ ! -s "$CACHE_FILE" ]]; then
            rm -f "$CACHE_FILE"
            return
        fi
    fi
    source "$CACHE_FILE"
}
function clear_cached_eval {
    rm -rf ~/.local/cache/zshrc-eval
}
PACKAGE_MANAGER="brew install"

# Ensure that a non-login, non-interactive shell has a defined environment.
if [[ "$SHLVL" -eq 1 && ! -o LOGIN && -s "${ZDOTDIR:-$HOME}/.zprofile" ]]; then
  source "${ZDOTDIR:-$HOME}/.zprofile"
fi
