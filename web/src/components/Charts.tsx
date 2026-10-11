import { useEffect, useRef, useState } from "react";
import { createChart, ColorType, CrosshairMode, type IChartApi, type ISeriesApi, type UTCTimestamp } from "lightweight-charts";
import { BRAINS, REGIMES, type LiveBar, type Regime } from "../lib/api";

const base = (el: HTMLElement): IChartApi => createChart(el, {
  // attribution is in the app footer (lightweight-charts NOTICE)
  layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#94A3B8", fontFamily: "Inter, system-ui, sans-serif", attributionLogo: false },
  grid: { vertLines: { visible: false }, horzLines: { color: "rgba(148,163,184,.08)" } },
  rightPriceScale: { borderVisible: false },
  timeScale: { borderVisible: false },
  crosshair: { mode: CrosshairMode.Normal },
  autoSize: true,
  localization: { locale: "en-US" },
});

export type Candle = { t: number; o: number; h: number; l: number; c: number; regime: Regime | null };
export type Marker = { t: number; side: "buy" | "sell"; text: string };
const day = (t: number) => (Math.floor(t / 86400) * 86400) as UTCTimestamp;
const BAND_ALPHA = "38"; // ~22%: loud enough to read the regime at a glance

type Seg = { from: number; to: number; regime: Regime }; // bar index range [from, to)
/** Consecutive runs of the same regime, as bar-index ranges. */
function segments(bars: Candle[]): Seg[] {
  const out: Seg[] = [];
  let start = 0;
  for (let i = 1; i <= bars.length; i++) {
    if (i < bars.length && bars[i].regime === bars[start].regime) continue;
    const r = bars[start].regime;
    if (r) out.push({ from: start, to: i, regime: r });
    start = i;
  }
  return out;
}

/**
 * Daily candles over regime bands, with entry/exit markers.
 * Bands are painted as a layer behind the transparent chart canvas, positioned on exact bar coordinates,
 * so alternating regimes never smear into each other; wide bands carry their brain's name.
 * `live` moves today's candle in real time; `stream` appends replay bars one by one without rebuilding the chart.
 */
export function RegimeChart({ data, markers = [], height = 380, live, stream }: { data: Candle[]; markers?: Marker[]; height?: number; live?: LiveBar; stream?: Candle[] }) {
  const el = useRef<HTMLDivElement>(null);
  const series = useRef<ISeriesApi<"Candlestick">>();
  const chart = useRef<IChartApi>();
  const shown = useRef(0); // stream bars already drawn
  const segsRef = useRef<Seg[]>([]);
  const [rects, setRects] = useState<{ x: number; w: number; regime: Regime }[]>([]);

  const all = stream && data.length ? [...data, ...stream.filter((b) => b.t > data[data.length - 1].t)] : data;
  segsRef.current = segments(all);

  const paint = () => {
    const c = chart.current, box = el.current;
    if (!c || !box) return;
    const ts = c.timeScale();
    const right = box.clientWidth - c.priceScale("right").width();
    const out: { x: number; w: number; regime: Regime }[] = [];
    // logicalToCoordinate only resolves whole bar indices (fractions return 0), so offset by half a bar ourselves
    const spacing = ts.options().barSpacing;
    const edge = (i: number) => { const x = ts.logicalToCoordinate(i as any); return x == null ? null : x - spacing / 2; };
    for (const g of segsRef.current) {
      const a = edge(g.from), last = edge(g.to - 1);
      if (a == null || last == null) continue;
      const b = last + spacing;
      const x = Math.max(0, a), x2 = Math.min(right, b);
      if (x2 > x) out.push({ x, w: x2 - x, regime: g.regime });
    }
    setRects(out);
  };

  // build once per dataset
  useEffect(() => {
    if (!el.current || !data.length) return;
    const c = base(el.current);
    chart.current = c;
    const big = data[data.length - 1].c >= 1000; // whole dollars for BTC/ETH, cents for cheaper coins
    const s = c.addCandlestickSeries({ upColor: "#34D399", downColor: "#F87171", wickUpColor: "#34D399", wickDownColor: "#F87171", borderVisible: false,
      priceFormat: { type: "price", precision: big ? 0 : 2, minMove: big ? 1 : 0.01 } });
    s.setData(data.map((d) => ({ time: d.t as UTCTimestamp, open: d.o, high: d.h, low: d.l, close: d.c })));
    series.current = s;
    shown.current = 0;
    c.timeScale().setVisibleLogicalRange({ from: Math.max(0, data.length - 180), to: data.length + 3 });
    let raf = 0;
    const schedule = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(paint); };
    c.timeScale().subscribeVisibleLogicalRangeChange(schedule);
    const ro = new ResizeObserver(schedule); ro.observe(el.current);
    schedule();
    return () => { cancelAnimationFrame(raf); ro.disconnect(); series.current = undefined; chart.current = undefined; c.remove(); };
  }, [data]);

  // replay: append new bars
  useEffect(() => {
    if (!series.current || !stream) return;
    if (stream.length < shown.current) shown.current = 0; // a new replay started
    for (const b of stream.slice(shown.current)) {
      if (data.length && b.t <= data[data.length - 1].t) continue;
      series.current.update({ time: b.t as UTCTimestamp, open: b.o, high: b.h, low: b.l, close: b.c });
    }
    if (stream.length > shown.current) chart.current?.timeScale().scrollToRealTime();
    shown.current = stream.length;
    requestAnimationFrame(paint);
  }, [stream, data]);

  // trade markers
  useEffect(() => {
    if (!series.current || !all.length) return;
    const first = all[0].t;
    series.current.setMarkers(markers.filter((m) => m.t >= first).sort((a, b) => a.t - b.t).map((m) => ({
      time: day(m.t), position: m.side === "buy" ? "belowBar" : "aboveBar", color: m.side === "buy" ? "#34D399" : "#F5B841",
      shape: m.side === "buy" ? "arrowUp" : "arrowDown", text: m.text,
    })));
  }, [data, stream, markers]);

  // live: move today's candle
  useEffect(() => {
    const last = data[data.length - 1];
    if (!series.current || !live || !last || live.t < last.t || stream) return;
    series.current.update({ time: live.t as UTCTimestamp, open: live.o, high: live.h, low: live.l, close: live.c });
  }, [live, data, stream]);

  return (
    <div className="relative" style={{ height }}>
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        {rects.map((r, i) => (
          <div key={i} className="absolute inset-y-0" style={{ left: r.x, width: r.w, background: REGIMES[r.regime].color + BAND_ALPHA }}>
            {r.w > 72 && <span className="absolute left-1.5 top-1.5 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider" style={{ color: REGIMES[r.regime].color, background: "#0B1220cc" }}>{BRAINS[REGIMES[r.regime].brain].label}</span>}
          </div>
        ))}
      </div>
      <div ref={el} className="relative h-full" role="img" aria-label="Daily price chart over regime bands labelled with the active brain, with entry and exit markers" />
    </div>
  );
}

/** Equity curve with the starting balance as a reference line. */
export function EquityChart({ points, start, height = 200 }: { points: [number, number][]; start: number; height?: number }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!el.current) return;
    const c = base(el.current);
    const last = points[points.length - 1]?.[1] ?? start;
    const up = last >= start;
    const a = c.addAreaSeries({ lineColor: up ? "#34D399" : "#F87171", topColor: (up ? "#34D399" : "#F87171") + "40", bottomColor: "transparent", lineWidth: 2,
      priceFormat: { type: "custom", formatter: (v: number) => "$" + v.toLocaleString("en-US", { maximumFractionDigits: 0 }) } });
    const seen = new Set<number>();
    a.setData(points.filter(([t]) => !seen.has(t) && !!seen.add(t)).map(([t, v]) => ({ time: t as UTCTimestamp, value: v })));
    a.createPriceLine({ price: start, color: "#64748B", lineStyle: 2, lineWidth: 1, axisLabelVisible: false, title: "start" });
    c.timeScale().fitContent();
    return () => c.remove();
  }, [points, start]);
  return <div ref={el} style={{ height }} role="img" aria-label="Portfolio value over time" />;
}

/** Multi-line % chart: series = {name, color, points:[[t, pct]]}. */
export function Lines({ series, height = 280 }: { series: { name: string; color: string; points: [number, number][]; thin?: boolean }[]; height?: number }) {
  const el = useRef<HTMLDivElement>(null);
  const key = series.map((s) => s.name + s.points.length).join("|");
  useEffect(() => {
    if (!el.current) return;
    const c = base(el.current);
    for (const s of series) {
      const l = c.addLineSeries({ color: s.color, lineWidth: s.thin ? 1 : 2, title: s.name, priceFormat: { type: "custom", formatter: (v: number) => v.toFixed(0) + "%" } });
      const seen = new Set<number>();
      l.setData(s.points.filter(([t]) => !seen.has(t) && !!seen.add(t)).map(([t, v]) => ({ time: t as UTCTimestamp, value: v })));
    }
    c.timeScale().fitContent();
    return () => c.remove();
  }, [key]);
  return <div ref={el} style={{ height }} role="img" aria-label={"Line chart: " + series.map((s) => s.name).join(", ")} />;
}
