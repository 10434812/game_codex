# Design System Document: The Editorial Guofeng Aesthetic

## 1. Overview & Creative North Star
**Creative North Star: "The Modern Calligrapher"**
This design system rejects the clinical coldness of modern tech in favor of "The Modern Calligrapher"—an aesthetic that honors centuries of Chinese artistic tradition through a high-end, editorial lens. It is not a literal recreation of history, but a digital evolution where the tactility of aged parchment meets the ethereal depth of modern glassmorphism.

The system breaks the "standard app template" by treating every screen as a scroll or a canvas. We prioritize **intentional asymmetry**, allowing elements to bleed off-edge or overlap, mimicking the rhythmic flow of a brush on paper. High-contrast typography scales and layered translucency replace rigid grids to create a sense of curated breathing room and cultural prestige.

---

## 2. Colors: Tonal Depth & Warmth
The palette is rooted in Earth, Ink, and Warm Amber. We move beyond flat blocks of color by utilizing a sophisticated tier of surfaces that mimic the natural variations in handmade paper.

### Core Palette
- **Primary (`#e57c1f`)**: A deep amber-orange used for high-impact brand moments.
- **Primary Container (`#f4b24a`)**: Our active warm orange for CTAs and primary actions.
- **Secondary (`#7b5800`)**: A refined bronze for ornamentation and secondary interactive elements.
- **Background (`#fff9ed`)**: The "Aged Parchment" base. All screens must start here.

### The "No-Line" Rule
**Strict Mandate:** Designers are prohibited from using 1px solid borders for sectioning. Boundaries must be defined solely through:
1.  **Background Color Shifts:** Use `surface-container-low` for secondary content areas sitting on a `surface` background.
2.  **Tonal Transitions:** Use soft, organic shifts in color to imply a change in context. Lines feel mechanical; we aim for organic.

### Glass & Gradient (The Soul of the UI)
To avoid a "flat" historical look, use **Glassmorphism** for floating elements.
- **Floating Cards:** Use `surface-container-lowest` at 60-80% opacity with a `backdrop-blur` of 12px-20px.
- **Signature Gradients:** Primary buttons must utilize a subtle gradient from `primary` to `primary-container` (amber-to-subtle-orange) to provide a "lit from within" glow reminiscent of traditional lanterns.

---

## 3. Typography: The Calligraphic Hierarchy
We pair the structural elegance of Noto Serif (Traditional/Simplified) with the modern functionality of Manrope.

| Level | Token | Font | Size | Weight | Intent |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Display** | `display-lg` | Noto Serif | 3.5rem | Bold | Heroic brand moments / Poetry |
| **Headline**| `headline-md`| Noto Serif | 1.75rem | Medium | Page titles / Editorial headers |
| **Title**   | `title-lg`   | Manrope    | 1.375rem | SemiBold| Content grouping / List headers |
| **Body**    | `body-md`    | Manrope    | 0.875rem | Regular | General reading / Long-form text |
| **Label**   | `label-sm`   | Manrope    | 0.6875rem| Medium | Captions / Metadata |

**Editorial Note:** Use `display` tokens with generous line-heights and occasional vertical text orientations to reference traditional script layouts.

---

## 4. Elevation & Depth: Tonal Layering
In this design system, elevation is not achieved through height, but through **materiality**.

- **The Layering Principle:** Stack `surface-container` tiers to create depth. A `surface-container-highest` card placed on a `surface-container-low` section creates a natural lift.
- **Ambient Shadows:** Shadows are forbidden from being "gray." They must be a tinted version of `on-surface` (charcoal with a hint of warm tan), set to 4-8% opacity with a blur radius of at least 24px.
- **The "Ghost Border":** If a container lacks sufficient contrast against a background, use the `outline-variant` token at 15% opacity. It should be felt, not seen.
- **Texture Overlays:** Apply a subtle noise or "aged paper" texture (SVG or PNG) at 3% opacity over the entire `background` to maintain the tactile "Guofeng" feel.

---

## 5. Components: The Physical Artifacts

### Buttons
- **Primary:** Rounded (`radius-full`), featuring an Amber-to-Orange gradient (`primary` to `primary-container`). White text.
- **Secondary:** Bronze outline (`secondary`) with no fill, or a soft glass background.
- **Tertiary:** Text-only in `primary` amber, using `title-sm` for an authoritative yet minimal feel.

### Cards & Surfaces
- **Rules:** Never use dividers. Separation is achieved through `xl` (1.5rem) or `lg` (1rem) corner rounding and background tonal shifts.
- **Floating Navigation:** The bottom nav must be a floating glass pill or a full-width translucent bar (`surface` at 85% opacity) with a 20px blur. Active states use a `primary-container` tint on custom-drawn iconography.

### Custom "Guofeng" Elements
- **Circular Avatars:** Must feature a `secondary` (golden/bronze) border of 1.5pt to mimic traditional seals or coins.
- **Selection Chips:** Use `secondary-container` for the background with `on-secondary-container` text. Keep corners `full` for a pebble-like quality.

---

## 6. Do's and Don'ts

### Do:
- **Do** use negative space as a functional element. Allow margins to be "imperfect" or wider on one side to create an editorial look.
- **Do** overlap images with text blocks, using glassmorphism to maintain legibility.
- **Do** use the `notoSerif` font for all high-level headers to reinforce the cultural identity.

### Don't:
- **Don't** use 100% black. Always use `on-background` (Charcoal #1f1c0b) for text to maintain warmth.
- **Don't** use sharp corners. Everything should feel weathered and smoothed by time (minimum `sm` rounding).
- **Don't** use drop-shadows on flat parchment backgrounds; let the tonal layering of the "Surface Hierarchy" do the work.
- **Don't** use standard system icons. Icons should be custom-styled with varying stroke weights that mimic brush pressure.
