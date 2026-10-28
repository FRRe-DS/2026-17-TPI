---
version: 1
slug: "cliente-src-app-tsx"
primary_target: "cliente/src/app.tsx"
related_targets: []
---

## Scope

Whole panel shell (sidebar, header, technical strip, screen frame) for the twelve screens. Mode: Operate. Audience: test client and evaluator, equal weight. Job: run each M2 operation and see what M2 answered. Constraints: strict CSP (no inline style, no data:), own CSS (globals + CSS Modules), system fonts, light and dark, 360 to 1440 px, 44 px controls, 4.5:1 text contrast.

## Direction contract

THESIS: «Verde ciudad», the tool of an urban mobility app (chosen by Lautaro on 2026-10-28 among five options; replaces «the paper form with a folio»). White working cards on a faintly green ground, one teal accent for what you touch or what is selected, and every answer from M2 filed under its X-Request-Id folio in the technical strip. It refuses the card-grid dashboard of KPI tiles and the generic admin template.

OWN-WORLD: green-tinted ground (#F3F6F4) and sidebar (#EAF1EE), white cards (#FFFFFF) with a soft layered shadow and 18 px corners, near-black green ink (#0F1F1A), one teal accent (#0F766E; #5EEAD4 at night) on the primary button, current menu item (a white tab with teal text), selected options, links and focus; 10 px controls; an amber «Entorno de prueba» band above every view for anything simulated; mono only for real M2 values; a near-black technical strip at the foot. Status uses only green (ok), red (error), amber (warning).

STORY: the client sees their own record and completes the task; the evaluator reads, at the foot of every screen, the method, path, status, duration drawn to scale and folio of the last request, and opens its detail in one click.

FIRST VIEWPORT: 248 px light green sidebar left (text-only brand «M2 | Clientes» with M2 in teal, role menu in groups, current item as a white tab, «TPI 2026 · Grupo 17» at the foot); a 36 px amber test-environment band, then a 64 px translucent session row with the teal role chip, id and «Cerrar sesión» right; content: 28 px title, then white cards (form title, two columns of fields, light grey footer with the teal primary bottom right); 56 px technical strip at the foot. Below 960 px the sidebar becomes a top bar with a menu button.

FORM: Formulario con folio, 7 on my ordered list (assigned). seed:353b1d938bae6db5. Raises: tabular mono numerics; persistent technical strip; destructive actions isolated and outlined until focus; a remembered client that no longer exists is struck through, not removed; one 8 px grid; request durations drawn to scale.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Unresolved

Whether panel/.impeccable/ is committed or ignored (ask Lautaro).
