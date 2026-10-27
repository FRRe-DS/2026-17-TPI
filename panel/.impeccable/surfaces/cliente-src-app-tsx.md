---
version: 1
slug: "cliente-src-app-tsx"
primary_target: "cliente/src/app.tsx"
related_targets: []
---

## Scope

Whole panel shell (sidebar, header, technical strip, screen frame) for the twelve screens. Mode: Operate. Audience: test client and evaluator, equal weight. Job: run each M2 operation and see what M2 answered. Constraints: strict CSP (no inline style, no data:), own CSS (globals + CSS Modules), system fonts, light and dark, 360 to 1440 px, 44 px controls, 4.5:1 text contrast.

## Direction contract

THESIS: the panel is a paper form with a folio. Every screen is a numbered sheet of casilleros and every answer from M2 is filed under its X-Request-Id folio. It refuses the card-grid dashboard of KPI tiles and the generic admin template.

OWN-WORLD: warm paper (#F3ECE0) with a whiter sheet (#FBF8F2), dark sepia sidebar (#4E3420), sepia ink accents (#6B4A2E), ruled 1 px hairlines (#D8CAB4), numbered mono casillero labels (01, 02…), dashed pill tags for anything simulated, a near-black technical strip at the foot in monospace. Dark mode is the same desk at night: deep brown paper, sheets one step lighter, tan ink. Status uses only green (ok), brick (error), amber (warning). No gradients, no shadows beyond a hairline, radius 6–8 px.

STORY: the client sees their own record and completes the task; the evaluator reads, at the foot of every screen, the method, path, status, duration drawn to scale and folio of the last request, and opens its detail in one click.

FIRST VIEWPORT: 248 px sepia sidebar left (brand «M2 · Clientes», role menu in groups, mono counts); 64 px sheet-colored header with the two «simulado» dashed tags left and role chip, name and «Cerrar sesión» right; content: 28 px title, mono subtitle with the client id, the sheet with folio in its header and a 2-column grid of numbered casilleros, primary «Guardar cambios» bottom right of the sheet; 360 px side column of fichas; 56 px technical strip at the foot. Below 900 px the sidebar becomes a top bar with a menu button and the side column stacks under the sheet.

FORM: Formulario con folio, 7 on my ordered list (assigned). seed:353b1d938bae6db5. Raises: tabular mono numerics; persistent technical strip; destructive actions isolated and outlined until focus; a remembered client that no longer exists is struck through, not removed; one 8 px grid; request durations drawn to scale.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Unresolved

Whether panel/.impeccable/ is committed or ignored (ask Lautaro).
