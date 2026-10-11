import { useEffect, useMemo, useState } from "react";
import { api, speak } from "../lib/api";
import { VerifyPanel } from "../components/Audit";
import { Icon } from "../components/Icons";

/** `/settings` — talk to your portfolio (MCP), voice alerts, audit trail. */
export default function Settings({ acct, cfg, voice, toggleVoice, reload, logout }: { acct: any; cfg: any; voice: boolean; toggleVoice: () => void; reload: () => void; logout: () => void }) {
  const mcp = useMemo(() => JSON.stringify({ mcpServers: { vantrel: { command: "python", args: ["mcp/server.py"], env: { VANTREL_API: location.origin, VANTREL_MCP_TOKEN: acct.mcp_token } } } }, null, 2), [acct.mcp_token]);
  const [copied, setCopied] = useState(false);
  const [voiceTest, setVoiceTest] = useState(""); // "", "busy", "ok", or the ElevenLabs error
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold text-white">Settings</h1>

      <section className="card p-6">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-white"><Icon n="bolt" size={18} className="text-violet-300" />Talk to your portfolio (Claude Desktop)</h2>
        <p className="mt-2 text-sm text-slate-400">Add this to Claude Desktop's MCP config, then ask: <i>"Why did you sell ETH?"</i> or <i>"How am I doing against my goal?"</i> Read-only: Claude can explain, never trade.</p>
        <div className="relative mt-4">
          <pre className="overflow-x-auto rounded-xl border border-ink-700 bg-ink-950 p-4 text-xs text-slate-300">{mcp}</pre>
          <button className="btn absolute right-2 top-2 px-3 py-1.5 text-xs" onClick={() => navigator.clipboard.writeText(mcp).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })}>{copied ? "Copied" : "Copy"}</button>
        </div>
      </section>

      {cfg.voice && (
        <section className="card flex flex-wrap items-center justify-between gap-4 p-6">
          <div><h2 className="text-lg font-semibold text-white">Voice alerts</h2><p className="mt-1 text-sm text-slate-400">Hear it when the AI switches brains or a thesis breaks.</p></div>
          <div className="flex shrink-0 gap-2">
            <button className="btn" disabled={voiceTest === "busy"} onClick={async () => { setVoiceTest("busy"); setVoiceTest((await speak("Vantrel voice is working.", true)) ?? "ok"); }}>{voiceTest === "busy" ? "Testing…" : "Test"}</button>
            <button className={"btn " + (voice ? "border-wire text-wire" : "")} aria-pressed={voice} onClick={toggleVoice}><Icon n={voice ? "volume" : "mute"} size={16} />{voice ? "On" : "Off"}</button>
          </div>
          {voiceTest && voiceTest !== "busy" && <p role="status" className={"w-full text-xs " + (voiceTest === "ok" ? "text-up" : "text-down")}>{voiceTest === "ok" ? "Voice OK: ElevenLabs answered." : voiceTest}</p>}
        </section>
      )}

      <VerifyPanel />

      <section className="card p-6">
        <button className="btn btn-danger" onClick={logout}><Icon n="logout" size={16} />Sign out</button>
      </section>
    </div>
  );
}
