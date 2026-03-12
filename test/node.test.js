'use strict';

const { SearchNode } = require('../src/node');

/**
 * Integration tests for SearchNode.
 * These tests spin up real TCP listeners on random ports so they exercise
 * the full network stack without touching the public internet.
 */

async function makeNode(extraOpts = {}) {
  const node = new SearchNode({ network: { port: 0, ...extraOpts } });
  await node.start();
  return node;
}

describe('SearchNode — local index', () => {
  let node;

  beforeEach(async () => {
    node = await makeNode();
  });

  afterEach(async () => {
    await node.stop();
  });

  test('starts with an empty index', () => {
    expect(node.index.size).toBe(0);
  });

  test('search returns empty array on empty index', async () => {
    const results = await node.search('hello');
    expect(results).toEqual([]);
  });

  test('search accepts a plain query string', async () => {
    node.index.addDocument({ url: 'http://example.com', title: 'Hello World', content: '' });
    const results = await node.search('hello');
    expect(results).toHaveLength(1);
  });

  test('search accepts a search:// URI', async () => {
    node.index.addDocument({ url: 'http://example.com', title: 'Cats are great', content: '' });
    const results = await node.search('search://cats');
    expect(results).toHaveLength(1);
    expect(results[0].url).toBe('http://example.com');
  });

  test('search throws on empty query', async () => {
    await expect(node.search('')).rejects.toThrow();
  });

  test('search throws on invalid search:// URI', async () => {
    await expect(node.search('search://')).rejects.toThrow();
  });

  test('results are deduplicated by URL', async () => {
    node.index.addDocument({ url: 'http://example.com', title: 'Test', content: 'hello world' });
    const results = await node.search('hello');
    const urls = results.map(r => r.url);
    expect(new Set(urls).size).toBe(urls.length);
  });
});

describe('SearchNode — P2P search', () => {
  let nodeA;
  let nodeB;

  beforeEach(async () => {
    nodeA = await makeNode();
    nodeB = await makeNode();
    // Connect A → B
    await nodeA.connectTo('127.0.0.1', nodeB.network.port);
    // Give the HELLO handshake a moment to propagate
    await new Promise(r => setTimeout(r, 100));
  });

  afterEach(async () => {
    await Promise.all([nodeA.stop(), nodeB.stop()]);
  });

  test('nodeA has one connected peer', () => {
    expect(nodeA.network.peers).toHaveLength(1);
  });

  test('nodeA receives results from nodeB index', async () => {
    // Only nodeB has this document
    nodeB.index.addDocument({
      url: 'http://peer-content.com',
      title: 'Quantum Computing',
      content: 'qubits superposition entanglement',
    });

    const results = await nodeA.search('quantum', 3_000);
    const urls = results.map(r => r.url);
    expect(urls).toContain('http://peer-content.com');
  });

  test('results from both local and remote nodes are merged', async () => {
    nodeA.index.addDocument({ url: 'http://local.com', title: 'Local Result cats', content: '' });
    nodeB.index.addDocument({ url: 'http://remote.com', title: 'Remote Result cats', content: '' });

    const results = await nodeA.search('cats', 3_000);
    const urls = results.map(r => r.url);
    expect(urls).toContain('http://local.com');
    expect(urls).toContain('http://remote.com');
  });

  test('duplicate URLs from multiple peers are de-duplicated', async () => {
    const doc = { url: 'http://shared.com', title: 'Shared Doc dogs', content: '' };
    nodeA.index.addDocument(doc);
    nodeB.index.addDocument(doc);

    const results = await nodeA.search('dogs', 3_000);
    const urls = results.map(r => r.url);
    const unique = new Set(urls);
    expect(unique.size).toBe(urls.length);
  });
});

describe('SearchNode — queueCrawl', () => {
  test('queueCrawl does not throw for empty array', async () => {
    const node = await makeNode();
    expect(() => node.queueCrawl([])).not.toThrow();
    await node.stop();
  });
});
