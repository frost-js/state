const activeEffects = [];
const effectNextStates = new WeakMap();
const stateEffects = new WeakMap();

const removeEffect = (state, effect) => {
    stateEffects.get(state)?.delete(effect);
};

/**
 * Checks whether state reads are currently being tracked by an active effect.
 * @returns {boolean} Whether an effect is currently collecting dependencies.
 */
export function isTrackingEffects() {
    return activeEffects.length > 0;
}

/**
 * Callable state accessor returned by `useState`.
 * @template T
 * @typedef {Function} StateAccessor
 * @property {(markEffects?: boolean) => T} get The function to retrieve the current value.
 * @property {(newValue: T) => void} set The function to set a new value.
 * @property {T} value The current value.
 * @property {T|undefined} previous The previous value after the last successful change.
 */

/**
 * Registers a reactive effect that runs immediately and re-runs when any state
 * read inside the callback changes.
 * Re-execution is coalesced in a microtask unless `.sync()` is used.
 * @param {Function} callback The callback function.
 * @param {{ weak?: boolean }} [options] The effect options.
 * @param {boolean} [options.weak=false] Whether to use a WeakRef for the effect runner.
 * @returns {Function & { sync: Function, stop: Function }} The wrapped effect runner.
 * @throws {Error} If the effect synchronously triggers itself.
 * @throws {*} Re-throws any error thrown by `callback`.
 */
export function useEffect(callback, { weak = false } = {}) {
    const prevStates = new Set();
    const nextStates = new Set();

    const removeFromStates = (states) => {
        for (const state of states) {
            removeEffect(state, ref);
        }

        states.clear();
    };

    const wrapped = () => {
        if (stopped) {
            return;
        }

        if (activeEffects.includes(ref)) {
            throw new Error('Cannot trigger an effect inside itself');
        }

        activeEffects.push(ref);

        try {
            callback();
        } catch (error) {
            for (const state of nextStates) {
                if (!prevStates.has(state)) {
                    removeEffect(state, ref);
                }
            }

            nextStates.clear();

            throw error;
        } finally {
            activeEffects.pop();
        }

        for (const state of prevStates) {
            if (!nextStates.has(state)) {
                removeEffect(state, ref);
            }
        }

        prevStates.clear();

        for (const state of nextStates) {
            prevStates.add(state);
        }

        nextStates.clear();
    };

    let running = false;
    let scheduledJob;
    let pending = false;
    let stopped = false;
    const debounced = () => {
        if (stopped) {
            return;
        }

        if (running) {
            pending = true;
            return;
        }

        if (scheduledJob) {
            return;
        }

        const job = {};

        scheduledJob = job;

        queueMicrotask(() => {
            if (stopped || scheduledJob !== job) {
                return;
            }

            scheduledJob = undefined;
            running = true;

            try {
                wrapped();
            } finally {
                running = false;

                if (!stopped && pending) {
                    pending = false;
                    debounced();
                } else {
                    pending = false;
                }
            }
        });
    };

    debounced.sync = () => {
        scheduledJob = undefined;
        pending = false;
        wrapped();
    };

    const ref = weak ?
        new WeakRef(debounced) :
        { deref: () => debounced };

    effectNextStates.set(ref, nextStates);

    debounced.stop = () => {
        if (stopped) {
            return;
        }

        stopped = true;
        scheduledJob = undefined;
        pending = false;
        removeFromStates(prevStates);
        removeFromStates(nextStates);
        effectNextStates.delete(ref);
    };

    try {
        wrapped();
    } catch (error) {
        debounced.stop();
        throw error;
    }

    return debounced;
};

/**
 * Creates a reactive state container.
 * @template T
 * @param {T} value The initial state value.
 * @returns {StateAccessor<T>} The state accessor.
 */
export function useState(value) {
    return createState(value);
};

/**
 * Creates a state accessor with an optional hook before every write.
 * @template T
 * @param {T} value The initial state value.
 * @param {Function} [onWrite] The hook, including writes of an unchanged value.
 * @returns {StateAccessor<T>} The state accessor.
 */
export function createState(value, onWrite) {
    let previous;
    const effects = new Set();

    const get = (markEffects = true) => {
        if (markEffects && activeEffects.length) {
            const activeEffect = activeEffects.at(-1);
            const states = effectNextStates.get(activeEffect);

            if (states) {
                effects.add(activeEffect);
                states.add(state);
            }
        }

        return value;
    };

    const set = (newValue) => {
        onWrite?.();

        if (Object.is(value, newValue)) {
            return;
        }

        previous = value;
        value = newValue;

        for (const effect of effects) {
            const callback = effect.deref();

            if (callback) {
                callback(state);
            } else {
                effects.delete(effect);
            }
        }
    };

    const state = function(newValue) {
        if (!arguments.length) {
            return get();
        }

        set(newValue);
    };

    state[Symbol.toPrimitive] = get;
    state.get = get;
    state.set = set;
    stateEffects.set(state, effects);

    Object.defineProperty(state, 'previous', {
        get: () => previous,
    });

    Object.defineProperty(state, 'value', {
        get,
        set,
    });

    return state;
};
