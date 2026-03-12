'use strict';

/**
 * Inverted search index for local document storage and retrieval.
 *
 * Each document is stored with its URL, title, and description.
 * Terms are extracted from the title, description, and body content and
 * stored in an inverted index that maps term → set of document IDs.
 * Relevance scoring is based on term-frequency (number of query terms
 * that match a document).
 */
class SearchIndex {
  constructor() {
    /** @type {Map<string, Set<number>>} term → document IDs */
    this._invertedIndex = new Map();
    /** @type {Map<number, {url:string, title:string, description:string, indexedAt:number}>} */
    this._documents = new Map();
    this._nextId = 0;
  }

  /**
   * Add a document to the index.
   * If a document with the same URL already exists it is replaced.
   *
   * @param {{ url: string, title?: string, description?: string, content?: string }} doc
   * @returns {number} Internal document ID
   */
  addDocument(doc) {
    if (!doc || !doc.url) {
      throw new Error('Document must have a url property');
    }

    // Replace existing document with same URL
    for (const [id, existing] of this._documents) {
      if (existing.url === doc.url) {
        this._removeDocumentTerms(id);
        this._documents.delete(id);
        break;
      }
    }

    const id = this._nextId++;
    this._documents.set(id, {
      url: doc.url,
      title: doc.title || '',
      description: doc.description || '',
      indexedAt: Date.now(),
    });

    // Index all text fields
    const text = [doc.title, doc.description, doc.content]
      .filter(Boolean)
      .join(' ');

    for (const term of this._tokenize(text)) {
      if (!this._invertedIndex.has(term)) {
        this._invertedIndex.set(term, new Set());
      }
      this._invertedIndex.get(term).add(id);
    }

    return id;
  }

  /**
   * Search the index for documents matching the query.
   *
   * @param {string} query - Free-text search query
   * @param {number} [limit=10] - Maximum number of results to return
   * @returns {Array<{url:string, title:string, description:string, score:number}>}
   */
  search(query, limit = 10) {
    if (!query || typeof query !== 'string') return [];

    const queryTerms = this._tokenize(query);
    if (queryTerms.length === 0) return [];

    // Score each matching document by term-frequency overlap
    const scores = new Map();
    for (const term of queryTerms) {
      const docIds = this._invertedIndex.get(term);
      if (!docIds) continue;
      for (const docId of docIds) {
        scores.set(docId, (scores.get(docId) || 0) + 1);
      }
    }

    return Array.from(scores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([docId, score]) => ({
        ...this._documents.get(docId),
        score,
      }));
  }

  /** Total number of indexed documents. */
  get size() {
    return this._documents.size;
  }

  /**
   * Export the index to a plain serialisable object so it can be shared
   * with peer nodes over the network.
   *
   * @returns {{ documents: Array, invertedIndex: Array }}
   */
  export() {
    return {
      documents: Array.from(this._documents.entries()).map(([id, doc]) => ({ id, ...doc })),
      invertedIndex: Array.from(this._invertedIndex.entries()).map(
        ([term, ids]) => [term, Array.from(ids)],
      ),
    };
  }

  /**
   * Merge an exported index from a peer node into this index.
   * Only documents not already present (by URL) are imported.
   *
   * @param {{ documents: Array }} exported
   */
  merge(exported) {
    if (!exported || !Array.isArray(exported.documents)) return;

    const existingUrls = new Set(
      Array.from(this._documents.values()).map(d => d.url),
    );

    for (const doc of exported.documents) {
      if (!existingUrls.has(doc.url)) {
        this.addDocument(doc);
        existingUrls.add(doc.url);
      }
    }
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  _removeDocumentTerms(docId) {
    for (const [term, ids] of this._invertedIndex) {
      ids.delete(docId);
      if (ids.size === 0) {
        this._invertedIndex.delete(term);
      }
    }
  }

  /**
   * Tokenise a text string into lower-case alphabetic terms (≥ 3 chars).
   *
   * @param {string} text
   * @returns {string[]}
   */
  _tokenize(text) {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length >= 3);
  }
}

module.exports = { SearchIndex };
