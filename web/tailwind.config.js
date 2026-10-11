/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: { sans: ["Inter", "system-ui", "-apple-system", "Segoe UI", "sans-serif"] },
      colors: {
        ink: { 950: "#070B14", 900: "#0B1220", 850: "#0F1729", 800: "#131C31", 700: "#1C2740", 600: "#2A3654" },
        wire: "#F5B841",
        up: "#34D399",
        down: "#F87171",
        regime: { range: "#60A5FA", trend: "#34D399", vol: "#F5B841", down: "#94A3B8" },
      },
      boxShadow: { card: "0 1px 0 0 rgba(255,255,255,.04) inset, 0 8px 24px -12px rgba(0,0,0,.6)" },
    },
  },
  plugins: [],
};
