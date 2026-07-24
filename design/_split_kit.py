#!/usr/bin/env python3
"""
One-time build script: splits hybrid-design-kit.html into individual
Claude-Design "card" files — one self-contained HTML file per component,
each tagged with the @dsCard marker comment the Design System pane reads
to build its card index (per DesignSync tool docs: first line
`<!-- @dsCard group="..." -->`, one card per component, grouped by section).

Each card gets the FULL token :root + FULL component CSS (not just the
rules it needs) so it renders correctly in total isolation — no missing
class definitions, no cross-file dependency. This is intentionally
redundant; these are reference/authoring files, never shipped to the apps.

Run: python3 design/_split_kit.py   (regenerates design/cards/*.html)
"""
import re, os, html

SRC = 'design/hybrid-design-kit.html'
OUT = 'design/cards'

src = open(SRC, encoding='utf-8').read()
style_m = re.search(r'(<style>.*?</style>)', src, re.S)
STYLE = style_m.group(1)

def slugify(s):
    s = re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-')
    return s

def extract_balanced(text, start):
    """Given text and the index of an opening '<div', return (inner_html, end_index)
    for the balanced div — inner_html excludes the outer <div ...> and </div>."""
    depth = 0
    i = start
    open_tag_end = text.index('>', start) + 1
    depth = 1
    i = open_tag_end
    while depth > 0:
        nxt_open = text.find('<div', i)
        nxt_close = text.find('</div>', i)
        if nxt_close == -1:
            raise ValueError('unbalanced')
        if nxt_open != -1 and nxt_open < nxt_close:
            depth += 1
            i = text.index('>', nxt_open) + 1
        else:
            depth -= 1
            i = nxt_close + len('</div>')
    inner = text[open_tag_end:i - len('</div>')]
    return inner, i

# ---- walk sections ----
sec_pattern = re.compile(r'<section class="kit-sec">')

# The generic extractor assumes '<div', so handle <section> specially:
def extract_section(text, start):
    depth = 1
    i = text.index('>', start) + 1
    while depth > 0:
        nxt_open = text.find('<section', i)
        nxt_close = text.find('</section>', i)
        if nxt_close == -1:
            raise ValueError('unbalanced section')
        if nxt_open != -1 and nxt_open < nxt_close:
            depth += 1
            i = text.index('>', nxt_open) + 1
        else:
            depth -= 1
            i = nxt_close + len('</section>')
    inner = text[text.index('>', start) + 1 : i - len('</section>')]
    return inner, i

sections = []
pos = 0
while True:
    m = sec_pattern.search(src, pos)
    if not m: break
    inner, end = extract_section(src, m.start())
    sections.append(inner)
    pos = end

assert len(sections) == 5, f'expected 5 sections, got {len(sections)}'

CARD_TMPL = '''<!-- @dsCard group="{group}" -->
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{name}</title>
{style}
<style>
  /* card-frame: only for standalone preview; not part of the token system */
  body{{padding:28px}}
  .card-demo{{max-width:520px}}
</style>
</head>
<body>
<div class="card-demo">
{body}
</div>
</body>
</html>
'''

os.makedirs(OUT, exist_ok=True)
for f in os.listdir(OUT):
    if f.endswith('.html'): os.remove(os.path.join(OUT, f))

manifest = []
sec_meta = [
    ('01-foundations-colour', 'Foundations — Colour'),
    ('02-foundations-type-scale', 'Foundations — Type, Radius, Elevation'),
    ('03-shared', 'Shared Components'),
    ('04-athlete', 'Athlete App'),
    ('05-coach', 'Coach Site'),
]

item_re = re.compile(r'<div class="kit-item"')
lab_re = re.compile(r'<div class="kit-lab">(.*?)</div>', re.S)

n = 0
for sec_html, (prefix, group) in zip(sections, sec_meta):
    ipos = 0
    idx = 0
    while True:
        m = item_re.search(sec_html, ipos)
        if not m: break
        inner, end = extract_balanced(sec_html, m.start())
        ipos = end
        idx += 1
        n += 1
        lab_m = lab_re.search(inner)
        raw_label = re.sub(r'<[^>]+>', '', lab_m.group(1)).strip() if lab_m else f'Item {idx}'
        label = html.unescape(raw_label)
        slug = slugify(label)[:48] or f'item-{idx}'
        fname = f'{prefix}-{idx:02d}-{slug}.html'
        card = CARD_TMPL.format(group=group, name=label, style=STYLE, body=inner.strip())
        open(os.path.join(OUT, fname), 'w', encoding='utf-8').write(card)
        manifest.append((fname, group, label))

print(f'wrote {n} card files to {OUT}/')
idx_lines = '\n'.join(f'{i+1:2d}. [{g}] {l}  ->  cards/{f}' for i,(f,g,l) in enumerate(manifest))
print(idx_lines)
