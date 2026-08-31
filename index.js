const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');
const mime = require('mime-types');
const os = require('os');
const multer = require('multer');

dotenv.config();

const PORT = process.env.PORT || 5000;
const SCAN_INTERVAL = (parseInt(process.env.SCAN_INTERVAL, 10) || 300) * 1000;
const MAX_UPLOAD_SIZE = parseInt(process.env.MAX_UPLOAD_SIZE_MB, 10) || 2048;

const MEDIA_EXTENSIONS = {
  video: new Set(['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.mpg', '.mpeg', '.3gp', '.ts']),
  audio: new Set(['.mp3', '.flac', '.wav', '.aac', '.ogg', '.wma', '.m4a', '.opus', '.aiff']),
  image: new Set(['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg', '.tiff', '.ico']),
  subtitle: new Set(['.srt', '.vtt', '.ass', '.ssa', '.sub']),
};

function getMediaType(ext) {
  ext = ext.toLowerCase();
  if (MEDIA_EXTENSIONS.video.has(ext)) return 'video';
  if (MEDIA_EXTENSIONS.audio.has(ext)) return 'audio';
  if (MEDIA_EXTENSIONS.image.has(ext)) return 'image';
  return null;
}

function isSubtitle(ext) {
  return MEDIA_EXTENSIONS.subtitle.has(ext.toLowerCase());
}

// --- Media Scanner ---
let mediaLibrary = [];
let folderTree = {};

function getMediaDirs() {
  return (process.env.MEDIA_DIRS || './media')
    .split(',')
    .map(d => d.trim())
    .filter(Boolean)
    .map(d => path.resolve(d));
}

function findSubtitles(filePath) {
  const dir = path.dirname(filePath);
  const baseName = path.basename(filePath, path.extname(filePath));
  const subs = [];
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return subs;
  }
  for (const entry of entries) {
    const ext = path.extname(entry);
    if (!isSubtitle(ext)) continue;
    const entryBase = path.basename(entry, ext);
    // Match "movie.srt", "movie.en.srt", "movie.eng.srt"
    if (entryBase === baseName || entryBase.startsWith(baseName + '.')) {
      const langTag = entryBase.slice(baseName.length + 1) || 'default';
      subs.push({ label: langTag, file: entry, ext: ext.slice(1) });
    }
  }
  return subs;
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
    if (entry.name.startsWith('.')) continue;
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
        const file = {
          name: entry.name,
          path: fullPath,
          dir: path.relative(baseDir, path.dirname(fullPath)) || '.',
          relativePath: path.relative(baseDir, fullPath),
          type,
          size: stat.size,
          modified: stat.mtime.toISOString(),
          mimeType: mime.lookup(fullPath) || 'application/octet-stream',
        };
        if (type === 'video') {
          file.subtitles = findSubtitles(fullPath);
        }
        results.push(file);
      }
    }
  }
  return results;
}

function buildFolderTree(files) {
  const tree = { name: 'root', children: {}, files: [] };
  for (const file of files) {
    const parts = file.dir === '.' ? [] : file.dir.split(path.sep);
    let node = tree;
    for (const part of parts) {
      if (!node.children[part]) {
        node.children[part] = { name: part, children: {}, files: [] };
      }
      node = node.children[part];
    }
    node.files.push(mediaLibrary.indexOf(file));
  }
  return tree;
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
  folderTree = buildFolderTree(allFiles);
  console.log(`[scanner] Found ${mediaLibrary.length} media files`);
}

// --- Upload storage ---
const uploadStorage = multer.diskStorage({
  destination(req, _file, cb) {
    const dirs = getMediaDirs();
    const targetDir = req.query.dir
      ? path.join(dirs[0], req.query.dir)
      : dirs[0];
    fs.mkdirSync(targetDir, { recursive: true });
    cb(null, targetDir);
  },
  filename(_req, file, cb) {
    const ext = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext);
    let finalName = file.originalname;
    const dir = _req.uploadDir || getMediaDirs()[0];
    let counter = 1;
    while (fs.existsSync(path.join(dir, finalName))) {
      finalName = `${base} (${counter})${ext}`;
      counter++;
    }
    cb(null, finalName);
  },
});
const upload = multer({
  storage: uploadStorage,
  limits: { fileSize: MAX_UPLOAD_SIZE * 1024 * 1024 },
});

// --- Server ---
const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// API: List/search media files
app.get('/api/files', (req, res) => {
  const { type, q, sort, order, dir } = req.query;
  let files = mediaLibrary;

  if (type && ['video', 'audio', 'image'].includes(type)) {
    files = files.filter(f => f.type === type);
  }

  if (dir !== undefined) {
    const target = dir || '.';
    files = files.filter(f => f.dir === target);
  }

  if (q) {
    const query = q.toLowerCase();
    files = files.filter(f => f.name.toLowerCase().includes(query) || f.relativePath.toLowerCase().includes(query));
  }

  const safeFiles = files.map(f => ({
    id: mediaLibrary.indexOf(f),
    name: f.name,
    dir: f.dir,
    relativePath: f.relativePath,
    type: f.type,
    size: f.size,
    modified: f.modified,
    mimeType: f.mimeType,
    subtitles: f.subtitles || [],
  }));

  const sortField = sort || 'name';
  const sortOrder = order === 'desc' ? -1 : 1;
  safeFiles.sort((a, b) => {
    let cmp = 0;
    if (sortField === 'name') cmp = a.name.localeCompare(b.name);
    else if (sortField === 'size') cmp = a.size - b.size;
    else if (sortField === 'modified') cmp = new Date(a.modified) - new Date(b.modified);
    else if (sortField === 'type') cmp = a.type.localeCompare(b.type);
    return cmp * sortOrder;
  });

  res.json({ count: safeFiles.length, files: safeFiles });
});

// API: Folder structure
app.get('/api/folders', (req, res) => {
  const target = req.query.path || '';

  function serializeNode(node) {
    const subfolders = Object.values(node.children).map(c => ({
      name: c.name,
      fileCount: countFiles(c),
      hasSubfolders: Object.keys(c.children).length > 0,
    }));
    return {
      name: node.name,
      subfolders,
      fileIds: node.files,
    };
  }

  function countFiles(node) {
    let count = node.files.length;
    for (const child of Object.values(node.children)) {
      count += countFiles(child);
    }
    return count;
  }

  let current = folderTree;
  if (target) {
    const parts = target.split('/').filter(Boolean);
    for (const part of parts) {
      if (current.children[part]) {
        current = current.children[part];
      } else {
        return res.status(404).json({ error: 'Folder not found' });
      }
    }
  }

  res.json(serializeNode(current));
});

// API: Server info
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

// API: Re-scan
app.post('/api/scan', (_req, res) => {
  scanAllMedia();
  res.json({ message: 'Scan complete', totalFiles: mediaLibrary.length });
});

// API: Stream a media file (Range support)
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

// API: Download a file (Content-Disposition: attachment)
app.get('/api/download/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const file = mediaLibrary[id];
  if (!file || !fs.existsSync(file.path)) {
    return res.status(404).json({ error: 'File not found' });
  }
  res.download(file.path, file.name);
});

// API: Serve subtitle file for a video
app.get('/api/subtitle/:id/:subIndex', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const subIndex = parseInt(req.params.subIndex, 10);
  const file = mediaLibrary[id];

  if (!file || !file.subtitles || !file.subtitles[subIndex]) {
    return res.status(404).json({ error: 'Subtitle not found' });
  }

  const sub = file.subtitles[subIndex];
  const subPath = path.join(path.dirname(file.path), sub.file);

  if (!fs.existsSync(subPath)) {
    return res.status(404).json({ error: 'Subtitle file missing' });
  }

  // Convert SRT to VTT on the fly for browser compatibility
  if (sub.ext === 'srt') {
    const srtContent = fs.readFileSync(subPath, 'utf-8');
    const vttContent = 'WEBVTT\n\n' + srtContent
      .replace(/\r\n/g, '\n')
      .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
    res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
    return res.send(vttContent);
  }

  res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
  res.sendFile(subPath);
});

// API: Thumbnail (images served directly, others get type icon)
app.get('/api/thumbnail/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const file = mediaLibrary[id];
  if (!file) return res.status(404).json({ error: 'File not found' });

  if (file.type === 'image') {
    return res.sendFile(file.path);
  }
  res.redirect('/icons/' + file.type + '.svg');
});

// API: Upload files
app.post('/api/upload', upload.array('files', 20), (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No files uploaded' });
  }
  scanAllMedia();
  res.json({
    message: `${req.files.length} file(s) uploaded`,
    files: req.files.map(f => ({ name: f.originalname, size: f.size })),
  });
});

// Initial scan
scanAllMedia();
setInterval(scanAllMedia, SCAN_INTERVAL);

// Listen on all interfaces
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
