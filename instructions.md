# GitHub Plugin

The GitHub plugin owns every interaction with github.com in Cadence: pull requests, reviews, repo discovery, cloning, and the git log sidebar.

## Routes

The HTTP handlers live in this plugin's `routes.js`. The manifest keeps the legacy absolute paths under `/api/github/*` and `/api/pull-request` so existing UI, scripts, and AI routes keep working while ownership is plugin-based.

| Surface              | Current path                          | Purpose                                    |
|----------------------|---------------------------------------|--------------------------------------------|
| List PRs             | `GET /api/github/pulls`               | Used by the PR center tab                  |
| PR detail            | `GET /api/github/pulls/detail`        | Header + body of a single PR               |
| PR files             | `GET /api/github/pulls/files`         | Changed files with patches                 |
| PR comments          | `GET /api/github/pulls/comments`      | Issue + review comments merged             |
| PR timeline          | `GET /api/github/pulls/timeline`      | Events, reviews, commits                   |
| Add comment          | `POST /api/github/pulls/comment`      | Write a comment (gated)                    |
| Submit review        | `POST /api/github/pulls/review`       | APPROVE / CHANGES_REQUESTED / COMMENT      |
| Create PR            | `POST /api/pull-request`              | Open a PR; same permission gate            |
| Image proxy          | `GET /api/github/image`               | Proxies private repo image attachments     |
| User repos           | `GET /api/github/user-repos`          | Repos modal "Clone from GitHub"            |
| Clone                | `POST /api/github/clone`              | Clones into a local folder                 |
| Repo info            | `GET /api/github/repo-info`           | Parses origin remote for owner/repo        |
| Who I am             | `GET /api/github/me`                  | The login the token belongs to             |
| Review requests      | `GET /api/github/review-requests`     | Open PRs across repos asking for my review |
| PR checks            | `GET /api/github/pulls/checks`        | Check runs and statuses on the PR's head   |
| PR diff              | `GET /api/github/pulls/diff`          | The unified diff, capped; for reading      |
| Merge PR             | `POST /api/github/pulls/merge`        | Squash / merge / rebase (gated)            |

## In Cadence 3.0

Everything GitHub is the plugin's own surface (rail icon "GitHub"): pull requests as a bento, one pull request as a dashboard with review, checks and merge, an AI review and summary that read the diff through the routes above and never post by themselves, "Awaiting you" across repos, Ask over any period, and your repositories to clone. The app has no pull-request view of its own any more.

## Contributions

- `prProvider` describes the full PR surface so the generic Backlog/PR tab can render GitHub PRs without hard-coding the routes.
- `repoSources` adds the "Clone from GitHub" entry in the repos modal.
- `commitLinkers` turns `#123` in commit messages into a link to `pull/123`.
- `configKeys` and `sensitiveKeys` declare this plugin's config ownership and secret scrubbing.

## Configuration

Reads `GitHubPAT`. This key is persisted in `dashboard/plugins/github/config.json` and merged into `/api/config` for backward compatibility.

## Workflow rules (owned by this plugin)

### Creating pull requests

Use the built-in script to create PRs on GitHub. NEVER use the `gh` CLI.

```bash
# Bash: push + create PR in one shot (auto-detects branch, generates title)
powershell.exe -ExecutionPolicy Bypass -NoProfile -Command "./dashboard/plugins/github/scripts/Push-AndPR.ps1 -Repo 'MyRepo'"

# With a custom title and target branch
powershell.exe -ExecutionPolicy Bypass -NoProfile -Command "./dashboard/plugins/github/scripts/Push-AndPR.ps1 -Repo 'MyRepo' -Title 'Add feature X' -Description 'Details' -TargetBranch 'develop'"
```

`New-PullRequest.ps1` gives finer-grained control over title, description, and target branch.

If the Azure DevOps plugin is also installed, `AB#<id>` references in commit messages and branch names auto-link the PR to the matching work item -- that crosswalk is documented in the Azure DevOps plugin.

### Plugin scripts

Under `./dashboard/plugins/github/scripts/`:

| Script | Purpose |
|---|---|
| `Push-AndPR.ps1 -Repo '<name>'` | Push + open a PR in one shot |
| `New-PullRequest.ps1 -Repo '<name>' -Title '...' -Description '...'` | PR with custom body |

Call with `powershell.exe -ExecutionPolicy Bypass -NoProfile -File "./dashboard/plugins/github/scripts/<Name>.ps1"` from bash.

## Issues, Activity, Actions, Releases, Inbox (3.0)

Everything below is on the same server that opened your shell (`$CADENCE_API`, fallback `http://127.0.0.1:3800`). GET routes are read-only; the POST routes go through the permission gate and need the `x-cadence-token` header (the scripts attach it).

| Route | What |
|---|---|
| `GET /api/github/issues?repo&state&labels&assignee` | Issues (never pull requests): number, title, state, assignees, labels, milestone, comments, dates |
| `GET /api/github/issues/detail?repo&number` | One issue: body, comments, linked pull requests, history events |
| `POST /api/github/issues/comment {repo, number, body}` | Comment on an issue (Markdown, @mentions) |
| `POST /api/github/issues/update {repo, number, state?, stateReason?, title?, body?, labels?, assignees?}` | Edit an issue |
| `POST /api/github/issues/create {repo, title, body?, labels?, assignees?}` | Open an issue |
| `POST /api/github/issues/start {repo, number}` | Cut `feature/issue-N-slug` (or `fix/...` for bugs) in the local checkout and assign the issue to you |
| `GET /api/github/labels?repo` / `GET /api/github/collaborators?repo` | Labels and people of the repository |
| `GET /api/github/activity?repo&days` | Commits and events over the last days |
| `GET /api/github/team?repo` | Per person: commits, open and merged PRs, reviews asked, issues held, last seen (30 days) |
| `GET /api/github/actions/runs?repo&branch&limit` | Workflow runs and workflows |
| `GET /api/github/actions/run?repo&id` | One run with jobs, steps, and the log tail of every failed job |
| `POST /api/github/actions/rerun {repo, id, failedOnly?}` | Re-run a workflow, or only its failed jobs |
| `GET /api/github/releases?repo` | Releases and tags |
| `GET /api/github/releases/delta?repo&from&to` | Commits and pull requests since a tag (default: the latest release) |
| `POST /api/github/releases/create {repo, tag, name?, body?, draft?, prerelease?, target?}` | Cut a release |
| `GET /api/github/notifications?all` | Your inbox |
| `POST /api/github/notifications/read {id | all}` | Mark read |
| `POST /api/github/pulls/update {repo, number, title?, body?, state?, base?, labels?, assignees?, reviewers?}` | Edit a pull request |
| `POST /api/github/pulls/review {repo, number, event, body?, comments?: [{path, line, side?, body}]}` | A review, with inline comments on the current head |
| `GET /api/github/pulls/commits?repo&number` | The commits of a pull request |
| `GET /api/github/branches?repo` | Branches on GitHub, the default, the local branch and whether it is pushed |
| `GET /api/github/branch-commits?repo&head&base` | Commits on a local branch beyond a base (local git) |
| `POST /api/github/pulls/create {repo, title, body?, head?, base?, draft?, push?, reviewers?, labels?}` | Open a pull request; `push: true` pushes the local branch first |

### Scripts (PowerShell, run from the Cadence directory)

Every script takes the configured repository name in `-Repo` and prints JSON. Read: `Get-Me`, `Get-ReviewRequests`, `Get-PullRequests`, `Get-PullRequest` (everything about one PR; `-NoDiff` to skip the diff), `Get-PullRequestDiff`, `Get-PullRequestChecks`, `Get-Branches`, `Get-Issues`, `Get-Issue`, `Get-Labels`, `Get-Collaborators`, `Get-Activity`, `Get-Team`, `Get-ActionRuns`, `Get-ActionRun`, `Get-Releases`, `Get-ReleaseDelta`, `Get-Notifications`, `Get-UserRepos`. Write (gated): `Add-PullRequestComment`, `Review-PullRequest` (`-Event APPROVE|REQUEST_CHANGES|COMMENT`, `-Body`, `-Comments '<json array>'` for inline comments), `Update-PullRequest`, `Merge-PullRequest`, `New-PullRequest` (`-Push`, `-Draft`, `-Reviewers`, `-Labels`), `Push-AndPR`, `New-Issue`, `Add-IssueComment`, `Update-Issue`, `Start-Issue`, `Restart-ActionRun`, `New-Release`, `Clear-Notifications`.

Rules for an AI working through these scripts: read first, write only what the user asked for, never post on the user's behalf without being told to, and say which script you ran.
