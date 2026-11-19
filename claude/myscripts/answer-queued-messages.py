#!/usr/bin/env python3
"""Stop フック: ターンの途中で届いたユーザーのメッセージに、最後の報告で答えさせる。

作業の途中（ツール呼び出しの合間）にユーザーが送ったメッセージは、会話ログに
attachment.type == "queued_command"（origin.kind == "human"）として残る。
モデルが途中のテキストで答えても、そのあとの長い報告に押し流されて
ユーザーの目に入らない（「回答はどこ？流れちゃった？」）。

このフックは、いまのターンにそうしたメッセージがあれば、1回だけターンの終わりを止め、
「最後の報告の先頭で答え直す」ように理由を返す。止めたメッセージは delivery_id で
記録するので、同じメッセージで2回は止めない（答え直したあとの Stop は通る）。

壊れていても Claude Code を止めない（例外はすべて通す＝exit 0・何も出さない）。
"""
import json
import os
import sys

STATE_DIR = os.path.expanduser("~/.claude/state/answer-queued-messages")


def is_turn_start(rec):
    """ユーザーが打ってターンを始めた記録か（ツールの結果・メタ・途中のメッセージは除く）。"""
    if rec.get("type") != "user" or rec.get("isMeta") or rec.get("isSidechain"):
        return False
    msg = rec.get("message") or {}
    content = msg.get("content")
    if isinstance(content, str):
        return not content.startswith("<")  # <command-…>・<system-reminder> などの差し込みは除く
    if isinstance(content, list):
        kinds = {c.get("type") for c in content if isinstance(c, dict)}
        if "tool_result" in kinds:
            return False
        texts = [c.get("text", "") for c in content if isinstance(c, dict) and c.get("type") == "text"]
        return bool(texts) and not all(t.startswith("<") for t in texts)
    return False


def queued_in_current_turn(lines):
    found = []
    for line in lines:
        try:
            rec = json.loads(line)
        except Exception:
            continue
        if is_turn_start(rec):
            found = []
            continue
        att = rec.get("attachment")
        if (
            isinstance(att, dict)
            and att.get("type") == "queued_command"
            and (att.get("origin") or {}).get("kind") == "human"
            and att.get("prompt")
        ):
            found.append(att)
    return found


def main():
    data = json.load(sys.stdin)
    path = data.get("transcript_path")
    session = data.get("session_id") or "unknown"
    if not path or not os.path.exists(path):
        return
    with open(path, encoding="utf-8") as f:
        lines = f.readlines()
    queued = queued_in_current_turn(lines)
    if not queued:
        return

    os.makedirs(STATE_DIR, exist_ok=True)
    state_path = os.path.join(STATE_DIR, f"{session}.json")
    try:
        with open(state_path, encoding="utf-8") as f:
            seen = set(json.load(f))
    except Exception:
        seen = set()

    new = [q for q in queued if (q.get("delivery_id") or q.get("source_uuid") or q["prompt"]) not in seen]
    if not new:
        return

    for q in new:
        seen.add(q.get("delivery_id") or q.get("source_uuid") or q["prompt"])
    tmp = state_path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(sorted(seen), f)
    os.replace(tmp, state_path)

    quoted = "\n".join(f"- 「{q['prompt'].strip()[:300]}」" for q in new)
    reason = (
        "このターンの途中で、ユーザーから次のメッセージが届いています。\n"
        f"{quoted}\n"
        "途中のテキストで答えていても、そのあとの報告に押し流されてユーザーには見えていません。"
        "最後の報告の先頭で、このメッセージへの答え（または対応したこと）を書き直してから終わってください。"
        "（このフックは同じメッセージで1回だけ止めます）"
    )
    print(json.dumps({"decision": "block", "reason": reason}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        pass
    sys.exit(0)
