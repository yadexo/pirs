# Hanken Grotesk

The app's one typeface, committed here and served from our own origin by
`next/font/local` (see `app/layout.tsx`).

Copyright 2021 The Hanken Grotesk Project Authors
(https://github.com/marcologous/hanken-grotesk), licensed under the SIL Open
Font License 1.1. The full licence is in `OFL.txt` beside these files, which
is what the OFL asks for: the font may be bundled and redistributed, including
commercially, as long as the licence travels with it.

## Why the files are here

They used to be fetched from Google at build time by `next/font/google`. The
browser never talked to Google either way — next/font self-hosts what it
downloads — but the *build* did, and a Vercel production build failed when
that call came back in a shape the loader could not read (`TypeError: Cannot
read properties of null (reading '1')`). A build should not be able to fail
because somebody else's CDN had a bad minute.

## What these files are

One variable font, weights 400–800, cut into the same per-script subsets
Google serves — and byte-for-byte the files `next/font/google` was already
emitting, so nothing about the rendering changed:

| File | Script | Preloaded |
|---|---|---|
| `hanken-grotesk-latin.woff2` | Latin (the app's own two languages) | yes |
| `hanken-grotesk-latin-ext.woff2` | Latin Extended (ł, ő, ř …) | no |
| `hanken-grotesk-vietnamese.woff2` | Vietnamese | no |
| `hanken-grotesk-cyrillic-ext.woff2` | Cyrillic Extended | no |

`next/font/local` has no `unicode-range`, so rather than one family with four
ranges there are four families, listed in order in `--font-ui`
(`app/design-tokens.css`). CSS font fallback runs per character, so a name
containing `ł` finds its glyph in the Latin Extended family instead of
dropping to the system font. Only the Latin cut is preloaded — the same as
before — and the others are fetched only when a page actually renders a
character from them.

That cascade is why every `localFont` call passes `adjustFontFallback: false`.
Left on, next/font appends a metric-matched Arial to each family, inside that
family's own CSS variable; because that fallback covers the whole of Latin it
would answer for a `ł` before the Latin Extended cut was ever asked. Turning
it back on would silently undo the coverage above.

## Replacing or updating the font

Take the `.woff2` files Google serves for the subsets you want, drop them in
here under the same names, and update `OFL.txt` if the copyright line changed.
Nothing else needs touching. Changing to a different typeface means editing
the four `localFont` calls in `app/layout.tsx` and the `--font-ui` stack.

`tests/fonts.test.ts` fails if `next/font/google` comes back, or if a file
named here goes missing.
