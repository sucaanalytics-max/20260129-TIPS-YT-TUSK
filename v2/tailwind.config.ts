import type { Config } from 'tailwindcss';

/**
 * Every colour resolves to `rgb(var(--token) / <alpha-value>)`, so the design's
 * tokens in app/globals.css are the single source and Tailwind's alpha
 * modifiers (`bg-card/50`, `border-border/40`) keep working on the components
 * carried over from the old dashboard.
 */
const rgb = (v: string) => `rgb(var(${v}) / <alpha-value>)`;

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-sans)', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      colors: {
        // Design tokens, named as the handoff names them.
        bg: rgb('--bg'),
        surface: rgb('--surface'),
        surface2: rgb('--surface2'),
        border2: rgb('--border2'),
        ink: rgb('--ink'),
        ink2: rgb('--ink2'),
        gridline: rgb('--gridline'),
        tips: rgb('--tips'),
        sare: rgb('--sare'),
        good: rgb('--good'),
        warn: rgb('--warn'),
        bad: rgb('--bad'),

        /*
         * Aliases the inherited components already use. Mapped onto the same
         * tokens so a reused table or chart lands on the right surface without
         * being rewritten: `bg-card` is the design's `--surface`,
         * `text-muted-foreground` is its `--muted`, and so on.
         */
        background: rgb('--bg'),
        foreground: rgb('--ink'),
        border: rgb('--border'),
        card: { DEFAULT: rgb('--surface'), foreground: rgb('--ink') },
        muted: { DEFAULT: rgb('--surface2'), foreground: rgb('--muted') },
        accent: { DEFAULT: rgb('--accent'), foreground: '#ffffff' },
        // Semantic state kept from the previous theme work; same values.
        warning: rgb('--warn'),
        critical: rgb('--bad'),
        serious: rgb('--sare'),
        info: rgb('--accent'),
      },
      borderRadius: {
        card: 'var(--r)',
      },
      spacing: {
        pad: 'var(--pad)',
        gap: 'var(--gap)',
        row: 'var(--row)',
      },
      boxShadow: {
        card: 'var(--shadow)',
      },
      letterSpacing: {
        eyebrow: '0.1em',
      },
      maxWidth: {
        shell: '1400px',
      },
    },
  },
  plugins: [],
};

export default config;
