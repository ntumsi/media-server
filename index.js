const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');
const mime = require('mime-types');
const os = require('os');

dotenv.config();

const PORT = process.env.PORT || 5000;
const SCAN_INTERVAL = (parseInt(process.env.SCAN_INTERVAL, 10) || 300) * 1000;

const MEDIA_EXTENSIONS = {
  video: new Set(['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.mpg', '.mpeg', '.3gp', '.ts']),
  audio: new Set(['.mp3', '.flac', '.wav', '.aac', '.ogg', '.wma', '.m4a', '.opus', '.aiff']),
  image: new Set(['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg', '.tiff', '.ico']),
};

function getMediaType(ext) {
  ext = ext.toLowerCase();
  if (MEDIA_EXTENSIONS.video.has(ext)) return 'video';
  if (MEDIA_EXTENSIONS.audio.has(ext)) return 'audio';
  if (MEDIA_EXTENSIONS.image.has(ext)) return 'image';
  return null;
}

// --- Media Scanner ---
let mediaLibrary = [];

function getMediaDirs() {
  const dirs = (process.env.MEDIA_DIRS || './media')
    .split(',')
    .map(d => d.trim())
    .filter(Boolean)
    .map(d => path.resolve(d));
  return dirs;
}

function scanDirectory(dirPath, baseDir) {
  const results = [];
  let entries;
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...scanDirectory(fullPath, baseDir));
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name);
      const type = getMediaType(ext);
      if (type) {
        let stat;
        try {
          stat = fs.statSync(fullPath);
        } catch {
          continue;
        }
        results.push({
          name: entry.name,
          path: fullPath,
          relativePath: path.relative(baseDir, fullPath),
          type,
          size: stat.size,
          modified: stat.mtime.toISOString(),
          mimeType: mime.lookup(fullPath) || 'application/octet-stream',
        });
      }
    }
  }
  return results;
}

function scanAllMedia() {
  const dirs = getMediaDirs();
  const allFiles = [];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      console.log(`[scanner] Creating media directory: ${dir}`);
      fs.mkdirSync(dir, { recursive: true });
    }
    console.log(`[scanner] Scanning: ${dir}`);
    allFiles.push(...scanDirectory(dir, dir));
  }
  mediaLibrary = allFiles;
  console.log(`[scanner] Found ${mediaLibrary.length} media files`);
}

// --- Server ---
const app = express();
app.use(express.json());
app.use(cors());

// Serve the web UI
app.use(express.static(path.join(__dirname, 'public')));

// API: List all media files
app.get('/api/files', (req, res) => {
  const { type, q } = req.query;
  let files = mediaLibrary;

  if (type && ['video', 'audio', 'image'].includes(type)) {
    files = files.filter(f => f.type === type);
  }

  if (q) {
    const query = q.toLowerCase();
    files = files.filter(f => f.name.toLowerCase().includes(query));
  }

  // Don't expose absolute paths to the client
  const safeFiles = files.map((f, index) => ({
    id: mediaLibrary.indexOf(f),
    name: f.name,
    relativePath: f.relativePath,
    type: f.type,
    size: f.size,
    modified: f.modified,
    mimeType: f.mimeType,
  }));

  res.json({ count: safeFiles.length, files: safeFiles });
});

// API: Get server info
app.get('/api/info', (req, res) => {
  const networkInterfaces = os.networkInterfaces();
  const addresses = [];
  for (const iface of Object.values(networkInterfaces)) {
    for (const config of iface) {
      if (config.family === 'IPv4' && !config.internal) {
        addresses.push(config.address);
      }
    }
  }

  res.json({
    name: 'Media Server',
    version: '2.0.0',
    mediaDirs: getMediaDirs(),
    totalFiles: mediaLibrary.length,
    counts: {
      video: mediaLibrary.filter(f => f.type === 'video').length,
      audio: mediaLibrary.filter(f => f.type === 'audio').length,
      image: mediaLibrary.filter(f => f.type === 'image').length,
    },
    network: {
      hostname: os.hostname(),
      addresses,
      port: PORT,
      urls: addresses.map(a => `http://${a}:${PORT}`),
    },
  });
});

// API: Re-scan media directories
app.post('/api/scan', (req, res) => {
  scanAllMedia();
  res.json({ message: 'Scan complete', totalFiles: mediaLibrary.length });
});

// Stream/serve a media file by ID (supports HTTP Range for video/audio seeking)
app.get('/api/stream/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const file = mediaLibrary[id];

  if (!file || !fs.existsSync(file.path)) {
    return res.status(404).json({ error: 'File not found' });
  }

  const stat = fs.statSync(file.path);
  const fileSize = stat.size;
  const contentType = file.mimeType;
  const range = req.headers.range;

  if (range) {
    // HTTP Range request for seeking
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
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

// Thumbnail/poster placeholder — serves the file directly for images
app.get('/api/thumbnail/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const file = mediaLibrary[id];

  if (!file) {
    return res.status(404).json({ error: 'File not found' });
  }

  if (file.type === 'image') {
    return res.sendFile(file.path);
  }

  // For video/audio, return a placeholder icon
  res.redirect('/icons/' + file.type + '.svg');
});

// Initial scan
scanAllMedia();

// Periodic re-scan
setInterval(scanAllMedia, SCAN_INTERVAL);

// Listen on all interfaces so LAN devices can connect
app.listen(PORT, '0.0.0.0', () => {
  const networkInterfaces = os.networkInterfaces();
  console.log(`\n========================================`);
  console.log(`  Media Server v2.0.0`);
  console.log(`========================================`);
  console.log(`  Local:   http://localhost:${PORT}`);
  for (const iface of Object.values(networkInterfaces)) {
    for (const config of iface) {
      if (config.family === 'IPv4' && !config.internal) {
        console.log(`  Network: http://${config.address}:${PORT}`);
      }
    }
  }
  console.log(`\n  Media directories:`);
  getMediaDirs().forEach(d => console.log(`    - ${d}`));
  console.log(`  Files found: ${mediaLibrary.length}`);
  console.log(`  Re-scan interval: ${SCAN_INTERVAL / 1000}s`);
  console.log(`========================================\n`);
});
