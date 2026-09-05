import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { useEffect, useState } from '../../src/index.js';

describe('useState', () => {
    describe('reads', () => {
        it.each([
            ['state()', (state) => state()],
            ['state.get()', (state) => state.get()],
            ['state.value', (state) => state.value],
            ['Symbol.toPrimitive', Number],
        ])('reads with %s', (_, read) => {
            const state = useState(1);

            assert.strictEqual(read(state), 1);
        });
    });

    describe('writes', () => {
        it.each([
            ['state(x)', (state, value) => state(value), 2],
            ['state.set(x)', (state, value) => state.set(value), 3],
            ['state.value = x', (state, value) => {
                state.value = value;
            }, 4],
        ])('writes with %s', (_, write, value) => {
            const state = useState(1);

            write(state, value);

            assert.strictEqual(state(), value);
        });
    });

    describe('change tracking', () => {
        it('tracks state.previous', () => {
            const state = useState(1);

            state(2);
            assert.strictEqual(state.previous, 1);

            state.value = 3;
            assert.strictEqual(state.previous, 2);

            state.set(4);
            assert.strictEqual(state.previous, 3);
        });

        it('treats the same value as a no-op', () => {
            const state = useState(1);

            state(1);

            assert.strictEqual(state.value, 1);
            assert.strictEqual(state.previous, undefined);
        });

        it('handles Object.is edge cases', () => {
            const state = useState(NaN);

            state(NaN);
            assert.ok(Number.isNaN(state.value));
            assert.strictEqual(state.previous, undefined);

            state.value = -0;
            assert.strictEqual(Object.is(state.value, -0), true);

            state.value = 0;
            assert.strictEqual(Object.is(state.value, 0), true);
            assert.strictEqual(state.previous, -0);
        });
    });

    describe('dependency tracking', () => {
        it('does not track dependencies when get(false) is used', async () => {
            const state = useState(1);
            let runs = 0;

            useEffect(() => {
                runs += 1;
                state.get(false);
            });

            state(2);
            await Promise.resolve();

            assert.strictEqual(runs, 1);
        });

        it('keeps effect bookkeeping private', () => {
            const state = useState(1);

            assert.strictEqual('effects' in state, false);
            assert.strictEqual('cleanup' in state, false);
        });
    });
});
