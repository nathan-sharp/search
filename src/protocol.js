'use strict';

/**
 * Decentralized Search Protocol
 *
 * Handles parsing and formatting of search:// URIs.
 * The scheme follows the pattern: search://<url-encoded-query>
 *
 * Examples:
 *   search://hello%20world   → query: "hello world"
 *   search://cats            → query: "cats"
 */

const PROTOCOL_SCHEME = 'search';
const PROTOCOL_PREFIX = `${PROTOCOL_SCHEME}://`;

/**
 * Parse a search:// URI into its components.
 *
 * @param {string} uri - The search URI, e.g. "search://hello%20world"
 * @returns {{ query: string }} Parsed components
 * @throws {Error} If the URI is invalid or the query is empty
 */
function parseSearchURI(uri) {
  if (!uri || typeof uri !== 'string') {
    throw new Error('Invalid URI: must be a non-empty string');
  }

  if (!uri.toLowerCase().startsWith(PROTOCOL_PREFIX)) {
    throw new Error(`Invalid URI: must start with "${PROTOCOL_PREFIX}"`);
  }

  const encoded = uri.slice(PROTOCOL_PREFIX.length);
  let query;
  try {
    query = decodeURIComponent(encoded).trim();
  } catch (e) {
    throw new Error(`Invalid URI: malformed percent-encoding — ${e.message}`);
  }

  if (!query) {
    throw new Error('Invalid URI: query cannot be empty');
  }

  return { query };
}

/**
 * Build a search:// URI from a plain query string.
 *
 * @param {string} query - The search query, e.g. "hello world"
 * @returns {string} The search URI, e.g. "search://hello%20world"
 * @throws {Error} If the query is empty or not a string
 */
function buildSearchURI(query) {
  if (!query || typeof query !== 'string') {
    throw new Error('Query must be a non-empty string');
  }

  const trimmed = query.trim();
  if (!trimmed) {
    throw new Error('Query cannot be empty');
  }

  return `${PROTOCOL_PREFIX}${encodeURIComponent(trimmed)}`;
}

module.exports = { parseSearchURI, buildSearchURI, PROTOCOL_SCHEME, PROTOCOL_PREFIX };
