import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { execPath } from 'node:process';
import { promisify } from 'node:util';
import { describe, it } from 'vitest';
import { StateStore, useEffect } from '../../src/index.js';
import { tick } from '../support/tick.js';

describe('StateStore', () => {
    describe('proxy access', () => {
        it('constructs callable stores without string code generation', async () => {
            const entry = new URL('../../src/index.js', import.meta.url).href;

            await promisify(execFile)(execPath, [
                '--disallow-code-generation-from-strings',
                '--input-type=module',
                '--eval',
                `import assert from 'node:assert/strict';
                import { StateStore } from ${JSON.stringify(entry)};
                const store = StateStore.wrap({ count: 1 });
                assert.ok(store instanceof StateStore);
                assert.ok(store instanceof Function);
                assert.equal(store('count')(), 1);
                assert.equal(store(), store);`,
            ]);
        });

        it('reads shallow values via proxy', () => {
            const store = new StateStore();

            store.set({ a: 1 });

            assert.strictEqual(store.a, 1);
        });

        it('writes shallow values via proxy', () => {
            const store = new StateStore();

            store.a = 2;

            assert.strictEqual(store.a, 2);
        });

        it('creates shallow values via proxy assignment', () => {
            const store = new StateStore();

            store.a = 1;

            assert.strictEqual(store.a, 1);
            assert.strictEqual(store.has('a'), true);
        });

        it('does not create state on symbol access', () => {
            const store = new StateStore();

            const iter = store[Symbol.iterator];

            assert.strictEqual(iter, undefined);
            assert.strictEqual(store.has('Symbol(Symbol.iterator)'), false);
        });

        it('does not create state on missing property read', () => {
            const store = new StateStore();

            assert.strictEqual(store.missing, undefined);
            assert.strictEqual(store.has('missing'), false);
            assert.deepStrictEqual(Object.keys(store), []);
        });

        it('does not expose internal-looking keys by default', () => {
            const store = new StateStore();

            assert.strictEqual(store._state, undefined);
            assert.strictEqual(store.has('_state'), false);
            assert.deepStrictEqual(Object.keys(store), []);
        });

        it('allows common function property names as state keys', () => {
            const store = new StateStore();

            store.name = 'counter';
            store.length = 1;

            assert.strictEqual(store.name, 'counter');
            assert.strictEqual(store.use('name')(), 'counter');
            assert.strictEqual(store.length, 1);
            assert.deepStrictEqual(Object.keys(store).sort(), ['length', 'name']);
        });

        it('safely exposes non-configurable function properties', () => {
            const store = new StateStore();

            assert.strictEqual(store.arguments, null);
            assert.strictEqual(store.caller, null);
            assert.strictEqual(typeof store.prototype, 'object');
            assert.strictEqual('arguments' in store, true);
            assert.strictEqual('caller' in store, true);
            assert.strictEqual('prototype' in store, true);
        });

        it('returns the proxy when called without arguments', () => {
            const store = new StateStore();

            assert.strictEqual(store(), store);

            store().count = 1;

            assert.strictEqual(store.count, 1);
        });
    });

    describe('state accessors', () => {
        it('reads shallow values via use()', () => {
            const store = new StateStore();

            store.set({ a: 1 });

            assert.strictEqual(store.use('a')(), 1);
        });

        it('writes shallow values via use()', () => {
            const store = new StateStore();

            store.set({ a: 1 });
            store.use('a').set(2);

            assert.strictEqual(store.a, 2);
        });

        it('returns a state accessor from use()', () => {
            const store = new StateStore();

            const state = store.use('count', 1);

            assert.strictEqual(typeof state, 'function');
        });

        it('writes through the state accessor returned by use()', () => {
            const store = new StateStore();

            const state = store.use('count', 1);
            state(2);

            assert.strictEqual(store.count, 2);
        });
    });

    describe('introspection', () => {
        it('rejects integrity changes without damaging the store', () => {
            for (const lock of [Object.preventExtensions, Object.seal, Object.freeze]) {
                for (const initial of [{}, { count: 1 }]) {
                    const store = StateStore.wrap(initial);

                    assert.throws(() => lock(store), TypeError);
                    assert.strictEqual(Object.isExtensible(store), true);
                    assert.strictEqual(Reflect.preventExtensions(store), false);

                    store.count = 2;
                    assert.deepStrictEqual(Object.keys(store), ['count']);
                    assert.strictEqual(store.count, 2);
                }
            }
        });

        it('supports has() for existing keys', () => {
            const store = new StateStore();

            store.set({ a: 1 });

            assert.strictEqual(store.has('a'), true);
        });

        it('supports has() for missing keys', () => {
            const store = new StateStore();

            assert.strictEqual(store.has('b'), false);
        });

        it('supports the "in" operator for existing keys', () => {
            const store = new StateStore();

            store.set({ a: 1 });

            assert.strictEqual('a' in store, true);
        });

        it('supports the "in" operator for missing keys', () => {
            const store = new StateStore();

            assert.strictEqual('b' in store, false);
        });

        it('supports the "in" operator for store methods', () => {
            const store = new StateStore();

            assert.strictEqual('use' in store, true);
            assert.strictEqual('set' in store, true);
            assert.strictEqual('_state' in store, false);
        });

        it('iterates keys with keys()', () => {
            const store = new StateStore();

            store.set({ a: 1, b: 2 });

            assert.deepStrictEqual(
                Array.from(store.keys()).sort(),
                ['a', 'b'],
            );
        });

        it('returns keys via Object.keys()', () => {
            const store = new StateStore();

            store.set({ a: 1, b: 2 });

            assert.deepStrictEqual(
                Object.keys(store).sort(),
                ['a', 'b'],
            );
        });

        it('does not track values while enumerating keys', async () => {
            const store = new StateStore();
            let runs = 0;

            store.count = 1;

            useEffect(() => {
                runs += 1;
                Object.keys(store);
            });

            store.count = 2;
            await tick();

            assert.strictEqual(runs, 1);
        });
    });

    describe('property operations', () => {
        it('deletes keys reactively and preserves subscriptions on reassignment', async () => {
            const store = StateStore.wrap({ count: 1 });
            const values = [];
            const effect = useEffect(() => values.push(store.count));

            assert.strictEqual(delete store.count, true);
            assert.strictEqual(store.count, undefined);
            assert.strictEqual(store.has('count'), false);
            assert.strictEqual('count' in store, false);
            assert.deepStrictEqual(Object.keys(store), []);
            await tick();

            store.count = 2;
            await tick();

            assert.deepStrictEqual(values, [1, undefined, 2]);
            effect.stop();
        });

        it('restores deleted keys through previously returned accessors', () => {
            for (const write of [
                (state) => state(2),
                (state) => state.set(2),
                (state) => {
                    state.value = 2;
                },
                (state) => state(undefined),
            ]) {
                const store = StateStore.wrap({ count: 1 });
                const state = store.use('count');

                delete store.count;
                assert.strictEqual(store.has('count'), false);
                write(state);

                assert.strictEqual(store.has('count'), true);
                assert.strictEqual(store.count, state());
                assert.deepStrictEqual(Object.keys(store), ['count']);
            }
        });

        it('handles missing, reserved, and symbol deletions', () => {
            const store = new StateStore();
            const symbol = Symbol('metadata');

            store[symbol] = 1;

            assert.strictEqual(delete store.missing, true);
            assert.strictEqual(delete store[symbol], true);
            assert.strictEqual(symbol in store, false);
            assert.strictEqual(Reflect.deleteProperty(store, 'use'), false);
            assert.strictEqual(Reflect.deleteProperty(store, 'prototype'), false);
            assert.strictEqual(typeof store.use, 'function');
        });

        it('defines data properties through reactive state', async () => {
            const store = new StateStore();
            const values = [];
            const effect = useEffect(() => values.push(store.count));

            Object.defineProperty(store, 'count', {
                value: 1,
                configurable: true,
                enumerable: true,
                writable: true,
            });
            await tick();

            Object.defineProperty(store, 'count', { value: 2 });
            await tick();

            assert.strictEqual(store.count, 2);
            assert.strictEqual(store.use('count')(), 2);
            assert.deepStrictEqual(Object.getOwnPropertyDescriptor(store, 'count'), {
                value: 2,
                configurable: true,
                enumerable: true,
                writable: true,
            });
            assert.deepStrictEqual(values, [undefined, 1, 2]);
            effect.stop();
        });

        it('rejects unsupported descriptors without changing state', () => {
            const store = StateStore.wrap({ count: 1 });

            for (const descriptor of [
                { value: 2, configurable: false },
                { value: 2, enumerable: false },
                { value: 2, writable: false },
                { get: () => 2 },
                { set: () => {} },
            ]) {
                assert.strictEqual(Reflect.defineProperty(store, 'count', descriptor), false);
                assert.strictEqual(store.count, 1);
                assert.strictEqual(store.use('count')(), 1);
            }

            assert.strictEqual(Reflect.defineProperty(store, 'missing', { value: 2 }), false);
            assert.strictEqual(store.has('missing'), false);
            assert.strictEqual(Reflect.defineProperty(store, 'use', { value: 2 }), false);
            assert.strictEqual(typeof store.use, 'function');
        });
    });

    describe('reserved keys', () => {
        it('rejects reserved keys via use()', () => {
            const store = new StateStore();

            assert.throws(
                () => store.use('use', 1),
                /reserved StateStore key/,
            );
        });

        it('rejects reserved keys via proxy assignment', () => {
            const store = new StateStore();

            assert.throws(
                () => {
                    store.use = 1;
                },
                /reserved StateStore key/,
            );
        });

        it('rejects reserved keys via set()', () => {
            const store = new StateStore();

            assert.throws(
                () => store.set({ use: 1 }),
                /reserved StateStore key/,
            );
        });

        it('rejects non-configurable function keys without storing them', () => {
            for (const key of ['arguments', 'caller', 'prototype']) {
                const store = new StateStore();

                assert.throws(
                    () => {
                        store[key] = 1;
                    },
                    /reserved StateStore key/,
                );
                assert.strictEqual(store.has(key), false);
            }
        });

        it('validates set() before changing the store', () => {
            const store = new StateStore();

            assert.throws(
                () => store.set({ added: 1, use: 2 }),
                /reserved StateStore key/,
            );

            assert.strictEqual(store.has('added'), false);
        });

        it('allows internal-looking keys when they are not part of the API', () => {
            const store = new StateStore();

            store._state = 'user value';

            assert.strictEqual(store._state, 'user value');
            assert.strictEqual(store.has('_state'), true);
        });
    });

    describe('value handling', () => {
        it('handles array values as plain values', () => {
            const store = new StateStore();
            const arr = [1, 2, 3];

            store.set({ a: arr });

            assert.strictEqual(store.a, arr);
        });

        it('handles null values as plain values', () => {
            const store = new StateStore();

            store.set({ a: null });

            assert.strictEqual(store.a, null);
        });

        it('handles Date values as plain values', () => {
            const store = new StateStore();
            const value = new Date();

            store.set({ a: value });

            assert.strictEqual(store.a, value);
        });

        it('keeps nested objects plain when using set', () => {
            const store = new StateStore();

            store.set({ a: { b: 1 } });

            assert.ok(!(store.a instanceof StateStore));
            assert.strictEqual(store.a.b, 1);
        });
    });

    describe('wrap', () => {
        it('creates a nested store', () => {
            const store = new StateStore();

            store.set({ a: StateStore.wrap({ b: 1 }) });

            assert.ok(store.a instanceof StateStore);
        });

        it('reads nested values via proxy', () => {
            const store = new StateStore();

            store.set({ a: StateStore.wrap({ b: 1 }) });

            assert.strictEqual(store.a.b, 1);
        });

        it('writes nested values via proxy', () => {
            const store = new StateStore();

            store.set({ a: StateStore.wrap({ b: 1 }) });
            store.a.b = 2;

            assert.strictEqual(store.a.b, 2);
        });

        it('returns non-plain values as-is', () => {
            const date = new Date();
            const arr = [1, 2, 3];

            assert.strictEqual(StateStore.wrap(date), date);
            assert.strictEqual(StateStore.wrap(arr), arr);
        });

        it('detects plain objects by prototype', () => {
            const value = { a: 1 };

            Object.defineProperty(value, 'constructor', {
                value: null,
            });

            const wrapped = StateStore.wrap(value);

            assert.ok(wrapped instanceof StateStore);
            assert.strictEqual(wrapped.a, 1);
        });

        it('keeps nested objects plain when deep=false', () => {
            const wrapped = StateStore.wrap({ a: { b: 1 } });

            assert.ok(wrapped instanceof StateStore);
            assert.ok(!(wrapped.a instanceof StateStore));
            assert.strictEqual(wrapped.a.b, 1);
        });

        it('wraps nested plain objects when deep=true', () => {
            const wrapped = StateStore.wrap({ a: { b: 1 } }, { deep: true });

            assert.ok(wrapped instanceof StateStore);
            assert.ok(wrapped.a instanceof StateStore);
            assert.strictEqual(wrapped.a.b, 1);
        });

        it('preserves cycles and shared references when wrapping deeply', () => {
            const shared = { value: 1 };
            const source = { a: shared, b: shared };

            source.self = source;

            const wrapped = StateStore.wrap(source, { deep: true });

            assert.strictEqual(wrapped.self, wrapped);
            assert.strictEqual(wrapped.a, wrapped.b);
        });
    });

    describe('merge', () => {
        it('separates conflicting updates to an existing shared store', () => {
            const shared = { count: 0, nested: { kept: true, value: 0 } };
            const store = StateStore.wrap({ a: shared, b: shared }, { deep: true });
            const first = store.a;

            StateStore.merge(store, {
                a: { count: 1, nested: { value: 1 }, added: true },
                b: { count: 2 },
            }, { deep: true });

            assert.strictEqual(store.a, first);
            assert.notStrictEqual(store.a, store.b);
            assert.strictEqual(store.a.count, 1);
            assert.strictEqual(store.b.count, 2);
            assert.strictEqual(store.a.nested.value, 1);
            assert.strictEqual(store.b.nested.value, 0);
            assert.strictEqual(store.b.nested.kept, true);
            assert.strictEqual(store.b.has('added'), false);
        });

        it('separates nested updates from an existing root cycle', () => {
            const source = { count: 0 };

            source.self = source;

            const store = StateStore.wrap(source, { deep: true });

            StateStore.merge(store, { count: 1, self: { count: 2 } }, { deep: true });

            assert.strictEqual(store.count, 1);
            assert.strictEqual(store.self.count, 2);
            assert.notStrictEqual(store.self, store);
            assert.strictEqual(store.self.self, store.self);
        });

        it('throws when the existing value is not a store', () => {
            assert.throws(
                () => StateStore.merge(null, { a: 1 }),
                /StateStore instance/,
            );
        });

        it('falls back to wrap when allowFallback is true', () => {
            const merged = StateStore.merge(null, { a: 1 }, { allowFallback: true });

            assert.ok(merged instanceof StateStore);
            assert.strictEqual(merged.a, 1);
        });

        it('reuses nested stores on subsequent merge calls', () => {
            const store = new StateStore();

            StateStore.merge(store, { a: { b: 1 } }, { deep: true });
            const first = store.a;

            StateStore.merge(store, { a: { c: 2 } }, { deep: true });
            const second = store.a;

            assert.strictEqual(first, second);
        });

        it('preserves existing nested values', () => {
            const store = new StateStore();

            StateStore.merge(store, { a: { b: 1 } }, { deep: true });
            StateStore.merge(store, { a: { c: 2 } }, { deep: true });

            assert.strictEqual(store.a.b, 1);
        });

        it('adds new nested values', () => {
            const store = new StateStore();

            StateStore.merge(store, { a: { b: 1 } }, { deep: true });
            StateStore.merge(store, { a: { c: 2 } }, { deep: true });

            assert.strictEqual(store.a.c, 2);
        });

        it('overwrites nested stores with non-objects', () => {
            const store = new StateStore();

            StateStore.merge(store, { a: { b: 1 } }, { deep: true });
            StateStore.merge(store, { a: 3 }, { deep: true });

            assert.strictEqual(store.a, 3);
        });

        it('deep merges into existing nested stores', () => {
            const store = new StateStore();

            StateStore.merge(store, { a: { b: 1 } }, { deep: true });
            const first = store.a;

            StateStore.merge(store, { a: { c: 2 } }, { deep: true });
            const second = store.a;

            assert.strictEqual(first, second);
            assert.strictEqual(store.a.b, 1);
            assert.strictEqual(store.a.c, 2);
        });

        it('preserves cycles and shared references when merging deeply', () => {
            const store = new StateStore();
            const shared = { value: 1 };
            const source = { a: shared, b: shared };

            source.self = source;

            StateStore.merge(store, source, { deep: true });

            assert.strictEqual(store.self, store);
            assert.strictEqual(store.a, store.b);
        });
    });

    describe('reactivity', () => {
        it('triggers effects when a missing key is later assigned', async () => {
            const store = new StateStore();
            const values = [];

            useEffect(() => {
                values.push(store.count);
            });

            assert.deepStrictEqual(values, [undefined]);
            assert.strictEqual(store.has('count'), false);
            assert.deepStrictEqual(Object.keys(store), []);

            store.count = 1;
            await tick();

            assert.deepStrictEqual(values, [undefined, 1]);
            assert.strictEqual(store.has('count'), true);
            assert.deepStrictEqual(Object.keys(store), ['count']);
        });

        it('triggers effects for nested updates', async () => {
            const store = new StateStore();
            let runs = 0;

            StateStore.merge(store, { a: { b: 1 } }, { deep: true });

            useEffect(() => {
                runs += 1;
                store.a.b;
            });

            assert.strictEqual(runs, 1);

            store.a.b = 2;
            await tick();

            assert.strictEqual(runs, 2);
        });
    });
});
