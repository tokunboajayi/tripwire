import { useEffect, useRef } from "react";
import { createChart, ColorType, CrosshairMode, type IChartApi, type ISeriesApi, type SeriesMarker, type Time, type UTCTimestamp } from "lightweight-charts";
import { REGIMES, type LiveBar, type Regime } from "../lib/api";

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

/** Daily candles with the regime shaded behind every bar, plus entry/exit markers. `live` moves today's candle in real time. */
export function RegimeChart({ data, markers = [], height = 360, live }: { data: Candle[]; markers?: Marker[]; height?: number; live?: LiveBar }) {
  const el = useRef<HTMLDivElement>(null);
  const series = useRef<ISeriesApi<"Candlestick">>();
  useEffect(() => {
    const last = data[data.length - 1];
    if (!series.current || !live || !last || live.t < last.t) return;
    series.current.update({ time: live.t as UTCTimestamp, open: live.o, high: live.h, low: live.l, close: live.c });
  }, [live, data]);
  useEffect(() => {
    if (!el.current || !data.length) return;
    const c = base(el.current);
    // one full-height area per regime; whitespace where another regime rules → solid bands, not stripes
    for (const r of Object.keys(REGIMES) as Regime[]) {
      const band = c.addAreaSeries({ priceScaleId: "bg", lineVisible: false, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false,
        topColor: REGIMES[r].color + "24", bottomColor: REGIMES[r].color + "24",
        autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 1 } }) });
      band.setData(data.map((d) => (d.regime === r ? { time: d.t as UTCTimestamp, value: 1 } : { time: d.t as UTCTimestamp })));
    }
    c.priceScale("bg").applyOptions({ scaleMargins: { top: 0, bottom: 0 }, visible: false });
    const s = c.addCandlestickSeries({ upColor: "#34D399", downColor: "#F87171", wickUpColor: "#34D399", wickDownColor: "#F87171", borderVisible: false });
    s.setData(data.map((d) => ({ time: d.t as UTCTimestamp, open: d.o, high: d.h, low: d.l, close: d.c })));
    series.current = s;
    const first = data[0].t;
    const ms: SeriesMarker<Time>[] = markers.filter((m) => m.t >= first).sort((a, b) => a.t - b.t).map((m) => ({
      time: day(m.t), position: m.side === "buy" ? "belowBar" : "aboveBar", color: m.side === "buy" ? "#34D399" : "#F5B841",
      shape: m.side === "buy" ? "arrowUp" : "arrowDown", text: m.text,
    }));
    s.setMarkers(ms);
    c.timeScale().setVisibleLogicalRange({ from: Math.max(0, data.length - 180), to: data.length + 3 });
    return () => { series.current = undefined; c.remove(); };
  }, [data, markers]);
  return <div ref={el} style={{ height }} role="img" aria-label="Daily price chart, background shaded by market regime, with entry and exit markers" />;
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
