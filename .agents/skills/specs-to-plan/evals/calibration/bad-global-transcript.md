## Turn 1: planner
I recommend a vendor-independent `RemoteConfig` with `get<T>(key: string): T` and `onValuesChanged(listener: (keys: string[]) => void)`. Firebase implements it, and consumers filter keys and call get again. Accept?

## Turn 2: engineer
Confirmed: no
The caller can lie about T and every consumer receives unrelated changes. Recommend a smaller key-safe API.

## Turn 3: planner
Use a generic value map so the key chooses its type, and return a stable key-scoped object with current value and onChange/unsubscribe. Firebase owns one listener and a fake supports tests.

## Turn 4: engineer
Confirmed: yes
Shared understanding is confirmed.
