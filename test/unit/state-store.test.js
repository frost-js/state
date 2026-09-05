import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { execPath } from 'node:process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, it } from 'vitest';
import { StateStore, useEffect } from '../../src/index.js';
import { tick } from '../support/tick.js';

describe('StateStore', () => {
    describe('proxy access', () => {
        it('constructs callable stores without string code generation', async () => {
            const fixture = fileURLToPath(new URL('../support/no-code-generation.js', import.meta.url));

            await promisify(execFile)(execPath, [
                '--disallow-code-generation-from-strings',
                fixture,
            ]);
        });

        it('reads shallow values via proxy', () => {
            const store = new StateStore();

            store.set({ a: 1 });

            assert.strictEqual(store.a, 1);
        });

        it('creates and updates keys via proxy assignment', () => {
            const store = new StateStore();

            store.a = 1;

            assert.strictEqual(store.a, 1);
            assert.strictEqual(store.has('a'), true);

            store.a = 2;

            assert.strictEqual(store.a, 2);
        });

        it('does not create state on symbol access', () => {
            const store = new StateStore();

            const iter = store[Symbol.iterator];

            assert.strictEqual(iter, undefined);
            assert.strictEqual(store.has('Symbol(Symbol.iterator)'), false);
        });

        it.each(['missing', '_state'])('does not create state when reading "%s"', (key) => {
            const store = new StateStore();

            assert.strictEqual(store[key], undefined);
            assert.strictEqual(store.has(key), false);
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
        it.each([
            ['preventExtensions on an empty store', Object.preventExtensions, {}],
            ['preventExtensions on a populated store', Object.preventExtensions, { count: 1 }],
            ['seal on an empty store', Object.seal, {}],
            ['seal on a populated store', Object.seal, { count: 1 }],
            ['freeze on an empty store', Object.freeze, {}],
            ['freeze on a populated store', Object.freeze, { count: 1 }],
        ])('rejects %s without damaging it', (_, lock, initial) => {
            const store = StateStore.wrap(initial);

            assert.throws(() => lock(store), TypeError);
            assert.strictEqual(Object.isExtensible(store), true);
            assert.strictEqual(Reflect.preventExtensions(store), false);

            store.count = 2;
            assert.deepStrictEqual(Object.keys(store), ['count']);
            assert.strictEqual(store.count, 2);
        });

        it.each([
            ['existing', { a: 1 }, true],
            ['missing', {}, false],
        ])('reports %s keys through has() and "in"', (_, initial, expected) => {
            const store = StateStore.wrap(initial);

            assert.strictEqual(store.has('a'), expected);
            assert.strictEqual('a' in store, expected);
        });

        it('supports the "in" operator for store methods', () => {
            const store = new StateStore();

            assert.strictEqual('use' in store, true);
            assert.strictEqual('set' in store, true);
            assert.strictEqual('_state' in store, false);
        });

        it.each([
            ['keys()', (store) => Array.from(store.keys())],
            ['Object.keys()', Object.keys],
        ])('enumerates stored keys with %s', (_, keys) => {
            const store = new StateStore();

            store.set({ a: 1, b: 2 });

            assert.deepStrictEqual(keys(store).sort(), ['a', 'b']);
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

        it.each([
            ['state(2)', (state) => state(2), 2],
            ['state.set(2)', (state) => state.set(2), 2],
            ['state.value = 2', (state) => {
                state.value = 2;
            }, 2],
            ['state(undefined)', (state) => state(undefined), undefined],
        ])('restores a deleted key through %s on its existing accessor', (_, write, expected) => {
            const store = StateStore.wrap({ count: 1 });
            const state = store.use('count');

            delete store.count;
            assert.strictEqual(store.has('count'), false);
            write(state);

            assert.strictEqual(store.has('count'), true);
            assert.strictEqual(store.count, expected);
            assert.strictEqual(state(), expected);
            assert.deepStrictEqual(Object.keys(store), ['count']);
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

        it.each([
            ['non-configurable', { value: 2, configurable: false }],
            ['non-enumerable', { value: 2, enumerable: false }],
            ['non-writable', { value: 2, writable: false }],
            ['getter', { get: () => 2 }],
            ['setter', { set: () => {} }],
        ])('rejects a %s descriptor without changing state', (_, descriptor) => {
            const store = StateStore.wrap({ count: 1 });

            assert.strictEqual(Reflect.defineProperty(store, 'count', descriptor), false);
            assert.strictEqual(store.count, 1);
            assert.strictEqual(store.use('count')(), 1);
        });

        it('rejects incomplete descriptors for new keys', () => {
            const store = new StateStore();

            assert.strictEqual(Reflect.defineProperty(store, 'missing', { value: 2 }), false);
            assert.strictEqual(store.has('missing'), false);
        });

        it('rejects redefining reserved methods', () => {
            const store = new StateStore();

            assert.strictEqual(Reflect.defineProperty(store, 'use', { value: 2 }), false);
            assert.strictEqual(typeof store.use, 'function');
        });
    });

    describe('reserved keys', () => {
        it.each([
            ['use()', (store) => store.use('use', 1)],
            ['proxy assignment', (store) => {
                store.use = 1;
            }],
            ['set()', (store) => store.set({ use: 1 })],
        ])('rejects reserved keys via %s', (_, write) => {
            const store = new StateStore();

            assert.throws(() => write(store), /reserved StateStore key/);
        });

        it.each(['arguments', 'caller', 'prototype'])('rejects "%s" without storing it', (key) => {
            const store = new StateStore();

            assert.throws(
                () => {
                    store[key] = 1;
                },
                /reserved StateStore key/,
            );
            assert.strictEqual(store.has(key), false);
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
        it.each([
            ['array', [1, 2, 3]],
            ['null', null],
            ['Date', new Date(0)],
        ])('handles %s values as plain values', (_, value) => {
            const store = new StateStore();

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
        it('creates a readable and writable nested store', () => {
            const store = new StateStore();

            store.set({ a: StateStore.wrap({ b: 1 }) });

            assert.ok(store.a instanceof StateStore);
            assert.strictEqual(store.a.b, 1);

            store.a.b = 2;

            assert.strictEqual(store.a.b, 2);
        });

        it.each([
            ['Date', new Date(0)],
            ['array', [1, 2, 3]],
        ])('returns %s values as-is', (_, value) => {
            assert.strictEqual(StateStore.wrap(value), value);
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

        it('overwrites nested stores with non-objects', () => {
            const store = new StateStore();

            StateStore.merge(store, { a: { b: 1 } }, { deep: true });
            StateStore.merge(store, { a: 3 }, { deep: true });

            assert.strictEqual(store.a, 3);
        });

        it('reuses nested stores while preserving existing values and adding new ones', () => {
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
