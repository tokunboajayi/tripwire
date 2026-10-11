// Minimal path router: / · /onboard · /app · /replay · /backtest · /settings (spec §10).
import { useEffect, useState } from "react";

export type Route = "/" | "/onboard" | "/app" | "/replay" | "/backtest" | "/settings";
const ROUTES: Route[] = ["/", "/onboard", "/app", "/replay", "/backtest", "/settings"];
const current = (): Route => (ROUTES.includes(location.pathname as Route) ? (location.pathname as Route) : "/");

export function navigate(to: Route, replace = false) {
  if (location.pathname === to) return;
  history[replace ? "replaceState" : "pushState"](null, "", to);
  dispatchEvent(new PopStateEvent("popstate"));
  scrollTo({ top: 0 });
}

export function usePath(): Route {
  const [p, setP] = useState(current);
  useEffect(() => {
    const f = () => setP(current());
    addEventListener("popstate", f);
    return () => removeEventListener("popstate", f);
  }, []);
  return p;
}
