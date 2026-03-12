'use strict';

/**
 * SearchNode — the top-level component of the decentralized search protocol.
 *
 * A SearchNode combines:
 *   • a P2P Network (TCP gossip layer)
 *   • a local SearchIndex (inverted index of crawled pages)
 *   • a lightweight Crawler (fetches & parses web pages)
 *
 * Usage
 * ─────
 *   const node = new SearchNode();
 *   await node.start();
 *   await node.connectTo('peer.example.com', 5500);
 *   const results = await node.search('search://cats');
 *   await node.stop();
 */

const { EventEmitter } = require('events');
const { Network } = require('./network');
const { SearchIndex } = require('./search-index');
const { crawlURL } = require('./crawler');
const { parseSearchURI } = require('./protocol');

const CRAWL_DELAY_MS = 100; // Politeness delay between crawl requests
const DEFAULT_SEARCH_TIMEOUT_MS = 5_000;

class SearchNode extends EventEmitter {
  /**
   * @param {{ network?: { port?: number, nodeId?: string } }} [options]
   */
  constructor(options = {}) {
    super();
    this.network = new Network(options.network || {});
    this.index = new SearchIndex();

    /**
     * Pending distributed queries.
     * @type {Map<string, { results: Array, timer: NodeJS.Timeout, resolve: Function }>}
     */
    this._pendingQueries = new Map();

    this._crawlQueue = [];
    this._crawling = false;

    // ── Wire up network events ─────────────────────────────────────────────

    // A peer sent us a QUERY — search our local index and reply
    this.network.on('query', ({ id, query, originId }) => {
      const results = this.index.search(query, 10);
      if (results.length > 0) {
        this.network.sendResults(id, results, originId);
      }
    });

    // A peer sent us RESULTS for one of our outstanding queries
    this.network.on('results', ({ queryId, results }) => {
      const pending = this._pendingQueries.get(queryId);
      if (pending) {
        pending.results.push(...results);
      }
    });
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  /**
   * Start the node (begin listening for peer connections).
   * @returns {Promise<SearchNode>} this
   */
  async start() {
    await this.network.listen();
    this.emit('ready', { port: this.network.port, nodeId: this.network.nodeId });
    return this;
  }

  /**
   * Connect to a bootstrap peer.
   * @param {string} host
   * @param {number} port
   */
  async connectTo(host, port) {
    await this.network.connectToPeer(host, port);
  }

  /**
   * Stop the node (close all connections).
   */
  async stop() {
    // Resolve any pending queries immediately
    for (const [id, pending] of this._pendingQueries) {
      clearTimeout(pending.timer);
      pending.resolve(this._deduplicateResults(pending.results));
      this._pendingQueries.delete(id);
    }
    await this.network.close();
  }

  // ── Search ─────────────────────────────────────────────────────────────────

  /**
   * Execute a search query.
   *
   * Accepts either a raw query string ("cats") or a search:// URI
   * ("search://cats"). The query is:
   *   1. Satisfied immediately from the local index.
   *   2. Broadcast to all connected peers; their results are merged in.
   *
   * @param {string} input - Query string or search:// URI
   * @param {number} [timeout] - How long to wait for peer results (ms)
   * @returns {Promise<Array<{ url, title, description, score }>>}
   */
  async search(input, timeout = DEFAULT_SEARCH_TIMEOUT_MS) {
    const query = this._resolveQuery(input);
    const localResults = this.index.search(query, 20);

    if (this.network.peers.length === 0) {
      return localResults;
    }

    // Broadcast to peers and accumulate results until timeout
    const queryId = this.network.broadcastQuery(query);

    return new Promise(resolve => {
      const state = {
        results: [...localResults],
        resolve,
        timer: setTimeout(() => {
          this._pendingQueries.delete(queryId);
          resolve(this._deduplicateResults(state.results));
        }, timeout),
      };
      this._pendingQueries.set(queryId, state);
    });
  }

  // ── Indexing ───────────────────────────────────────────────────────────────

  /**
   * Crawl a URL and add it to the local search index.
   *
   * @param {string} url
   * @returns {Promise<Object|null>} Indexed document, or null on failure
   */
  async indexURL(url) {
    const doc = await crawlURL(url);
    if (doc) {
      this.index.addDocument(doc);
      this.emit('indexed', { url: doc.url, title: doc.title });
    }
    return doc;
  }

  /**
   * Add URLs to the background crawl queue.
   * @param {string[]} urls
   */
  queueCrawl(urls) {
    this._crawlQueue.push(...urls);
    if (!this._crawling) {
      this._processCrawlQueue();
    }
  }

  // ── Private ────────────────────────────────────────────────────────────────

  /**
   * Extract the plain query string from either a search:// URI or raw text.
   * @param {string} input
   * @returns {string}
   */
  _resolveQuery(input) {
    if (typeof input !== 'string' || !input.trim()) {
      throw new Error('Query must be a non-empty string');
    }
    if (input.toLowerCase().startsWith('search://')) {
      return parseSearchURI(input).query;
    }
    return input.trim();
  }

  async _processCrawlQueue() {
    this._crawling = true;
    while (this._crawlQueue.length > 0) {
      const url = this._crawlQueue.shift();
      await this.indexURL(url);
      await new Promise(r => setTimeout(r, CRAWL_DELAY_MS));
    }
    this._crawling = false;
  }

  /**
   * Remove duplicate URLs from a result list and sort by descending score.
   * @param {Array} results
   * @returns {Array}
   */
  _deduplicateResults(results) {
    const seen = new Set();
    return results
      .filter(r => {
        if (seen.has(r.url)) return false;
        seen.add(r.url);
        return true;
      })
      .sort((a, b) => (b.score || 0) - (a.score || 0));
  }
}

module.exports = { SearchNode };
