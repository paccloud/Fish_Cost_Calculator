# Issue Tracker: GitHub

Issues and PRDs for this repo live in GitHub Issues for `paccloud/Fish_Cost_Calculator`. Use the `gh` CLI for issue operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --comments`, fetching labels and filtering comments when needed.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply or remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close an issue**: `gh issue close <number> --comment "..."`

Run `gh` from this repository clone so it can infer the repo from `git remote -v`. If running from elsewhere, pass `--repo paccloud/Fish_Cost_Calculator`.

## When a skill says "publish to the issue tracker"

Create a GitHub issue in `paccloud/Fish_Cost_Calculator`.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments` from this repo.
