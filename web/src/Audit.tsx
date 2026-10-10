import { useEffect, useState } from "react";
import { api } from "./api";
import { Icon } from "./Icons";

const RPC = "https://api.devnet.solana.com";
async function sha256hex(s: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
}
export const explorer = (sig: string, cluster = "devnet") => `https://explorer.solana.com/tx/${sig}?cluster=${cluster}`;

/** Header badge: how much of the history is anchored on Solana. */
export function AuditBadge() {
  const [s, setS] = useState<any>(null);
  useEffect(() => { const f = () => api("/v1/audit/status").then(setS).catch(() => {}); f(); const t = setInterval(f, 60000); return () => clearInterval(t); }, []);
  if (!s?.signature) return null;
  return <a className="badge" href={explorer(s.signature, s.cluster)} target="_blank" rel="noreferrer" title="Every trade and AI decision is fingerprinted and anchored on Solana"><Icon n="chain" size={16} /><span>Verified on Solana<small>{s.anchored_seq} events anchored</small></span></a>;
}

/** Trustless check: recompute the hash chain in the browser and compare with the memo stored on Solana. */
export function VerifyPanel() {
  const [steps, setSteps] = useState<{ ok: boolean | null; text: string; link?: string }[]>([]), [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true); const out: typeof steps = []; const push = (s: (typeof steps)[0]) => { out.push(s); setSteps([...out]); };
    try {
      const { genesis, entries, anchors } = await api("/v1/audit");
      push({ ok: true, text: `Downloaded ${entries.length} recorded events (trades, AI decisions, blocked orders).` });
      let prev = genesis, broken = 0; const bySeq: Record<number, string> = {};
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
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTransaction", params: [a.signature, { encoding: "json", maxSupportedTransactionVersion: 0, commitment: "confirmed" }] }) }).then(r => r.json());
      const log = (r.result?.meta?.logMessages || []).join("\n"); const m = log.match(/tripwire:(\d+):([0-9a-f]{64})/);
      if (!m) { push({ ok: false, text: "Could not read the memo from Solana.", link: explorer(a.signature, a.cluster) }); return; }
      push({ ok: true, text: `Read directly from Solana ${a.cluster}: event #${m[1]} fingerprint ${m[2].slice(0, 16)}…`, link: explorer(a.signature, a.cluster) });
      const match = bySeq[+m[1]] === m[2];
      push({ ok: match, text: match ? `Match. Nothing up to event #${m[1]} has been changed since it was anchored.` : `Mismatch at event #${m[1]}: our history no longer matches what was anchored.` });
    } catch (e: any) { push({ ok: false, text: "Verification error: " + e.message }); } finally { setBusy(false); }
  };
  return <section className="card"><div className="card-head"><h3>Don't trust our track record. Verify it.</h3><button className="btn primary" disabled={busy} onClick={run}><Icon n="search" size={16} />{busy ? "Verifying…" : "Verify it yourself"}</button></div>
    <p className="fine">Every trade, AI decision and blocked order gets a SHA-256 fingerprint that includes the one before it. The latest fingerprint is written to Solana. Change any past event and every fingerprint after it changes, and it no longer matches the blockchain.</p>
    {steps.length > 0 && <ol className="verify" aria-live="polite">{steps.map((s, i) => <li key={i} className={s.ok === true ? "ok" : s.ok === false ? "bad" : "wait"}><Icon n={s.ok === true ? "ok" : s.ok === false ? "bad" : "wait"} label={s.ok === true ? "Passed" : s.ok === false ? "Failed" : "Pending"} /><span>{s.text} {s.link && <a href={s.link} target="_blank" rel="noreferrer">View on Solana Explorer <Icon n="external" size={14} /></a>}</span></li>)}</ol>}
  </section>;
}
