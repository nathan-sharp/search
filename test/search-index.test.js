'use strict';

const { SearchIndex } = require('../src/search-index');

describe('SearchIndex', () => {
  let index;

  beforeEach(() => {
    index = new SearchIndex();
  });

  // ── Construction ─────────────────────────────────────────────────────────

  test('starts empty', () => {
    expect(index.size).toBe(0);
  });

  // ── addDocument ───────────────────────────────────────────────────────────

  test('adds a document and increments size', () => {
    index.addDocument({ url: 'http://example.com', title: 'Example', content: 'hello' });
    expect(index.size).toBe(1);
  });

  test('throws when document has no URL', () => {
    expect(() => index.addDocument({ title: 'No URL' })).toThrow(/url/i);
  });

  test('replaces an existing document with the same URL', () => {
    index.addDocument({ url: 'http://example.com', title: 'v1', content: 'old content' });
    index.addDocument({ url: 'http://example.com', title: 'v2', content: 'new content' });
    expect(index.size).toBe(1);
    const results = index.search('new');
    expect(results[0].title).toBe('v2');
  });

  test('adds multiple documents', () => {
    index.addDocument({ url: 'http://a.com', title: 'A', content: 'foo' });
    index.addDocument({ url: 'http://b.com', title: 'B', content: 'bar' });
    expect(index.size).toBe(2);
  });

  // ── search ────────────────────────────────────────────────────────────────

  test('returns empty array for empty index', () => {
    expect(index.search('hello')).toEqual([]);
  });

  test('returns empty array for empty query', () => {
    index.addDocument({ url: 'http://example.com', title: 'Test', content: 'hello' });
    expect(index.search('')).toEqual([]);
    expect(index.search(null)).toEqual([]);
  });

  test('finds a document by title term', () => {
    index.addDocument({ url: 'http://example.com', title: 'Hello World', content: '' });
    const results = index.search('hello');
    expect(results).toHaveLength(1);
    expect(results[0].url).toBe('http://example.com');
  });

  test('finds a document by content term', () => {
    index.addDocument({ url: 'http://example.com', title: '', content: 'quantum computing is fascinating' });
    const results = index.search('quantum');
    expect(results).toHaveLength(1);
  });

  test('finds a document by description term', () => {
    index.addDocument({ url: 'http://example.com', title: '', description: 'great coffee shop', content: '' });
    const results = index.search('coffee');
    expect(results).toHaveLength(1);
  });

  test('returns empty array when no documents match', () => {
    index.addDocument({ url: 'http://example.com', title: 'Cats', content: 'meow' });
    expect(index.search('dogs')).toHaveLength(0);
  });

  test('ranks higher-scoring documents first', () => {
    // First doc has "test" in all fields, second only in one
    index.addDocument({ url: 'http://a.com', title: 'test', description: 'test', content: 'test test test' });
    index.addDocument({ url: 'http://b.com', title: 'other', description: 'something', content: 'test' });
    const results = index.search('test');
    expect(results[0].url).toBe('http://a.com');
  });

  test('respects the limit parameter', () => {
    for (let i = 0; i < 15; i++) {
      index.addDocument({ url: `http://site${i}.com`, title: `Site ${i}`, content: 'common term here' });
    }
    const results = index.search('common', 5);
    expect(results.length).toBeLessThanOrEqual(5);
  });

  test('default limit is 10', () => {
    for (let i = 0; i < 20; i++) {
      index.addDocument({ url: `http://site${i}.com`, title: `Site ${i}`, content: 'shared keyword' });
    }
    const results = index.search('shared');
    expect(results.length).toBeLessThanOrEqual(10);
  });

  test('returns score on each result', () => {
    index.addDocument({ url: 'http://example.com', title: 'Hello World', content: '' });
    const results = index.search('hello');
    expect(typeof results[0].score).toBe('number');
    expect(results[0].score).toBeGreaterThan(0);
  });

  // ── export / merge ────────────────────────────────────────────────────────

  test('export returns documents and invertedIndex arrays', () => {
    index.addDocument({ url: 'http://a.com', title: 'Alpha', content: 'hello' });
    const exported = index.export();
    expect(Array.isArray(exported.documents)).toBe(true);
    expect(Array.isArray(exported.invertedIndex)).toBe(true);
    expect(exported.documents).toHaveLength(1);
  });

  test('merge imports documents from another index', () => {
    const other = new SearchIndex();
    other.addDocument({ url: 'http://peer.com', title: 'Peer Doc', content: 'hello' });
    index.merge(other.export());
    expect(index.size).toBe(1);
    expect(index.search('peer')[0].url).toBe('http://peer.com');
  });

  test('merge ignores documents with duplicate URLs', () => {
    index.addDocument({ url: 'http://example.com', title: 'Local', content: 'local' });
    const other = new SearchIndex();
    other.addDocument({ url: 'http://example.com', title: 'Peer', content: 'peer' });
    index.merge(other.export());
    expect(index.size).toBe(1);
  });

  test('merge handles empty or null input gracefully', () => {
    expect(() => index.merge(null)).not.toThrow();
    expect(() => index.merge({})).not.toThrow();
    expect(() => index.merge({ documents: 'bad' })).not.toThrow();
  });
});
