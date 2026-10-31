# Dhivehi Font Studio

A browser app where anyone can design their own Dhivehi (Thaana) font: draw each letter and fili, test it with a phonetic Thaana keyboard, and download a real `.ttf` / `.woff` font.

Everything runs in the browser. Fonts are saved in the browser's IndexedDB; nothing is uploaded anywhere.

## Run it

Live site: https://gassaan.github.io/dhivehi-font-studio/

```
npm install
npm run dev        # http://localhost:5173
npm run build      # static site in dist/, host it anywhere
```

Every push to `main` builds and deploys to GitHub Pages (`.github/workflows/deploy.yml`).

## What a designer can do

- **Draw** the 24 core letters, 11 fili, 15 extended letters, digits/punctuation and (optionally) Latin, with a round brush, a calligraphy nib (angle adjustable), an eraser, pressure from a stylus, a "steady hand" stabilizer, undo/redo and keyboard shortcuts.
- **Trace a photo** of handwriting: dark pixels become ink that can be moved, scaled and tidied with the eraser.
- **Draw fili in context** against their own ބ. Fili are placed automatically on every letter with OpenType mark positioning, so they sit correctly in Word, browsers, phones and design apps.
- **Test** with the built-in phonetic keyboard (h → ހ, a → ަ …), sample texts and a size waterfall, and see which letters are still missing.
- **Download** TTF and WOFF, copy a ready `@font-face` snippet, and export/import a backup file to move between devices.

## How it works

| File | Job |
| --- | --- |
| `src/lib/charset.ts` | The character set, grouped, with fili above/below. |
| `src/lib/ink.ts` | Renders strokes (brush, nib, eraser) and traced pictures to a canvas. |
| `src/lib/trace.ts` | Bitmap → outline: edge tracing, smoothing, simplification, then a quadratic B-spline where sharp turns become corners. |
| `src/lib/compile.ts` | Traces every glyph, applies side bearings, and computes mark anchors from the letter height and the designer's ބ. |
| `src/lib/sfnt.ts` | A small TrueType writer (glyf, cmap, OS/2, name, GDEF, GPOS mark-to-base) plus WOFF packing. |

## Tests

`npm test` builds a synthetic font and checks it with the OpenType Sanitizer (what Chrome and Firefox run), fontTools (outline direction) and HarfBuzz (fili attach to their letters). It needs `pip install fonttools uharfbuzz opentype-sanitizer`.
