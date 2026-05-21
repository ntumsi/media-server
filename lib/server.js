const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const os = require('os');

function parseRangeHeader(header, fileSize) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match) return null;

  const hasStart = match[1] !== '';
  const hasEnd = match[2] !== '';
  if (!hasStart && !hasEnd) return null;

  let start;
  let end;
  if (!hasStart && hasEnd) {
    const suffix = parseInt(match[2], 10);
    if (suffix <= 0) return null;
    start = Math.max(0, fileSize - suffix);
    end = fileSize - 1;
  } else {
    start = parseInt(match[1], 10);
    end = hasEnd ? parseInt(match[2], 10) : fileSize - 1;
  }

  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  if (start < 0 || end < start || start >= fileSize || end >= fileSize) return null;

  return { start, end };
}

function getIPv4Addresses() {
  const networkInterfaces = os.networkInterfaces();
  const addresses = [];
  for (const iface of Object.values(networkInterfaces)) {
    if (!iface) continue;
    for (const config of iface) {
      if (config.family === 'IPv4' && !config.internal) {
        addresses.push(config.address);
      }
    }
  }
  return addresses;
}

function createApp({ getLibrary, getMediaDirs, runScan, port }) {
  const app = express();
  app.use(express.json());
  app.use(cors());
  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.get('/api/files', (req, res) => {
    const library = getLibrary();
    const { type, q } = req.query;
    let files = library;

    if (type && ['video', 'audio', 'image'].includes(type)) {
      files = files.filter(f => f.type === type);
    }

    if (q) {
      const query = String(q).toLowerCase();
      files = files.filter(f => f.name.toLowerCase().includes(query));
    }

    const safeFiles = files.map(f => ({
      id: library.indexOf(f),
      name: f.name,
      relativePath: f.relativePath,
      type: f.type,
      size: f.size,
      modified: f.modified,
      mimeType: f.mimeType,
    }));

    res.json({ count: safeFiles.length, files: safeFiles });
  });

  app.get('/api/info', (req, res) => {
    const library = getLibrary();
    const addresses = getIPv4Addresses();

    res.json({
      name: 'Media Server',
      version: '2.0.0',
      mediaDirs: getMediaDirs(),
      totalFiles: library.length,
      counts: {
        video: library.filter(f => f.type === 'video').length,
        audio: library.filter(f => f.type === 'audio').length,
        image: library.filter(f => f.type === 'image').length,
      },
      network: {
        hostname: os.hostname(),
        addresses,
        port,
        urls: addresses.map(a => `http://${a}:${port}`),
      },
    });
  });

  app.post('/api/scan', (req, res) => {
    runScan();
    res.json({ message: 'Scan complete', totalFiles: getLibrary().length });
  });

  app.get('/api/stream/:id', (req, res) => {
    const library = getLibrary();
    const id = parseInt(req.params.id, 10);

    if (!Number.isInteger(id) || id < 0 || id >= library.length) {
      return res.status(404).json({ error: 'File not found' });
    }

    const file = library[id];
    if (!file || !fs.existsSync(file.path)) {
      return res.status(404).json({ error: 'File not found' });
    }

    const stat = fs.statSync(file.path);
    const fileSize = stat.size;
    const contentType = file.mimeType;
    const rangeHeader = req.headers.range;

    if (rangeHeader) {
      const parsed = parseRangeHeader(rangeHeader, fileSize);
      if (!parsed) {
        res.set('Content-Range', `bytes */${fileSize}`);
        return res.status(416).json({ error: 'Range Not Satisfiable' });
      }
      const { start, end } = parsed;
      const chunkSize = end - start + 1;

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': contentType,
      });
      fs.createReadStream(file.path, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
      });
      fs.createReadStream(file.path).pipe(res);
    }
  });

  app.get('/api/thumbnail/:id', (req, res) => {
    const library = getLibrary();
    const id = parseInt(req.params.id, 10);

    if (!Number.isInteger(id) || id < 0 || id >= library.length) {
      return res.status(404).json({ error: 'File not found' });
    }

    const file = library[id];
    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }

    if (file.type === 'image') {
      if (!fs.existsSync(file.path)) {
        return res.status(404).json({ error: 'File not found' });
      }
      return res.sendFile(file.path);
    }

    res.redirect('/icons/' + file.type + '.svg');
  });

  return app;
}

module.exports = { createApp, parseRangeHeader, getIPv4Addresses };
