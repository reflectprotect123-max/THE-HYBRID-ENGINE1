/*
 * NativeWind reads the SAME token names as the web app's Tailwind theme, so a
 * class like `bg-panel` or `text-gold2` means the same colour on both. The 8px
 * grid is enforced the same way too: the spacing scale is multiples of 8.
 */
const space = { 0.5: 4, 1: 8, 2: 16, 3: 24, 4: 32, 5: 40, 6: 48, 8: 64, 10: 80, 12: 96 };
const px = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v + 'px']));

module.exports = {
  content: ['./src/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        bg: '#070706', panel: '#141311', panel2: '#1c1b18', panel3: '#0a0a09', well: '#0c0c0a',
        line: 'rgba(255,255,255,.065)', line2: 'rgba(255,255,255,.1)',
        text: '#f5f1e9', muted: '#aaa49a', dim: '#847d73',
        gold: '#c09358', gold2: '#e0bc87',
        'gold-wash': 'rgba(192,147,88,.09)', 'gold-line': 'rgba(224,188,135,.22)',
        'done-bg': 'rgba(192,147,88,.14)', 'done-line': 'rgba(224,188,135,.5)', 'done-ink': '#e6c795',
        'on-accent': '#1b1509',
        ok: '#9fc59b', warn: '#d1a464', bad: '#cf7f7c',
        'z-low': '#5b8def', 'z-mod': '#cf9d4f', 'z-high': '#e0524d',
        track: 'rgba(255,255,255,.08)',
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
