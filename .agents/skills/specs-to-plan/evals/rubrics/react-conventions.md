Evaluate whether the planner discovers and follows repository conventions before recommending implementation. Judge evidence-based pattern recognition, not compliance with generic stylistic preferences or exact syntax.

## Verified evidence

- `SettingsScreen` and `ProfileDetailsScreen` use feature folders, `ScreenTemplate`, translation keys, `.types.ts`, `.styles.ts`, and barrel exports.
- `PaymentMethodsScreen` is the closest current list analogue. It additionally uses `ResourceState`, `SettingsRow`, colocated query options, a colocated component test, shared test helpers/fixtures, translated state/action copy, and a footer action.
- `ScreenTemplate` already owns safe area, heading semantics, scrolling, footer, and test ID.
- `ResourceState` already owns loading and error/retry presentation. `SettingsRow` owns the established account-list row interaction.
- Typed routes for SavedAddresses, AddAddress, and EditAddress already exist.
- `getSavedAddresses(signal)` and the `Address` model already exist; service changes are out of scope.
- Both English and Spanish locale catalogs must receive corresponding copy.
- The standalone `SavedAddressesScreen.tsx` is a legacy placeholder: it duplicates layout, hardcodes copy, manually coordinates fetching, lacks failure/empty/default/add behavior, and does not follow the dominant folder convention.
- Object-shaped screen/component contracts consistently use `interface` in `.types.ts`. This is evidence for local consistency only. A union or alias may validly use `type`; a blanket “interfaces are always better” claim is unsupported.

## Strong target

A strong recommendation first inspects multiple representative files, distinguishes the dominant current pattern from the legacy target, and proposes:

- replacing the standalone target with a `SavedAddressesScreen/` folder containing screen, types, styles, query options, test, and index export;
- composing `ScreenTemplate`, `ResourceState`, and `SettingsRow` rather than recreating their responsibilities;
- using a colocated query-options factory around the unchanged API and forwarding cancellation;
- extending Settings through its existing row/navigation/localization pattern;
- adding matching localized copy to every locale;
- using typed existing add/edit routes;
- following local declaration, styling, export, and test-fixture conventions without turning them into universal language rules;
- introducing no new shared abstraction because existing components cover the needs.

Equivalent filenames and grouping receive full credit when they genuinely match the discovered dominant pattern. Do not reward naming existing components without assigning their real responsibilities.

## Recommendation quality — 0.00 to 1.00

Score the planner's first substantive recommendation for each convention/design dimension before engineer correction. The interview contract requires one decision at a time, so do not expect Turn 1 to enumerate the whole implementation. Across the interview, evaluate whether each pattern was independently discovered and correctly recommended when that concern first arose; later correction of a weak recommendation does not erase it.

### Pattern discovery and evidence — 0.25

Inspects representative sibling screens, shared components, navigation, locales, tests, and API. Distinguishes repeated current conventions from one-off or legacy code. Penalize recommendations formed from `spec.md` and target file alone.

### Reuse and responsibility fit — 0.25

Reuses existing layout, resource-state, and row components for the responsibilities they already own. Penalize duplicate layout/state UI or invented wrappers/components/frameworks.

### Structure and local code conventions — 0.20

Follows feature-folder, types, styles, query-options, tests, and public-export patterns. Treats interface/type as contextual: follows the observed convention for equivalent object contracts without making a universal rule or damaging type modeling.

### Existing boundaries — 0.20

Keeps address API and typed navigation contracts unchanged, forwards query cancellation, uses existing add/edit routes, and extends every locale rather than hardcoding copy.

### Scope discipline — 0.10

Avoids unrelated refactors and speculative abstractions; identifies the legacy target as something to replace rather than emulate.

The aggregate first-recommendation score across these dimensions must reach 0.88 even if the final plan is correct.

## Final plan quality — 0.00 to 1.00

### Complete convention-aligned design — 0.45

Names reused components and responsibilities, concrete files/exports, query/API flow, Settings entry, route behavior, locale changes, accessible loading/error/empty/populated/default presentations, and add/edit interactions. Rejected bespoke designs do not return.

### Verification — 0.25

Covers Settings navigation; localized copy; loading/error/retry; empty/populated/default states; add/edit navigation and ID; accessibility; cancellation forwarding; and use of existing test helpers/fixtures.

### Grounding and restraint — 0.20

Separates proven repeated patterns from assumptions, follows conventions where applicable, preserves legitimate type-model choices, and introduces no needless abstractions or API changes.

### Delivery — 0.10

Provides ordered implementation steps, normal rollout, practical rollback, and concrete risks such as inconsistent copy, inaccessible status, incorrect route IDs, or duplicated shared behavior.

## Output

Return recommendation and plan scores independently. `overallScore` is their arithmetic mean. Feedback must distinguish initial pattern-discovery/recommendation defects from final-plan defects.
