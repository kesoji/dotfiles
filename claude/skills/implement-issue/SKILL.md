---
name: implement-issue
description: >
  Autonomously implements a GitHub issue end-to-end.
  Fetches issue details, creates a git worktree + branch, tracks progress in a /tmp temp file,
  iterates on implementation + tests until passing, then creates a PR via create-pr skill.
  Trigger on: "#614を実装して", "implement issue 614", "issue #523 を対応して", etc.
  Communicate with the user in Japanese throughout execution.
---

# implement-issue

Autonomously implement a GitHub issue from start to PR. Communicate with the user in Japanese.

## Workflow

### 1. Fetch Issue

```bash
gh issue view {NUMBER} --json number,title,body,labels,comments
```

Understand the goal, requirements, and acceptance criteria.
If the issue body contains a design document, follow it as the primary spec.

### 2. Create Worktree + Branch

Generate a slug from the issue title (lowercase, hyphen-separated, max 40 chars; translate non-English titles to English):

```bash
REPO_ROOT=$(git rev-parse --show-toplevel)
REPO_NAME=$(basename "$REPO_ROOT")
SLUG="<translated-english-slug>"
BRANCH="issue/{NUMBER}-${SLUG}"
WORKTREE_PATH="${REPO_ROOT}/../${REPO_NAME}-issue-{NUMBER}"

git worktree add "$WORKTREE_PATH" -b "$BRANCH"
```

**Copy gitignored env files into the worktree.** A fresh worktree only contains tracked files, so `.env` (which is gitignored) is missing — tools like Prisma, dotenv, and local DB connections will silently fall back to `.env.example` or fail. Copy every `.env*` real file (excluding `*.example` / `*.sample`) from the original repo root into the same relative path in the worktree:

```bash
cd "$REPO_ROOT"
# Find tracked-dir .env files that git ignores (the real local ones), excluding examples/samples
find . -type d -name node_modules -prune -o -type f -name ".env*" \
  ! -name "*.example" ! -name "*.sample" -print | while read -r f; do
    git check-ignore -q "$f" || continue           # only copy files git actually ignores
    mkdir -p "$WORKTREE_PATH/$(dirname "$f")"
    cp "$f" "$WORKTREE_PATH/$f"
    echo "copied $f"
done
cd "$WORKTREE_PATH"
```

If the user prefers the worktree to track edits to env back to the main checkout, symlink instead of copy (`ln -s "$REPO_ROOT/$f" "$WORKTREE_PATH/$f"`); default to copy to keep the worktree isolated. If no `.env` is found but a `.env.example` exists, warn the user that local config may be missing.

Install dependencies per the project (e.g. `pnpm install`, `npm install`, `bundle install`, `go mod download`).

### 3. Detect Project Conventions

Before implementing, detect how this specific project expects work to be done. Inspect:

- `CLAUDE.md` (root and nested) — authoritative rules, commands, and pointers to project-specific skills
- `.claude/skills/` — list available project-specific skills and note which apply to this issue
- `package.json` `scripts`, `Makefile`, `Taskfile.yml`, `justfile` — real commands for typecheck / lint / test / e2e
- `go.mod`, `Cargo.toml`, `pyproject.toml`, `Gemfile` — language/toolchain
- Existing test files near the code you'll touch — naming conventions and framework (vitest/jest/pytest/go test/rspec/etc.)
- E2E test location (often `tests/e2e/`, `e2e/`, `cypress/`, `playwright/`)

Record the detected commands and conventions at the top of the Progress File (Step 4). If you cannot detect a required command (e.g. no typecheck script exists), ask the user in Japanese rather than guessing.

### 4. Create Progress File

```
/tmp/{REPO_NAME}-issue-{NUMBER}-progress.md
```

Structure:
```markdown
# Issue #{NUMBER}: {TITLE}

## Detected Conventions
- Typecheck: <command or "none">
- Lint/Format: <command or "none">
- Unit tests: <command + framework>
- E2E tests: <command + location or "none">
- Relevant project skills: <list>

## Plan
- [ ] task 1
- [ ] task 2

## Iteration History

### Iteration 1
- Done:
- Result:
- Next:
```

Update this file continuously. Never commit it to git.

### 5. Implement

Work inside the worktree. Follow `CLAUDE.md` rules if present.
Invoke the project-specific skills identified in Step 3 when they apply.

### 6. Write Tests

**Writing tests is MANDATORY. Do NOT skip this step.**

1. **Check the issue body for a test plan.** If present, use it as the primary guide.
2. **Unit tests**: Write unit tests for new/changed business logic using the framework detected in Step 3. Follow the project's existing file-naming convention (colocated `*.test.ts`, sibling `*_test.go`, `tests/test_*.py`, etc.).
3. **E2E tests**: If the change affects user-facing behavior (UI, new pages, form flow), add or update E2E specs in the location detected in Step 3. Match existing patterns.
4. **What to test** — cover at minimum:
   - Happy path for each new feature
   - Error/edge cases explicitly mentioned in the issue
   - Server-side validation (if added)

### 7. Run Tests & Iterate (max 5 attempts)

**Running tests is MANDATORY. Execute ALL applicable steps in order. Do NOT skip any step that was detected in Step 3.**

Run in order, using the commands recorded in the Progress File:

1. **Type check**
2. **Lint / Format**
3. **Unit tests** — the tests you wrote + existing related tests
4. **E2E tests** — the specs you wrote + existing related specs. If no E2E tests apply, record this explicitly in the Progress File.

**On failure:** Record error in Progress File (as Iteration N), analyze root cause, fix, retry.
**After 5 failures:** Report status and progress file path to user in Japanese, then stop.
**On success:** Write completion note to Progress File, proceed to Step 8.

### 8. Create PR

Use the `create-pr` skill. Include:
- Summary of implemented feature
- `Closes #{NUMBER}`
- Test result summary

### 9. Cleanup

After PR creation, ask the user (in Japanese) whether to remove the worktree:
```bash
git worktree remove "$WORKTREE_PATH"
```
