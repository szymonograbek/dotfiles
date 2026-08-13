# Reactive remote configuration

## At a glance

**Problem:** Features need remotely controlled values without coupling product code to Firebase or waiting for network data before rendering.
**Goal:** Provide typed, read-only remote configuration values that are immediately available and react to live changes for the specific value a consumer uses.
**Primary users:** App feature engineers and test authors.
**Success:** Features can read and observe supported values without importing Firebase, and tests can exercise changes without Firebase.
**Status:** Agreed

## Why this matters

Feature code currently has no shared remote-configuration boundary. Firebase Remote Config is the initial provider, but Firebase concepts must not spread through features or make tests depend on the SDK. The app must render safely before fetch/activation finishes and respond when activated values change while it is running.

## Scope and non-goals

- **In scope:** A shared, vendor-independent remote-configuration contract; a Firebase-backed implementation; typed string, number, and boolean values; synchronous initial values; key-specific live updates; app composition; testability without Firebase.
- **Out of scope:** Client-side writes, server configuration, JSON/object values, experiments, analytics exposure, feature-specific React hooks, provider selection at runtime, and supporting multiple active providers.

## Users, permissions, and needs

- **Feature engineer:** Reads a known key with its correct type and observes changes to only that value without Firebase imports or provider lifecycle knowledge.
- **Test author:** Supplies deterministic initial values and changes them during tests without loading Firebase.
- **App composition:** Creates and owns the configured implementation and its provider lifecycle.

## Story map

| ID | Actor | Trigger | Goal | Outcome |
| --- | --- | --- | --- | --- |
| RC-1 | Feature engineer | Feature reads configuration | Get a typed value immediately | Initial or active value is synchronously available |
| RC-2 | Feature engineer | Provider activates changed values | React to the used key changing | Only relevant subscribers are notified |
| RC-3 | Test author | Test exercises a config transition | Control values without Firebase | Test observes the same consumer contract deterministically |

## Detailed stories and scenarios

### RC-1: Read a typed value

**Story:** As a feature engineer, I want a known configuration key to have one compile-time value type so that callers cannot request the same key as incompatible types.
**Preconditions:** App composition has supplied initial values for every supported key.

#### Primary scenario

1. A consumer requests a known key.
2. Its current typed value is available synchronously, including before Firebase fetch/activation completes.

#### Alternate and non-happy scenarios

- **Unknown key:** It is rejected at compile time.
- **Provider unavailable or not activated:** The supplied initial value remains effective.
- **Unsupported type:** Objects, arrays, null, and undefined are not supported values.

#### Acceptance criteria

- Given a configured boolean, number, or string key, when a consumer reads it, then the returned value has that key's compile-time type.
- Given startup before provider activation, when a consumer reads a key, then its supplied initial value is available synchronously.
- Given feature code, when it uses remote configuration, then it imports no Firebase type or API.

### RC-2: Observe a live value

**Story:** As a feature engineer, I want to observe the configuration value I use so that unrelated remote changes do not leak into my feature.

#### Primary scenario

1. A consumer gets a key-specific value handle and subscribes to it.
2. Firebase activates a different effective value for that key.
3. The handle exposes the new value and notifies that key's subscribers.

#### Alternate and non-happy scenarios

- **Unrelated key changes:** The subscriber is not called.
- **Same effective value:** The subscriber is not called.
- **Unsubscribe:** The removed listener receives no later notifications.
- **Provider failure:** The last effective value remains available and no false change is published.

#### Acceptance criteria

- Given a key subscriber, when that key's effective value changes, then it receives the typed new value once.
- Given only another key changes, when activation completes, then the subscriber is not called.
- Given the effective value is unchanged, when provider updates are processed, then no change is emitted.
- Given an unsubscribed listener, when the key changes later, then that listener is not called.

### RC-3: Test without Firebase

**Story:** As a test author, I want a deterministic test implementation so that feature behavior can be tested without the Firebase SDK.

#### Primary scenario

1. A test creates remote configuration with typed initial values.
2. The feature reads through the production consumer contract.
3. The test changes one value through test-only API.
4. The feature observes the change.

#### Acceptance criteria

- Given a feature test, when no Firebase runtime exists, then initial reads and live changes remain testable.
- Given production feature code, then the consumer contract exposes no mutation operation.

## Cross-cutting requirements

- **Accessibility:** Not applicable; this is a non-visual infrastructure boundary.
- **Privacy/security/compliance:** Values are read-only to clients. No config values or keys are added to analytics by this capability.
- **Data lifecycle:** Initial values live in app composition; provider values remain owned by Firebase; this capability persists nothing new.
- **Analytics:** None.

## Constraints, assumptions, and risks

- **Constraint:** Firebase Remote Config is the first provider and supports native string, number, and boolean getters.
- **Constraint:** Features must remain vendor-independent.
- **Constraint:** App composition owns provider startup and disposal.
- **Assumption:** Live provider updates can identify changed keys after activation.
- **Risk:** A broad or vendor-shaped API would spread lifecycle, parsing, and unrelated changes into every consumer.
- **Risk:** Creating independent provider listeners for every read could leak resources or multiply work.

## Open questions

- None. Product behavior and scope are agreed; implementation design remains to be planned.
