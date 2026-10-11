import { useState } from "react";
import { api } from "../lib/api";
import { Icon } from "./Icons";

const RPC = "https://api.devnet.solana.com";
async function sha256hex(s: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
export const explorer = (sig: string, cluster = "devnet") => `https://explorer.solana.com/tx/${sig}?cluster=${cluster}`;
type Step = { ok: boolean | null; text: string; link?: string };

/** Trustless check: recompute the hash chain in the browser and compare with the memo stored on Solana. */
export function VerifyPanel() {
  const [steps, setSteps] = useState<Step[]>([]);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    const out: Step[] = [];
    const push = (s: Step) => { out.push(s); setSteps([...out]); };
    try {
      const { genesis, entries, anchors } = await api("/v1/audit");
      push({ ok: true, text: `Downloaded ${entries.length} recorded events (trades, AI decisions, blocked orders).` });
      let prev = genesis, broken = 0;
      const bySeq: Record<number, string> = {};
      for (const e of entries) {
        const h = await sha256hex(`${prev}|${e.seq}|${e.ts}|${e.kind}|${e.msg}`);
        if (h !== e.hash) { broken = e.seq; break; }
        bySeq[e.seq] = h; prev = h;
      }
      push(broken ? { ok: false, text: `Fingerprint chain BROKEN at event #${broken}: history was edited.` }
        : { ok: true, text: `Recomputed all ${entries.length} fingerprints in your browser. Chain is intact.` });
      const a = anchors[anchors.length - 1];
      if (!a) { push({ ok: null, text: "No Solana anchor yet (the anchor job runs every 5 minutes)." }); return; }
      const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTransaction", params: [a.signature, { encoding: "json", maxSupportedTransactionVersion: 0, commitment: "confirmed" }] }) }).then((r) => r.json());
      const m = (r.result?.meta?.logMessages || []).join("\n").match(/(?:vantrel|tripwire):(\d+):([0-9a-f]{64})/);
      if (!m) { push({ ok: false, text: "Could not read the memo from Solana.", link: explorer(a.signature, a.cluster) }); return; }
      push({ ok: true, text: `Read from Solana ${a.cluster}: event #${m[1]} fingerprint ${m[2].slice(0, 16)}…`, link: explorer(a.signature, a.cluster) });
      const match = bySeq[+m[1]] === m[2];
      push({ ok: match, text: match ? `Match. Nothing up to event #${m[1]} has changed since it was anchored.` : `Mismatch at event #${m[1]}: history no longer matches the anchor.` });
    } catch (e: any) {
      push({ ok: false, text: "Verification error: " + e.message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-lg font-semibold text-white">Verify the track record</h3>
        <button className="btn" disabled={busy} onClick={run}><Icon n="search" size={16} />{busy ? "Verifying…" : "Verify it yourself"}</button>
      </div>
      <p className="mt-2 text-sm text-slate-400">Every trade, AI decision and blocked order gets a SHA-256 fingerprint chained to the one before it. The latest fingerprint is written to Solana, so any edit to past history is detectable.</p>
      {steps.length > 0 && (
        <ol className="mt-4 space-y-2" aria-live="polite">
          {steps.map((s, i) => (
            <li key={i} className="flex gap-2 text-sm">
              <Icon n={s.ok === true ? "ok" : s.ok === false ? "bad" : "wait"} size={18} label={s.ok === true ? "Passed" : s.ok === false ? "Failed" : "Pending"}
                className={s.ok === true ? "text-up" : s.ok === false ? "text-down" : "text-slate-400"} />
              <span className="text-slate-300">{s.text} {s.link && <a className="text-sky-300 underline" href={s.link} target="_blank" rel="noreferrer">View on Explorer</a>}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
