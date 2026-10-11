// The demo video, scene by scene. `say` is narrated (ElevenLabs) and captioned; `act` runs in the real app.
export const SCENES = [
  { id: "title", say: "Most people can't watch crypto all day. And most trading bots can wipe out an account overnight. Meet Vantrel.",
    card: { kicker: "Vantrel", title: "Set your risk. Fund it.", accent: "AI trades for you." } },
  { id: "problem", say: "AI is smart. It's also wrong sometimes. So Vantrel lets AI trade for you, behind a safety line it can't cross.",
    card: { kicker: "The problem", title: "AI is smart.", accent: "AI is also wrong sometimes." } },
  { id: "signup", say: "You start with a name. No account needed. Then you set your risk once. These limits are enforced in Rust on every single order.", act: "signup" },
  { id: "dashboard", say: "Three trading brains, one for each kind of market. The AI reads the market and picks the brain. The amber risk wire shows today's loss against the line where trading pauses itself.", act: "dashboard" },
  { id: "wire", say: "Watch what happens when the AI asks for more risk than you allowed. Rust says no, in microseconds. It can earn risk back by winning, but never above your line.", act: "wire" },
  { id: "replay", say: "Here's 2025, replayed on real prices with the same engine. In calm weeks, mean-reversion buys the dips. When Bitcoin trends, the Trend brain rides it. When volatility spikes, the Breakout brain only buys confirmed moves. And when Bitcoin fell, Vantrel handed control to the Shield and stepped into cash, while holding just took the hit.", act: "replay" },
  { id: "result", say: "Through the 2025 rally it trailed simply holding. When the market fell, it lost a fraction of what holding lost. That's the job: survive the drop, then compound.", act: "result" },
  { id: "proof", say: "Every trade, AI decision and blocked order is fingerprinted and anchored on Solana. And you can ask Claude about your portfolio through MCP.", act: "proof" },
  { id: "outro", say: "Vantrel. The AI trades. Rust holds the line.",
    card: { kicker: "getwiththeprogram.study", title: "The AI trades.", accent: "Rust holds the line.", built: true } },
];
