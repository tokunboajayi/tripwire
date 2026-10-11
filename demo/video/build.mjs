// One command: narration (ElevenLabs) -> recording -> out/vantrel-demo.mp4 with the voice laid under each scene.
//   cd demo/video && npm install && ELEVENLABS_API_KEY=... U=https://getwiththeprogram.study node build.mjs
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { SCENES } from "./script.mjs";

const run = (cmd, args) => execFileSync(cmd, args, { stdio: "inherit" });
run(process.execPath, ["narrate.mjs"]);
if (!process.env.SKIP_RECORD) run(process.execPath, ["record.mjs"]); // SKIP_RECORD=1 reuses out/raw/demo.webm

// The recording's clock drifts from wall time, so read each scene's real start from the colour stamps in the video.
const FPS = 20, raw = execFileSync("ffmpeg", ["-v", "error", "-i", "out/raw/demo.webm", "-vf", `crop=8:8:4:4,scale=1:1,fps=${FPS}`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: 1 << 26 });
const stampAt = (f) => {
  const [r, g, bl] = [raw[f * 3], raw[f * 3 + 1], raw[f * 3 + 2]];
  if (r < 200 || g > 70) return -1;
  const i = Math.round((bl - 10) / 22);
  return i >= 0 && i <= SCENES.length && Math.abs(bl - (i * 22 + 10)) <= 9 ? i : -1;
};
const found = {};
for (let f = 0, last = -1; (f + 1) * 3 + 2 < raw.length; f++) {
  const i = stampAt(f);
  if (i < 0 || i !== stampAt(f + 1) || found[i] != null || (found[i - 1] ?? -1) > f / FPS) continue; // held 2 frames, in order
  found[i] = f / FPS; last = i;
}
const wall = JSON.parse(readFileSync("out/marks.json", "utf8"));
const marks = {};
SCENES.forEach((s, i) => { marks[s.id] = found[i] ?? wall[s.id]; });
marks.__end = (found[SCENES.length] ?? wall.__end) + 0.6;
console.log("scene starts in the video:", Object.entries(marks).map(([k, v]) => `${k}=${v.toFixed(1)}s`).join(" "), `(${Object.keys(found).length}/${SCENES.length + 1} stamps found)`);
// Retime each scene's footage to its narration (0.75x-1.3x, too little to notice), then lay the lines back to back:
// the voice never waits for the picture, so there are no dead pauses.
const len = (f) => parseFloat(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString());
const timingEst = JSON.parse(readFileSync("out/timing.json", "utf8"));
const BREATH = 0.3, LEAD = 0.2;
const seg = SCENES.map((s, i) => {
  const a = marks[s.id], b = i + 1 < SCENES.length ? marks[SCENES[i + 1].id] : marks.__end;
  const voice = existsSync(`out/audio/${s.id}.mp3`) ? `out/audio/${s.id}.mp3` : null;
  const spoken = voice ? len(voice) : timingEst[s.id] - 0.35;
  const target = LEAD + spoken + (i + 1 < SCENES.length ? BREATH : 1.5);
  const k = Math.min(1.3, Math.max(0.75, target / (b - a)));
  return { s, a, b, voice, spoken, k, out: (b - a) * k };
});
let t = 0; for (const g of seg) { g.at = t; t += g.out; }
const gaps = seg.slice(0, -1).map((g) => [g.s.id, g.out - LEAD - g.spoken]).filter(([, x]) => x > 1);
console.log(gaps.length ? "Gaps over 1s (scene footage too long even at 1.3x): " + gaps.map(([id, x]) => `after ${id} ${x.toFixed(1)}s`).join(", ") : "No gaps over 1s: the narration flows.");

const voiced = seg.filter((g) => g.voice);
const args = ["-y", "-i", "out/raw/demo.webm"];
voiced.forEach((g) => args.push("-i", g.voice));
const enc = ["-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-r", "30", "-movflags", "+faststart"];
const vf = seg.map((g, i) => `[0:v]trim=start=${g.a.toFixed(3)}:end=${g.b.toFixed(3)},setpts=(PTS-STARTPTS)*${g.k.toFixed(4)}[v${i}]`).join(";")
  + ";" + seg.map((_, i) => `[v${i}]`).join("") + `concat=n=${seg.length}:v=1:a=0[vout]`;
if (voiced.length) {
  const af = voiced.map((g, i) => { const ms = Math.round((g.at + LEAD) * 1000); return `[${i + 1}:a]adelay=${ms}|${ms}[a${i}]`; }).join(";");
  args.push("-filter_complex", `${vf};${af};${voiced.map((_, i) => `[a${i}]`).join("")}amix=inputs=${voiced.length}:normalize=0[aout]`,
    "-map", "[vout]", "-map", "[aout]", ...enc, "-c:a", "aac", "-b:a", "192k", "-t", t.toFixed(2));
} else {
  args.push("-filter_complex", vf, "-map", "[vout]", ...enc, "-an");
  console.log("No narration audio (set ELEVENLABS_API_KEY): making a captions-only video.");
}
args.push("out/vantrel-demo.mp4");
run("ffmpeg", args);
console.log("\nDone: demo/video/out/vantrel-demo.mp4");
