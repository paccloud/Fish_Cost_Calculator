/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
    // Tests are not shipped, and their regexes and fixtures can look like class names
    "!./src/**/__tests__/**",
    "!./src/**/*.test.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        // Both families are bundled with the app (no CDN), under the '... Variable' names
        sans: ['Inter Variable', 'Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        // The names of things: species, products, screens, sections. Never in a control or a number
        display: ['Fraunces Variable', 'Fraunces', 'Georgia', 'serif'],
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
        'on-primary': 'var(--color-on-primary)', // text and icons on primary, brand-teal and brand-cta fills
        accent: 'var(--color-accent)', // teal used as text/icons; lightens in dark mode
        link: 'var(--color-link)', // terracotta used as text; AA-contrast in both themes
        success: 'var(--color-success)',
        danger: 'var(--color-danger)',
        // The price ticket: the one darkest block on a screen
        bar: 'var(--color-bar)',
        'on-bar': 'var(--color-on-bar)',
        'on-bar-muted': 'var(--color-on-bar-muted)',
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
      // Tight corners. `rounded` (4px) is for stamps, `rounded-lg` for buttons and inputs,
      // `rounded-xl` for cards, tiles and stepper buttons. Nothing in the app is rounder
      // than that except `rounded-full` step numbers.
      borderRadius: {
        lg: '6px',
        xl: '8px',
      },
      boxShadow: {
        card: '0 1px 2px 0 rgba(0, 0, 0, 0.05)', // barely there: borders do the work in glare
        ticket: '0 -4px 16px rgba(0, 0, 0, 0.18)', // the ticket pinned over scrolling content
      },
      minHeight: {
        target: '2.75rem', // 44px: smallest tappable thing anywhere
        control: '3rem', // 48px: buttons, inputs, selects
        tile: '3.5rem', // 56px: choice tiles, stepper buttons, tab-bar items
      },
      minWidth: {
        target: '2.75rem',
      },
      maxWidth: {
        measure: '65ch', // widest line of running copy
        content: '42rem', // widest the main column grows on a desktop
      },
    },
  },
  plugins: [],
}
