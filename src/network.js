'use strict';

/**
 * P2P network layer for the decentralized search protocol.
 *
 * Architecture
 * ────────────
 * Each node opens a TCP server and accepts inbound connections from peers.
 * Peers can also be connected to explicitly (e.g. bootstrap nodes).
 * Messages are newline-delimited JSON frames sent over TCP sockets.
 *
 * Message types
 * ─────────────
 * HELLO   — identify yourself when a new connection is established
 * QUERY   — broadcast a search query; carries a TTL for propagation depth
 * RESULTS — send matching documents back (unicast toward origin or broadcast)
 * PING    — keepalive probe
 * PONG    — keepalive reply
 */

const net = require('net');
const crypto = require('crypto');
const { EventEmitter } = require('events');

const DEFAULT_PORT = 5500;
const MAX_TTL = 5;
const MESSAGE_SEPARATOR = '\n';
const SEEN_MSG_LIMIT = 10_000;

class Network extends EventEmitter {
  /**
   * @param {{ port?: number, nodeId?: string }} [options]
   */
  constructor(options = {}) {
    super();
    this.port = options.port !== undefined ? options.port : DEFAULT_PORT;
    this.nodeId = options.nodeId || crypto.randomBytes(16).toString('hex');

    /** @type {Map<string, { peerId:string, socket:net.Socket, address:string, port:number|null }>} */
    this._peers = new Map();
    this._server = null;
    /** @type {Set<string>} — deduplication cache for forwarded messages */
    this._seenMessages = new Set();
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  /**
   * Start listening for inbound peer connections.
   * @returns {Promise<number>} The port actually bound to
   */
  listen() {
    return new Promise((resolve, reject) => {
      this._server = net.createServer(socket =>
        this._handleInboundConnection(socket),
      );
      this._server.on('error', reject);
      this._server.listen(this.port, () => {
        this.port = this._server.address().port; // Capture actual port (0 → random)
        resolve(this.port);
      });
    });
  }

  /**
   * Connect to a peer node.
   * @param {string} host
   * @param {number} port
   * @returns {Promise<void>}
   */
  connectToPeer(host, port) {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host, port }, () => {
        this._setupSocket(socket, host, port);
        this._send(socket, {
          type: 'HELLO',
          nodeId: this.nodeId,
          port: this.port,
        });
        resolve();
      });
      socket.on('error', reject);
    });
  }

  /**
   * Close all connections and shut down the server.
   * @returns {Promise<void>}
   */
  close() {
    for (const peer of this._peers.values()) {
      peer.socket.destroy();
    }
    this._peers.clear();

    if (!this._server) return Promise.resolve();
    return new Promise(resolve => this._server.close(resolve));
  }

  // ── Public messaging API ───────────────────────────────────────────────────

  /**
   * Broadcast a search query to all connected peers.
   * @param {string} query
   * @param {number} [ttl]
   * @returns {string} Query ID (use to correlate RESULTS events)
   */
  broadcastQuery(query, ttl = MAX_TTL) {
    const id = crypto.randomBytes(8).toString('hex');
    this._markSeen(id);
    this._broadcastAll({ type: 'QUERY', id, query, ttl, originId: this.nodeId });
    return id;
  }

  /**
   * Send search results for a query.
   * If targetPeerId is supplied the message is unicast; otherwise it is broadcast.
   *
   * @param {string} queryId
   * @param {Array} results
   * @param {string} [targetPeerId]
   */
  sendResults(queryId, results, targetPeerId) {
    const msg = { type: 'RESULTS', id: queryId, results, nodeId: this.nodeId };
    if (targetPeerId && this._peers.has(targetPeerId)) {
      this._send(this._peers.get(targetPeerId).socket, msg);
    } else {
      this._broadcastAll(msg);
    }
  }

  /**
   * Currently connected peers.
   * @returns {Array<{ id:string, address:string, port:number|null }>}
   */
  get peers() {
    return Array.from(this._peers.values()).map(p => ({
      id: p.peerId,
      address: p.address,
      port: p.port,
    }));
  }

  // ── Private ────────────────────────────────────────────────────────────────

  _handleInboundConnection(socket) {
    this._setupSocket(socket, socket.remoteAddress, null);
  }

  _setupSocket(socket, address, port) {
    let buffer = '';
    socket.setEncoding('utf8');

    socket.on('data', data => {
      buffer += data;
      const lines = buffer.split(MESSAGE_SEPARATOR);
      buffer = lines.pop(); // Keep any partial trailing line

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          this._handleMessage(JSON.parse(line), socket, address, port);
        } catch (_) {
          // Discard malformed frames
        }
      }
    });

    socket.on('close', () => this._removePeer(socket));
    socket.on('error', () => socket.destroy());
  }

  _handleMessage(msg, socket, address, port) {
    switch (msg.type) {
      case 'HELLO':
        this._onHello(msg, socket, address);
        break;
      case 'QUERY':
        this._onQuery(msg, socket);
        break;
      case 'RESULTS':
        this._onResults(msg);
        break;
      case 'PING':
        this._send(socket, { type: 'PONG', nodeId: this.nodeId });
        break;
      default:
        break; // Unknown message types are silently ignored
    }
  }

  _onHello(msg, socket, address) {
    const { nodeId, port } = msg;
    if (nodeId === this.nodeId) return; // Reject self-connections
    if (!this._peers.has(nodeId)) {
      this._peers.set(nodeId, { peerId: nodeId, socket, address, port: port || null });
      this.emit('peer:connect', { id: nodeId, address, port: port || null });
      // Reciprocate so the connecting side also registers us as a peer
      this._send(socket, { type: 'HELLO', nodeId: this.nodeId, port: this.port });
    }
  }

  _onQuery(msg, socket) {
    const { id, query, ttl, originId } = msg;
    if (this._seenMessages.has(id)) return;
    this._markSeen(id);

    this.emit('query', { id, query, originId, socket });

    // Propagate to other peers if TTL allows
    if (ttl > 1) {
      const forwarded = { ...msg, ttl: ttl - 1 };
      for (const peer of this._peers.values()) {
        if (peer.socket !== socket) {
          this._send(peer.socket, forwarded);
        }
      }
    }
  }

  _onResults(msg) {
    this.emit('results', {
      queryId: msg.id,
      results: msg.results,
      nodeId: msg.nodeId,
    });
  }

  _markSeen(id) {
    // Evict oldest entry when cache is full
    if (this._seenMessages.size >= SEEN_MSG_LIMIT) {
      this._seenMessages.delete(this._seenMessages.values().next().value);
    }
    this._seenMessages.add(id);
  }

  _removePeer(socket) {
    for (const [peerId, peer] of this._peers) {
      if (peer.socket === socket) {
        this._peers.delete(peerId);
        this.emit('peer:disconnect', { id: peerId });
        return;
      }
    }
  }

  _send(socket, msg) {
    try {
      socket.write(JSON.stringify(msg) + MESSAGE_SEPARATOR);
    } catch (_) {
      // Ignore write errors on dead sockets
    }
  }

  _broadcastAll(msg) {
    for (const peer of this._peers.values()) {
      this._send(peer.socket, msg);
    }
  }
}

module.exports = { Network, DEFAULT_PORT, MAX_TTL };
