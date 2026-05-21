const dotenv = require('dotenv');
dotenv.config();

const os = require('os');
const { getMediaDirs, scanAllMedia } = require('./lib/scanner');
const { createApp } = require('./lib/server');

const PORT = parseInt(process.env.PORT, 10) || 5000;
const SCAN_INTERVAL = (parseInt(process.env.SCAN_INTERVAL, 10) || 300) * 1000;

let mediaLibrary = [];

function getDirs() {
  return getMediaDirs();
}

function runScan() {
  const dirs = getDirs();
  for (const dir of dirs) {
    console.log(`[scanner] Scanning: ${dir}`);
  }
  mediaLibrary = scanAllMedia(dirs, { ensureExists: true });
  console.log(`[scanner] Found ${mediaLibrary.length} media files`);
}

const app = createApp({
  getLibrary: () => mediaLibrary,
  getMediaDirs: getDirs,
  runScan,
  port: PORT,
});

if (require.main === module) {
  runScan();
  setInterval(runScan, SCAN_INTERVAL);

  app.listen(PORT, '0.0.0.0', () => {
    const networkInterfaces = os.networkInterfaces();
    console.log(`\n========================================`);
    console.log(`  Media Server v2.0.0`);
    console.log(`========================================`);
    console.log(`  Local:   http://localhost:${PORT}`);
    for (const iface of Object.values(networkInterfaces)) {
      if (!iface) continue;
      for (const config of iface) {
        if (config.family === 'IPv4' && !config.internal) {
          console.log(`  Network: http://${config.address}:${PORT}`);
        }
      }
    }
    console.log(`\n  Media directories:`);
    getDirs().forEach(d => console.log(`    - ${d}`));
    console.log(`  Files found: ${mediaLibrary.length}`);
    console.log(`  Re-scan interval: ${SCAN_INTERVAL / 1000}s`);
    console.log(`========================================\n`);
  });
}

module.exports = {
  app,
  runScan,
  getLibrary: () => mediaLibrary,
};
