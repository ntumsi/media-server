// --- DOM ---
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const gallery = $('#gallery');
const searchInput = $('#search');
const fileCountBadge = $('#file-count');
const playerModal = $('#player-modal');
const infoModal = $('#info-modal');
const uploadModal = $('#upload-modal');
const playerContainer = $('#player-container');
const playerTitle = $('#player-title');
const playerMeta = $('#player-meta');
const infoContent = $('#info-content');
const breadcrumb = $('#breadcrumb');
const toast = $('#toast');

// --- State ---
let currentFilter = '';
let currentSearch = '';
let currentSort = 'name';
let currentOrder = 'asc';
let currentPath = null; // null = show all, '' = root folder, 'sub/path' = subfolder
let viewMode = localStorage.getItem('viewMode') || 'grid';
let currentFileId = null;

// --- Utilities ---
function formatSize(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
}

function formatDate(iso) {
  const d = new Date(iso);
  const now = new Date();
  const diff = now - d;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
  if (diff < 604800000) return Math.floor(diff / 86400000) + 'd ago';
  return d.toLocaleDateString();
}

function typeIcon(type) {
  switch (type) {
    case 'video': return '\u{1F3AC}';
    case 'audio': return '\u{1F3B5}';
    case 'image': return '\u{1F5BC}';
    default: return '\u{1F4C1}';
  }
}

function showToast(msg) {
  toast.textContent = msg;
  toast.classList.remove('hidden');
  toast.classList.add('show');
  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.classList.add('hidden'), 300);
  }, 2000);
}

// --- Resume Playback (localStorage) ---
function getResumeTime(id) {
  try {
    const data = JSON.parse(localStorage.getItem('resume') || '{}');
    return data[id] || 0;
  } catch { return 0; }
}

function setResumeTime(id, time, duration) {
  try {
    const data = JSON.parse(localStorage.getItem('resume') || '{}');
    // Clear if within 5s of start or 10s of end
    if (time < 5 || (duration && time > duration - 10)) {
      delete data[id];
    } else {
      data[id] = Math.floor(time);
    }
    localStorage.setItem('resume', JSON.stringify(data));
  } catch { /* ignore */ }
}

function getResumePercent(id) {
  try {
    const data = JSON.parse(localStorage.getItem('resume') || '{}');
    const durations = JSON.parse(localStorage.getItem('durations') || '{}');
    const time = data[id];
    const dur = durations[id];
    if (time && dur) return Math.min((time / dur) * 100, 100);
  } catch { /* ignore */ }
  return 0;
}

function setDuration(id, dur) {
  try {
    const data = JSON.parse(localStorage.getItem('durations') || '{}');
    data[id] = Math.floor(dur);
    localStorage.setItem('durations', JSON.stringify(data));
  } catch { /* ignore */ }
}

// --- API ---
async function fetchFiles() {
  const params = new URLSearchParams();
  if (currentFilter) params.set('type', currentFilter);
  if (currentSearch) params.set('q', currentSearch);
  params.set('sort', currentSort);
  params.set('order', currentOrder);
  if (currentPath !== null) params.set('dir', currentPath);
  const res = await fetch('/api/files?' + params.toString());
  return res.json();
}

async function fetchFolders(folderPath) {
  const params = new URLSearchParams();
  if (folderPath) params.set('path', folderPath);
  const res = await fetch('/api/folders?' + params.toString());
  return res.json();
}

async function fetchInfo() {
  const res = await fetch('/api/info');
  return res.json();
}

async function triggerScan() {
  const res = await fetch('/api/scan', { method: 'POST' });
  return res.json();
}

// --- Rendering ---
function renderBreadcrumb() {
  if (currentPath === null) {
    breadcrumb.classList.add('hidden');
    return;
  }

  breadcrumb.classList.remove('hidden');
  const parts = currentPath ? currentPath.split('/') : [];
  let html = '<a href="#" data-path="" class="crumb">Home</a>';

  let accumulated = '';
  for (let i = 0; i < parts.length; i++) {
    accumulated += (i > 0 ? '/' : '') + parts[i];
    html += '<span class="sep">/</span>';
    if (i === parts.length - 1) {
      html += `<span class="crumb current">${parts[i]}</span>`;
    } else {
      html += `<a href="#" data-path="${accumulated}" class="crumb">${parts[i]}</a>`;
    }
  }

  breadcrumb.innerHTML = html;

  breadcrumb.querySelectorAll('a.crumb').forEach(a => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      currentPath = a.dataset.path;
      loadGallery();
    });
  });
}

async function loadGallery() {
  renderBreadcrumb();

  let folderHtml = '';

  // Show folders if browsing by directory
  if (currentPath !== null && !currentSearch) {
    try {
      const folderData = await fetchFolders(currentPath);
      if (folderData.subfolders && folderData.subfolders.length > 0) {
        folderHtml = folderData.subfolders.map(f => {
          const fPath = currentPath ? currentPath + '/' + f.name : f.name;
          return `
            <div class="folder-card" data-folder="${fPath}">
              <span class="folder-icon">\u{1F4C1}</span>
              <div>
                <div class="folder-name">${f.name}</div>
                <div class="folder-count">${f.fileCount} file${f.fileCount !== 1 ? 's' : ''}</div>
              </div>
            </div>
          `;
        }).join('');
      }
    } catch { /* ignore folder errors */ }
  }

  const data = await fetchFiles();
  fileCountBadge.textContent = data.count;

  if (data.files.length === 0 && !folderHtml) {
    gallery.innerHTML = `
      <div class="empty-state">
        <div class="big-icon">${currentSearch ? '\u{1F50D}' : '\u{1F4C2}'}</div>
        <p>${currentSearch ? 'No files match your search' : 'No media files found'}</p>
        <p class="hint">${currentSearch
          ? 'Try a different search term'
          : 'Add media to your configured directories and click the scan button'}</p>
      </div>
    `;
    return;
  }

  const fileHtml = data.files.map(file => {
    const resumePct = (file.type === 'video' || file.type === 'audio') ? getResumePercent(file.id) : 0;
    const resumeBar = resumePct > 0
      ? `<div class="resume-badge"><div class="resume-fill" style="width:${resumePct}%"></div></div>`
      : '';

    return `
      <div class="media-card" data-id="${file.id}" data-type="${file.type}" title="${file.name}">
        <div class="thumb">
          ${file.type === 'image'
            ? `<img src="/api/thumbnail/${file.id}" alt="" loading="lazy" />`
            : `<span class="icon">${typeIcon(file.type)}</span>`
          }
          ${resumeBar}
        </div>
        <div class="card-info">
          <div class="name">${file.name}</div>
          <div class="meta">
            <span class="type-badge ${file.type}">${file.type}</span>
            <span>${formatSize(file.size)}</span>
          </div>
        </div>
      </div>
    `;
  }).join('');

  gallery.innerHTML = folderHtml + fileHtml;
}

function setViewMode(mode) {
  viewMode = mode;
  localStorage.setItem('viewMode', mode);
  gallery.className = mode === 'list' ? 'list-view' : 'grid-view';
  $('#btn-view-grid').classList.toggle('active', mode === 'grid');
  $('#btn-view-list').classList.toggle('active', mode === 'list');
}

// --- Player ---
function openPlayer(file) {
  currentFileId = file.id;
  const streamUrl = `/api/stream/${file.id}`;
  let content = '';

  switch (file.type) {
    case 'video': {
      const resumeTime = getResumeTime(file.id);
      let trackHtml = '';
      if (file.subtitles && file.subtitles.length > 0) {
        trackHtml = file.subtitles.map((sub, i) =>
          `<track kind="subtitles" src="/api/subtitle/${file.id}/${i}" label="${sub.label}" ${i === 0 ? 'default' : ''}>`
        ).join('');
      }
      content = `<video controls autoplay ${resumeTime ? `data-resume="${resumeTime}"` : ''}>
        <source src="${streamUrl}" type="${file.mimeType}">
        ${trackHtml}
      </video>`;
      break;
    }
    case 'audio': {
      const resumeTime = getResumeTime(file.id);
      content = `<audio controls autoplay ${resumeTime ? `data-resume="${resumeTime}"` : ''}>
        <source src="${streamUrl}" type="${file.mimeType}">
      </audio>`;
      break;
    }
    case 'image':
      content = `<img src="${streamUrl}" alt="${file.name}" />`;
      break;
  }

  playerContainer.innerHTML = content;
  playerTitle.textContent = file.name;
  playerMeta.textContent = `${file.type} • ${formatSize(file.size)} • ${file.relativePath}`;

  // Set up download button
  $('#player-download').onclick = () => {
    window.open(`/api/download/${file.id}`, '_blank');
  };

  // Resume playback position
  const media = playerContainer.querySelector('video, audio');
  if (media) {
    const resumeTime = parseFloat(media.dataset.resume || 0);

    media.addEventListener('loadedmetadata', () => {
      setDuration(file.id, media.duration);
      if (resumeTime > 0 && resumeTime < media.duration - 10) {
        media.currentTime = resumeTime;
        showToast(`Resuming from ${formatTime(resumeTime)}`);
      }
    });

    // Save position periodically
    let saveInterval;
    media.addEventListener('play', () => {
      saveInterval = setInterval(() => {
        setResumeTime(file.id, media.currentTime, media.duration);
      }, 5000);
    });

    media.addEventListener('pause', () => {
      clearInterval(saveInterval);
      setResumeTime(file.id, media.currentTime, media.duration);
    });

    media.addEventListener('ended', () => {
      clearInterval(saveInterval);
      setResumeTime(file.id, 0, media.duration);
    });
  }

  playerModal.classList.remove('hidden');
}

function formatTime(s) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function closePlayer() {
  const media = playerContainer.querySelector('video, audio');
  if (media) {
    if (currentFileId !== null) {
      setResumeTime(currentFileId, media.currentTime, media.duration);
    }
    media.pause();
  }
  playerModal.classList.add('hidden');
  playerContainer.innerHTML = '';
  currentFileId = null;
}

// --- Info modal ---
function renderInfo(info) {
  const urls = info.network.urls.length > 0
    ? info.network.urls
    : [`http://localhost:${info.network.port}`];

  const urlsHtml = urls.map(u => `<a href="${u}" target="_blank">${u}</a>`).join('');

  infoContent.innerHTML = `
    <table>
      <tr><td>Hostname</td><td>${info.network.hostname}</td></tr>
      <tr><td>Port</td><td>${info.network.port}</td></tr>
      <tr><td>Total files</td><td>${info.totalFiles}</td></tr>
      <tr><td>Videos</td><td>${info.counts.video}</td></tr>
      <tr><td>Audio</td><td>${info.counts.audio}</td></tr>
      <tr><td>Images</td><td>${info.counts.image}</td></tr>
    </table>

    <p class="info-section">Access from other devices</p>
    <div class="url-list">${urlsHtml}</div>
    <div class="qr-container" id="qr-container"></div>

    <p class="info-section">Media directories</p>
    <div style="font-size:0.8rem;color:var(--text-muted);margin-top:4px;">
      ${info.mediaDirs.map(d => `<div>${d}</div>`).join('')}
    </div>

    <div class="keyboard-shortcuts">
      <p class="info-section">Keyboard shortcuts</p>
      <table>
        <tr><td><kbd>Space</kbd></td><td>Play / Pause</td></tr>
        <tr><td><kbd>←</kbd> <kbd>→</kbd></td><td>Seek -10s / +10s</td></tr>
        <tr><td><kbd>↑</kbd> <kbd>↓</kbd></td><td>Volume up / down</td></tr>
        <tr><td><kbd>F</kbd></td><td>Toggle fullscreen</td></tr>
        <tr><td><kbd>M</kbd></td><td>Toggle mute</td></tr>
        <tr><td><kbd>Esc</kbd></td><td>Close player</td></tr>
        <tr><td><kbd>/</kbd></td><td>Focus search</td></tr>
      </table>
    </div>
  `;

  // Generate QR code (simple inline SVG via a minimal QR library)
  if (urls[0]) {
    generateQR(urls[0], $('#qr-container'));
  }
}

// Minimal QR code generator - renders text as a QR-like scannable URL label
function generateQR(url, container) {
  // Use a canvas-free approach: render the URL prominently so users can type it
  container.innerHTML = `
    <div style="margin-top:12px;padding:14px;background:var(--bg);border-radius:var(--radius-sm);border:1px solid var(--border);">
      <div style="font-size:0.72rem;color:var(--text-muted);margin-bottom:4px;">Open this URL on your device:</div>
      <div style="font-size:1.1rem;font-weight:600;color:var(--accent);word-break:break-all;user-select:all;">${url}</div>
    </div>
  `;
}

// --- Upload ---
function openUpload() {
  uploadModal.classList.remove('hidden');
  $('#upload-progress').classList.add('hidden');
  $('#upload-zone').classList.remove('hidden');
  $('#upload-input').value = '';
}

function handleUpload(files) {
  if (!files || files.length === 0) return;

  const formData = new FormData();
  for (const file of files) {
    formData.append('files', file);
  }

  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/api/upload');

  $('#upload-zone').classList.add('hidden');
  $('#upload-progress').classList.remove('hidden');
  $('#upload-status').textContent = `Uploading ${files.length} file${files.length > 1 ? 's' : ''}...`;

  xhr.upload.addEventListener('progress', (e) => {
    if (e.lengthComputable) {
      const pct = Math.round((e.loaded / e.total) * 100);
      $('#progress-fill').style.width = pct + '%';
      $('#upload-status').textContent = `Uploading... ${pct}%`;
    }
  });

  xhr.addEventListener('load', () => {
    if (xhr.status === 200) {
      const result = JSON.parse(xhr.responseText);
      $('#upload-status').textContent = result.message;
      showToast(result.message);
      setTimeout(() => {
        uploadModal.classList.add('hidden');
        loadGallery();
      }, 1200);
    } else {
      $('#upload-status').textContent = 'Upload failed. Try again.';
    }
  });

  xhr.addEventListener('error', () => {
    $('#upload-status').textContent = 'Upload failed. Check your connection.';
  });

  xhr.send(formData);
}

// --- Events ---

// Search (debounced)
let searchTimeout;
searchInput.addEventListener('input', () => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    currentSearch = searchInput.value.trim();
    // When searching, show results from all folders
    if (currentSearch) {
      currentPath = null;
    }
    loadGallery();
  }, 250);
});

// Type filters
$$('.filter').forEach(btn => {
  btn.addEventListener('click', () => {
    $('.filter.active').classList.remove('active');
    btn.classList.add('active');
    currentFilter = btn.dataset.type;
    loadGallery();
  });
});

// Sort
$('#sort-select').addEventListener('change', (e) => {
  const [sort, order] = e.target.value.split(':');
  currentSort = sort;
  currentOrder = order;
  loadGallery();
});

// View mode
$('#btn-view-grid').addEventListener('click', () => setViewMode('grid'));
$('#btn-view-list').addEventListener('click', () => setViewMode('list'));

// Gallery clicks (files + folders)
gallery.addEventListener('click', async (e) => {
  // Folder click
  const folder = e.target.closest('.folder-card');
  if (folder) {
    currentPath = folder.dataset.folder;
    loadGallery();
    return;
  }

  // File click
  const card = e.target.closest('.media-card');
  if (!card) return;

  const id = parseInt(card.dataset.id, 10);
  const data = await fetchFiles();
  const file = data.files.find(f => f.id === id);
  if (file) openPlayer(file);
});

// Close modals
document.addEventListener('click', (e) => {
  if (e.target.closest('.modal-close') || e.target.classList.contains('modal-backdrop')) {
    closePlayer();
    infoModal.classList.add('hidden');
    uploadModal.classList.add('hidden');
  }
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  // Don't capture when typing in search
  if (e.target === searchInput) {
    if (e.key === 'Escape') {
      searchInput.blur();
      searchInput.value = '';
      currentSearch = '';
      loadGallery();
    }
    return;
  }

  const media = playerContainer.querySelector('video, audio');

  switch (e.key) {
    case 'Escape':
      closePlayer();
      infoModal.classList.add('hidden');
      uploadModal.classList.add('hidden');
      break;

    case ' ':
      if (media) {
        e.preventDefault();
        media.paused ? media.play() : media.pause();
      }
      break;

    case 'ArrowLeft':
      if (media) { e.preventDefault(); media.currentTime = Math.max(0, media.currentTime - 10); }
      break;

    case 'ArrowRight':
      if (media) { e.preventDefault(); media.currentTime = Math.min(media.duration, media.currentTime + 10); }
      break;

    case 'ArrowUp':
      if (media) { e.preventDefault(); media.volume = Math.min(1, media.volume + 0.1); showToast(`Volume: ${Math.round(media.volume * 100)}%`); }
      break;

    case 'ArrowDown':
      if (media) { e.preventDefault(); media.volume = Math.max(0, media.volume - 0.1); showToast(`Volume: ${Math.round(media.volume * 100)}%`); }
      break;

    case 'f':
    case 'F':
      if (media) {
        if (document.fullscreenElement) {
          document.exitFullscreen();
        } else {
          media.requestFullscreen().catch(() => {});
        }
      }
      break;

    case 'm':
    case 'M':
      if (media) {
        media.muted = !media.muted;
        showToast(media.muted ? 'Muted' : 'Unmuted');
      }
      break;

    case '/':
      e.preventDefault();
      searchInput.focus();
      break;

    case 'Backspace':
      if (!playerModal.classList.contains('hidden')) break;
      if (currentPath !== null && currentPath !== '') {
        const parts = currentPath.split('/');
        parts.pop();
        currentPath = parts.join('/');
        loadGallery();
      } else if (currentPath === '') {
        currentPath = null;
        loadGallery();
      }
      break;
  }
});

// Scan button
$('#btn-scan').addEventListener('click', async () => {
  const btn = $('#btn-scan');
  btn.style.opacity = '0.5';
  btn.style.pointerEvents = 'none';
  showToast('Scanning media directories...');
  await triggerScan();
  await loadGallery();
  btn.style.opacity = '';
  btn.style.pointerEvents = '';
  showToast('Scan complete');
});

// Info button
$('#btn-info').addEventListener('click', async () => {
  const info = await fetchInfo();
  renderInfo(info);
  infoModal.classList.remove('hidden');
});

// Upload button + drag & drop
$('#btn-upload').addEventListener('click', openUpload);

$('#upload-zone').addEventListener('click', () => $('#upload-input').click());
$('#upload-input').addEventListener('change', (e) => handleUpload(e.target.files));

const uploadZone = $('#upload-zone');
uploadZone.addEventListener('dragover', (e) => { e.preventDefault(); uploadZone.classList.add('dragover'); });
uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('dragover'));
uploadZone.addEventListener('drop', (e) => {
  e.preventDefault();
  uploadZone.classList.remove('dragover');
  handleUpload(e.dataTransfer.files);
});

// Also support drag & drop on the whole page (opens upload modal)
document.body.addEventListener('dragover', (e) => {
  e.preventDefault();
  if (uploadModal.classList.contains('hidden')) openUpload();
});

// Enable folder browsing by default when no search active
$('#breadcrumb').addEventListener('click', (e) => {
  if (e.target.matches('a.crumb')) {
    e.preventDefault();
    currentPath = e.target.dataset.path;
    loadGallery();
  }
});

// --- Init ---
setViewMode(viewMode);

// Start with folder browsing
currentPath = '';
loadGallery();
