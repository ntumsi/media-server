const gallery = document.getElementById('gallery');
const searchInput = document.getElementById('search');
const fileCountBadge = document.getElementById('file-count');
const playerModal = document.getElementById('player-modal');
const infoModal = document.getElementById('info-modal');
const playerContainer = document.getElementById('player-container');
const playerTitle = document.getElementById('player-title');
const playerMeta = document.getElementById('player-meta');
const infoContent = document.getElementById('info-content');

let currentFilter = '';
let currentSearch = '';

// --- Utilities ---
function formatSize(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + units[i];
}

function typeIcon(type) {
  switch (type) {
    case 'video': return '\u{1F3AC}';
    case 'audio': return '\u{1F3B5}';
    case 'image': return '\u{1F5BC}';
    default: return '\u{1F4C1}';
  }
}

// --- API ---
async function fetchFiles() {
  const params = new URLSearchParams();
  if (currentFilter) params.set('type', currentFilter);
  if (currentSearch) params.set('q', currentSearch);

  const res = await fetch('/api/files?' + params.toString());
  const data = await res.json();
  return data;
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
function renderGallery(data) {
  fileCountBadge.textContent = data.count + ' file' + (data.count !== 1 ? 's' : '');

  if (data.files.length === 0) {
    gallery.innerHTML = `
      <div class="empty-state">
        <div class="icon">${currentSearch ? '\u{1F50D}' : '\u{1F4C2}'}</div>
        <p>${currentSearch ? 'No files match your search' : 'No media files found'}</p>
        <p class="hint">${currentSearch ? 'Try a different search term' : 'Add media files to your configured directories and click Scan'}</p>
      </div>
    `;
    return;
  }

  gallery.innerHTML = data.files.map(file => `
    <div class="media-card" data-id="${file.id}" data-type="${file.type}">
      <div class="thumb">
        ${file.type === 'image'
          ? `<img src="/api/thumbnail/${file.id}" alt="${file.name}" loading="lazy" />`
          : `<span class="icon">${typeIcon(file.type)}</span>`
        }
      </div>
      <div class="card-info">
        <div class="name" title="${file.name}">${file.name}</div>
        <div class="meta">
          <span class="type-badge ${file.type}">${file.type}</span>
          <span>${formatSize(file.size)}</span>
        </div>
      </div>
    </div>
  `).join('');
}

function renderInfo(info) {
  const urls = info.network.urls.length > 0
    ? info.network.urls.map(u => `<a href="${u}" target="_blank">${u}</a>`).join('')
    : `<a href="http://localhost:${info.network.port}">http://localhost:${info.network.port}</a>`;

  infoContent.innerHTML = `
    <table>
      <tr><td>Hostname</td><td>${info.network.hostname}</td></tr>
      <tr><td>Port</td><td>${info.network.port}</td></tr>
      <tr><td>Total Files</td><td>${info.totalFiles}</td></tr>
      <tr><td>Videos</td><td>${info.counts.video}</td></tr>
      <tr><td>Audio</td><td>${info.counts.audio}</td></tr>
      <tr><td>Images</td><td>${info.counts.image}</td></tr>
    </table>
    <h3 style="margin-top:16px;font-size:0.9rem;">Access from other devices:</h3>
    <div class="url-list">${urls}</div>
    <h3 style="margin-top:16px;font-size:0.9rem;">Media Directories:</h3>
    <div style="font-size:0.8rem;color:#888;margin-top:4px;">
      ${info.mediaDirs.map(d => `<div>${d}</div>`).join('')}
    </div>
  `;
}

// --- Player ---
function openPlayer(file) {
  let content = '';
  const streamUrl = `/api/stream/${file.id}`;

  switch (file.type) {
    case 'video':
      content = `<video controls autoplay><source src="${streamUrl}" type="${file.mimeType}">Your browser does not support video playback.</video>`;
      break;
    case 'audio':
      content = `<audio controls autoplay><source src="${streamUrl}" type="${file.mimeType}">Your browser does not support audio playback.</audio>`;
      break;
    case 'image':
      content = `<img src="${streamUrl}" alt="${file.name}" />`;
      break;
  }

  playerContainer.innerHTML = content;
  playerTitle.textContent = file.name;
  playerMeta.textContent = `${file.type} \u2022 ${formatSize(file.size)} \u2022 ${file.relativePath}`;
  playerModal.classList.remove('hidden');
}

function closePlayer() {
  playerModal.classList.add('hidden');
  // Stop any playing media
  const video = playerContainer.querySelector('video');
  const audio = playerContainer.querySelector('audio');
  if (video) video.pause();
  if (audio) audio.pause();
  playerContainer.innerHTML = '';
}

// --- Events ---
let searchTimeout;
searchInput.addEventListener('input', () => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(async () => {
    currentSearch = searchInput.value.trim();
    const data = await fetchFiles();
    renderGallery(data);
  }, 300);
});

document.querySelectorAll('.filter').forEach(btn => {
  btn.addEventListener('click', async () => {
    document.querySelector('.filter.active').classList.remove('active');
    btn.classList.add('active');
    currentFilter = btn.dataset.type;
    const data = await fetchFiles();
    renderGallery(data);
  });
});

gallery.addEventListener('click', async (e) => {
  const card = e.target.closest('.media-card');
  if (!card) return;

  const id = parseInt(card.dataset.id, 10);
  const res = await fetch('/api/files');
  const data = await res.json();
  const file = data.files.find(f => f.id === id);
  if (file) openPlayer(file);
});

// Close modals
document.querySelectorAll('.modal-backdrop, .modal-close').forEach(el => {
  el.addEventListener('click', () => {
    closePlayer();
    infoModal.classList.add('hidden');
  });
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closePlayer();
    infoModal.classList.add('hidden');
  }
});

document.getElementById('btn-scan').addEventListener('click', async () => {
  const btn = document.getElementById('btn-scan');
  btn.textContent = 'Scanning...';
  btn.disabled = true;
  await triggerScan();
  const data = await fetchFiles();
  renderGallery(data);
  btn.textContent = 'Scan';
  btn.disabled = false;
});

document.getElementById('btn-info').addEventListener('click', async () => {
  const info = await fetchInfo();
  renderInfo(info);
  infoModal.classList.remove('hidden');
});

// --- Init ---
(async () => {
  const data = await fetchFiles();
  renderGallery(data);
})();
