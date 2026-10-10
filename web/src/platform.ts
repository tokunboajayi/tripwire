// Detect Mac / Windows / iPhone so one codebase looks native on each. Override for demos: ?platform=mac|windows|ios
export type Platform = "ios" | "mac" | "windows" | "android" | "other";
export function detectPlatform(): Platform {
  const q = new URLSearchParams(location.search).get("platform");
  if (q && ["ios", "mac", "windows", "android", "other"].includes(q)) return q as Platform;
  const ua = navigator.userAgent, iPadOS = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  if (/iPhone|iPad|iPod/.test(ua) || iPadOS) return "ios";
  if (/Android/.test(ua)) return "android";
  if (/Mac/.test(ua)) return "mac";
  if (/Win/.test(ua)) return "windows";
  return "other";
}
export const platform = detectPlatform();
export const standalone = matchMedia("(display-mode: standalone)").matches || (navigator as any).standalone === true;
document.documentElement.dataset.platform = platform;
if (standalone) document.documentElement.dataset.standalone = "1";

// Desktop install prompt (Chrome / Edge on Mac and Windows). iPhone uses Share -> Add to Home Screen.
let deferred: any = null; const subs = new Set<() => void>();
addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferred = e; subs.forEach((f) => f()); });
export const canInstall = () => !!deferred;
export const onInstallable = (f: () => void) => { subs.add(f); return () => subs.delete(f); };
export async function install() { if (!deferred) return false; deferred.prompt(); const r = await deferred.userChoice; deferred = null; return r.outcome === "accepted"; }
