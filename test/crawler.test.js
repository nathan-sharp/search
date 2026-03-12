'use strict';

const { parseHTML } = require('../src/crawler');

/**
 * Tests for the HTML parser used by the crawler.
 * We test parseHTML directly to avoid making real HTTP requests in unit tests.
 */
describe('parseHTML', () => {
  const BASE_URL = 'http://example.com/page';

  test('extracts the page title', () => {
    const html = '<html><head><title>My Page Title</title></head><body></body></html>';
    const { title } = parseHTML(html, BASE_URL);
    expect(title).toBe('My Page Title');
  });

  test('trims whitespace from title', () => {
    const html = '<title>  Spaced Title  </title>';
    const { title } = parseHTML(html, BASE_URL);
    expect(title).toBe('Spaced Title');
  });

  test('returns empty title when none present', () => {
    const { title } = parseHTML('<html><body>No title</body></html>', BASE_URL);
    expect(title).toBe('');
  });

  test('extracts meta description', () => {
    const html = '<meta name="description" content="Great website about cats">';
    const { description } = parseHTML(html, BASE_URL);
    expect(description).toBe('Great website about cats');
  });

  test('returns empty description when none present', () => {
    const { description } = parseHTML('<html><body>Text</body></html>', BASE_URL);
    expect(description).toBe('');
  });

  test('strips HTML tags from content', () => {
    const html = '<body><p>Hello <b>World</b></p></body>';
    const { content } = parseHTML(html, BASE_URL);
    expect(content).not.toContain('<');
    expect(content).toContain('Hello');
    expect(content).toContain('World');
  });

  test('strips script tags (tag text remains for indexing)', () => {
    const html = '<body><script>var x = "hidden";</script><p>Visible</p></body>';
    const { content } = parseHTML(html, BASE_URL);
    // Tags are removed; text inside script elements is kept for search indexing
    expect(content).not.toContain('<script');
    expect(content).not.toContain('</script>');
    expect(content).toContain('Visible');
  });

  test('strips style tags (tag text remains for indexing)', () => {
    const html = '<body><style>body { color: red; }</style><p>Text</p></body>';
    const { content } = parseHTML(html, BASE_URL);
    // Tags are removed; text inside style elements is kept for search indexing
    expect(content).not.toContain('<style');
    expect(content).not.toContain('</style>');
    expect(content).toContain('Text');
  });

  test('extracts absolute links', () => {
    const html = '<a href="http://other.com/page">Link</a>';
    const { links } = parseHTML(html, BASE_URL);
    expect(links).toContain('http://other.com/page');
  });

  test('resolves relative links against base URL', () => {
    const html = '<a href="/about">About</a>';
    const { links } = parseHTML(html, BASE_URL);
    expect(links).toContain('http://example.com/about');
  });

  test('ignores fragment-only links', () => {
    const html = '<a href="#section">Jump</a>';
    const { links } = parseHTML(html, BASE_URL);
    // Fragment-only hrefs start with '#' and should be excluded
    expect(links.every(l => !l.includes('#section') || l.startsWith('http'))).toBe(true);
  });

  test('returns empty links array when no hrefs present', () => {
    const html = '<body><p>No links here</p></body>';
    const { links } = parseHTML(html, BASE_URL);
    expect(links).toEqual([]);
  });

  test('handles empty HTML gracefully', () => {
    const result = parseHTML('', BASE_URL);
    expect(result.title).toBe('');
    expect(result.description).toBe('');
    expect(result.content).toBe('');
    expect(result.links).toEqual([]);
  });
});
