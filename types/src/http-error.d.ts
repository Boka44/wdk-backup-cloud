/**
 * Internal HTTP/network error carrying a status code when available.
 * Not part of the public API — providers map this to typed Cloud* errors.
 */
export class CloudHttpError extends Error {
    /**
     * @param {string} message
     * @param {number | null} [status]
     * @param {string} [detail]
     */
    constructor(message: string, status?: number | null, detail?: string);
    /** @type {number | null} */
    status: number | null;
    /** @type {string} */
    detail: string;
}
