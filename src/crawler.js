'use strict';

/**
 * Lightweight web crawler using only Node.js built-in modules.
 *
 * Fetches a URL, follows a single redirect, and extracts page metadata
 * (title, meta-description, visible body text, outbound links) suitable
 * for adding to the local SearchIndex.
 */

const https = require('https');
const http = require('http');
const { URL } = require('url');

const FETCH_TIMEOUT_MS = 10_000;
const MAX_BODY_BYTES = 500_000; // 500 KB — avoid huge pages
const MAX_CONTENT_CHARS = 5_000; // Characters stored per page
const MAX_REDIRECTS = 3;

/**
 * Fetch a URL and return its raw body text.
 *
 * @param {string} url
 * @param {number} [redirectsLeft]
 * @returns {Promise<{ body: string, statusCode: number, contentType: string }>}
 */
function fetchURL(url, redirectsLeft = MAX_REDIRECTS) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (e) {
      return reject(new Error(`Invalid URL: ${url}`));
    }

    const client = parsed.protocol === 'https:' ? https : http;

    const req = client.get(url, { timeout: FETCH_TIMEOUT_MS }, res => {
      const { statusCode, headers } = res;

      // Follow redirects
      if (statusCode >= 300 && statusCode < 400 && headers.location) {
        if (redirectsLeft <= 0) {
          return reject(new Error('Too many redirects'));
        }
        res.resume(); // Drain the socket
        try {
          const next = new URL(headers.location, url).toString();
          resolve(fetchURL(next, redirectsLeft - 1));
        } catch (e) {
          reject(new Error(`Invalid redirect location: ${headers.location}`));
        }
        return;
      }

      const contentType = headers['content-type'] || '';
      let bytes = 0;
      let body = '';
      res.setEncoding('utf8');

      res.on('data', chunk => {
        bytes += Buffer.byteLength(chunk, 'utf8');
        if (bytes <= MAX_BODY_BYTES) {
          body += chunk;
        } else {
          res.destroy(); // Stop reading oversized pages
        }
      });

      res.on('end', () => resolve({ body, statusCode, contentType }));
      res.on('error', reject);
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Request timed out after ${FETCH_TIMEOUT_MS}ms`));
    });
  });
}

/**
 * Parse an HTML string and extract page metadata.
 *
 * @param {string} html
 * @param {string} baseURL - Used to resolve relative links
 * @returns {{ title: string, description: string, content: string, links: string[] }}
 */
function parseHTML(html, baseURL) {
  // Title
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch
    ? titleMatch[1].replace(/\s+/g, ' ').trim()
    : '';

  // Meta description
  const descMatch =
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)/i) ||
    html.match(/<meta[^>]+content=["']([^"']*)[^>]+name=["']description["']/i);
  const description = descMatch ? descMatch[1].trim() : '';

  // Visible body text (strip scripts, styles, tags)
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const rawBody = bodyMatch ? bodyMatch[1] : html;
  const content = rawBody
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_CONTENT_CHARS);

  // Outbound links
  const links = [];
  const linkPattern = /href=["']([^"'#?][^"']*?)["']/gi;
  let match;
  while ((match = linkPattern.exec(html)) !== null) {
    try {
      const abs = new URL(match[1], baseURL).toString();
      if (abs.startsWith('http://') || abs.startsWith('https://')) {
        links.push(abs);
      }
    } catch (_) {
      // Skip unparseable hrefs
    }
  }

  return { title, description, content, links };
}

/**
 * Crawl a single URL and return an indexable document, or null on failure.
 *
 * @param {string} url
 * @returns {Promise<{ url, title, description, content, links } | null>}
 */
async function crawlURL(url) {
  let result;
  try {
    result = await fetchURL(url);
  } catch (_) {
    return null;
  }

  if (result.statusCode !== 200) return null;
  if (!result.contentType.includes('text/html')) return null;

  const parsed = parseHTML(result.body, url);
  return {
    url,
    title: parsed.title,
    description: parsed.description,
    content: parsed.content,
    links: parsed.links,
  };
}

module.exports = { crawlURL, parseHTML, fetchURL };
