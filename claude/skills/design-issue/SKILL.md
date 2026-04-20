---
name: design-issue
description: Create a technical design document for a GitHub issue and write it to the issue body. Trigger when the user mentions an issue number with a design request, e.g. "#612の設計をして", "design issue #100", "issue #100 を設計して". Reads the issue title, body, and comments, investigates related code, then writes a design doc back to the issue body via gh CLI.
---

## Workflow

### 1. Fetch issue information

```bash
# Issue details (title, body, labels)
gh issue view <NUMBER> --json title,body,labels,assignees

# Comments (mandatory - contains important context)
gh issue view <NUMBER> --comments
```

### 2. Investigate related code

Identify the scope of impact from the issue content and read related code.
- Use Grep/Glob to search for relevant files
- Use Agent for deeper exploration when needed

### 3. Write design document

Write the design document **in Japanese**. Omit sections that are not relevant.

```markdown
## 背景・目的

(Summarize and organize the original issue description)

## 現状の仕組み

(Explain current behavior based on code investigation)

## 技術的アプローチ

(Implementation approach and strategy)

### 変更対象ファイル

- `path/to/file.ts` - Summary of changes
- ...

## 実装ステップ

1. Step 1
2. Step 2
3. ...

## 影響範囲・注意点

(Side effects, migrations, impact on existing features)

## 未決事項

(Open questions, items requiring user confirmation)
```

### 4. Write to issue body

If the original body has content, append the design after a `---` separator. If empty, write the design directly.

```bash
gh issue edit <NUMBER> --body "$(cat <<'EOF'
(preserve original body content if any)

---

# 設計

(design document content)
EOF
)"
```

### Important rules

- Present the design to the user for review BEFORE writing to the issue
- Preserve any useful information from the original body
- Ask the user if the issue number is not specified
