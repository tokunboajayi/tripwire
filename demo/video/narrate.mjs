// Narration for each scene via ElevenLabs -> out/audio/<id>.mp3 and out/timing.json (seconds per scene).
// No ELEVENLABS_API_KEY? Durations are estimated and the video is captions-only.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { SCENES } from "./script.mjs";

const KEY = process.env.ELEVENLABS_API_KEY, VOICE = process.env.ELEVENLABS_VOICE || "21m00Tcm4TlvDq8ikWAM";
const MODEL = process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2"; // best quality for a recorded video
mkdirSync("out/audio", { recursive: true });
const timing = {};
for (const s of SCENES) {
  const f = `out/audio/${s.id}.mp3`;
  if (KEY && !existsSync(f)) {
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE}`, {
      method: "POST", headers: { "xi-api-key": KEY, "content-type": "application/json", accept: "audio/mpeg" },
      body: JSON.stringify({ text: s.say, model_id: MODEL, voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.25 } }),
    });
    if (!r.ok) { console.error(`ElevenLabs ${r.status} for ${s.id}: ${await r.text()}`); process.exit(1); }
    writeFileSync(f, Buffer.from(await r.arrayBuffer()));
  }
  const dur = existsSync(f)
    ? parseFloat(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString())
    : s.say.split(/\s+/).length / 2.6; // ~156 wpm when there's no audio
  timing[s.id] = +(dur + 1.2).toFixed(2); // breathing room between scenes
  console.log(`${s.id.padEnd(10)} ${timing[s.id]}s ${existsSync(f) ? "voice" : "(no voice)"}`);
}
writeFileSync("out/timing.json", JSON.stringify(timing, null, 2));
