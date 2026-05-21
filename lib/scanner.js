const fs = require('fs');
const path = require('path');
const mime = require('mime-types');

const MEDIA_EXTENSIONS = {
  video: new Set(['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.mpg', '.mpeg', '.3gp', '.ts']),
  audio: new Set(['.mp3', '.flac', '.wav', '.aac', '.ogg', '.wma', '.m4a', '.opus', '.aiff']),
  image: new Set(['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg', '.tiff', '.ico']),
};

function getMediaType(ext) {
  if (typeof ext !== 'string') return null;
  const lower = ext.toLowerCase();
  if (MEDIA_EXTENSIONS.video.has(lower)) return 'video';
  if (MEDIA_EXTENSIONS.audio.has(lower)) return 'audio';
  if (MEDIA_EXTENSIONS.image.has(lower)) return 'image';
  return null;
}

function getMediaDirs(rawValue) {
  const raw = rawValue !== undefined ? rawValue : (process.env.MEDIA_DIRS || './media');
  return raw
    .split(',')
    .map(d => d.trim())
    .filter(Boolean)
    .map(d => path.resolve(d));
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
      if (!type) continue;

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
  return results;
}

function scanAllMedia(dirs, { ensureExists = false } = {}) {
  const allFiles = [];
  for (const dir of dirs) {
    if (ensureExists && !fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    allFiles.push(...scanDirectory(dir, dir));
  }
  return allFiles;
}

module.exports = {
  MEDIA_EXTENSIONS,
  getMediaType,
  getMediaDirs,
  scanDirectory,
  scanAllMedia,
};
