import { useEffect, useRef } from "react";
import { createChart, ColorType, IChartApi } from "lightweight-charts";
import { REGIME_COLOR } from "./api";

const base = (el: HTMLElement, h: number) => createChart(el, {
  height: h, layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#9aa3b2", fontFamily: "Inter" },
  grid: { vertLines: { visible: false }, horzLines: { color: "rgba(140,150,170,.12)" } }, rightPriceScale: { borderVisible: false },
  timeScale: { borderVisible: false }, crosshair: { mode: 0 }, autoSize: true, localization: { locale: "en-US" },
});

/** Daily candles with the regime shaded behind every bar. */
export function RegimeChart({ data }: { data: any[] }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!el.current || !data.length) return;
    const c = base(el.current, 340);
    const bg = c.addHistogramSeries({ priceScaleId: "bg", lastValueVisible: false, priceLineVisible: false });
    c.priceScale("bg").applyOptions({ scaleMargins: { top: 0, bottom: 0 }, visible: false });
    bg.setData(data.map(d => ({ time: d.t, value: 1, color: d.regime ? REGIME_COLOR[d.regime] + "2e" : "rgba(0,0,0,0)" })));
    const s = c.addCandlestickSeries({ upColor: "#2bb673", downColor: "#e5484d", wickUpColor: "#2bb673", wickDownColor: "#e5484d", borderVisible: false });
    s.setData(data.map(d => ({ time: d.t, open: d.o, high: d.h, low: d.l, close: d.c })));
    c.timeScale().fitContent();
    return () => c.remove();
  }, [data]);
  return <div ref={el} className="chart" />;
}

/** Multi-line chart: series = {name, color, points:[[t,v],...]} */
export function Lines({ series, height = 260, pct = false }: { series: { name: string; color: string; points: [number, number][] }[]; height?: number; pct?: boolean }) {
  const el = useRef<HTMLDivElement>(null); const chart = useRef<IChartApi>();
  useEffect(() => {
    if (!el.current) return;
    chart.current?.remove(); const c = base(el.current, height); chart.current = c;
    for (const s of series) {
      const l = c.addLineSeries({ color: s.color, lineWidth: s.name.includes("hold") ? 1 : 2, title: s.name, priceFormat: pct ? { type: "custom", formatter: (v: number) => v.toFixed(0) + "%" } : undefined });
      const seen = new Set<number>();
      l.setData(s.points.filter(([t]) => !seen.has(t) && seen.add(t)).map(([t, v]) => ({ time: t as any, value: v })));
    }
    c.timeScale().fitContent();
    return () => { c.remove(); chart.current = undefined; };
  }, [JSON.stringify(series.map(s => s.points.length)), series.length]);
  return <div ref={el} className="chart" style={{ height }} />;
}
