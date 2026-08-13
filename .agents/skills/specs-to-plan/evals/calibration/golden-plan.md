# Reactive Remote Config implementation plan

## At a glance
**Spec:** `spec.md`
**Goal:** Add typed, synchronous, key-reactive configuration without exposing Firebase to features.
**Approach:** Define a minimal generic core contract, implement it with one Firebase update fan-out, and inject it with a mutable test fake.
**Status:** Agreed

## Relevant context
- Shared contracts live in `src/core`, vendor classes in `src/infrastructure/firebase`, fakes in `src/testing`, and lifecycle in `createAppDependencies`.
- Firebase Remote Config 23.5.0 supplies native string, number, and boolean getters.

## Decisions
### Minimal shared boundary
**Choice:** Define `RemoteConfigPrimitive = string | number | boolean`, `RemoteConfigValue<T> { readonly value: T; onChange(listener: (value: T) => void): Unsubscribe }`, and `RemoteConfig<Values> { get<Key extends keyof Values>(key: Key): RemoteConfigValue<Values[Key]> }`, with a mapped constraint ensuring all values are primitives.
**Why:** Keys determine types and each consumer reads/observes only its own value.
**Alternatives:** Reject `get<T>(string)`, Firebase-shaped getters, global callbacks, setters, lifecycle, hooks, and provider factories because they weaken safety or expose unrelated concerns.

### Firebase implementation and initial values
**Choice:** `FirebaseRemoteConfig<Values>` receives one initial-values object defining keys, types, and immediate values. It chooses `getString`, `getNumber`, or `getBoolean` from each initial value's primitive type. No schema or decoder exists.
**Why:** Initial reads are synchronous and Firebase already supplies typed primitive getters.
**Alternatives:** Reject raw strings, codecs, feature parsing, and duplicated defaults.

### Reactive update flow
**Choice:** Cache one stable binding per key. Own one Firebase provider subscription. After an update, activate before reading affected known keys, compare with `Object.is`, update and notify only changed key bindings, and preserve last values on failure. `onChange` returns unsubscribe. Composition owns startup/disposal on the concrete implementation.
**Why:** This prevents listener multiplication and unrelated notifications.
**Alternatives:** Reject listener-per-read, global changes, duplicate emissions, and lifecycle on the shared contract.

### Fake and composition
**Choice:** `FakeRemoteConfig<Values>` implements the read-only interface, accepts initial values, and adds a test-only typed `set(key, value)` that synchronously notifies only when changed. Composition defines `AppRemoteConfigValues`, constructs initial values/Firebase implementation, injects `RemoteConfig<AppRemoteConfigValues>`, and disposes the concrete resource.
**Why:** Features and tests share one consumer API without production mutation.
**Alternatives:** Reject Firebase in tests and setters on `RemoteConfig`.

## Proposed architecture and data flow
Feature code depends on `RemoteConfig<AppRemoteConfigValues>`. Composition creates `FirebaseRemoteConfig` with initial values. `get(key)` returns a stable current-value binding. The concrete class receives provider updates, activates them, reads changed known keys through native typed getters, and fans effective changes to only matching bindings. The fake substitutes at the same boundary.

## API, schema, and UI changes
- Add the generic core types and no UI API.
- Add Firebase and fake implementations.
- Add app value map/initial values and dependency injection/disposal.
- Expose no Firebase types, setters, provider selection, analytics, or hooks.

## Implementation steps
1. Add core types and compile-time tests.
2. Add stable binding and Firebase implementation/update lifecycle tests.
3. Add fake and tests.
4. Wire app composition and migrate the first consumer.

## Testing and acceptance coverage
- Compile-time known-key/value relationships and unknown-key rejection.
- Immediate initial reads and string/number/boolean native getter selection.
- Stable repeated bindings, changed-key-only notification, identical-value suppression, unsubscribe, and unknown provider keys.
- Activation before publication, failure retaining last value, one provider subscription, and disposal.
- Fake typed mutation and composition injection; assert consumers import no Firebase.

## Rollout, rollback, observability, and risks
- **Rollout:** Normal app release after typecheck, tests, and lint.
- **Rollback:** Remove consumers and composition injection; leave remote values unused.
- **Signal:** Existing error logging only; no config analytics.
- **Risk:** Listener leak or notification storm; verify one subscription, unsubscribe, and equality suppression.
- **Risk:** Initial/activated race; verify activation ordering and last-value preservation.

## Open questions
- None.
