# Design contract (0.11.0)

`design.md` is the visual contract of an application. A human can read it.
An agent reads it **before writing UI**. The platform turns it into `--pf-*`
CSS variables at build time and lets an owner import, pick, or fine-tune a
design at runtime without a rebuild.

**One source of truth is the repo-root `design.md`.** The coding agent reads
that file, not the database. Runtime `platform.design` is an owner overlay
for live preview and for applying a pasted / uploaded / gallery document
until someone commits the export.

Voice (tone / do / don't) is for the agent. It **never** becomes CSS.

## Two layers

| Layer | Source | When it applies | Who writes it |
| --- | --- | --- | --- |
| Build-time | repo-root `design.md` → `app/design-tokens.css` | every page load, even before JS | whoever edits `design.md` + host build |
| Runtime | settings key `platform.design` | document replaces build-time tokens; form overlay merges on top | owner, via Design page, import, gallery, or `PUT /design` |

`GET /api/platform/design` is **public** and secret-free. It returns
`{ tokens, override }`. `tokens` is the merge the GUI should inject.
`override` is the public JSON subset (`colors` / `typography` / `shape`) plus
`source` (`markdown` \| `preset` \| `form`), or `null`. Public GET never
returns the markdown body, Voice, or Brand.

A corrupt stored override is treated as missing (GET stays 200, tokens =
build-time). Reset (`DELETE /design`) deletes `platform.design`.

## Stored `platform.design`

Two shapes, both accepted by `validateDesignOverride`. Old 0.10 rows keep
working.

1. **Document (0.11)** — `{ markdown, spec, source, preset? }`. `spec` is the
   full `DesignSpec` including Voice. Tokens come from `spec` (full replace of
   build-time CSS, gaps filled from defaults).
2. **Form overlay (0.10)** — `{ colors?, typography?, shape?, source?: "form" }`.
   Merged onto build-time tokens. No Voice, no Brand.

`POST /design/import` writes a document (`source: markdown` or `preset`).
`PUT /design` writes a form overlay (`source: form`). Fine-tune after import
is **lossy**: it replaces the stored document with the color/font/radius
subset.

## File format

Markdown headings (`#` / `##` / `###`) name sections. Body lines are
`key: value`. Unknown sections and unknown keys fail. Errors look like
`design.md:12: invalid hex for accent: "red"`.

Required sections:

```markdown
# Brand
name: Example
tagline: A short line

# Colors
bg: #0f1115
surface: #171b22
fg: #e8eaed
muted: #9aa3b2
accent: #6ea8fe
accent-fg: #0f1115
danger: #f87171
ok: #34d399
# optional: border: #2a3140

# Typography
heading font: ui-sans-serif, system-ui, sans-serif
body font: ui-sans-serif, system-ui, sans-serif
base size: 16px

# Shape
radius sm: 0.375rem
radius md: 0.75rem
radius lg: 1rem
density: comfortable

# Voice
tone: calm and direct
do: Prefer short sentences and one accent.
don't: Don't invent a second palette.
```

Optional theme sections (same color keys as Colors):

```markdown
## Colors (light)
…

## Colors (dark)
…
```

Those emit `[data-pf-theme="light"]` / `[data-pf-theme="dark"]` blocks.
The default `Colors` section always fills `:root`.

Hex only: `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`. Colors are the only
values type-checked as hex. Fonts, radii, density, and Voice are free text
(Voice may be empty-looking but the keys must be present).

A sample for mother-app is [`docs/host/design.md`](host/design.md). Six
gallery presets live in `src/design/gallery/*.md` and are generated into
`src/design/generated/gallery.ts`.

## CSS names

The generator writes the same `--pf-*` names as `src/ui/tokens.css`:

`--pf-bg`, `--pf-surface`, `--pf-fg`, `--pf-muted`, `--pf-accent`,
`--pf-accent-fg`, `--pf-danger`, `--pf-ok`, `--pf-border`, `--pf-radius`
(from radius md), `--pf-radius-sm`, `--pf-radius-lg`, `--pf-font` (body),
`--pf-heading-font`, `--pf-font-size`, `--pf-density`.

Values containing `;` or `{` / `}` are dropped so a setting cannot break
out of a `<style>` block.

## Library

```ts
import {
  parseDesignMd,
  generateTokensCss,
  tokensFromSpec,
  applyOverride,
  validateDesignOverride,
  tokensFromStored,
  publicOverride,
  DESIGN_PROMPT,
  DESIGN_GALLERY,
} from "../platform/src/design/index.js";
```

`parseDesignMd` throws `DesignParseError` (`error.line`, message prefixed
`design.md:N:`). `validateDesignOverride` throws `BadRequestError` (HTTP 400).
The form subset is `{ colors?, typography?, shape?, source? }` — **no Voice,
no Brand**. A document is `{ markdown?, spec?, source?, preset? }`.

`DESIGN_PROMPT` is the instruction + template for an LLM to emit a valid
`design.md` (markdown only, no fences). Copy it from DesignPage or import
the constant.

## CLI

```bash
node --experimental-strip-types platform/scripts/generate-design-tokens.mjs \
  design.md app/design-tokens.css
```

Missing args → exit 2. Parse error → exit 1 with the line-numbered message.

Gallery (committed generated file):

```bash
node --experimental-strip-types platform/scripts/generate-design-gallery.mjs
```

## HTTP

| Method | Path | Who |
| --- | --- | --- |
| `GET` | `/api/platform/design` | public. `{ tokens, override }`. `override.source` is `markdown` \| `preset` \| `form` or override is `null`. No markdown body. |
| `PUT` | `/api/platform/design` | owner. Body = form overlay JSON (not `{value:…}`). Sets `source: form`. |
| `DELETE` | `/api/platform/design` | owner. Reset to build-time. |
| `POST` | `/api/platform/design/import` | owner. `{ markdown }` or `{ preset: id }`. Saves `{ markdown, spec, source }`. Parse error → `400 { code: "invalid_design", errors: [{ line, message }] }`. |
| `GET` | `/api/platform/design/export` | owner. `text/markdown`: stored markdown, else host `designMarkdown`. 404 if neither. |
| `GET` | `/api/platform/design/gallery` | owner. `{ presets: [{ id, name, tagline, colors }] }`. |

Host options:

```ts
createPlatformHandler({
  appConfig,
  sessionSource,
  getDatabase,
  designMarkdown, // raw repo-root design.md; tokens are derived if designTokens is omitted
  designTokens,   // optional explicit --pf-* map; wins over designMarkdown when both are set
});
```

When `designMarkdown` is set and `designTokens` is not, the handler parses it
for build-time tokens and for export fallback. `designTokens` remains for
compatibility.

Import audits `design.import` with `{ source, preset? }`. PUT/DELETE audit
`design.set`. Both also write through settings (`settings.set` /
`settings.delete`).

## AppShell / DesignPage

`AppShell` / `AdminLayout` accept `tokens` and/or `designUrl`. When
`designUrl` is set they fetch it on mount and inject `<style>` so a GUI
save is visible without rebuild. Fallback is `tokens.css` / generated CSS.

`DesignPage` is owner-only. Sections:

- **Import** — paste or upload `.md`, Validate (line errors), Apply (import +
  live tokens before save).
- **Gallery** — swatches from `DESIGN_GALLERY`, Use imports that preset.
- **Export** — Download `design.md`. Copy the prompt for an LLM
  (`DESIGN_PROMPT`). Reminder: *Commit this file to the repo root: the coding
  agent reads design.md from the repository, not from the database.*
- **Fine-tune** — color / font / radius form, Save (`PUT`), Reset (`DELETE`).

Mount at `/admin/design`. Client methods: `getDesign`, `setDesign`,
`resetDesign`, `importDesign`, `exportDesign`, `listDesignGallery`.

## Export flow

1. Owner imports, picks a gallery preset, or fine-tunes in `/admin/design`.
2. Download `design.md`.
3. Commit it at the **repository root** as `design.md`.
4. The next host build regenerates `app/design-tokens.css`. Reset the runtime
   overlay when the committed file should be the only source.

Until that commit, the overlay lives only in `platform.design`. Agents must
not treat the database as the contract.

## How an agent uses this

1. Read `design.md` (před tvorbou UI čti design.md).
2. Follow Voice. Do not invent a second palette or a parallel token set.
3. Use `--pf-*` (and Tailwind utilities that reference them). Do not hardcode
   hex in components except as `design.md` values flowing through tokens.
4. Do not put Voice into CSS. Do not dump markdown on public `GET /design`.
5. If you generate a new look, output only a `design.md` that `parseDesignMd`
   accepts (see `DESIGN_PROMPT`).
