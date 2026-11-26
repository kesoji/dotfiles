#!/usr/bin/env python3
"""rebase・merge・cherry-pick の途中の `git commit --amend` を止める（PreToolUse / Bash）。

rebase 中の --amend は「いま適用中のコミット」ではなく HEAD（＝土台側の、
すでに公開されているコミット）に当たる。他人のコミットを静かに飲み込むので止める。

2026-11-16 に実際にやった（番頭の v77 を飲み込み、push 前に reset --soft で復旧）。
文章の注意では再現するので、手が動く前に止める。
"""
import json
import os
import os.path
import re
import subprocess
import sys

BUSY = ("rebase-merge", "rebase-apply", "MERGE_HEAD", "CHERRY_PICK_HEAD")


def main() -> int:
    try:
        inp = json.load(sys.stdin)
    except Exception:
        return 0
    if inp.get("tool_name") != "Bash":
        return 0
    cmd = inp.get("tool_input", {}).get("command", "")
    if "--amend" not in cmd:
        return 0
    if not re.search(r"\bgit\b", cmd) or not re.search(r"\bcommit\b", cmd):
        return 0

    cwd = inp.get("cwd") or os.getcwd()
    try:
        gitdir = subprocess.run(
            ["git", "rev-parse", "--absolute-git-dir"],
            cwd=cwd, capture_output=True, text=True, timeout=5, check=True,
        ).stdout.strip()
    except Exception:
        return 0
    if not gitdir:
        return 0

    busy = [n for n in BUSY if os.path.exists(os.path.join(gitdir, n))]
    if not busy:
        return 0

    print(json.dumps({"hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "deny",
        "permissionDecisionReason": (
            f"{busy[0]} があるので rebase／merge の途中です。ここで `git commit --amend` を打つと、"
            "いま適用中のコミットではなく HEAD（土台側の、すでに公開されているコミット）が書き換わり、"
            "他人のコミットを飲み込みます。`git commit` で新しく作るか、"
            "`--continue` で rebase を終わらせてから直してください。"),
    }}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
