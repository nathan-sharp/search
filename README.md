# search — Decentralized Search Protocol

A peer-to-peer search protocol that lets anyone enter a query and receive a
list of public web pages — **with no central server in control**.

Queries use the `search://` URI scheme:

```
search://your query here
search://cats%20and%20dogs
```

---

## How it works

```
┌─────────────┐   search://cats   ┌─────────────┐
│   Your node │ ──────────────►  │   Peer node │
│  (index A)  │ ◄──────────────  │  (index B)  │
└─────────────┘    results        └─────────────┘
       │                                 │
       ▼                                 ▼
  Local index                      Local index
  (crawled pages)                  (crawled pages)
```

1. Every node maintains a **local inverted search index** of web pages it has crawled.
2. When you run a query, your node searches its local index **and** broadcasts the
   query to all connected peers using a gossip protocol (TCP, newline-delimited JSON).
3. Each peer searches its own index and sends matching results back.
4. Results from all nodes are merged, deduplicated, and ranked by relevance.
5. No single server is authoritative — the network is fully **decentralized**.

---

## Installation

```bash
npm install
```

Requires Node.js ≥ 16.

---

## Usage

### CLI

```bash
# One-shot query (exits after printing results)
node bin/search "hello world"
node bin/search "search://hello%20world"

# Start a persistent P2P node daemon
node bin/search --node

# Start a node + browser-accessible HTTP gateway
node bin/search --gateway
```

### Environment variables

| Variable        | Default | Description                            |
|-----------------|---------|----------------------------------------|
| `SEARCH_PORT`   | `5500`  | TCP port for the P2P node              |
| `SEARCH_PEERS`  | _(none)_| Comma-separated bootstrap peers `h:p` |
| `GATEWAY_PORT`  | `3000`  | Port for the HTTP gateway              |

### HTTP Gateway

Once the gateway is running visit **http://localhost:3000** in any browser.

| Route                  | Description                          |
|------------------------|--------------------------------------|
| `GET /`                | Search home page (HTML form)         |
| `GET /search?q=cats`   | Search results (HTML)                |
| `GET /search?q=cats&json=1` | Search results (JSON)           |
| `GET /search?uri=search://cats` | Search via protocol URI    |
| `GET /health`          | Node status (JSON)                   |

### Programmatic API

```js
const { SearchNode } = require('./src/node');

const node = new SearchNode();
await node.start();

// Connect to a peer
await node.connectTo('peer.example.com', 5500);

// Search — accepts plain text or search:// URI
const results = await node.search('search://cats');
// [{ url, title, description, score }, ...]

// Crawl and index a page
await node.indexURL('https://example.com');

// Queue multiple pages for background crawling
node.queueCrawl(['https://a.com', 'https://b.com']);

await node.stop();
```

### Protocol module

```js
const { parseSearchURI, buildSearchURI } = require('./src/protocol');

buildSearchURI('hello world');          // → 'search://hello%20world'
parseSearchURI('search://hello%20world'); // → { query: 'hello world' }
```

---

## Architecture

| Module | Responsibility |
|--------|----------------|
| `src/protocol.js` | Parse / build `search://` URIs |
| `src/search-index.js` | Local inverted search index |
| `src/crawler.js` | Fetch and parse web pages (built-in `http`/`https`) |
| `src/network.js` | P2P TCP gossip layer (HELLO / QUERY / RESULTS) |
| `src/node.js` | Top-level `SearchNode` combining all components |
| `src/gateway.js` | HTTP gateway (HTML UI + JSON API) |
| `bin/search` | CLI entrypoint |

### Wire protocol

Messages are newline-delimited JSON sent over TCP:

```jsonc
// Peer handshake
{ "type": "HELLO",   "nodeId": "<hex>", "port": 5500 }

// Broadcast a query (TTL controls propagation depth)
{ "type": "QUERY",   "id": "<hex>", "query": "cats", "ttl": 5, "originId": "<hex>" }

// Return matching results
{ "type": "RESULTS", "id": "<hex>", "results": [...], "nodeId": "<hex>" }
```

---

## Tests

```bash
npm test
```

66 unit and integration tests covering the protocol parser, search index,
HTML parser, and P2P network layer.

