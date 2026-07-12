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
PACKAGE_MANAGER="brew install"

# Ensure that a non-login, non-interactive shell has a defined environment.
if [[ "$SHLVL" -eq 1 && ! -o LOGIN && -s "${ZDOTDIR:-$HOME}/.zprofile" ]]; then
  source "${ZDOTDIR:-$HOME}/.zprofile"
fi
