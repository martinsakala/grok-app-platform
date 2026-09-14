# Design contract (0.10.0)

`design.md` is the visual contract of an application. A human can read it.
An agent reads it **before writing UI**. The platform turns it into `--pf-*`
CSS variables at build time and lets an owner override a subset at runtime
without a rebuild.

Voice (tone / do / don't) is for the agent. It **never** becomes CSS.

## Two layers

| Layer | Source | When it applies | Who writes it |
| --- | --- | --- | --- |
| Build-time | repo-root `design.md` → `app/design-tokens.css` | every page load, even before JS | whoever edits `design.md` + host build |
| Runtime | settings key `platform.design` | merged on top of build-time tokens | owner, via Design page or `PUT /design` |

`GET /api/platform/design` is **public** and secret-free. It returns
`{ tokens, override }`. `tokens` is the merge the GUI should inject.
`override` is the stored JSON subset, or `null`.

A corrupt stored override is treated as missing (GET stays 200, tokens =
build-time). Reset (`DELETE /design`) deletes `platform.design`.

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

A sample for mother-app is [`docs/host/design.md`](host/design.md).

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
} from "../platform/src/design/index.js";
```

`parseDesignMd` throws `DesignParseError` (`error.line`, message prefixed
`design.md:N:`). `validateDesignOverride` throws `BadRequestError` (HTTP 400).
The JSON subset is `{ colors?, typography?, shape? }` — **no Voice, no Brand**.

## CLI

```bash
node --experimental-strip-types platform/scripts/generate-design-tokens.mjs \
  design.md app/design-tokens.css
```

Missing args → exit 2. Parse error → exit 1 with the line-numbered message.

## HTTP

| Method | Path | Who |
| --- | --- | --- |
| `GET` | `/api/platform/design` | public |
| `PUT` | `/api/platform/design` | owner. Body = override JSON (not `{value:…}`) |
| `DELETE` | `/api/platform/design` | owner. Reset to build-time |

Host passes build-time tokens into the handler:

```ts
createPlatformHandler({
  appConfig,
  sessionSource,
  getDatabase,
  designTokens: tokensFromSpec(parseDesignMd(designMdRaw)),
});
```

PUT also writes `platform.design` through settings, so the audit log has
both `settings.set` and `design.set`. DELETE logs `design.set` with
`{reset:true}` (and `settings.delete` when the key existed).

## AppShell / DesignPage

`AppShell` / `AdminLayout` accept `tokens` and/or `designUrl`. When
`designUrl` is set they fetch it on mount and inject `<style>` so a GUI
save is visible without rebuild. Fallback is `tokens.css` / generated CSS.

`DesignPage` is owner-only: color / font / radius form, live preview, Save
(`platform.design`), Reset. Mount at `/admin/design`.

## How an agent uses this

1. Read `design.md` (před tvorbou UI čti design.md).
2. Follow Voice. Do not invent a second palette or a parallel token set.
3. Use `--pf-*` (and Tailwind utilities that reference them). Do not hardcode
   hex in components except as `design.md` values flowing through tokens.
4. Do not put Voice into CSS or into `platform.design`.
