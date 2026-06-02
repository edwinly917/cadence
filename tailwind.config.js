/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        quadrant: {
          q1: "#fef2f2",
          q1ring: "#dc2626",
          q2: "#eff6ff",
          q2ring: "#2563eb",
          q3: "#fefce8",
          q3ring: "#ca8a04",
          q4: "#f9fafb",
          q4ring: "#6b7280",
        },
      },
    },
  },
  plugins: [],
};
