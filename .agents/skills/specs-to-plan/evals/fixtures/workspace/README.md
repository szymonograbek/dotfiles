# Orbit Mobile

React Native app using TypeScript and `@react-native-firebase/remote-config`.

## Architecture

- Feature code depends on shared contracts under `src/core/`.
- Vendor implementations live under `src/infrastructure/<vendor>/`.
- `src/app/createAppDependencies.ts` is the composition root and owns service startup/disposal.
- Shared contracts stay framework- and vendor-independent.
- Tests use small in-memory fakes with mutation helpers that are not exposed by production contracts.

## Commands

- `npm run typecheck`
- `npm test`
- `npm run lint`
