# 07 · GitHub Repo, README, Team & Landing Page

## Repo setup (AJ's computer = head of uploads)
1. One-time setup is done: the repo exists, teammates are invited, `main` is protected. (The `setup_repo.ps1` / `SETUP_REPO.bat` bootstrap scripts were removed after use.)
2. Teammates accept the invite, clone, and follow `CONTRIBUTING.md`.
3. Fill teammate handles in `.github/CODEOWNERS` and the README team table (first PR).

## Upload flow (see CONTRIBUTING.md)
- Teammates: branch `<seat>/<task>` → push → Pull Request.
- AJ: reviews + merges every 2 hours, posts "main updated", tags `demo-1`, `demo-2`, `demo-final`.
- Only AJ merges to `main`. Secrets never in git; AJ DMs keys.

## Claude Code prompt — repo README
```
Write README.md for Tripwire using docs/01_IDEA.md, docs/02_BACKTEST.md, docs/03_BUILD_SPEC.md. Plain language, short sentences, no jargon without a 3-word explanation. Sections:
1 One-line pitch + screenshot placeholder + live link
2 The problem (3 bullets)
3 How it works (3 brains + shield table, AI chooses / Rust enforces)
4 Results (v2 table + equity_curves_v2.png + caveats, never claim guaranteed returns)
5 Architecture diagram (mermaid: web → engine(Rust) ↔ agents(Python) → Alpaca)
6 Tech stack
7 Run locally (docker compose up, .env.example)
8 Built with (sponsor list below, one line each on how we used it)
9 Team (4 names, seat, GitHub handle)
10 Disclaimer: paper trading only, not financial advice.
Under 200 lines.
```

## Claude Code prompt — GitHub Pages landing
```
Create landing/index.html (single file, Tailwind CDN, dark, mobile-first) for Tripwire. Hero: "Set your risk. AI trades. Rust keeps it safe." CTA buttons: Try the demo (<app url>), GitHub. Sections: problem (Robinhood vs robo vs bots vs Tripwire table), 3 brains + shield cards, results chart (embed equity_curves_v2.png) with honest caveat line, how-it-works diagram, Built With sponsor strip, team, disclaimer footer. Then add .github/workflows/pages.yml to deploy landing/ to GitHub Pages.
```
Enable: Settings → Pages → Source: GitHub Actions.

## "Built with" strip (only list what you actually used)
| Sponsor | How Tripwire uses it |
|---|---|
| Auth0 | user sign-in, JWT-verified API |
| Vultr | hosts the Rust engine + AI agents |
| GoDaddy | custom domain |
| Tiger Data | time-series storage for candles and equity (if adopted) |
| ElevenLabs | voice alerts when the brain switches (if adopted) |
| Google Cloud / Gemini | (if adopted) |
| Alpaca, Anthropic Claude | market data / paper broker; AI agents |
Cox Automotive, Adobe, Mercedes-Benz R&D, Red Bull, OLIPOP, Saxbys, Solana, MLH: thank in footer only — don't claim usage you didn't build.

## Devpost checklist
Title · tagline · 2–3 min video · screenshots (dashboard, brain switch, gate block, backtest) · track: **Fintech** · sponsor prizes opted in · repo link · live link · team.
