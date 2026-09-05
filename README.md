# Frost State

[![CI](https://github.com/frost-js/state/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/frost-js/state/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/frost-js/state/branch/main/graph/badge.svg)](https://codecov.io/gh/frost-js/state)
[![npm version](https://img.shields.io/npm/v/%40fr0st%2Fstate?style=flat-square)](https://www.npmjs.com/package/@fr0st/state)
[![npm downloads](https://img.shields.io/npm/dm/%40fr0st%2Fstate?style=flat-square)](https://www.npmjs.com/package/@fr0st/state)
[![JS gzip size](https://img.badgesize.io/frost-js/state/main/dist/frost-state.min.js?compression=gzip&label=JS%20gzip%20size&style=flat-square)](https://github.com/frost-js/state/blob/main/dist/frost-state.min.js)
[![license](https://img.shields.io/github/license/frost-js/state?style=flat-square)](./LICENSE)

Small, focused reactive state primitives for values, effects, and keyed stores. Frost State has zero runtime dependencies, works in Node and bundlers, and also ships a browser-friendly UMD bundle that exposes `globalThis.State`.

## Highlights

- Named exports for tree-shaking
- Prebuilt ESM and UMD bundles in `dist/`
- No runtime dependencies
- JSDoc-powered IntelliSense

## Installation

### Node / bundlers

```bash
npm i @fr0st/state
```

Frost State's package entry point is ESM-only. Use `import` syntax in Node and bundlers.

```js
import { useEffect, useState } from '@fr0st/state';
```

### Browser (ESM)

Import the minified ESM bundle directly from a CDN:

```html
<script type="module">
    import { useEffect, useState } from 'https://cdn.jsdelivr.net/npm/@fr0st/state@latest/dist/frost-state.esm.min.js';

    const count = useState(0);

    useEffect(() => {
        console.log('count =', count());
    });

    count(1);
</script>
```

### Browser (UMD)

Load the bundle from your own copy or a CDN:

```html
<script src="/path/to/dist/frost-state.min.js"></script>
<!-- or -->
<script src="https://cdn.jsdelivr.net/npm/@fr0st/state@latest/dist/frost-state.min.js"></script>
<script>
    const { StateStore, useEffect, useState } = globalThis.State;

    const count = useState(0);

    useEffect(() => {
        console.log('count =', count());
    });

    count(1);
</script>
```

The package root resolves to the prebuilt ESM bundle. Published files under `dist/` and `src/` are also available through matching package subpaths.

## Quick Start

### Reactive values

```js
import { useEffect, useState } from '@fr0st/state';

const first = useState('Ada');
const last = useState('Lovelace');

useEffect(() => {
    console.log(`${first()} ${last()}`);
});

last('Byron');
first.value = 'Augusta'; // logs "Augusta Byron" once on the next microtask
```

### Keyed stores

```js
import { StateStore, useEffect } from '@fr0st/state';

const store = StateStore.wrap({
    count: 0,
});

useEffect(() => {
    console.log('count =', store.count);
});

store.count = 1; // logs "count = 1" on the next microtask
```

TypeScript note: Frost State is written in JavaScript and uses JSDoc types, which most editors surface as IntelliSense.

## API

Frost State exports three named APIs from `@fr0st/state`: `useState`, `useEffect`, and `StateStore`.

### `useState(value)`

Creates a callable state accessor for a single value.

```js
const state = useState(value);
```

The returned accessor supports:

- `state()`: read the current value
- `state(next)`: write the current value
- `state.get(markEffects = true)`: read the current value, optionally without effect tracking
- `state.set(next)`: write the current value
- `state.value`: read or write the current value
- `state.previous`: read the previous value after the last successful change; initially `undefined`

Writes use `Object.is` to detect changes. Writing the same value leaves `previous`
unchanged and does not schedule effects. Mutating an object or array in place does
not trigger an update; assign a different reference to notify effects.

```js
import { useState } from '@fr0st/state';

const state = useState('hello');

state(); // 'hello'
state('world');

state.get(); // 'world'
state.set('again');

state.value = 'done';
state.previous; // 'again'
```

### `useEffect(callback, options)`

Runs an effect immediately, tracks the states read synchronously during that run,
and schedules re-runs when any of those states change. Reads after an `await` or
inside a later callback are not tracked by that run.

```js
const effect = useEffect(callback, options);
```

Options:

- `options.weak` (default `false`): use a `WeakRef`-backed runner

With `weak: true`, keep a reference to the returned runner for as long as the effect
should remain active. Otherwise, it may be garbage-collected.

The returned runner supports:

- `effect()`: schedule a coalesced re-run in a microtask
- `effect.sync()`: run immediately and cancel any pending re-run
- `effect.stop()`: stop the effect, cancel pending work, and unsubscribe

```js
import { useEffect, useState } from '@fr0st/state';

const a = useState(1);
const b = useState(2);

const effect = useEffect(() => {
    console.log(a() + b());
});

a(3);
effect.sync(); // logs 5 immediately and cancels the pending microtask
effect.stop();
```

### `StateStore`

Creates a callable, proxy-backed keyed store for state accessors. Property reads
return stored values, property assignment writes keys, and missing string-key reads
return `undefined`. Effects that read missing keys subscribe to later value changes
without exposing those keys through enumeration.

```js
const store = new StateStore();
const state = store(key, defaultValue);
```

#### Instance API

The returned store supports:

- `store.key`: read an existing key
- `store.key = value`: write a key
- `delete store.key`: remove a key and reset its accessor to `undefined`
- `store.use(key, defaultValue)`: retrieve or create a state accessor
- `store(key, defaultValue)`: retrieve or create a state accessor through the callable form
- `store()`: return the store itself
- `store.set(object)`: set top-level keys from an object
- `store.has(key)`: check whether a key exists
- `store.keys()`: iterate stored keys

State keys are strings. Defaults apply when a key is created or restored after
deletion; existing keys retain their values. Symbol properties are ordinary,
nonreactive properties and are excluded from `store.keys()`.

```js
import { StateStore, useEffect } from '@fr0st/state';

const store = new StateStore();
const count = store('count', 0);

store.set({ label: 'Clicks' });

useEffect(() => {
    console.log(store.label, count());
});

count(1);
store.count = 2; // logs "Clicks 2" once on the next microtask

store.has('count'); // true
Array.from(store.keys()); // ['count', 'label']
```

Deletion preserves the accessor so effects and previously returned accessors stay
connected to the key:

```js
import { StateStore } from '@fr0st/state';

const store = StateStore.wrap({ count: 1 });
const count = store('count');

delete store.count;
store.has('count'); // false
count(); // undefined

count(2); // restores the key
store.count; // 2
store.has('count'); // true
```

String state keys support data-property definitions with `configurable`,
`enumerable`, and `writable` all enabled. New keys must explicitly enable these
attributes; updates may omit unchanged attributes:

```js
import { StateStore } from '@fr0st/state';

const store = new StateStore();

Object.defineProperty(store, 'count', {
    value: 1,
    configurable: true,
    enumerable: true,
    writable: true,
});

Object.defineProperty(store, 'count', { value: 2 }); // notifies effects normally
store.count; // 2
```

#### Static helpers

- `StateStore.wrap(value, options)`: wrap a plain object in a store
- `StateStore.merge(store, value, options)`: merge plain-object data into a store

Both helpers accept `options.deep` (default `false`) to process nested plain objects.
`wrap` returns an existing `StateStore` unchanged. For plain-object data, `merge`
updates and returns the target store. Non-plain input values are returned unchanged
by either helper; `merge` leaves the target unchanged in that case.

`merge` requires a `StateStore` target by default. Set `options.allowFallback` to
`true` to call `wrap(value, options)` when the target is not a store.

```js
import { StateStore } from '@fr0st/state';

const nested = StateStore.wrap(
    {
        user: {
            name: 'Ada',
        },
    },
    { deep: true },
);

nested.user.name = 'Grace';

const settings = new StateStore();

StateStore.merge(
    settings,
    {
        ui: {
            theme: 'dark',
        },
    },
    { deep: true },
);

StateStore.merge(
    settings,
    {
        ui: {
            compact: true,
        },
    },
    { deep: true },
);

settings.ui.theme = 'light';

nested.user.name; // 'Grace'
settings.ui.theme; // 'light'
settings.ui.compact; // true
```

Deep wrapping and merging preserve cycles and shared plain-object references.

## Behavior Notes

- `useEffect()` tracks only the states read synchronously during the latest successful run. A failed rerun retains the previous subscriptions; a failed initial run releases them.
- `useEffect()` coalesces normal re-runs in a microtask.
- `effect.sync()` runs immediately and cancels a pending re-run.
- `effect.stop()` permanently cancels the effect and releases its subscriptions.
- `store.set(...)` assigns own enumerable string keys at the top level only. Nested plain objects remain plain values.
- Use `StateStore.wrap(..., { deep: true })` or `StateStore.merge(..., { deep: true })` for nested reactive stores.
- Deep wrap and merge preserve cycles and shared references in the incoming plain-object data.
- Deep merge separates existing shared stores when distinct incoming objects update them, preserving their pre-merge values in each branch.
- Arrays, dates, class instances, and null-prototype objects are treated as plain values rather than nested stores.
- Missing property reads such as `store.missing` return `undefined`. Reads made during effect tracking still subscribe to later value changes without exposing the key.
- `store.has(key)`, `key in store`, `store.keys()`, and `Object.keys(store)` do not create effect subscriptions. Read a key's value to track it.
- Deleting a key resets its accessor to `undefined` and hides the key. Effects are scheduled when that changes the value. Writing through a previously returned accessor restores the key, including writes of `undefined`.
- For string state keys, accessor properties and restrictive descriptors are rejected without changing the key. `Object.defineProperty` throws; `Reflect.defineProperty` returns `false`.
- Stores must remain extensible. `Object.preventExtensions`, `Object.seal`, and `Object.freeze` throw without changing the store. `Reflect.preventExtensions` returns `false`.
- `constructor`, `use`, `set`, `has`, `keys`, `arguments`, `caller`, and `prototype` are reserved and cannot be used as state keys. `name` and `length` are valid state keys.
- Callable stores work with string code generation disabled.
- Weak effects rely on `WeakRef`.

## Development

```bash
npm test
npm run lint
npm run build
```

## License

Frost State is released under the [MIT License](./LICENSE).
