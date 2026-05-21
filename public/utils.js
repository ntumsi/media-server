(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    const exported = factory();
    Object.assign(root, exported);
  }
}(typeof self !== 'undefined' ? self : this, function () {
  function formatSize(bytes) {
    if (!bytes || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + units[i];
  }

  function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeAttr(value) {
    return escapeHtml(value);
  }

  function typeIcon(type) {
    switch (type) {
      case 'video': return '\u{1F3AC}';
      case 'audio': return '\u{1F3B5}';
      case 'image': return '\u{1F5BC}';
      default: return '\u{1F4C1}';
    }
  }

  return { formatSize, escapeHtml, escapeAttr, typeIcon };
}));
