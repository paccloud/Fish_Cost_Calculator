# Issue tracker: GitHub

Issues and PRDs for this repo live as GitHub issues on `paccloud/Fish_Cost_Calculator`.

## Tooling

- **Local Claude Code / terminal sessions:** use the `gh` CLI (it infers the repo from `git remote -v`).
- **Claude Code on the web / remote sessions:** the `gh` CLI is not available — use the GitHub MCP server tools (`mcp__github__issue_write`, `mcp__github__list_issues`, `mcp__github__issue_read`, etc.) instead. The conventions below map 1:1.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."` (heredoc for multi-line bodies), or `issue_write` with `method: create`.
- **Read an issue**: `gh issue view <number> --comments`, or `issue_read`.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments` with appropriate `--label`/`--state` filters, or `list_issues`.
- **Comment on an issue**: `gh issue comment <number> --body "..."`, or `add_issue_comment`.
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`, or `issue_write` with `method: update`.
- **Close**: `gh issue close <number> --comment "..."`, or `issue_write` (always set a state reason).

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Read the issue with its comments.
