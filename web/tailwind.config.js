import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('tailwindcss').Config} */
export default {
  content: [path.join(here, "index.html"), path.join(here, "src/**/*.{js,ts,jsx,tsx}")],
  theme: {
    extend: {
      colors: {
        sand: {
          50: "#FBF8F1",
          100: "#F7F1E5",
          200: "#F4ECD9",
          300: "#ECE1CD",
          400: "#C7B08A",
          500: "#A8916D",
          700: "#46331F",
          900: "#312213",
          950: "#1F1408",
        },
        gold: {
          400: "#D4A72C",
          700: "#A67C17",
          800: "#8A6612",
        },
        sage: "rgba(198,219,181,0.55)",
        moss: "#5B7B4C",
        rust: "#B3402A",
      },
      fontFamily: {
        sans: ["Quicksand", "sans-serif"],
      },
      borderRadius: {
        "3xl": "1.5rem",
      },
    },
  },
  plugins: [],
};
