/** @import { StateAccessor } from './state.js' */

import Callable from './callable.js';
import { isPlainObject } from './helpers.js';
import { createState, isTrackingEffects } from './state.js';

/**
 * Creates a callable, proxy-backed keyed reactive store.
 * Existing keys are read via property access, written via assignment, and raw
 * state accessors are available via `store.use(key)` or `store(key)`.
 * Missing string-key reads return `undefined`. Reads made during effect
 * tracking subscribe to later assignments without exposing the key.
 * API keys and non-configurable Function keys are reserved and cannot be used
 * as state keys.
 */
export default class StateStore extends Callable {
    #state = new Map();
    #visibleKeys = new Set();

    /**
     * Merges plain-object data into a `StateStore`.
     * Non-plain values replace the current value and are returned unchanged.
     * @template T
     * @param {*} store The target store to merge into. It must already be a `StateStore`
     *   unless `options.allowFallback` is true.
     * @param {T} value The value to merge.
     * @param {{ deep?: boolean, allowFallback?: boolean }} [options] The merge options.
     * @param {boolean} [options.deep=false] Whether to recursively merge nested plain objects into nested stores.
     * @param {boolean} [options.allowFallback=false] Whether to wrap the value when the target is not already a `StateStore`.
     * @returns {StateStore|T} The updated store, or the original value.
     * @throws {TypeError} If `store` is not a `StateStore` and fallback is disabled.
     * @throws {TypeError} If the merged data contains a reserved `StateStore` key.
     */
    static merge(store, value, options = { deep: false, allowFallback: false }) {
        if (!(store instanceof StateStore)) {
            if (options.allowFallback) {
                return StateStore.wrap(value, options);
            }

            throw new TypeError('First argument must be a StateStore instance');
        }

        return StateStore.#mergeValue(
            store,
            value,
            Boolean(options.deep),
            new WeakMap(),
        );
    }

    /**
     * Wraps a plain object in a `StateStore`.
     * Non-plain values are returned unchanged.
     * @template T
     * @param {T} value The value to wrap.
     * @param {{ deep?: boolean }} [options] The wrap options.
     * @param {boolean} [options.deep=false] Whether to recursively wrap nested plain objects.
     * @returns {StateStore|T} The wrapped store, or the original value.
     * @throws {TypeError} If the wrapped object contains a reserved `StateStore` key.
     */
    static wrap(value, options = { deep: false }) {
        if (value instanceof StateStore) {
            return value;
        }

        return StateStore.#mergeValue(
            undefined,
            value,
            Boolean(options.deep),
            new WeakMap(),
        );
    }

    /**
     * Copies an existing store graph using values from before the merge.
     * @param {*} store The value to copy; non-store values retain their identity.
     * @param {WeakMap<StateStore, Array<[string, *]>>} snapshots The original store entries.
     * @param {WeakMap<StateStore, StateStore>} [clones] The stores already copied.
     * @returns {*} The copied store or original value.
     */
    static #cloneStore(store, snapshots, clones = new WeakMap()) {
        if (!(store instanceof StateStore)) {
            return store;
        }

        if (clones.has(store)) {
            return clones.get(store);
        }

        const clone = new StateStore();

        clones.set(store, clone);

        for (const [key, value] of snapshots.get(store) ?? StateStore.#entries(store)) {
            clone[key] = StateStore.#cloneStore(value, snapshots, clones);
        }

        return clone;
    }

    /**
     * Reads stored values without tracking effects.
     * @param {StateStore} store The store to read.
     * @returns {Array<[string, *]>} The stored entries.
     */
    static #entries(store) {
        return Array.from(store.keys(), (key) => [key, store.use(key).get(false)]);
    }

    /**
     * Wraps or merges a plain-object value while preserving cycles and shared references.
     * @template T
     * @param {*} store The existing value that may be reused as the target store.
     * @param {T} value The value to wrap or merge.
     * @param {boolean} deep Whether to process nested plain objects recursively.
     * @param {WeakMap<object, StateStore>} stores The previously visited source objects and their stores.
     * @param {WeakMap<StateStore, Array<[string, *]>>} [snapshots] Store values before merging, used when splitting aliases.
     * @returns {StateStore|T} The merged store, or the original non-plain value.
     */
    static #mergeValue(store, value, deep, stores, snapshots = new WeakMap()) {
        if (!isPlainObject(value)) {
            return value;
        }

        if (stores.has(value)) {
            return stores.get(value);
        }

        let target = store instanceof StateStore ? store : new StateStore();

        if (deep) {
            if (snapshots.has(target)) {
                target = StateStore.#cloneStore(target, snapshots);
            }

            snapshots.set(target, StateStore.#entries(target));
        }

        stores.set(value, target);

        for (const [key, val] of Object.entries(value)) {
            const current = target.has(key) ? target.use(key).get(false) : undefined;

            target[key] = deep ?
                StateStore.#mergeValue(current, val, true, stores, snapshots) :
                val;
        }

        return target;
    }

    /**
     * Creates a new callable `StateStore` proxy.
     */
    constructor() {
        super();

        // Preserve the reserved metadata of the original Function-backed store.
        Object.defineProperties(this, {
            arguments: { value: null },
            caller: { value: null },
        });

        // Allow Function metadata names to be used as state keys.
        delete this.name;
        delete this.length;

        const proxy = new Proxy(
            this,
            {
                apply(target, thisArg, args) {
                    if (!args.length) {
                        return proxy;
                    }

                    return target.use(...args);
                },
                defineProperty(target, prop, descriptor) {
                    if (typeof prop === 'symbol') {
                        return Reflect.defineProperty(target, prop, descriptor);
                    }

                    if (target.#isReservedStateKey(prop)) {
                        return false;
                    }

                    if ('get' in descriptor || 'set' in descriptor) {
                        return false;
                    }

                    const exists = target.has(prop);

                    // Omitted flags retain existing attributes; new keys default to false.
                    const {
                        configurable = exists,
                        enumerable = exists,
                        writable = exists,
                    } = descriptor;

                    if (!configurable || !enumerable || !writable) {
                        return false;
                    }

                    if ('value' in descriptor || !exists) {
                        target.#assignKey(prop, descriptor.value);
                    }

                    return true;
                },
                deleteProperty(target, prop) {
                    if (typeof prop === 'symbol') {
                        return Reflect.deleteProperty(target, prop);
                    }

                    if (target.#isReservedStateKey(prop)) {
                        return false;
                    }

                    // Retain the accessor so existing subscribers observe later writes.
                    target.#state.get(prop)?.set(undefined);
                    target.#visibleKeys.delete(prop);

                    return true;
                },
                get(target, prop) {
                    if (typeof prop === 'symbol') {
                        return Reflect.get(target, prop, target);
                    }

                    if (target.#isReservedStateKey(prop)) {
                        const value = Reflect.get(target, prop, target);

                        if (typeof value === 'function') {
                            return value.bind(target);
                        }

                        return value;
                    }

                    return target.#readKey(prop);
                },
                getOwnPropertyDescriptor(target, prop) {
                    const descriptor = Reflect.getOwnPropertyDescriptor(target, prop);

                    if (descriptor) {
                        return descriptor;
                    }

                    if (target.has(prop)) {
                        return {
                            configurable: true,
                            enumerable: true,
                            writable: true,
                            value: target.#state.get(prop).get(false),
                        };
                    }

                    return undefined;
                },
                has(target, prop) {
                    if (typeof prop === 'symbol') {
                        return Reflect.has(target, prop);
                    }

                    return target.#isReservedStateKey(prop) || target.has(prop);
                },
                ownKeys(target) {
                    const baseKeys = Reflect.ownKeys(target);
                    const stateKeys = target.keys();

                    return Array.from(
                        new Set([...baseKeys, ...stateKeys]),
                    );
                },
                preventExtensions() {
                    return false;
                },
                set(target, prop, value) {
                    if (typeof prop === 'symbol') {
                        return Reflect.set(target, prop, value, target);
                    }

                    target.#assignKey(prop, value);

                    return true;
                },
            },
        );

        return proxy;
    }

    /**
     * Checks whether a state key exists in the store.
     * @param {string} key The state key.
     * @returns {boolean} Whether the key exists.
     */
    has(key) {
        return this.#visibleKeys.has(key);
    }

    /**
     * Retrieves the stored state keys.
     * Reserved keys are not included.
     * @returns {IterableIterator<string>} The key iterator.
     */
    keys() {
        return this.#visibleKeys.values();
    }

    /**
     * Sets multiple keys from an object's own enumerable string properties.
     * @param {Record<string, *>} data The key/value pairs.
     * @throws {TypeError} If `data` contains a reserved `StateStore` key.
     */
    set(data) {
        const entries = Object.entries(data);

        for (const [key] of entries) {
            if (this.#isReservedStateKey(key)) {
                throw new TypeError(`"${key}" is a reserved StateStore key`);
            }
        }

        for (const [key, value] of entries) {
            this.#assignKey(key, value);
        }
    }

    /**
     * Retrieves or creates a state by key.
     * Missing keys become visible only through this method, `set(...)`, or proxy assignment.
     * @template T
     * @param {string} key The state key.
     * @param {T} [defaultValue] The default value when creating.
     * @returns {StateAccessor<T>} The state accessor for the key.
     * @throws {TypeError} If `key` is reserved by `StateStore`.
     */
    use(key, defaultValue) {
        if (this.#isReservedStateKey(key)) {
            throw new TypeError(`"${key}" is a reserved StateStore key`);
        }

        if (this.#state.has(key)) {
            const state = this.#state.get(key);

            if (!this.has(key)) {
                this.#visibleKeys.add(key);

                if (arguments.length > 1) {
                    state.value = defaultValue;
                }
            }

            return state;
        }

        const state = this.#createState(key, defaultValue);

        this.#visibleKeys.add(key);

        return state;
    }

    /**
     * Creates or updates a visible state key.
     * @param {string} key The state key.
     * @param {*} value The value to store.
     * @throws {TypeError} If `key` is reserved by `StateStore`.
     */
    #assignKey(key, value) {
        this.use(key).set(value);
    }

    /**
     * Creates an accessor that exposes its key whenever it is written.
     * @template T
     * @param {string} key The state key.
     * @param {T} value The initial state value.
     * @returns {StateAccessor<T>} The state accessor.
     */
    #createState(key, value) {
        const state = createState(value, () => this.#visibleKeys.add(key));

        this.#state.set(key, state);

        return state;
    }

    /**
     * Checks whether a key belongs to the store API or a non-configurable Function property.
     * @param {string|symbol} key The candidate property key.
     * @returns {boolean} Whether the key cannot be used for state.
     */
    #isReservedStateKey(key) {
        if (typeof key !== 'string') {
            return false;
        }

        if (Object.hasOwn(StateStore.prototype, key)) {
            return true;
        }

        const descriptor = Reflect.getOwnPropertyDescriptor(this, key);

        return descriptor?.configurable === false;
    }

    /**
     * Reads a state key, creating a hidden accessor only when an effect is tracking the missing key.
     * @param {string} key The state key.
     * @returns {*} The current value, or `undefined` when the key is missing.
     */
    #readKey(key) {
        if (this.#state.has(key)) {
            return this.#state.get(key).value;
        }

        if (!isTrackingEffects()) {
            return undefined;
        }

        return this.#createState(key, undefined).value;
    }
}
