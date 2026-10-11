// Inline SVG icons (Lucide paths, MIT). Decorative by default; pass `label` when the icon carries meaning alone.
const P: Record<string, string> = {
  overview: "M3 3h7v9H3z|M14 3h7v5h-7z|M14 12h7v9h-7z|M3 16h7v5H3z",
  activity: "M8 6h13|M8 12h13|M8 18h13|M3 6h.01|M3 12h.01|M3 18h.01",
  proof: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z|m9 12 2 2 4-4",
  connect: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
  pause: "M6 4h4v16H6z|M14 4h4v16h-4z",
  play: "m6 3 14 9-14 9V3z",
  power: "M12 2v10|M18.4 6.6a9 9 0 1 1-12.77.04",
  sell: "M22 17l-8.5-8.5-5 5L2 7|M16 17h6v-6",
  trade: "M22 7l-8.5 8.5-5-5L2 17|M16 7h6v6",
  alert: "m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z|M12 9v4|M12 17h.01",
  logout: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4|m16 17 5-5-5-5|M21 12H9",
  volume: "M11 5 6 9H2v6h4l5 4V5z|M15.54 8.46a5 5 0 0 1 0 7.07|M19.07 4.93a10 10 0 0 1 0 14.14",
  mute: "M11 5 6 9H2v6h4l5 4V5z|m22 9-6 6|m16 9 6 6",
  chain: "M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71|M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71",
  search: "M11 3a8 8 0 1 0 0 16 8 8 0 0 0 0-16z|m21 21-4.3-4.3",
  ok: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z|m9 12 2 2 4-4",
  bad: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z|m15 9-6 6|m9 9 6 6",
  wait: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z|M12 6v6l4 2",
  refresh: "M3 12a9 9 0 0 1 15-6.7L21 8|M21 3v5h-5|M21 12a9 9 0 0 1-15 6.7L3 16|M3 21v-5h5",
  download: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4|m7 10 5 5 5-5|M12 15V3",
  note: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z|M14 2v6h6|M16 13H8|M16 17H8",
  external: "M15 3h6v6|M10 14 21 3|M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6",
  bolt: "M13 2 3 14h9l-1 8 10-12h-9l1-8z",
  phone: "M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z|M12 18h.01",
  laptop: "M4 5h16v10H4z|M2 19h20",
  shieldOff: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z|M9 9l6 6|M15 9l-6 6",
  chevron: "m9 18 6-6-6-6",
  // brain glyphs
  mr: "M2 12h2|M20 12h2|M4 12c2.5-7 5.5-7 8 0s5.5 7 8 0",
  trend: "M3 17l6-6 4 4 8-8|M15 7h6v6",
  breakout: "M3 9h18|M4 19l5-5 3 3 7-11",
  shield: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z|M8.5 12h7",
  back: "m15 18-6-6 6-6",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z|M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z",
  target: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z|M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12z|M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
  wallet: "M20 12V8H6a2 2 0 0 1 0-4h12v4|M4 6v12a2 2 0 0 0 2 2h14v-4|M18 12a2 2 0 0 0 0 4h4v-4z",
  check: "M20 6 9 17l-5-5",
  chart: "M3 3v18h18|m19 9-5 5-4-4-3 3",
};
export type IconName = keyof typeof P;
export function Icon({ n, size = 18, label, className }: { n: IconName; size?: number; label?: string; className?: string }) {
  return <svg className={"shrink-0 " + (className ?? "")} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
    strokeLinecap="round" strokeLinejoin="round" aria-hidden={label ? undefined : true} role={label ? "img" : undefined} aria-label={label}>
    {P[n].split("|").map((d, i) => <path key={i} d={d} />)}</svg>;
}
