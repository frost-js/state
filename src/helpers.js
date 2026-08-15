/**
 * Checks whether a value has `Object.prototype`.
 * Values with a null prototype, arrays, and class instances return `false`.
 * @param {*} value The value to test.
 * @returns {boolean} Whether the value is a plain object.
 */
export function isPlainObject(value) {
    return value !== null &&
        typeof value === 'object' &&
        Object.getPrototypeOf(value) === Object.prototype;
};
