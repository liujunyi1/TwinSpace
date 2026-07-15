import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/**/*.{ts,tsx}",
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        ink: "#18171f",
        muted: "#8a8791",
        line: "#e9e7ec",
        surface: "#f6f5f7",
        blush: "#fff1f4",
        lilac: "#eee9ff",
        skysoft: "#edf7ff"
      },
      boxShadow: {
        soft: "0 18px 48px rgba(25, 23, 31, 0.08)"
      }
    }
  },
  plugins: []
};

export default config;
