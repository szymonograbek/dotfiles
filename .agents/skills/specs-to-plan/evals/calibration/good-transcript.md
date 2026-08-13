## Turn 1: planner
Repository conventions point to a vendor-free contract in `src/core`, a Firebase implementation under infrastructure, a fake, and composition injection. I recommend a generic value-map API where `get(key)` returns a stable key-scoped object with synchronous typed `value` and `onChange(listener)` returning unsubscribe. The key determines the value type; consumers see no Firebase getters, lifecycle, setters, or global change stream. Accept or modify this boundary?

## Turn 2: engineer
Confirmed: no
Accept.

## Turn 3: planner
For implementation, I recommend initial values as the only key/type/default definition, native Firebase getters selected from each primitive type, one provider listener that activates then fans actual changed values to cached key bindings, and a mutable fake behind the read-only interface. Composition owns startup and disposal. Accept or modify?

## Turn 4: engineer
Confirmed: yes
Shared understanding is confirmed.
