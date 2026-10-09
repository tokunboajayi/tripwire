# How we ship (read once, 3 min)

## The one rule
**AJ's computer is the head of uploads.** Everyone pushes branches and opens Pull Requests. Only AJ merges into `main`.

## Your loop
```bash
git clone https://github.com/<owner>/tripwire.git && cd tripwire
git checkout -b data/fixtures          # <seat>/<short-task>
# ...work only in your folders...
git add . && git commit -m "data: add 2025 parity fixtures"
git push -u origin data/fixtures
# open PR on GitHub → fill the template → AJ merges
git checkout main && git pull           # after every merge, before new work
```

## Branch prefixes
`engine/` · `data/` · `ai/` · `mcp/` · `web/` · `landing/` · `docs/`

## Merge windows
AJ merges every **2 hours** (on the even hour) and posts "main updated" in the team chat. Pull right after.
Blocked by someone else's code? Use mocks from `docs/03_BUILD_SPEC.md §9`. Don't wait.

## Rules
- Stay in your folders (see `.github/CODEOWNERS`). Need a change elsewhere? Ask in chat or open a small PR for that owner.
- Small PRs (< 300 lines). One task each.
- **Never commit secrets.** `.env` is ignored. Keys come from AJ by DM.
- No big data files. Raw data stays in `data/raw/` (ignored); commit only small fixtures (< 5 MB).
- `main` must always run. Broken main = everyone stops and fixes it.
- Commit messages: `<seat>: <what>` e.g. `mcp: add get_positions tool`.

## Release tags (AJ)
`demo-1` after Layer 1 · `demo-2` after Layer 2 · `demo-final` at feature freeze. The demo runs from a tag, never from a branch.
