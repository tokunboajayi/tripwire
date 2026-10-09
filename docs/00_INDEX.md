# Tripwire — Doc Index (start here)

**Set your risk. Fund it. AI trades for you — switching between 3 trading brains to fit the market, with a Rust safety layer it can't override.**
Hacklanta '26 · Fintech track · team of 4 · paper trading on live crypto.

## Read in this order
| # | Doc | What it's for | Who |
|---|---|---|---|
| 01 | `01_IDEA.md` | Problem, product, 3 brains, claims, classifications | everyone, 5 min |
| 02 | `02_BACKTEST.md` | **Real** results (run Oct 9, 2026) + caveats | everyone + pitcher |
| 03 | `03_BUILD_SPEC.md` | Architecture, data, engine loop, API, prompts | builders |
| 04 | `04_BUILD_PLAN.md` | Seats, layers, hour map, cut list, demo script, Q&A | everyone |
| 05 | `05_PROMPTS.md` | Copy-paste Claude Code prompts per seat | builders |
| 06 | `06_ACCOUNTS.md` | Keys to grab | owner |
| 07 | `07_REPO_AND_PAGES.md` | Repo, collaborators, README + landing prompts, sponsors | owner + D |
| — | `../backtest/` | Working Python backtest, results, charts | B |

## Kick off (first 30 minutes)
1. AJ: edit teammates into `setup_repo.ps1` → double-click `SETUP_REPO.bat` (creates GitHub repo, invites team).
2. Everyone: accept invite, clone, read `CONTRIBUTING.md`, copy `.env.example` → `.env` (AJ DMs keys).
3. Seats: Owner = Engine · B = Data & Strategy · C = AI & MCP · D = Product (04).
4. Each seat opens Claude Code → **P0**, then their first prompt (05).
5. Checkpoint H12: Layer 1 live end-to-end.

## The 3 numbers to remember
- 2025–26: market **−27.5%** → Tripwire **+0.4% to +1.5%**
- Max drawdown 4 years: Tripwire **−17%** (conservative) vs buy & hold **−76%**
- Win rate **46%** vs break-even **36%** → a real edge, not a lucky streak (98 trades — small sample, say so)
