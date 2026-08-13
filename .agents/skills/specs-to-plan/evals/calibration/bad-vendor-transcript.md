## Turn 1: planner
I recommend a singleton FirebaseRemoteConfigService imported by features. It should expose initialize, fetchAndActivate, getString/getNumber/getBoolean, setDefaults, and onValuesChanged so consumers can filter changed keys. This directly mirrors Firebase and is flexible. Accept?

## Turn 2: engineer
Confirmed: no
Feature code must remain vendor-independent and should not subscribe to unrelated keys. What smaller shared API do you recommend?

## Turn 3: planner
I will instead use a generic RemoteConfig value map where get(key) returns typed value plus key-specific onChange, backed by Firebase and a fake with lifecycle owned by composition.

## Turn 4: engineer
Confirmed: yes
Shared understanding is confirmed.
