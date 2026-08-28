import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { useEffect, useState } from '../src/index.js';
import { tick } from './support.js';

describe('useEffect', () => {
    describe('execution', () => {
        it('runs immediately', () => {
            const state = useState(1);
            let runs = 0;

            useEffect(() => {
                runs += 1;
                state();
            });

            assert.strictEqual(runs, 1);
        });

        it('runs on dependency change', async () => {
            const state = useState(1);
            let runs = 0;

            useEffect(() => {
                runs += 1;
                state();
            });

            state(2);
            await tick();

            assert.strictEqual(runs, 2);
        });

        it('does not run on the same value', async () => {
            const state = useState(1);
            let runs = 0;

            useEffect(() => {
                runs += 1;
                state();
            });

            state(2);
            await tick();
            assert.strictEqual(runs, 2);

            state(2);
            await tick();
            assert.strictEqual(runs, 2);
        });

        it('does not drop updates triggered during an effect', async () => {
            const state = useState(0);
            let runs = 0;

            useEffect(() => {
                runs += 1;
                if (state() < 2) {
                    state(state() + 1);
                }
            });

            for (let i = 0; i < 5; i += 1) {
                await tick();
            }

            assert.strictEqual(state(), 2);
            assert.strictEqual(runs, 3);
        });

        it('coalesces synchronous changes', async () => {
            const state = useState(0);
            let runs = 0;

            useEffect(() => {
                runs += 1;
                state();
            });

            state(1);
            state(2);
            state(3);
            await tick();

            assert.strictEqual(runs, 2);
        });

        it('runs synchronously with effect.sync()', () => {
            const state = useState(1);
            let runs = 0;

            const effect = useEffect(() => {
                runs += 1;
                state();
            });

            assert.strictEqual(runs, 1);

            effect.sync();

            assert.strictEqual(runs, 2);
        });

        it('cancels a pending run when sync() is used', async () => {
            const state = useState(0);
            const values = [];

            const effect = useEffect(() => {
                values.push(state());
            });

            state(1);
            effect.sync();
            await tick();

            assert.deepStrictEqual(values, [0, 1]);
        });

        it('does not let canceled work consume a newer run', async () => {
            const state = useState(0);
            const values = [];

            const effect = useEffect(() => {
                values.push(state());
            });

            state(1);
            effect.sync();
            state(2);
            await tick();

            assert.deepStrictEqual(values, [0, 1, 2]);
        });

        it('stops an effect and cancels pending work', async () => {
            const state = useState(0);
            let runs = 0;

            const effect = useEffect(() => {
                runs += 1;
                state();
            });

            state(1);
            effect.stop();
            effect.stop();
            effect();
            effect.sync();
            state(2);
            await tick();

            assert.strictEqual(runs, 1);
        });

        it('can stop while running', async () => {
            const state = useState(0);
            let shouldStop = false;
            let runs = 0;

            const effect = useEffect(() => {
                runs += 1;
                state();

                if (shouldStop) {
                    effect.stop();
                    state();
                }
            });

            shouldStop = true;
            state(1);
            await tick();

            state(2);
            await tick();

            assert.strictEqual(runs, 2);
        });
    });

    describe('dependency tracking', () => {
        it('switches dependencies when the access path changes', async () => {
            const a = useState(1);
            const b = useState(1);
            const toggle = useState(true);
            let runs = 0;

            useEffect(() => {
                runs += 1;
                if (toggle()) {
                    a();
                } else {
                    b();
                }
            });

            assert.strictEqual(runs, 1);

            toggle(false);
            await tick();

            assert.strictEqual(runs, 2);
        });

        it('does not respond to stale dependencies', async () => {
            const a = useState(1);
            const b = useState(1);
            const toggle = useState(true);
            let runs = 0;

            useEffect(() => {
                runs += 1;
                if (toggle()) {
                    a();
                } else {
                    b();
                }
            });

            toggle(false);
            await tick();

            a(2);
            await tick();
            assert.strictEqual(runs, 2);

            b(2);
            await tick();
            assert.strictEqual(runs, 3);
        });

        it('keeps previous dependencies when a run fails', async () => {
            const useA = useState(true);
            const a = useState(0);
            const b = useState(0);
            let shouldThrow = true;
            let runs = 0;

            const effect = useEffect(() => {
                runs += 1;

                if (useA()) {
                    a();
                    return;
                }

                b();

                if (shouldThrow) {
                    shouldThrow = false;
                    throw new Error('boom');
                }
            });

            useA(false);
            assert.throws(() => effect.sync(), /boom/);

            b(1);
            await tick();
            assert.strictEqual(runs, 2);

            a(1);
            await tick();
            assert.strictEqual(runs, 3);
        });
    });

    describe('error handling', () => {
        it('throws on a re-entrant effect', () => {
            const ref = {};
            const effect = useEffect(() => {
                if (ref.effect) {
                    ref.effect.sync();
                }
            });

            ref.effect = effect;
            effect();

            assert.throws(() => {
                effect.sync();
            }, /Cannot trigger an effect inside itself/);
        });

        it('cancels subscriptions and work when setup throws', async () => {
            const state = useState(0);
            let runs = 0;

            assert.throws(() => {
                useEffect(() => {
                    runs += 1;
                    state(state() + 1);
                    throw new Error('boom');
                });
            }, /boom/);

            state(2);
            await tick();

            assert.strictEqual(runs, 1);
        });
    });

    describe('weak effects', () => {
        it('removes a collected weak effect on the next write', async () => {
            const NativeWeakRef = globalThis.WeakRef;
            let target;

            globalThis.WeakRef = class {
                constructor(value) {
                    target = value;
                }

                deref() {
                    return target;
                }
            };

            try {
                const state = useState(1);
                let runs = 0;

                useEffect(() => {
                    runs += 1;
                    state();
                }, { weak: true });

                target = undefined;
                state(2);
                await tick();

                assert.strictEqual(runs, 1);
            } finally {
                globalThis.WeakRef = NativeWeakRef;
            }
        });
    });
});
