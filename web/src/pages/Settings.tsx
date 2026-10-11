import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { VerifyPanel } from "../components/Audit";
import { Icon } from "../components/Icons";

/** `/settings` — talk to your portfolio (MCP), voice alerts, iMessage, audit trail. */
export default function Settings({ acct, cfg, voice, toggleVoice, reload, logout }: { acct: any; cfg: any; voice: boolean; toggleVoice: () => void; reload: () => void; logout: () => void }) {
  const mcp = useMemo(() => JSON.stringify({ mcpServers: { vantrel: { command: "python", args: ["mcp/server.py"], env: { VANTREL_API: location.origin, VANTREL_MCP_TOKEN: acct.mcp_token } } } }, null, 2), [acct.mcp_token]);
  const [copied, setCopied] = useState(false);
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
        <section className="card flex items-center justify-between gap-4 p-6">
          <div><h2 className="text-lg font-semibold text-white">Voice alerts</h2><p className="mt-1 text-sm text-slate-400">Hear it when the AI switches brains or a thesis breaks.</p></div>
          <button className={"btn " + (voice ? "border-up text-up" : "")} aria-pressed={voice} onClick={toggleVoice}><Icon n={voice ? "volume" : "mute"} size={16} />{voice ? "On" : "Off"}</button>
        </section>
      )}

      <TextMe linked={!!acct.imessage} number={cfg.imessage_number} reload={reload} />
      <VerifyPanel />

      <section className="card p-6">
        <button className="btn btn-danger" onClick={logout}><Icon n="logout" size={16} />Sign out</button>
      </section>
    </div>
  );
}

function TextMe({ linked, number, reload }: { linked: boolean; number: string; reload: () => void }) {
  const [code, setCode] = useState<string | null>(null);
  useEffect(() => { if (linked) setCode(null); }, [linked]);
  return (
    <section className="card p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-white">iMessage alerts</h2>
        {linked ? <button className="btn" onClick={() => api("/v1/accounts/me/unlink-phone", "POST").then(reload)}>Stop texts</button>
          : !code && <button className="btn" onClick={() => api("/v1/accounts/me/link-code", "POST").then((r: any) => setCode(r.code))}><Icon n="connect" size={16} />Text me</button>}
      </div>
      <p className="mt-2 text-sm text-slate-400">Vantrel texts you when it trades, blocks an order or pauses. A text can make it safer, never riskier.</p>
      {code && <p className="mt-3 text-sm text-slate-300">Text <code className="rounded bg-ink-800 px-1.5 py-0.5 font-mono text-white">link {code}</code>{number && <> to <b className="text-white">{number}</b></>} within 10 minutes.</p>}
    </section>
  );
}
