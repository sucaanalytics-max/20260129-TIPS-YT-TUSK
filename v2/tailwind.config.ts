import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        // Serif carries the mastheads, headlines and every figure — it is the
        // voice of the thing. Sans is for labels, controls and running text.
        serif: ['var(--font-serif)', 'Georgia', 'serif'],
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
      },
      colors: {
        border: 'hsl(var(--border))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        paper: 'hsl(var(--paper))',
        ink: 'hsl(var(--ink))',
        muted: { DEFAULT: 'hsl(var(--muted))', foreground: 'hsl(var(--muted-foreground))' },
        accent: { DEFAULT: 'hsl(var(--accent))', foreground: 'hsl(var(--accent-foreground))' },
        card: { DEFAULT: 'hsl(var(--card))', foreground: 'hsl(var(--card-foreground))' },
        good: 'hsl(var(--good))',
        warning: 'hsl(var(--warning))',
        serious: 'hsl(var(--serious))',
        critical: 'hsl(var(--critical))',
        info: 'hsl(var(--info))',
      },
      letterSpacing: {
        // The small-caps label treatment used for every column head and eyebrow.
        eyebrow: '0.06em',
      },
    },
  },
  plugins: [],
};

export default config;
