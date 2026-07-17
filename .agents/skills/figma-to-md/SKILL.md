---
name: figma-to-md
description: Converts one or more Figma design links into concise per-screen Markdown design specs. Use when the user provides Figma links, asks to inspect Figma designs, or wants design screens documented under designs/ for implementation planning.
---

# Figma to Markdown

## Goal
Turn Figma links into readable visual specs in `designs/`, one file per distinct screen/frame. Do not dump raw MCP output. Document what the design shows: layout, hierarchy, exact copy, reusable presentational components, responsive behavior, colors, tokens, and assets.

## Workflow
1. **Collect inputs**
   - Accept one or more Figma links. A single link may contain multiple frames/screens.
   - If the link points to a narrow selection, document only that selection unless asked for surrounding context.

2. **Inspect the app first**
   - Identify the UI stack and styling conventions.
   - Read only visually relevant files: theme/token files, global styles, presentational primitives, assets, and nearby screens.
   - Identify existing components, tokens, and assets that can reproduce the design closely.
   - Do not investigate or prescribe business logic, state management, data flow, navigation architecture, hooks, analytics, or event-handler patterns.

3. **Fetch Figma via MCP**
   - Inspect frames, hierarchy, text layers, colors, typography, spacing, assets, and generated code context.
   - Process each distinct screen independently.
   - Treat absolute positions as visual guidance, not implementation instructions.

4. **Describe the visual implementation**
   - Prefer responsive flex/layout descriptions over absolute coordinates.
   - Record each element's placement and alignment relative to its parent or nearby anchors.
   - Include exact edge offsets when placement is visually defining, such as floating controls positioned `40px from the bottom edge` of the reference frame.
   - Map values to existing presentational components and tokens only when genuinely close.
   - If the closest token would visibly change the design, keep the Figma value and propose a new token in Markdown. Do not edit token files unless explicitly asked.
   - Preserve all visible text exactly 1:1, including capitalization, punctuation, meaningful line breaks, and button labels.
   - Describe interaction only when visually evident, such as selected, disabled, expanded, pressed, loading, or scroll states. Do not suggest implementation APIs or hooks.

5. **Write Markdown files**
   - Create `designs/` if needed.
   - Write one file per distinct screen/frame. Do not combine a feature flow, section, or multi-screen Figma area into one file.
   - Name files descriptively in kebab-case, e.g. `designs/onboarding-welcome.md`.
   - Only combine true same-screen variants, such as enabled/disabled, empty/populated, active/inactive, or light/dark. If unsure, use separate files.

## Markdown format
````md
# [Screen name]
## Source
- Figma: [link or frame name]
## Layout
- [High-level layout: container, header/body/footer, scrolling behavior]
- [Placement: alignment, anchors, order, and visually defining edge offsets]
- [Responsive behavior: flex direction, alignment, wrapping, safe areas]
## Structure
```txt
[Screen]
├─ [Header]
│  ├─ [Text: "Exact title"; fg: token-or-hex]
│  └─ [Text: "Exact subtitle"; fg: token-or-hex]
├─ [Section: "Exact section title"]
│  ├─ [Text: "Exact helper text"; fg: token-or-hex]
│  └─ [Button: "Exact label"; bg: token-or-hex; fg: token-or-hex]
│     ├─ [Icon: sf.symbol.name-or-description; fg: token-or-hex]
│     └─ [Text: "Exact label"; fg: token-or-hex]
└─ [Footer/Action]
```
## Reusable components
- **[Component/area]:** [Existing component to reuse, or concise visual description if none fits]
## Styling and tokens
- **Background:** [existing token or Figma value]
- **Text:** [existing text style/token or Figma value]
- **Spacing:** [existing spacing tokens; Figma values as guidance]
- **Corners/shadows/borders:** [existing token or observed value]
- **Icons/images:** [asset description, SF Symbol name when applicable, sizing]
- **Proposed new tokens:** [name/value only when existing tokens are not close enough]
## Visual implementation notes
- [Layout, reuse, assets, and styling guidance needed to reproduce the design]
- [Visually relevant caveats, e.g. avoid absolute positioning or preserve a fixed aspect ratio]
````

## Structure rules
- Include a plain tree for every non-trivial screen.
- Prefer semantic labels over Figma layer names.
- Use `[Text: "..."; fg: ...]`, `[Button: "..."; bg: ...; fg: ...]`, `[Icon: ...; fg: ...]`, `[Row: ...; bg: ...; fg: ...]`, `[Section: "..."]`.
- For controls and containers with visible fills, always include `bg:`. For visible text/icons, always include `fg:`.
- Use closest app tokens when known and close; otherwise use Figma hex/rgba.

## SF Symbols
When a Figma node appears to be an SF Symbol, check layer/component names, MCP/generated code such as `Image(systemName: "...")`, nearby app icon usage, and SF Symbols.app if installed. If unresolved, mark it unresolved instead of guessing.

## Scope boundary
- Stay concerned with visual fidelity and reuse of existing presentational UI.
- Do not recommend architectural changes, refactors, domain abstractions, hooks, callback utilities, state libraries, data models, API integration, analytics, or control-flow patterns.
- Do not infer hidden behavior from appearance. Omit details that cannot be verified from the design or app.
- Name an existing component only after verifying that its visuals and intended UI role fit the design.

## Quality rules
- Do not paste raw Figma/MCP JSON.
- Do not invent copy or behavior.
- Do not omit where elements sit. State alignment, anchoring, order, and any visually defining offsets.
- Do not turn every Figma coordinate into an implementation coordinate; use exact offsets only where they define the composition.
- Ground component, asset, and token recommendations in inspected app files.
- Keep each file simple enough to implement without reopening Figma for basic layout, copy, styling, or asset choices.
