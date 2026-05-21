const { formatSize, escapeHtml, typeIcon } = require('../public/utils');

describe('formatSize', () => {
  test('renders zero', () => {
    expect(formatSize(0)).toBe('0 B');
  });

  test('renders bytes', () => {
    expect(formatSize(512)).toBe('512.0 B');
  });

  test('renders kilobytes', () => {
    expect(formatSize(1024)).toBe('1.0 KB');
    expect(formatSize(1536)).toBe('1.5 KB');
  });

  test('renders megabytes', () => {
    expect(formatSize(1024 * 1024)).toBe('1.0 MB');
  });

  test('renders gigabytes', () => {
    expect(formatSize(1024 * 1024 * 1024)).toBe('1.0 GB');
  });

  test('handles falsy / negative input', () => {
    expect(formatSize(null)).toBe('0 B');
    expect(formatSize(undefined)).toBe('0 B');
    expect(formatSize(-5)).toBe('0 B');
  });
});

describe('escapeHtml', () => {
  test('escapes script tags', () => {
    expect(escapeHtml('<script>alert(1)</script>'))
      .toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  test('escapes quotes and ampersands', () => {
    expect(escapeHtml(`AT&T "<a href='x'>"`))
      .toBe('AT&amp;T &quot;&lt;a href=&#39;x&#39;&gt;&quot;');
  });

  test('coerces non-string values', () => {
    expect(escapeHtml(42)).toBe('42');
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });

  test('leaves benign strings unchanged', () => {
    expect(escapeHtml('hello world')).toBe('hello world');
  });
});

describe('typeIcon', () => {
  test('returns emoji per type', () => {
    expect(typeIcon('video')).toBe('\u{1F3AC}');
    expect(typeIcon('audio')).toBe('\u{1F3B5}');
    expect(typeIcon('image')).toBe('\u{1F5BC}');
    expect(typeIcon('other')).toBe('\u{1F4C1}');
  });
});
