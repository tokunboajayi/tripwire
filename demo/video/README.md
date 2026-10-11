# Vantrel demo video

A ~2 minute, 1080p, ElevenLabs-narrated walkthrough of the whole project, recorded from the **real app**: animated title cards, a visible cursor, highlight boxes and burned-in captions (so it works on mute).

Scenes and narration live in `script.mjs`. Edit a line there and rebuild.

## Make it
Requirements: Node 20+, `ffmpeg` on PATH (Windows: `winget install ffmpeg`).
```
cd demo/video
npm install
npx playwright-core@1.56.1 install chromium
# voice: your ElevenLabs key (never commit it); target: the live site or a local engine
ELEVENLABS_API_KEY=sk_... U=https://getwiththeprogram.study node build.mjs
```
PowerShell: `$env:ELEVENLABS_API_KEY="sk_..."; $env:U="https://getwiththeprogram.study"; node build.mjs`

Output: `out/vantrel-demo.mp4`.

- No key: a captions-only video.
- Narration is cached in `out/audio/`. Lines whose text you change in `script.mjs` are regenerated automatically; unchanged lines cost no new credits.
- `SKIP_RECORD=1` re-mixes the existing recording without re-recording.
- Optional settings:
  - `ELEVENLABS_VOICE` (voice id)
  - `ELEVENLABS_MODEL` (default `eleven_multilingual_v2`)
  - `CHROME` (path to a Chrome binary)

## How the voice flows without pauses
Each scene's clicks are paced inside its narration (`narrate.mjs` measures each line with ffprobe). Browser recordings drift from wall-clock time, so each scene stamps a 16px colour code in the corner of the frame. `build.mjs`:
1. Finds each scene in the recording from those stamps.
2. Speeds up or slows each scene's footage slightly (0.75x to 1.3x) so it lasts exactly as long as its line.
3. Lays the lines back to back with a short breath between them.

ElevenLabs gets each line's previous and next text, so the read sounds like one take. The build prints a gap report; "No gaps over 1s" means it flows.
