---
name: figma-to-md
description: Converts one or more Figma design links into concise per-screen Markdown design specs. Use when the user provides Figma links, asks to inspect Figma designs, or wants design screens documented under designs/ for implementation planning.
model: gpt-5.6-terra
effort: medium
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
   - Distinguish a component's API and role from evidence about its rendered appearance. If visual styling is not available in the inspected source, list it only as a candidate and explicitly require visual verification before reuse.
   - Treat an inspected token file as evidence of what it contains, not proof that the broader app has no other tokens. Before proposing a new token, inspect the relevant broader catalog when available; otherwise make the proposal conditional on that check.
   - Do not investigate or prescribe business logic, state management, data flow, navigation architecture, hooks, analytics, or event-handler patterns.

3. **Fetch Figma via MCP**
   - Inspect frames, hierarchy, text layers, colors, typography, spacing, assets, and generated code context.
   - For each raster illustration or image that must be implemented, record its Figma file key, node ID, and node URL. Do not call `download_assets`; a later implementation task can use the file key and node ID to retrieve the full-resolution original source image.
   - Process each distinct screen independently.
   - Treat absolute positions as visual guidance, not implementation instructions.

4. **Describe the visual implementation**
   - Prefer responsive flex/layout descriptions over absolute coordinates.
   - Record each element's placement and alignment relative to its parent or nearby anchors. Associate every numeric value with the specific element, edge, or gap it describes. Do not transfer a container inset to a child edge or infer that separate edges align unless the evidence establishes that relationship.
   - Include exact edge offsets when placement is visually defining, such as floating controls positioned `40px from the bottom edge` of the reference frame.
   - Do not add a competing layout rule that contradicts a verified offset or anchor. For example, do not call a group vertically centered when its top position is explicitly fixed unless both facts are verified.
   - Map values to existing presentational components and tokens only when their relevant visual definitions were inspected and are genuinely close. Matching purpose, prop names, or copy alone is insufficient evidence of a visual match.
   - If the closest token would visibly change the design, keep the Figma value and propose a new token in Markdown. Do not edit token files unless explicitly asked.
   - Preserve all visible text exactly 1:1, including capitalization, punctuation, meaningful line breaks, and button labels. Record the verified typography for every distinct visible text role, including labels inside controls.
   - Mark visually relevant properties as unspecified when the evidence does not define them. Do not convert an unknown fill, offset, border, shadow, state, alignment relationship, or scrolling behavior into a plausible default such as `transparent`, `none`, a nearby container inset, or `no scrolling`.
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
- **[Component/area]:** [Existing component to reuse only when its visuals were verified; otherwise a candidate requiring visual verification, or a concise visual description]
## Styling and tokens
- **Background:** [existing token or Figma value]
- **Text:** [existing text style/token or Figma value]
- **Spacing:** [existing spacing tokens; Figma values as guidance]
- **Corners/shadows/borders:** [existing token or observed value]
- **Icons/images:** [asset description, SF Symbol name when applicable, sizing]
- **Downloadable source assets:** [for each raster illustration/image: name; Figma file key; node ID; Figma node URL]
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
- Directly recommend reusing an existing component only after verifying that its visuals and intended UI role fit the design. A component with an appropriate name, API, or role but uninspected styling may be named only as a candidate requiring visual verification.

## Quality rules
- Do not paste raw Figma/MCP JSON.
- Do not invent copy, behavior, or visual defaults for unspecified properties. State `unspecified in the inspected evidence` when omission could otherwise be mistaken for a verified default.
- Do not omit where elements sit. State alignment, anchoring, order, and any visually defining offsets.
- Do not turn every Figma coordinate into an implementation coordinate; use exact offsets only where they define the composition, and do not contradict them with unsupported centering or anchoring guidance.
- Ground component, asset, and token recommendations in inspected app files. Do not infer that a token is globally absent from a narrow or partial catalog; inspect more broadly or make any new-token proposal conditional.
- Include the Figma file key and node ID for all implementation-required raster assets so they can be downloaded in full resolution later. Do not download assets or persist temporary download URLs.
- Keep each file simple enough to implement without reopening Figma for basic layout, copy, styling, or asset choices.
