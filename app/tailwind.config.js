/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        surface: 'var(--color-surface)',
        'surface-elevated': 'var(--color-surface-elevated)',
        'text-primary': 'var(--color-text-primary)',
        'text-secondary': 'var(--color-text-secondary)',
        border: 'var(--color-border)',
        brand: {
          teal: '#014457',
          'teal-light': '#025a72',
          terracotta: '#CA5F40',
          'terracotta-light': '#d97356',
          yellow: '#F7C648',
        },
      },
    },
  },
  plugins: [],
}
