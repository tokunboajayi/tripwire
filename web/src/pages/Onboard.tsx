import { useState } from "react";
import { api, PROFILES, usd, type Profile, type Strategy } from "../lib/api";
import { LimitsTable, RiskSlider } from "../components/RiskSlider";
import { StrategyPicker } from "../components/StrategyPicker";
import { Logo } from "../components/Logo";
import { Icon } from "../components/Icons";

const GOALS: [number, number][] = [[1000, 6], [5000, 12], [10000, 24]];
const FUNDS = [1000, 5000, 10000, 25000];
const STEPS = ["Risk", "Goal", "Fund"];

/** `/onboard` — 60 seconds: risk slider → goal → paper-fund amount (01_IDEA "The product" §1). */
export default function Onboard({ done, logout }: { done: () => void; logout: () => void }) {
  const [step, setStep] = useState(0);
  const [profile, setProfile] = useState<Profile>("balanced");
  const [strategy, setStrategy] = useState<Strategy>("adaptive");
  const [goal, setGoal] = useState(5000);
  const [months, setMonths] = useState(12);
  const [cash, setCash] = useState(10000);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const valid = [true, goal > 0 && months >= 1 && months <= 120, cash >= 100 && cash <= 1_000_000][step];
  const annual = cash > 0 ? Math.pow(1 + goal / cash, 12 / Math.max(1, months)) - 1 : 0;
  const submit = () => {
    setBusy(true); setError("");
    api("/v1/accounts", "POST", { profile, strategy, goal_amount: goal, goal_months: months, start_cash: cash })
      .then(done).catch((e) => setError(e.message)).finally(() => setBusy(false));
  };

  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-2xl items-center justify-between px-4 py-5">
        <Logo />
        <button className="btn btn-ghost text-sm" onClick={logout}>Sign out</button>
      </header>
      <main className="mx-auto max-w-2xl px-4 pb-16">
        {/* progress */}
        <ol className="mb-8 grid grid-cols-3 gap-2" aria-label="Setup progress">
          {STEPS.map((s, i) => (
            <li key={s} aria-current={i === step ? "step" : undefined}>
              <div className={"h-1.5 rounded-full " + (i <= step ? "bg-wire" : "bg-ink-700")} />
              <div className={"mt-2 text-xs font-semibold " + (i === step ? "text-white" : "text-slate-400")}>{i + 1}. {s}</div>
            </li>
          ))}
        </ol>

        <section key={step} className="card rise p-6 sm:p-8">
          {step === 0 && (
            <>
              <h1 className="text-2xl font-bold text-white sm:text-3xl">How much risk are you comfortable with?</h1>
              <p className="mt-2 text-slate-400">Slide it. These are hard limits enforced in Rust on every single order.</p>
              <div className="mt-8"><RiskSlider value={profile} onChange={setProfile} /></div>
              <p key={profile} className="rise mt-6 rounded-xl bg-ink-850 p-4 text-sm text-slate-300"><b className="text-white">{PROFILES[profile].label}.</b> {PROFILES[profile].blurb}</p>
              <div className="mt-4"><LimitsTable profile={profile} /></div>
              <p className="mt-4 flex items-center gap-2 text-sm text-wire"><Icon n="proof" size={16} />The AI can tighten these limits. It can never loosen them.</p>
              <h2 className="mt-8 text-lg font-semibold text-white">Pick a strategy</h2>
              <p className="mt-1 text-sm text-slate-400">You can switch any time on the dashboard.</p>
              <div className="mt-3"><StrategyPicker value={strategy} onChange={setStrategy} /></div>
            </>
          )}

          {step === 1 && (
            <>
              <h1 className="text-2xl font-bold text-white sm:text-3xl">What's your goal?</h1>
              <p className="mt-2 text-slate-400">We'll track progress on your dashboard. It doesn't change how much risk the AI takes; your slider does.</p>
              <div className="mt-8 flex flex-wrap items-center gap-3 text-lg text-slate-300">
                <span>Grow my money by</span>
                <label className="relative w-36"><span className="sr-only">Goal amount in dollars</span>
                  <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">$</span>
                  <input className="input pl-8 num" type="number" inputMode="numeric" min={1} value={goal || ""} onChange={(e) => setGoal(+e.target.value)} />
                </label>
                <span>in</span>
                <label className="w-24"><span className="sr-only">Months</span>
                  <input className="input num" type="number" inputMode="numeric" min={1} max={120} value={months || ""} onChange={(e) => setMonths(+e.target.value)} />
                </label>
                <span>months</span>
              </div>
              <div className="mt-6 flex flex-wrap gap-2">
                {GOALS.map(([g, m]) => (
                  <button key={g} className={"btn " + (goal === g && months === m ? "border-wire text-wire" : "")} onClick={() => { setGoal(g); setMonths(m); }}>
                    +{usd(g, 0)} in {m} mo
                  </button>
                ))}
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <h1 className="text-2xl font-bold text-white sm:text-3xl">Fund your paper account</h1>
              <p className="mt-2 text-slate-400">Simulated money, traded on live prices. Nothing real is at risk.</p>
              <label className="relative mt-8 block max-w-xs"><span className="sr-only">Amount in dollars</span>
                <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-2xl text-slate-400">$</span>
                <input className="input py-4 pl-9 text-3xl num" type="number" inputMode="numeric" min={100} max={1000000} value={cash || ""} onChange={(e) => setCash(+e.target.value)} />
              </label>
              <div className="mt-4 flex flex-wrap gap-2">
                {FUNDS.map((f) => <button key={f} className={"btn " + (cash === f ? "border-wire text-wire" : "")} onClick={() => setCash(f)}>{usd(f, 0)}</button>)}
              </div>
              <div className="mt-8 rounded-xl border border-ink-700 bg-ink-850 p-5">
                <div className="label">Summary</div>
                <dl className="mt-3 grid grid-cols-3 gap-4 text-sm">
                  <div><dt className="text-slate-400">Risk</dt><dd className="font-semibold text-white">{PROFILES[profile].label}</dd></div>
                  <div><dt className="text-slate-400">Goal</dt><dd className="font-semibold text-white num">+{usd(goal, 0)} / {months} mo</dd></div>
                  <div><dt className="text-slate-400">Funding</dt><dd className="font-semibold text-white num">{usd(cash, 0)}</dd></div>
                </dl>
                {annual > 0.5 && (
                  <p className="mt-4 flex gap-2 text-sm text-wire"><Icon n="alert" size={16} className="mt-0.5" />
                    That goal needs about {(annual * 100).toFixed(0)}% a year. Vantrel is built to protect first, so expect it to take longer.</p>
                )}
              </div>
            </>
          )}

          {error && <p role="alert" className="mt-4 text-sm text-down">{error}</p>}
          <div className="mt-8 flex items-center justify-between gap-3">
            {step > 0 ? <button className="btn btn-ghost" onClick={() => setStep(step - 1)}><Icon n="back" size={16} />Back</button> : <span />}
            {step < 2
              ? <button className="btn btn-primary px-6" disabled={!valid} onClick={() => setStep(step + 1)}>Continue<Icon n="chevron" size={16} /></button>
              : <button className="btn btn-primary px-6" disabled={!valid || busy} onClick={submit}>{busy ? "Funding…" : "Fund & start trading"}</button>}
          </div>
        </section>
      </main>
    </div>
  );
}
