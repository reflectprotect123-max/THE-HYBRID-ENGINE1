/*
 * NativeWind reads the SAME token names as the web app's Tailwind theme, so a
 * class like `bg-panel` or `text-gold2` means the same colour on both. The 8px
 * grid is enforced the same way too: the spacing scale is multiples of 8.
 *
 * Colors are `var(--color-*)` references, not literals — App.tsx wraps the
 * app root in a View styled with NativeWind's `vars()`, fed by the active
 * ThemeProvider palette (packages/design), so every className below re-themes
 * per product without any call site changing. See
 * docs/superpowers/specs/2026-08-04-nativewind-theme-vars-design.md.
 */
const space = { 0.5: 4, 1: 8, 2: 16, 3: 24, 4: 32, 5: 40, 6: 48, 8: 64, 10: 80, 12: 96 };
const px = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v + 'px']));

module.exports = {
  content: ['./src/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        bg: 'var(--color-bg)', panel: 'var(--color-panel)', panel2: 'var(--color-panel2)',
        panel3: 'var(--color-panel3)', well: 'var(--color-well)',
        line: 'var(--color-line)', line2: 'var(--color-line2)',
        text: 'var(--color-text)', muted: 'var(--color-muted)', dim: 'var(--color-dim)',
        gold: 'var(--color-gold)', gold2: 'var(--color-gold2)',
        'gold-wash': 'var(--color-gold-wash)', 'gold-line': 'var(--color-gold-line)',
        'done-bg': 'var(--color-done-bg)', 'done-line': 'var(--color-done-line)', 'done-ink': 'var(--color-done-ink)',
        'on-accent': 'var(--color-on-accent)',
        ok: 'var(--color-ok)', warn: 'var(--color-warn)', bad: 'var(--color-bad)',
        'z-low': 'var(--color-z-low)', 'z-mod': 'var(--color-z-mod)', 'z-high': 'var(--color-z-high)',
        track: 'var(--color-track)',
      },
      spacing: px(space),
      borderRadius: { sm: '10px', md: '14px', lg: '18px', pill: '999px' },
      fontSize: {
        1: '10px', 2: '11px', 3: '12px', 4: '13px', 5: '14px',
        6: '16px', 7: '20px', 8: '26px', 9: '34px',
      },
    },
  },
  plugins: [],
};
