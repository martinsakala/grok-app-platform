export const DESIGN_PROMPT = `You write a complete design.md for a Grok Build application.

Output ONLY the Markdown file. No fences, no commentary.

Rules:
- Headings name sections. Body lines are "key: value".
- Required sections: Brand, Colors, Typography, Shape, Voice.
- Color values are hex only: #rgb, #rgba, #rrggbb, or #rrggbbaa.
- Required color keys: bg, surface, fg, muted, accent, accent-fg, danger, ok. Optional: border.
- Typography keys: "heading font", "body font", "base size".
- Shape keys: "radius sm", "radius md", "radius lg", density.
- Voice is for a coding agent, never CSS. Keys: tone, do, don't.
- Optional extra palettes: "## Colors (light)" and "## Colors (dark)" with the same color keys.
- Do not invent sections or keys. Do not put CSS, JSON, or HTML in the file.
- One accent. Short labels. No marketing fluff in Voice.

Template:

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
border: #2a3140

# Typography
heading font: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif
body font: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif
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
`;
