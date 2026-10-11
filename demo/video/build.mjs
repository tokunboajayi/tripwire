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
const voiced = SCENES.filter((s) => existsSync(`out/audio/${s.id}.mp3`));
const args = ["-y", "-i", "out/raw/demo.webm"];
voiced.forEach((s) => args.push("-i", `out/audio/${s.id}.mp3`));
const enc = ["-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-r", "30", "-movflags", "+faststart"];
if (voiced.length) {
  // each line starts 0.4s into its scene; amix keeps lines at full volume (normalize=0)
  const f = voiced.map((s, i) => `[${i + 1}:a]adelay=${Math.round((marks[s.id] + 0.4) * 1000)}|${Math.round((marks[s.id] + 0.4) * 1000)}[a${i}]`).join(";");
  args.push("-filter_complex", `${f};${voiced.map((_, i) => `[a${i}]`).join("")}amix=inputs=${voiced.length}:normalize=0[aout]`,
    "-map", "0:v", "-map", "[aout]", ...enc, "-c:a", "aac", "-b:a", "192k", "-t", String(marks.__end));
} else {
  args.push(...enc, "-an", "-t", String(marks.__end));
  console.log("No narration audio (set ELEVENLABS_API_KEY): making a captions-only video.");
}
args.push("out/vantrel-demo.mp4");
run("ffmpeg", args);
console.log("\nDone: demo/video/out/vantrel-demo.mp4");
