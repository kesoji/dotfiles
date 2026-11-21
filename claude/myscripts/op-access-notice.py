#!/usr/bin/env python3
"""PreToolUse フック（Bash）: 1Password CLI（op）を使う前に「どのペインが・どの項目を」出す。

herdr で Claude Code を何枚も並べていると、1Password の認証 UI が出ても
どのセッションが・どの項目を読もうとしているのか分からない。

このフックは Bash のコマンドに op の呼び出しが含まれるときだけ動き、
  1. Claude Code の許可の画面に理由つきで出す（permissionDecision: "ask"）
  2. herdr の通知を出す（herdr の中にいるときだけ）
  3. macOS の通知センターにも出す（herdr の外でも）
を行う。読む項目は op:// の参照・項目名・env ファイルの中の op:// の参照だけを出す。
値（秘密そのもの）は読まない・出さない・ログに書かない。

壊れていても Claude Code を止めない（例外はすべて通す＝exit 0・何も出さない）。
環境変数 OP_ACCESS_NOTICE_NO_NOTIFY=1 で通知だけを止められる（テスト用）。
"""
import json
import os
import re
import shlex
import shutil
import subprocess
import sys

# op の呼び出しらしい箇所があるか（速く抜けるための粗いふるい）
QUICK = re.compile(r"(?:^|[\s;&|(`/\"'])op\s")
# op:// の参照（引用符や括弧の手前で切る）
REF = re.compile(r"op://[^\s'\"`)<>|;&]+")
# $(op …) や `op …` のコマンド置換
SUBST = re.compile(r"(?:\$\(|`)\s*((?:[\w./-]*/)?op\s[^)`]*)")
# コマンドの頭に付いても op の呼び出しとみなす前置き
PREFIXES = {"sudo", "env", "exec", "time", "command", "nohup", "xargs", "builtin"}
SEPARATORS = {";", "&", "&&", "|", "||", "(", ")", "\n"}
MAX_ITEMS = 8


def split_commands(command):
    """コマンド行を ; && | ( ) で区切った単語の列に分ける。"""
    lex = shlex.shlex(command, posix=True, punctuation_chars=";&|()")
    lex.whitespace_split = True
    lex.commenters = ""
    seg = []
    for tok in lex:
        if tok in SEPARATORS or set(tok) <= set(";&|()"):
            if seg:
                yield seg
            seg = []
        else:
            seg.append(tok)
    if seg:
        yield seg


def refs_in_words(words):
    """単語の列から op:// の参照を取り出す（引用符で囲まれた空白入りの参照もそのまま）。"""
    refs = []
    for w in words:
        i = w.find("op://")
        if i >= 0:
            refs.append(w[i:].rstrip(")`'\""))
    return refs


def op_invocations(command):
    """op を実行している箇所ごとに、op より後ろの引数の列を返す。"""
    found = []
    try:
        segments = list(split_commands(command))
    except ValueError:  # 引用符の閉じ忘れなど
        segments = [command.split()]
    for seg in segments:
        i = 0
        while i < len(seg) and (re.match(r"^\w+=", seg[i]) or seg[i] in PREFIXES or (i > 0 and seg[i].startswith("-") and seg[i - 1] in PREFIXES)):
            i += 1
        if i < len(seg) and os.path.basename(seg[i]) == "op":
            found.append(seg[i + 1 :])
        # 引用符の中に残ったコマンド置換（"$(op read …)"）も拾う
        for tok in seg:
            for m in SUBST.finditer(tok):
                try:
                    words = shlex.split(m.group(1))
                except ValueError:
                    words = m.group(1).split()
                found.append(words[1:])
    # 区切りで拾えない形（例: 置換が単語の頭にない）も念のため
    if not found:
        for m in SUBST.finditer(command):
            found.append(m.group(1).split()[1:])
    return found


def option_value(args, *names):
    """--name value / --name=value / -n value の値を集める。"""
    vals = []
    for i, a in enumerate(args):
        for n in names:
            if a == n and i + 1 < len(args):
                vals.append(args[i + 1])
            elif n.startswith("--") and a.startswith(n + "="):
                vals.append(a[len(n) + 1 :])
    return vals


def refs_in_file(path, cwd):
    """ファイルの中の op:// の参照だけを返す。読めなければ None。"""
    full = path if os.path.isabs(path) else os.path.join(cwd or os.getcwd(), path)
    try:
        with open(os.path.expanduser(full), encoding="utf-8", errors="replace") as f:
            text = f.read(256 * 1024)
    except OSError:
        return None
    refs = []
    for line in text.splitlines():
        i = line.find("op://")
        if i >= 0 and not line.lstrip().startswith("#"):
            refs.append(line[i:].strip().strip("'\""))
    return refs


def describe_items(command, invocations, cwd):
    items = []

    def add(x):
        if x not in items:
            items.append(x)

    for args in invocations:
        for r in refs_in_words(args):
            add(r)
    if not items:
        for r in REF.findall(command):
            add(r)
    for args in invocations:
        if not args:
            continue
        positional = [a for a in args if not a.startswith("-")]
        sub = positional[:2]
        # op item get <名前> / op document get <名前>
        if len(sub) == 2 and sub[0] in ("item", "document") and sub[1] == "get":
            rest = args[args.index("get") + 1 :]
            skip_next = False
            for a in rest:
                if skip_next:
                    skip_next = False
                    continue
                if a.startswith("--") and "=" not in a and a in ("--vault", "--fields", "--format", "--account", "--out-file", "-o", "--otp"):
                    skip_next = a != "--otp"
                    continue
                if a.startswith("-") or a.startswith("op://"):
                    continue
                vault = option_value(args, "--vault")
                add(f"{sub[0]} {a}" + (f"（vault: {vault[0]}）" if vault else ""))
                break
        # op run --env-file / op inject -i
        files = option_value(args, "--env-file") + (option_value(args, "-i", "--in-file") if positional[:1] == ["inject"] else [])
        for path in files:
            refs = refs_in_file(path, cwd)
            if refs is None:
                add(f"{path}（ファイルを読めず）")
            elif refs:
                for r in refs:
                    add(r)
            else:
                add(f"{path}（op:// の参照なし）")
    if not items:
        verb = " ".join(a for a in (invocations[0] if invocations else [])[:2] if not a.startswith("-"))
        items.append(f"op {verb}（項目は特定できず）".replace("op （", "op（"))
    return items


def herdr(*args):
    exe = os.environ.get("HERDR_BIN_PATH") or shutil.which("herdr")
    if not exe:
        return None
    try:
        out = subprocess.run([exe, *args], capture_output=True, text=True, timeout=1.5)
        return json.loads(out.stdout).get("result") if out.returncode == 0 else None
    except Exception:
        return None


def who(cwd):
    """どのペイン（セッション）かを短い名前と詳しい説明で返す。"""
    parts = []
    pane_id = os.environ.get("HERDR_PANE_ID")
    label = None
    if os.environ.get("HERDR_ENV") and pane_id:
        pane = (herdr("pane", "get", pane_id) or {}).get("pane") or {}
        ws_id = pane.get("workspace_id") or os.environ.get("HERDR_WORKSPACE_ID")
        ws = (herdr("workspace", "get", ws_id) or {}).get("workspace") or {} if ws_id else {}
        label = pane.get("label") or pane.get("name") or ws.get("label")
        if label:
            parts.append(label)
        parts.append(pane_id)
        if pane.get("agent"):
            parts.append(pane["agent"])
    worker = os.environ.get("COS_WORKER_ID")
    if worker:
        parts.append(f"依頼 {worker}")
    short = " ".join(parts) or os.path.basename(cwd or os.getcwd())
    return short, label or worker or pane_id or os.path.basename(cwd or os.getcwd())


def notify(title, body, in_herdr):
    if os.environ.get("OP_ACCESS_NOTICE_NO_NOTIFY"):
        return
    devnull = subprocess.DEVNULL
    if in_herdr:
        exe = os.environ.get("HERDR_BIN_PATH") or shutil.which("herdr")
        if exe:
            subprocess.Popen([exe, "notification", "show", title, "--body", body, "--sound", "request"],
                             stdout=devnull, stderr=devnull, start_new_session=True)
    if sys.platform == "darwin":
        tn = shutil.which("terminal-notifier")
        if tn:
            cmd = [tn, "-title", title, "-message", body, "-group", "op-access-notice"]
        else:
            # 文字列は argv で渡す（AppleScript に埋め込まない＝引用符で壊れない）
            cmd = ["osascript", "-e", "on run argv", "-e",
                   "display notification (item 2 of argv) with title (item 1 of argv)",
                   "-e", "end run", title, body]
        subprocess.Popen(cmd, stdout=devnull, stderr=devnull, start_new_session=True)


def main():
    data = json.load(sys.stdin)
    if data.get("tool_name") != "Bash":
        return
    command = (data.get("tool_input") or {}).get("command") or ""
    if not QUICK.search(command):
        return
    invocations = op_invocations(command)
    if not invocations:
        return
    cwd = data.get("cwd") or os.getcwd()
    items = describe_items(command, invocations, cwd)
    shown = items[:MAX_ITEMS] + ([f"ほか {len(items) - MAX_ITEMS} 件"] if len(items) > MAX_ITEMS else [])
    detail, name = who(cwd)
    home = os.path.expanduser("~")
    place = "~" + cwd[len(home):] if cwd.startswith(home) else cwd
    reason = f"[{detail}] が 1Password を読みます: " + ", ".join(shown) + f"（{place}）"
    notify(f"1Password: {name}", ", ".join(shown), bool(os.environ.get("HERDR_ENV")))
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "ask",
            "permissionDecisionReason": reason,
        }
    }, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        pass
    sys.exit(0)
