# Brand

Verso's surface is a wall label, not a social network. Quiet, typographic, and
out of the way of the work — the art in the product is the art, and the
interface should not compete with it.

---

## The name

*Verso* is the back of a canvas or a leaf: the side that carries the labels,
the stamps, the inventory numbers and the record of where a work has been. That
is exactly what the product is — the record on the back of the work, saying who
has seen it and what they thought.

---

## The mark

<img src="../public/brand/mark.svg" width="120">

A canvas seen from behind: the stretcher frame, its cross brace, and the
provenance label pasted in the corner. The label is the only element in the
accent gold, because the label is the idea.

Three variants, because one drawing cannot serve 16px and 512px:

| File | Use |
|---|---|
| `public/brand/mark.svg` | Full mark. Inherits `currentColor`, so it works on either background. |
| `public/brand/mark-solid.svg` | Small sizes. The vertical brace is dropped — below about 32px a 5px stroke turns to mud. Also the favicon and the PWA icon. |
| `public/brand/mark-maskable.svg` | Android maskable icon. Everything important sits inside the 80% safe circle, since the platform crops to a squircle, a circle or a teardrop. |
| `public/brand/wordmark.svg` | Mark plus letterspaced wordmark, for headers and README-scale use. |

Rendered PNGs (`icon-192`, `icon-512`, `icon-maskable-512`, `apple-icon`) are
generated from the SVGs and committed in `public/`.

**Don't:** recolour the label to anything but the accent, add a gradient, set
the wordmark in a sans, or place the mark on a mid-tone background where the
frame stroke loses contrast.

---

## Colour

| Token | Hex | Role |
|---|---|---|
| `--color-ink` | `#12100e` | Background. Warm near-black — a gallery wall at night, not a terminal. |
| `--color-ink-soft` | `#1c1a17` | Cards, inputs, raised surfaces |
| `--color-paper` | `#f7f4ee` | Text, and the fill of primary buttons |
| `--color-paper-dim` | `#e9e3d8` | Secondary text on light surfaces |
| `--color-muted` | `#8a8378` | Metadata, captions, labels |
| `--color-line` | `#2a2724` | Every rule and border |
| `--color-accent` | `#c9a227` | Stars, the logo label, one hairline on share cards. Nothing else. |

The palette is deliberately small and the accent is deliberately rare. Gold
means *a rating* or *Verso itself*; if it starts meaning "this button is
important" it stops meaning either.

Dark only, on purpose: photographs of paintings and a dark surround is how the
works are lit in the building.

---

## Type

| Role | Stack |
|---|---|
| Display | `ui-serif, "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, "Times New Roman", serif` |
| Body and UI | `ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, …` |

Serif for titles — work titles, headings, big numbers — because it is the voice
of the wall label and the catalogue raisonné. Sans for everything functional.

No web fonts. A font file is 40–120 KB on the critical path of a screen whose
entire promise is being usable in ten seconds on a bad connection in a
basement, and the system serif stack is good on every platform this runs on.

**Utilities** (`globals.css`): `.display` for the serif face, `.label-caps` for
the small letterspaced uppercase labels, `.rule` for borders, `.plate` for the
image-less artwork placeholder, `.btn` / `.btn-primary` / `.btn-ghost`.

---

## Voice

Plain, specific, and never breathless. The product is for people who look at art
carefully; writing at them in growth-team exclamation marks is the fastest way
to lose them.

- "Log the art you actually see." — not "Track your art journey!"
- "Nobody has written about this yet." — not "Be the first to review!"
- "Not currently known to be on view." — say what is true, including when the
  answer is that we don't know.
- Microcopy carries the reasoning where it helps: *"Saved on this device and
  synced when there's signal."*

---

## Share cards

`src/lib/og.tsx` generates a 1200×630 Open Graph card per work, profile,
sighting and Year in Art page. Ink background, one gold hairline across the top,
the mark and wordmark bottom-right, and large numbers where there are numbers.

They are **typographic and image-free by design**. Most of the catalogue has no
image Verso may reproduce (see [`DATA.md`](DATA.md)), so a card design that
depended on artwork imagery would be broken for the majority of pages — and a
card that is sometimes beautiful is worse than one that is always right.

*Known limitation:* the card renderer has no serif available, so cards render in
the default sans while the app uses the serif display face. Fixing it means
embedding a font file in the OG route; it is a small, deliberate inconsistency
rather than an oversight.

---

## The placeholder

Most work pages have no image. The fallback is a stencilled plate carrying the
artist's initials — a crate mark — rather than a broken-image icon or a grey
box. It has to look like a decision, because it is one: it is what "we do not
have the rights to show you this" looks like when said politely 8,000 times.
