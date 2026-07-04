/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      colors: {
        surface: 'var(--color-surface)',
        'surface-raised': 'var(--color-surface-raised)',
        'text-primary': 'var(--color-text-primary)',
        'text-secondary': 'var(--color-text-secondary)',
        'text-muted': 'var(--color-text-muted)',
        line: 'var(--color-border)',
        'line-subtle': 'var(--color-border-subtle)',
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
