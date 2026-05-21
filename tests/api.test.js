const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');

const { createApp } = require('../lib/server');

function buildLibrary(tmpDir) {
  const videoPath = path.join(tmpDir, 'clip.mp4');
  const audioPath = path.join(tmpDir, 'song.mp3');
  const imagePath = path.join(tmpDir, 'photo.jpg');

  // Use a fixed payload so Range tests have deterministic offsets.
  const videoBuf = Buffer.alloc(1024);
  for (let i = 0; i < videoBuf.length; i++) videoBuf[i] = i % 256;
  fs.writeFileSync(videoPath, videoBuf);
  fs.writeFileSync(audioPath, 'audio-bytes');
  fs.writeFileSync(imagePath, 'image-bytes');

  return [
    {
      name: 'clip.mp4',
      path: videoPath,
      relativePath: 'clip.mp4',
      type: 'video',
      size: videoBuf.length,
      modified: new Date().toISOString(),
      mimeType: 'video/mp4',
    },
    {
      name: 'song.mp3',
      path: audioPath,
      relativePath: 'song.mp3',
      type: 'audio',
      size: fs.statSync(audioPath).size,
      modified: new Date().toISOString(),
      mimeType: 'audio/mpeg',
    },
    {
      name: 'photo.jpg',
      path: imagePath,
      relativePath: 'photo.jpg',
      type: 'image',
      size: fs.statSync(imagePath).size,
      modified: new Date().toISOString(),
      mimeType: 'image/jpeg',
    },
  ];
}

describe('API', () => {
  let tmpDir;
  let library;
  let app;
  let scanCalled;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-api-'));
    library = buildLibrary(tmpDir);
    scanCalled = 0;
    app = createApp({
      getLibrary: () => library,
      getMediaDirs: () => [tmpDir],
      runScan: () => { scanCalled++; },
      port: 5000,
    });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('GET /api/files', () => {
    test('returns all files with safe fields only', async () => {
      const res = await request(app).get('/api/files');
      expect(res.status).toBe(200);
      expect(res.body.count).toBe(3);
      expect(res.body.files).toHaveLength(3);
      for (const file of res.body.files) {
        expect(file).not.toHaveProperty('path');
        expect(file).toHaveProperty('id');
        expect(file).toHaveProperty('relativePath');
      }
    });

    test('filters by type', async () => {
      const res = await request(app).get('/api/files?type=video');
      expect(res.body.count).toBe(1);
      expect(res.body.files[0].name).toBe('clip.mp4');
    });

    test('ignores invalid type values', async () => {
      const res = await request(app).get('/api/files?type=bogus');
      expect(res.body.count).toBe(3);
    });

    test('filters by search query (case-insensitive)', async () => {
      const res = await request(app).get('/api/files?q=SONG');
      expect(res.body.count).toBe(1);
      expect(res.body.files[0].name).toBe('song.mp3');
    });

    test('combines type and q filters', async () => {
      const res = await request(app).get('/api/files?type=image&q=photo');
      expect(res.body.count).toBe(1);
    });
  });

  describe('GET /api/info', () => {
    test('returns server metadata', async () => {
      const res = await request(app).get('/api/info');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        name: 'Media Server',
        version: '2.0.0',
        totalFiles: 3,
        counts: { video: 1, audio: 1, image: 1 },
      });
      expect(res.body.mediaDirs).toEqual([tmpDir]);
      expect(res.body.network.port).toBe(5000);
      expect(Array.isArray(res.body.network.addresses)).toBe(true);
    });
  });

  describe('POST /api/scan', () => {
    test('invokes the scanner and returns updated count', async () => {
      const res = await request(app).post('/api/scan');
      expect(res.status).toBe(200);
      expect(scanCalled).toBe(1);
      expect(res.body.totalFiles).toBe(3);
    });
  });

  describe('GET /api/stream/:id', () => {
    test('serves full content with 200 when no Range header', async () => {
      const res = await request(app).get('/api/stream/0');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('video/mp4');
      expect(res.headers['content-length']).toBe('1024');
      expect(res.headers['accept-ranges']).toBe('bytes');
      expect(res.body.length).toBe(1024);
    });

    test('serves partial content with 206 for valid Range', async () => {
      const res = await request(app).get('/api/stream/0').set('Range', 'bytes=0-99');
      expect(res.status).toBe(206);
      expect(res.headers['content-range']).toBe('bytes 0-99/1024');
      expect(res.headers['content-length']).toBe('100');
      expect(res.body.length).toBe(100);
    });

    test('serves last N bytes for suffix Range', async () => {
      const res = await request(app).get('/api/stream/0').set('Range', 'bytes=-50');
      expect(res.status).toBe(206);
      expect(res.headers['content-range']).toBe('bytes 974-1023/1024');
      expect(res.body.length).toBe(50);
    });

    test('serves open-ended Range bytes=N-', async () => {
      const res = await request(app).get('/api/stream/0').set('Range', 'bytes=1000-');
      expect(res.status).toBe(206);
      expect(res.headers['content-range']).toBe('bytes 1000-1023/1024');
      expect(res.body.length).toBe(24);
    });

    test('returns 416 for malformed Range header', async () => {
      const res = await request(app).get('/api/stream/0').set('Range', 'not-a-range');
      expect(res.status).toBe(416);
      expect(res.headers['content-range']).toBe('bytes */1024');
    });

    test('returns 416 when start > end', async () => {
      const res = await request(app).get('/api/stream/0').set('Range', 'bytes=500-100');
      expect(res.status).toBe(416);
    });

    test('returns 416 when end >= fileSize', async () => {
      const res = await request(app).get('/api/stream/0').set('Range', 'bytes=0-2000');
      expect(res.status).toBe(416);
    });

    test('returns 416 when start >= fileSize', async () => {
      const res = await request(app).get('/api/stream/0').set('Range', 'bytes=2000-3000');
      expect(res.status).toBe(416);
    });

    test('returns 404 for non-numeric id', async () => {
      const res = await request(app).get('/api/stream/abc');
      expect(res.status).toBe(404);
    });

    test('returns 404 for out-of-range id', async () => {
      const res = await request(app).get('/api/stream/999');
      expect(res.status).toBe(404);
    });

    test('returns 404 for negative id', async () => {
      const res = await request(app).get('/api/stream/-1');
      expect(res.status).toBe(404);
    });

    test('returns 404 when underlying file is missing', async () => {
      fs.unlinkSync(library[0].path);
      const res = await request(app).get('/api/stream/0');
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/thumbnail/:id', () => {
    test('serves image files directly', async () => {
      const res = await request(app).get('/api/thumbnail/2');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/image\/jpeg/);
    });

    test('redirects to placeholder icon for video', async () => {
      const res = await request(app).get('/api/thumbnail/0').redirects(0);
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/icons/video.svg');
    });

    test('redirects to placeholder icon for audio', async () => {
      const res = await request(app).get('/api/thumbnail/1').redirects(0);
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/icons/audio.svg');
    });

    test('returns 404 for unknown id', async () => {
      const res = await request(app).get('/api/thumbnail/999');
      expect(res.status).toBe(404);
    });

    test('returns 404 when image file is missing (no path disclosure)', async () => {
      fs.unlinkSync(library[2].path);
      const res = await request(app).get('/api/thumbnail/2');
      expect(res.status).toBe(404);
    });
  });
});
