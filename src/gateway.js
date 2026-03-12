'use strict';

/**
 * HTTP gateway for the search:// protocol.
 *
 * Bridges standard HTTP requests to the decentralized search network so
 * that users can access it through any web browser without a custom
 * protocol handler installed.
 *
 * Routes
 * ──────
 *   GET /                         — search home page (HTML form)
 *   GET /search?q=<query>         — full-text search (HTML results)
 *   GET /search?uri=search://...  — search via protocol URI
 *   GET /search?q=<query>&json=1  — machine-readable JSON response
 *   GET /health                   — node health check (JSON)
 */

const http = require('http');
const { URL } = require('url');
const { parseSearchURI, buildSearchURI } = require('./protocol');

/**
 * Create and start an HTTP gateway server.
 *
 * @param {import('./node').SearchNode} node
 * @param {number} [port=3000]
 * @returns {http.Server}
 */
function createGateway(node, port = 3000) {
  const server = http.createServer((req, res) =>
    handleRequest(req, res, node, port),
  );
  server.listen(port);
  return server;
}

async function handleRequest(req, res, node, port) {
  const reqUrl = new URL(req.url, `http://localhost:${port}`);

  if (reqUrl.pathname === '/health') {
    return sendJSON(res, 200, {
      status: 'ok',
      nodeId: node.network.nodeId,
      peers: node.network.peers.length,
      indexed: node.index.size,
    });
  }

  if (reqUrl.pathname === '/search' || reqUrl.pathname === '/') {
    const rawQuery = reqUrl.searchParams.get('q') || '';
    const uriParam = reqUrl.searchParams.get('uri') || '';
    const wantJSON =
      reqUrl.searchParams.get('json') === '1' ||
      (req.headers.accept || '').includes('application/json');

    // No query → render home page
    if (!rawQuery && !uriParam) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(renderHomePage());
    }

    let query;
    try {
      if (uriParam) {
        ({ query } = parseSearchURI(uriParam));
      } else {
        query = rawQuery.trim();
        if (!query) throw new Error('Empty query');
      }
    } catch (e) {
      return sendJSON(res, 400, { error: e.message });
    }

    let results;
    try {
      results = await node.search(query);
    } catch (e) {
      return sendJSON(res, 500, { error: e.message });
    }

    if (wantJSON) {
      return sendJSON(res, 200, {
        query,
        uri: buildSearchURI(query),
        results,
        total: results.length,
      });
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(renderResultsPage(query, results));
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
}

// ── HTML templates ────────────────────────────────────────────────────────────

function renderHomePage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Decentralized Search</title>
  <style>
    *{box-sizing:border-box}
    body{font-family:Arial,sans-serif;max-width:600px;margin:100px auto 40px;padding:0 16px;text-align:center}
    h1{font-size:2.2em;color:#222;margin-bottom:4px}
    .sub{color:#666;margin-bottom:2em}
    form{display:flex;gap:8px}
    input[type=text]{flex:1;padding:12px 14px;font-size:1em;border:2px solid #ccc;border-radius:6px;outline:none}
    input[type=text]:focus{border-color:#555}
    button{padding:12px 22px;background:#333;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:1em}
    button:hover{background:#555}
    .note{margin-top:1.2em;font-size:.82em;color:#999}
  </style>
</head>
<body>
  <h1>&#x1F50D; Decentralized Search</h1>
  <p class="sub">Peer-to-peer search &mdash; no single server in control</p>
  <form action="/search" method="get">
    <input type="text" name="q" placeholder="Enter your search query&hellip;" autofocus>
    <button type="submit">Search</button>
  </form>
  <p class="note">Powered by the <code>search://</code> protocol</p>
</body>
</html>`;
}

function renderResultsPage(query, results) {
  const items = results.length === 0
    ? '<p style="color:#666">No results found.</p>'
    : results.map(r => `
      <div class="result">
        <a href="${esc(r.url)}" class="title">${esc(r.title || r.url)}</a>
        <div class="url">${esc(r.url)}</div>
        ${r.description ? `<div class="desc">${esc(r.description)}</div>` : ''}
      </div>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${esc(query)} &mdash; Decentralized Search</title>
  <style>
    *{box-sizing:border-box}
    body{font-family:Arial,sans-serif;max-width:720px;margin:20px auto;padding:0 16px}
    .bar{display:flex;gap:8px;margin-bottom:1.4em}
    input[type=text]{flex:1;padding:10px 12px;font-size:1em;border:2px solid #ccc;border-radius:6px}
    button{padding:10px 20px;background:#333;color:#fff;border:none;border-radius:6px;cursor:pointer}
    .count{color:#777;margin-bottom:1.2em;font-size:.9em}
    .result{margin-bottom:1.6em}
    .title{font-size:1.1em;color:#1a0dab;text-decoration:none}
    .title:hover{text-decoration:underline}
    .url{font-size:.83em;color:#006621;margin-top:2px}
    .desc{color:#545454;font-size:.9em;margin-top:4px}
    .proto{font-size:.78em;color:#aaa;margin-top:2em}
  </style>
</head>
<body>
  <form class="bar" action="/search" method="get">
    <input type="text" name="q" value="${esc(query)}">
    <button type="submit">Search</button>
  </form>
  <div class="count">${results.length} result${results.length !== 1 ? 's' : ''} for <em>${esc(query)}</em></div>
  ${items}
  <div class="proto">Protocol URI: <code>search://${encodeURIComponent(query)}</code></div>
</body>
</html>`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sendJSON(res, statusCode, body) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

module.exports = { createGateway };
