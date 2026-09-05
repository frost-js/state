/**
 * Creates a callable instance without runtime code generation.
 * Returning a function lets subclasses initialize their fields on it.
 */
export default class Callable extends Function {
    /**
     * Creates a function with the subclass prototype.
     */
    constructor() {
        return Object.setPrototypeOf(function() {}, new.target.prototype);
    }
}
