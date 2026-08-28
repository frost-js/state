/**
 * Wait for the next microtask.
 * @returns {Promise<void>} A promise that resolves on the next microtask.
 */
export const tick = () => Promise.resolve();
