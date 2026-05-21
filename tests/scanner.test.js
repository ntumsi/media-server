const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  getMediaType,
  getMediaDirs,
  scanDirectory,
  scanAllMedia,
} = require('../lib/scanner');

describe('getMediaType', () => {
  test('classifies video extensions', () => {
    expect(getMediaType('.mp4')).toBe('video');
    expect(getMediaType('.MKV')).toBe('video');
    expect(getMediaType('.webm')).toBe('video');
  });

  test('classifies audio extensions', () => {
    expect(getMediaType('.mp3')).toBe('audio');
    expect(getMediaType('.FLAC')).toBe('audio');
  });

  test('classifies image extensions', () => {
    expect(getMediaType('.jpg')).toBe('image');
    expect(getMediaType('.PNG')).toBe('image');
  });

  test('returns null for unknown extensions', () => {
    expect(getMediaType('.txt')).toBeNull();
    expect(getMediaType('')).toBeNull();
    expect(getMediaType('.zip')).toBeNull();
  });

  test('returns null for non-string input', () => {
    expect(getMediaType(undefined)).toBeNull();
    expect(getMediaType(null)).toBeNull();
    expect(getMediaType(42)).toBeNull();
  });
});

describe('getMediaDirs', () => {
  test('splits comma-separated values', () => {
    const dirs = getMediaDirs('/a,/b,/c');
    expect(dirs).toEqual([
      path.resolve('/a'),
      path.resolve('/b'),
      path.resolve('/c'),
    ]);
  });

  test('trims whitespace and drops empty entries', () => {
    const dirs = getMediaDirs(' /a , , /b ,');
    expect(dirs).toEqual([path.resolve('/a'), path.resolve('/b')]);
  });

  test('resolves relative paths to absolute', () => {
    const dirs = getMediaDirs('./media');
    expect(path.isAbsolute(dirs[0])).toBe(true);
    expect(dirs[0].endsWith('media')).toBe(true);
  });

  test('falls back to MEDIA_DIRS env var when value is undefined', () => {
    const prev = process.env.MEDIA_DIRS;
    process.env.MEDIA_DIRS = '/from-env';
    try {
      expect(getMediaDirs()).toEqual([path.resolve('/from-env')]);
    } finally {
      if (prev === undefined) delete process.env.MEDIA_DIRS;
      else process.env.MEDIA_DIRS = prev;
    }
  });

  test('falls back to ./media when env var is unset', () => {
    const prev = process.env.MEDIA_DIRS;
    delete process.env.MEDIA_DIRS;
    try {
      expect(getMediaDirs()).toEqual([path.resolve('./media')]);
    } finally {
      if (prev !== undefined) process.env.MEDIA_DIRS = prev;
    }
  });
});

describe('scanDirectory', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-scan-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('returns empty array for empty directory', () => {
    expect(scanDirectory(tmpDir, tmpDir)).toEqual([]);
  });

  test('returns empty array for unreadable directory', () => {
    expect(scanDirectory(path.join(tmpDir, 'does-not-exist'), tmpDir)).toEqual([]);
  });

  test('finds media files and skips non-media', () => {
    fs.writeFileSync(path.join(tmpDir, 'song.mp3'), 'a');
    fs.writeFileSync(path.join(tmpDir, 'movie.mp4'), 'bb');
    fs.writeFileSync(path.join(tmpDir, 'pic.jpg'), 'ccc');
    fs.writeFileSync(path.join(tmpDir, 'notes.txt'), 'skip');
    fs.writeFileSync(path.join(tmpDir, 'no-ext'), 'skip');

    const results = scanDirectory(tmpDir, tmpDir);
    const names = results.map(r => r.name).sort();
    expect(names).toEqual(['movie.mp4', 'pic.jpg', 'song.mp3']);

    const mp3 = results.find(r => r.name === 'song.mp3');
    expect(mp3.type).toBe('audio');
    expect(mp3.size).toBe(1);
    expect(mp3.mimeType).toBe('audio/mpeg');
    expect(mp3.relativePath).toBe('song.mp3');
    expect(typeof mp3.modified).toBe('string');
  });

  test('recurses into subdirectories', () => {
    const sub = path.join(tmpDir, 'nested', 'deep');
    fs.mkdirSync(sub, { recursive: true });
    fs.writeFileSync(path.join(sub, 'clip.webm'), 'data');

    const results = scanDirectory(tmpDir, tmpDir);
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('clip.webm');
    expect(results[0].relativePath).toBe(path.join('nested', 'deep', 'clip.webm'));
  });

  test('treats extensions case-insensitively', () => {
    fs.writeFileSync(path.join(tmpDir, 'CLIP.MP4'), 'x');
    const results = scanDirectory(tmpDir, tmpDir);
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe('video');
  });
});

describe('scanAllMedia', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-scan-all-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('aggregates across multiple directories', () => {
    const a = path.join(tmpDir, 'a');
    const b = path.join(tmpDir, 'b');
    fs.mkdirSync(a);
    fs.mkdirSync(b);
    fs.writeFileSync(path.join(a, 'one.mp3'), '1');
    fs.writeFileSync(path.join(b, 'two.mp4'), '22');

    const results = scanAllMedia([a, b]);
    expect(results.map(r => r.name).sort()).toEqual(['one.mp3', 'two.mp4']);
  });

  test('creates missing directories when ensureExists is true', () => {
    const missing = path.join(tmpDir, 'missing');
    expect(fs.existsSync(missing)).toBe(false);
    scanAllMedia([missing], { ensureExists: true });
    expect(fs.existsSync(missing)).toBe(true);
  });

  test('does not create missing directories by default', () => {
    const missing = path.join(tmpDir, 'still-missing');
    expect(fs.existsSync(missing)).toBe(false);
    scanAllMedia([missing]);
    expect(fs.existsSync(missing)).toBe(false);
  });
});
