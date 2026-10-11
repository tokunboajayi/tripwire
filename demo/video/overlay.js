// Injected into every page while recording: animated title cards, captions, highlight boxes and a visible cursor.
// Same "Wire" look as the app (amber #F5B841, IBM Plex Sans + JetBrains Mono, hairline grid).
(() => {
  if (window.__vt) return;
  const css = `
  #vt-layer{position:fixed;inset:0;z-index:2147483000;pointer-events:none;font-family:"IBM Plex Sans",system-ui,sans-serif}
  [data-caption],[data-offline-banner]{display:none!important}
  .vt-card{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;padding:0 12vw;
    background:radial-gradient(60% 70% at 15% 20%,rgba(245,184,65,.16),transparent 60%),
      linear-gradient(rgba(148,163,184,.06) 1px,transparent 1px) 0 0/48px 48px,
      linear-gradient(90deg,rgba(148,163,184,.06) 1px,transparent 1px) 0 0/48px 48px,#05070D;
    animation:vt-fade .5s ease-out both}
  .vt-card.out{animation:vt-fadeout .45s ease-in both}
  .vt-kicker{font:600 22px/1 "JetBrains Mono",monospace;letter-spacing:.32em;text-transform:uppercase;color:#F5B841;display:flex;align-items:center;gap:18px}
  .vt-kicker svg{width:44px;height:44px}
  .vt-title{margin-top:34px;font-weight:800;font-size:112px;line-height:1.02;letter-spacing:-.03em;color:#fff}
  .vt-title .w{display:inline-block;opacity:0;transform:translateY(40px);animation:vt-word .7s cubic-bezier(.2,.8,.2,1) forwards}
  .vt-accent{color:#F5B841}
  .vt-wire{margin-top:46px;height:3px;width:62vw;background:linear-gradient(90deg,#F5B841,rgba(245,184,65,.5),transparent);transform-origin:left;transform:scaleX(0);animation:vt-grow 1.1s .9s cubic-bezier(.2,.8,.2,1) forwards;box-shadow:0 0 18px #F5B841}
  .vt-built{margin-top:40px;font:500 22px "JetBrains Mono",monospace;color:#94A3B8;opacity:0;animation:vt-fade .8s 1.8s forwards;letter-spacing:.06em}
  .vt-built b{color:#E2E8F0;font-weight:600}
  .vt-cap{position:absolute;left:50%;bottom:56px;transform:translateX(-50%);width:min(1240px,86vw);background:rgba(5,7,13,.9);
    border:1px solid rgba(245,184,65,.35);border-radius:12px;padding:22px 30px 24px 92px;color:#F1F5F9;font-size:30px;line-height:1.35;
    box-shadow:0 20px 60px rgba(0,0,0,.6);animation:vt-up .45s ease-out both;backdrop-filter:blur(6px)}
  .vt-cap:before{content:"";position:absolute;left:0;right:0;top:0;height:2px;background:linear-gradient(90deg,#F5B841,transparent);transform-origin:left;animation:vt-grow .8s ease-out both}
  .vt-eq{position:absolute;left:30px;top:28px;display:flex;gap:4px;align-items:flex-end;height:28px;color:#F5B841}
  .vt-eq i{display:block;width:5px;height:100%;background:currentColor;border-radius:2px;transform-origin:bottom;animation:vt-eq .9s ease-in-out infinite}
  .vt-eq i:nth-child(2){animation-delay:-.3s}.vt-eq i:nth-child(3){animation-delay:-.6s}.vt-eq i:nth-child(4){animation-delay:-.15s}
  .vt-hl{position:absolute;border:3px solid #F5B841;border-radius:14px;box-shadow:0 0 0 9999px rgba(5,7,13,.45),0 0 30px rgba(245,184,65,.55);
    animation:vt-pop .45s cubic-bezier(.2,.8,.2,1) both;transition:all .5s cubic-bezier(.2,.8,.2,1)}
  .vt-hl span{position:absolute;left:-3px;top:-46px;background:#F5B841;color:#05070D;font:700 18px "JetBrains Mono",monospace;padding:8px 14px;border-radius:8px;white-space:nowrap;letter-spacing:.04em}
  .vt-cur{position:absolute;width:26px;height:26px;margin:-13px 0 0 -13px;border-radius:50%;border:3px solid #F5B841;background:rgba(245,184,65,.25);
    box-shadow:0 0 16px rgba(245,184,65,.7);transition:transform .08s linear}
  .vt-cur.down{transform:scale(.7)}
  .vt-ripple{position:absolute;width:20px;height:20px;margin:-10px 0 0 -10px;border-radius:50%;border:3px solid #F5B841;animation:vt-ripple .6s ease-out forwards}
  @keyframes vt-fade{from{opacity:0}to{opacity:1}} @keyframes vt-fadeout{to{opacity:0}}
  @keyframes vt-word{to{opacity:1;transform:none}} @keyframes vt-grow{to{transform:scaleX(1)}}
  @keyframes vt-up{from{opacity:0;transform:translate(-50%,24px)}to{opacity:1;transform:translate(-50%,0)}}
  @keyframes vt-eq{0%,100%{transform:scaleY(.3)}50%{transform:scaleY(1)}}
  @keyframes vt-pop{from{opacity:0;transform:scale(1.08)}to{opacity:1;transform:none}}
  @keyframes vt-ripple{to{transform:scale(3.2);opacity:0}}`;
  const mark = `<svg viewBox="0 0 32 32" fill="none"><rect width="32" height="32" rx="7" fill="#0B1220" stroke="#1E293B"/><path d="M6 10.5h20" stroke="#F5B841" stroke-width="2.4" stroke-linecap="round"/><path d="M6 23l6.5-6.5 4.5 4.5L26 12" stroke="#34D399" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  let layer, cap, cur, hls = [];
  const ensure = () => {
    if (layer && document.body.contains(layer)) return;
    const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);
    layer = document.createElement("div"); layer.id = "vt-layer"; document.body.appendChild(layer);
    cur = document.createElement("div"); cur.className = "vt-cur"; cur.style.left = "50%"; cur.style.top = "60%"; layer.appendChild(cur);
    addEventListener("mousemove", (e) => { cur.style.left = e.clientX + "px"; cur.style.top = e.clientY + "px"; }, true);
    addEventListener("mousedown", (e) => { cur.classList.add("down"); const r = document.createElement("div"); r.className = "vt-ripple"; r.style.left = e.clientX + "px"; r.style.top = e.clientY + "px"; layer.appendChild(r); setTimeout(() => r.remove(), 700); }, true);
    addEventListener("mouseup", () => cur.classList.remove("down"), true);
  };
  const words = (t, d0) => t.split(" ").map((w, i) => `<span class="w" style="animation-delay:${(d0 + i * 0.09).toFixed(2)}s">${w}</span>`).join(" ");
  window.__vt = {
    card({ kicker, title, accent, built }) {
      ensure(); this.clearCard();
      const el = document.createElement("div"); el.className = "vt-card";
      const n = title.split(" ").length;
      el.innerHTML = `<div class="vt-kicker">${mark}${kicker}</div><div class="vt-title">${words(title, 0.25)}<br><span class="vt-accent">${words(accent, 0.35 + n * 0.09)}</span></div><div class="vt-wire"></div>` +
        (built ? `<div class="vt-built">Built with <b>Rust</b> · <b>Claude</b> · <b>ElevenLabs</b> · <b>Solana</b> · <b>Auth0</b> · <b>TradingView</b> charts</div>` : "");
      layer.insertBefore(el, cur);
    },
    clearCard() { ensure(); layer.querySelectorAll(".vt-card").forEach((c) => { c.classList.add("out"); setTimeout(() => c.remove(), 460); }); },
    caption(text) { ensure(); cap?.remove(); cap = document.createElement("div"); cap.className = "vt-cap"; cap.innerHTML = `<div class="vt-eq"><i></i><i></i><i></i><i></i></div>${text}`; layer.insertBefore(cap, cur); },
    clearCaption() { cap?.remove(); cap = null; },
    highlight(selector, label, pad = 10) {
      ensure(); this.clearHighlights();
      const t = typeof selector === "string" ? document.querySelector(selector) : selector;
      if (!t) return false;
      const r = t.getBoundingClientRect(), h = document.createElement("div"); h.className = "vt-hl";
      Object.assign(h.style, { left: r.left - pad + "px", top: r.top - pad + "px", width: r.width + pad * 2 + "px", height: r.height + pad * 2 + "px" });
      if (label) h.innerHTML = `<span>${label}</span>`;
      layer.insertBefore(h, cap || cur); hls.push(h); return true;
    },
    clearHighlights() { hls.forEach((h) => h.remove()); hls = []; },
    // sync stamp: a 16px colour code in the corner at each scene start, read back from the video by build.mjs
    stamp(i) { ensure(); const d = document.createElement("div"); Object.assign(d.style, { position: "absolute", left: 0, top: 0, width: "16px", height: "16px", background: `rgb(255,0,${i * 22 + 10})` }); layer.appendChild(d); setTimeout(() => d.remove(), 700); },
  };
  if (document.body) ensure(); else addEventListener("DOMContentLoaded", ensure);
})();
