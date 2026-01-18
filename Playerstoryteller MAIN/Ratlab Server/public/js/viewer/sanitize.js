/**
 * Sanitization utilities to prevent XSS attacks.
 *
 * IMPORTANT: Always sanitize user-controlled data before inserting into HTML.
 * This includes: usernames, session names, queue submissions, error messages, etc.
 */

/**
 * Escape HTML special characters to prevent XSS.
 * Use this when inserting user data into innerHTML or template literals.
 *
 * @param {string} str - The string to sanitize
 * @returns {string} - Escaped string safe for HTML insertion
 */
export function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    if (typeof str !== 'string') str = String(str);

    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * Escape a string for safe use in HTML attributes.
 * More aggressive escaping for attribute contexts.
 *
 * @param {string} str - The string to sanitize
 * @returns {string} - Escaped string safe for HTML attributes
 */
export function escapeAttr(str) {
    if (str === null || str === undefined) return '';
    if (typeof str !== 'string') str = String(str);

    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;')
        .replace(/`/g, '&#096;')
        .replace(/\//g, '&#047;');
}

/**
 * Escape a string for safe use in JavaScript string contexts.
 * Use when inserting into onclick handlers or script contexts.
 *
 * @param {string} str - The string to sanitize
 * @returns {string} - Escaped string safe for JS string insertion
 */
export function escapeJs(str) {
    if (str === null || str === undefined) return '';
    if (typeof str !== 'string') str = String(str);

    return str
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r')
        .replace(/\t/g, '\\t')
        .replace(/</g, '\\x3c')
        .replace(/>/g, '\\x3e');
}

/**
 * Sanitize a URL to prevent javascript: and data: URL injection.
 *
 * @param {string} url - The URL to sanitize
 * @returns {string} - Safe URL or empty string if malicious
 */
export function sanitizeUrl(url) {
    if (!url || typeof url !== 'string') return '';

    const trimmed = url.trim().toLowerCase();

    // Block javascript:, data:, and vbscript: URLs
    if (trimmed.startsWith('javascript:') ||
        trimmed.startsWith('data:') ||
        trimmed.startsWith('vbscript:')) {
        console.warn('[Security] Blocked potentially malicious URL:', url);
        return '';
    }

    return url;
}

/**
 * Validate and sanitize a username.
 * Usernames should be alphanumeric with limited special chars.
 *
 * @param {string} username - The username to validate
 * @returns {string} - Sanitized username or 'Anonymous'
 */
export function sanitizeUsername(username) {
    if (!username || typeof username !== 'string') return 'Anonymous';

    // Remove any HTML/script tags
    let clean = username.replace(/<[^>]*>/g, '');

    // Limit to reasonable characters (alphanumeric, underscore, dash, space)
    clean = clean.replace(/[^a-zA-Z0-9_\- ]/g, '');

    // Trim and limit length
    clean = clean.trim().slice(0, 32);

    return clean || 'Anonymous';
}

/**
 * Sanitize a session ID for safe use in URLs and HTML.
 *
 * @param {string} sessionId - The session ID to sanitize
 * @returns {string} - Sanitized session ID
 */
export function sanitizeSessionId(sessionId) {
    if (!sessionId || typeof sessionId !== 'string') return '';

    // Session IDs should be alphanumeric with dashes
    return sessionId.replace(/[^a-zA-Z0-9\-_]/g, '').slice(0, 64);
}

/**
 * Create a text node instead of using innerHTML for simple text.
 * This is the safest way to insert user-controlled text.
 *
 * @param {HTMLElement} element - The element to set text on
 * @param {string} text - The text to set
 */
export function setTextSafe(element, text) {
    if (!element) return;
    element.textContent = text || '';
}

/**
 * Sanitize an object's string properties recursively.
 * Useful for sanitizing API response data before rendering.
 *
 * @param {Object} obj - The object to sanitize
 * @param {string[]} fields - Specific fields to sanitize (optional, defaults to all strings)
 * @returns {Object} - Sanitized object
 */
export function sanitizeObject(obj, fields = null) {
    if (!obj || typeof obj !== 'object') return obj;

    const result = Array.isArray(obj) ? [] : {};

    for (const key in obj) {
        if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;

        const value = obj[key];

        if (typeof value === 'string') {
            if (!fields || fields.includes(key)) {
                result[key] = escapeHtml(value);
            } else {
                result[key] = value;
            }
        } else if (typeof value === 'object' && value !== null) {
            result[key] = sanitizeObject(value, fields);
        } else {
            result[key] = value;
        }
    }

    return result;
}
