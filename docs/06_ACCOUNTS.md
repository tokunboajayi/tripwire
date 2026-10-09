# 06 · Accounts & Keys
| Service | For | Env | Priority |
|---|---|---|---|
| Alpaca (paper) | crypto prices, news, paper orders, stock replay data | APCA_* | Required |
| Anthropic | Regime + Thesis agents | ANTHROPIC_API_KEY | Required |
| Auth0 | public sign-in | AUTH0_*, VITE_AUTH0_CLIENT_ID | Required (cut → dev login) |
| GitHub | repo, Pages, collaborators | — | Required |
| Vultr | host engine + agents | — | Required (cut → laptop demo) |
| GoDaddy | domain | — | Nice |
| Tiger Data | Postgres/timescale for candles + equity | DATABASE_URL | Optional (sponsor) |
| ElevenLabs | voice "switched to Breakout brain" alerts | ELEVENLABS_API_KEY | Optional (sponsor) |
| Google Cloud / Gemini | alt LLM for agents if Gemini prize | GOOGLE_API_KEY | Optional (sponsor) |

Checks before coding: `curl` one Alpaca crypto bar request, one Anthropic call, Auth0 SPA + API created, `.env` in `.gitignore`.
**Keys never go in the repo or in chat.**
