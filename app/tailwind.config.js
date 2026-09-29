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
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      colors: {
        // Theme-aware tokens (values live in index.css so light/dark stay in one place)
        surface: 'var(--color-surface)',
        'surface-raised': 'var(--color-surface-raised)',
        'text-primary': 'var(--color-text-primary)',
        'text-secondary': 'var(--color-text-secondary)',
        'text-muted': 'var(--color-text-muted)',
        line: 'var(--color-border)',
        'line-subtle': 'var(--color-border-subtle)',
        'line-strong': 'var(--color-border-strong)', // form-control edges (3:1 against the surface)
        primary: {
          DEFAULT: 'var(--color-primary)',
          hover: 'var(--color-primary-hover)',
        },
        accent: 'var(--color-accent)', // teal used as text/icons; lightens in dark mode
        link: 'var(--color-link)', // terracotta used as text; AA-contrast in both themes
        success: 'var(--color-success)',
        danger: 'var(--color-danger)',
        // Fixed brand colors, for fills/decoration (not for body-size text)
        brand: {
          teal: '#014457',
          'teal-light': '#025a72',
          terracotta: '#CA5F40',
          'terracotta-light': '#d97356',
          cta: '#B04A2E', // terracotta that keeps white text at AA (5.4:1)
          'cta-hover': '#963D24',
          yellow: '#F7C648',
        },
      },
    },
  },
  plugins: [],
}
