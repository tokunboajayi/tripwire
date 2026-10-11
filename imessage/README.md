# imessage/ — Vantrel in iMessage (Photon Spectrum)
Seat C (Ebere). Vantrel texts you when it acts; you text back to ask or control it.

**Run:** `bun install && bun start` (reads `../.env`). Without `PHOTON_PROJECT_ID`/`PHOTON_PROJECT_SECRET` it runs the
Spectrum **terminal** provider, so you can test the whole flow by typing (phone = `terminal`). Tests: `bun test`.

**Link a phone:** dashboard → Live → "Text me" shows a 4-digit code → text `link 1234` to the Vantrel number.

| Text | Does |
|---|---|
| `status` | Equity, P&L, profile, holdings, goal progress |
| any question | Claude Haiku answers from your live portfolio + why-log (rule-based if no key) |
| `pause` / `resume` | Stop / restart new trades |
| `safer` | One profile step down. **No "riskier" by text** — engine enforces tighten-only |
| `kill`, `sell everything` | Asks for `YES` first |

Alerts: trades, blocked orders, auto-pause, kill, daily digest — bundled, at most one text per poll (`IMESSAGE_POLL_S`, 20s).

**Trust model (enforced in Rust):** the bridge uses `x-internal-token` + `x-act-as`, accepted only for accounts that
linked a phone with a code from their own signed-in dashboard; profile changes arriving that way go through
`set_limits(..., agent=true)` so they can only tighten. The link and every action land in the Solana-anchored audit chain.
