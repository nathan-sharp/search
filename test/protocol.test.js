'use strict';

const { parseSearchURI, buildSearchURI, PROTOCOL_SCHEME, PROTOCOL_PREFIX } = require('../src/protocol');

describe('PROTOCOL constants', () => {
  test('PROTOCOL_SCHEME is "search"', () => {
    expect(PROTOCOL_SCHEME).toBe('search');
  });

  test('PROTOCOL_PREFIX is "search://"', () => {
    expect(PROTOCOL_PREFIX).toBe('search://');
  });
});

describe('parseSearchURI', () => {
  test('parses a plain query', () => {
    expect(parseSearchURI('search://hello')).toEqual({ query: 'hello' });
  });

  test('parses a URI with spaces', () => {
    expect(parseSearchURI('search://hello world')).toEqual({ query: 'hello world' });
  });

  test('decodes percent-encoded query', () => {
    expect(parseSearchURI('search://hello%20world')).toEqual({ query: 'hello world' });
  });

  test('decodes multi-word percent-encoded query', () => {
    expect(parseSearchURI('search://cats%20and%20dogs')).toEqual({ query: 'cats and dogs' });
  });

  test('is case-insensitive for the scheme', () => {
    expect(parseSearchURI('SEARCH://hello')).toEqual({ query: 'hello' });
    expect(parseSearchURI('Search://hello')).toEqual({ query: 'hello' });
  });

  test('trims leading/trailing whitespace from the query', () => {
    expect(parseSearchURI('search://  hello  ')).toEqual({ query: 'hello' });
  });

  test('throws on null input', () => {
    expect(() => parseSearchURI(null)).toThrow();
  });

  test('throws on non-string input', () => {
    expect(() => parseSearchURI(42)).toThrow();
  });

  test('throws when scheme is missing', () => {
    expect(() => parseSearchURI('hello world')).toThrow(/must start with/i);
  });

  test('throws when scheme is a different protocol', () => {
    expect(() => parseSearchURI('http://example.com')).toThrow();
  });

  test('throws on empty query after scheme', () => {
    expect(() => parseSearchURI('search://')).toThrow(/empty/i);
  });

  test('throws on whitespace-only query', () => {
    expect(() => parseSearchURI('search://   ')).toThrow(/empty/i);
  });
});

describe('buildSearchURI', () => {
  test('builds a URI from a simple query', () => {
    const uri = buildSearchURI('hello');
    expect(uri).toBe('search://hello');
  });

  test('percent-encodes spaces', () => {
    const uri = buildSearchURI('hello world');
    expect(uri).toMatch(/^search:\/\//);
    expect(uri).not.toContain(' ');
  });

  test('percent-encodes special characters', () => {
    const uri = buildSearchURI('a & b');
    expect(uri).not.toContain('&');
  });

  test('throws on empty string', () => {
    expect(() => buildSearchURI('')).toThrow(/empty/i);
  });

  test('throws on whitespace-only string', () => {
    expect(() => buildSearchURI('   ')).toThrow(/empty/i);
  });

  test('throws on null', () => {
    expect(() => buildSearchURI(null)).toThrow();
  });

  test('throws on non-string', () => {
    expect(() => buildSearchURI(123)).toThrow();
  });

  test('round-trips through parseSearchURI', () => {
    const queries = ['hello world', 'cats & dogs', 'quantum computing 2025'];
    for (const q of queries) {
      const uri = buildSearchURI(q);
      const { query } = parseSearchURI(uri);
      expect(query).toBe(q);
    }
  });
});
