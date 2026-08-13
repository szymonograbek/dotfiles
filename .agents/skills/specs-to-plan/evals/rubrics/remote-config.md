Evaluate the implementation-design interview and resulting `plan.md`. The central purpose is to test whether the planner independently recommends a minimal, sound abstraction—not merely whether the engineer eventually corrects it.

Judge architectural meaning, not exact syntax or names. Equivalent small type-safe designs are valid. In particular, `get(key) → { value, onChange }`, `value(key) → { current, onChanged }`, and other naming-equivalent key-scoped stable bindings receive the same API score when they expose synchronous readonly state, narrowly scoped change registration, and unsubscribe. Do not deduct for spelling alone.

## Verified requirements and repository evidence

- Features need vendor-independent, read-only remote configuration backed first by Firebase.
- Supported values are string, number, and boolean.
- Every known key has a synchronous initial value before network activation.
- Consumers react only to live changes for the key they use; unchanged and unrelated values do not notify.
- Consumers unsubscribe explicitly; provider failure preserves the last effective value.
- Tests change values without Firebase, while mutation remains absent from the production consumer contract.
- App composition owns provider startup/disposal. No multiple providers, provider registry, runtime provider selection, persistence, analytics, objects, experiments, or core React hooks are required.
- Repository convention places shared vendor-independent contracts under `src/core/`, vendor classes under `src/infrastructure/<vendor>/`, fakes under `src/testing/`, and construction/lifecycle in `src/app/createAppDependencies.ts`.
- The existing Notifications service demonstrates shared interface → Firebase implementation → mutable fake → composition injection.
- Firebase Remote Config 23.5.0 and its native string/number/boolean getters are available.

## Sane minimal target design

A strong recommendation should independently converge on a design materially equivalent to:

```ts
type RemoteConfigPrimitive = string | number | boolean;
type Unsubscribe = () => void;

interface RemoteConfigValue<T extends RemoteConfigPrimitive> {
  readonly value: T;
  onChange(listener: (value: T) => void): Unsubscribe;
}

interface RemoteConfig<Values extends Record<string, RemoteConfigPrimitive>> {
  get<Key extends keyof Values>(key: Key): RemoteConfigValue<Values[Key]>;
}
```

A mapped generic constraint that accepts named object types is equally valid. The semantic requirements are:

- One generic value-map type makes each known key determine its value type; callers cannot lie with `get<T>(key: string)`.
- `get(key)` returns a stable key-scoped binding exposing only synchronous current `value` and `onChange` with unsubscribe.
- The shared consumer contract exposes no Firebase types, global changed-key callback, typed provider getters, setters, lifecycle, factories, hooks, or initialization.
- `FirebaseRemoteConfig<Values>` receives an initial-values object defining keys, types, and synchronous values; it selects Firebase native getters from each initial primitive's runtime type. No decoder/schema/codec is needed.
- Repeated `get` calls reuse a binding. The Firebase implementation owns one provider update subscription, activates before reading, fans changed effective values to affected key bindings, suppresses unchanged values, and preserves the last effective value on failure.
- Provider lifecycle belongs to the concrete Firebase implementation and composition root, not consumer features or the shared interface.
- `FakeRemoteConfig<Values>` implements the read-only contract and adds test-only typed mutation that synchronously notifies only changed keys.
- Composition defines the concrete app value map/initial object, injects the shared interface, and disposes the concrete resource.

Do not require exact filenames or exact interface syntax when responsibilities and guarantees are equivalent.

## Recommendation quality score — 0.00 to 1.00

Score the planner's first substantive recommendation for each design dimension before engineer correction. Later correction improves the final-plan score but does not erase a poor initial recommendation.

### Boundary and dependency direction — 0.20

- Independently recommends a generic vendor-free `RemoteConfig` boundary and Firebase-specific implementation following repository placement/injection.
- Penalize Firebase imports in features or a nominal abstraction that exposes Firebase lifecycle/types.

### API minimality and type safety — 0.30

- Independently recommends key-derived typing and a stable key-scoped binding with directly exposed current state plus narrowly scoped change registration/unsubscribe; method and property names are not scored.
- Penalize `get<T>(string)`, global `onValuesChanged`, changed-key arrays, separate consumer getters, setters, initialization, broad service APIs, provider registries/factories, or hooks.

### Initial values and Firebase implementation — 0.20

- Recommends one typed initial-values object as keys/types/synchronous values and native Firebase getters selected by primitive type.
- Penalize decoders/codecs/schema machinery, raw strings, caller parsing, or unclear pre-activation behavior.

### Reactivity and lifecycle — 0.20

- Recommends stable key bindings, one centralized provider listener, activation before publication, changed-value suppression, key-only fan-out, unsubscribe, last-value preservation, and composition-owned disposal.
- Penalize listener-per-read/consumer, unrelated notifications, false emissions, or consumer-owned Firebase lifecycle.

### Testability and simplicity — 0.10

- Recommends a mutable fake implementing the read-only production interface and avoids abstractions not demanded by the requirements.

A recommendation score below 0.85 fails the eval even if the final plan is corrected.

## Final plan quality score — 0.00 to 1.00

### Complete agreed design — 0.45

- Concrete interface semantics, generic relationships, responsibilities, dependency direction, initial values, native getter selection, Firebase update flow, stable bindings, effective-value comparison, failure behavior, lifecycle, fake, and composition are explicit. These may be resolved through separate one-decision interview turns; do not expect the first boundary recommendation to pre-answer later implementation decisions.
- Rejected designs do not reappear.

### Verification and acceptance mapping — 0.25

- Covers compile-time key/value safety; immediate reads; each primitive; stable bindings; key-specific and identical-value behavior; unsubscribe; unknown keys; activation ordering; provider failure; one subscription/disposal; fake mutation; composition injection; and no Firebase imports in consumers.

### Sequencing, rollout, and risks — 0.20

- Steps are dependency ordered and independently implementable.
- Normal-release rollout, practical rollback, and listener leak/update storm/startup race risks have concrete mitigations.

### Grounding and plan format — 0.10

- Uses repository conventions and the required specs-to-plan structure.
- Carries no invented product behavior or unnecessary open questions.
- Is detailed enough for plan-to-tickets without reopening architectural decisions.

## Output scoring

Return recommendation and plan scores independently. Compute `overallScore` as their arithmetic mean. Feedback must identify the strongest and weakest first recommendations separately from final-plan defects.
