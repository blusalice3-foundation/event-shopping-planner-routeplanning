import legacyTheme from "./tailwind-legacy-theme.json" with { type: "json" };

/** @type {import("tailwindcss").Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  // Preserve the application's v3 palette and scales during the compiler upgrade.
  theme: {
    extend: legacyTheme,
  },
  plugins: [],
};
