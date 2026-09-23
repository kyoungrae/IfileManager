const state = {
  user: null,
  currentPath: '',
  pendingDelete: null,
  pendingRename: null,
  directory: { files: [] },
  folderTree: [],
  expandedFolderPaths: new Set(['']),
  selectedFileIds: new Set(),
  fileListTransitionId: 0,
  section: 'files',
  v4Logs: { path: '', entries: [] },
  query: '',
  draggedFolderPath: null,
  folderMoveInProgress: false,
  trash: { entries: [] },
  selectedTrashIds: new Set(),
  expandedTrashFolderIds: new Set()
};

const $ = (selector) => document.querySelector(selector);
const iconPaths = {
  folder: '<path d="M2.7 7.25a2.7 2.7 0 0 1 2.7-2.7h4.25l2.15 2.15h6.8a2.7 2.7 0 0 1 2.7 2.7v7.35a2.7 2.7 0 0 1-2.7 2.7H5.4a2.7 2.7 0 0 1-2.7-2.7z"/>',
  users: '<path d="M16 20v-1.5a4.5 4.5 0 0 0-4.5-4.5h-5A4.5 4.5 0 0 0 2 18.5V20"/><circle cx="9" cy="7" r="3"/><path d="M16 4.2a3 3 0 0 1 0 5.6M22 20v-1.5a4.5 4.5 0 0 0-3-4.25"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.3 2"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6.5 7l.8 13h9.4l.8-13M10 11v5M14 11v5"/>',
  star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.3 4.3"/>',
  'arrow-up': '<path d="M12 20V4M6.5 9.5 12 4l5.5 5.5"/>',
  'folder-plus': '<path d="M3 6.5a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 10v5M9.5 12.5h5"/>',
  upload: '<path d="M12 15V3M7.5 7.5 12 3l4.5 4.5"/><path d="M5 13.5v4A2.5 2.5 0 0 0 7.5 20h9a2.5 2.5 0 0 0 2.5-2.5v-4"/>',
  archive: '<path d="M4 7h16v13H4z"/><path d="M3 4h18v3H3zM9 11h6M9 15h6"/>',
  grid: '<rect x="4" y="4" width="6" height="6" rx=".5"/><rect x="14" y="4" width="6" height="6" rx=".5"/><rect x="4" y="14" width="6" height="6" rx=".5"/><rect x="14" y="14" width="6" height="6" rx=".5"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6h.01M4 12h.01M4 18h.01"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
  'file-pdf': '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 16h2.5a1.5 1.5 0 0 0 0-3H8v5M14 13v5M14 13h2.2a1.4 1.4 0 1 1 0 2.8H14"/>',
  'file-document': '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 16h8"/>',
  'file-sheet': '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 12h8v6H8zM12 12v6M8 15h8"/>',
  'file-image': '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 17l2.6-3 2.1 2 1.8-2 1.5 3M9.5 11.5h.01"/>',
  'file-archive': '<path d="M5 7h14v13H5zM4 4h16v3H4zM10 11h4M10 15h4"/>',
  'file-video': '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M10 12.5l5 3.5-5 3.5z"/>',
  'file-audio': '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M15 12v5.3a1.8 1.8 0 1 1-1.2-1.7M15 12l3-1v5.3a1.8 1.8 0 1 1-1.2-1.7"/>',
  'file-code': '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M10 13l-2 2 2 2M14 13l2 2-2 2"/>',
  'file-text': '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 16h8M8 19h5"/>',
  'file-up': '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M12 18v-6M9.5 14.5 12 12l2.5 2.5"/>',
  'chevron-right': '<path d="m9 18 6-6-6-6"/>',
  eye: '<path d="M2.5 12s3.4-6 9.5-6 9.5 6 9.5 6-3.4 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.7"/>'
};

function applyIcons(root = document) {
  root.querySelectorAll?.('[data-icon]').forEach((element) => {
    const path = iconPaths[element.dataset.icon];
    if (!path) return;
    element.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${path}</svg>`;
  });
}

function svgIcon(name, className = '') {
  const element = document.createElement('span');
  if (className) element.className = className;
  element.dataset.icon = name;
  applyIcons(element.parentNode ?? { querySelectorAll: () => [] });
  element.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${iconPaths[name]}</svg>`;
  return element;
}

async function request(url, options = {}) {
  const response = await fetch(url, { credentials: 'same-origin', ...options, headers: { 'X-IFile-Manager': '1', ...(options.headers ?? {}) } });
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || '요청을 완료하지 못했습니다.');
  return data;
}

function setStatus(message = '', isError = false) {
  const element = $('#status');
  element.textContent = message;
  element.classList.toggle('error', isError);
}

let loadingDismissTimer;
let operationProgressTimer;

function showOperationLoading(title, description) {
  window.clearTimeout(loadingDismissTimer);
  window.clearInterval(operationProgressTimer);
  $('#operation-loading-title').textContent = title;
  $('#operation-loading-description').textContent = description;
  $('#operation-progress').hidden = true;
  $('#operation-loading').hidden = false;
}

function hideOperationLoading() {
  window.clearTimeout(loadingDismissTimer);
  window.clearInterval(operationProgressTimer);
  $('#operation-progress').hidden = true;
  $('#operation-loading').hidden = true;
}

function showDownloadLoading(description = '다운로드를 시작하고 있습니다.') {
  showOperationLoading('다운로드 준비 중…', description);
  // A browser intentionally does not expose an attachment download's completion
  // to JavaScript. Keep the overlay through the server's initial response only.
  loadingDismissTimer = window.setTimeout(hideOperationLoading, 2_000);
}

function attachDownloadLoading(link, description) {
  link.addEventListener('click', () => showDownloadLoading(description));
}

function formatDuration(milliseconds) {
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  if (hours) return `${hours}시간 ${minutes}분`;
  if (minutes) return `${minutes}분 ${seconds}초`;
  return `${seconds}초`;
}

function renderUploadProgress(progress) {
  const hasCurrentFile = progress.completed < progress.total;
  const currentFileSize = Math.max(0, progress.currentFile?.size ?? 0);
  const transferRatio = progress.currentTransferTotal > 0
    ? Math.min(1, progress.currentTransferredBytes / progress.currentTransferTotal)
    : 0;
  // The final 2% is reserved for server-side encryption and the disk write.
  // This prevents a misleading 100% display before a file is actually saved.
  const currentRatio = hasCurrentFile ? Math.min(0.98, transferRatio) : 0;
  const bytesDone = progress.completedBytes + (currentFileSize * currentRatio);
  const countRatio = progress.total ? (progress.completed + currentRatio) / progress.total : 0;
  const rawRatio = progress.completed === progress.total
    ? 1
    : progress.totalBytes > 0 ? bytesDone / progress.totalBytes : countRatio;
  const ratio = Math.max(0, Math.min(1, rawRatio));
  const percent = Math.floor(ratio * 100);
  const elapsed = Date.now() - progress.startedAt;
  const canEstimate = ratio >= 0.02 && ratio < 1;
  const remaining = canEstimate ? Math.max(0, (elapsed / ratio) - elapsed) : null;
  const filePosition = Math.min(progress.total, progress.completed + 1);

  $('#operation-progress-label').textContent = `완료 ${progress.completed} / ${progress.total}개`;
  $('#operation-progress-percent').textContent = `${percent}%`;
  $('#operation-progress-track').setAttribute('aria-valuenow', String(percent));
  $('#operation-progress-bar').style.width = `${ratio * 100}%`;
  $('#operation-progress-time').textContent = remaining === null
    ? `경과 ${formatDuration(elapsed)} · 남은 시간 계산 중`
    : `경과 ${formatDuration(elapsed)} · 약 ${formatDuration(remaining)} 남음`;

  if (hasCurrentFile) {
    const phase = progress.isSaving ? '암호화 및 저장 중' : '업로드 중';
    $('#operation-loading-description').textContent = `현재 ${filePosition} / ${progress.total}개 · “${progress.currentFile.name}” ${phase}`;
  } else {
    $('#operation-loading-description').textContent = `${progress.total}개 파일의 암호화 및 저장을 완료했습니다.`;
  }
}

function beginUploadProgress(progress) {
  $('#operation-progress').hidden = false;
  renderUploadProgress(progress);
  window.clearInterval(operationProgressTimer);
  operationProgressTimer = window.setInterval(() => renderUploadProgress(progress), 1_000);
}

function uploadFileWithProgress(file, folderPath, onProgress) {
  return new Promise((resolve, reject) => {
    const data = new FormData();
    data.append('folderPath', folderPath);
    data.append('files', file);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/files');
    xhr.withCredentials = true;
    xhr.setRequestHeader('X-IFile-Manager', '1');
    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) onProgress({ loaded: event.loaded, total: event.total });
    });
    xhr.addEventListener('load', () => {
      let response = {};
      try { response = JSON.parse(xhr.responseText || '{}'); }
      catch { response = {}; }
      if (xhr.status >= 200 && xhr.status < 300) resolve(response);
      else reject(new Error(response.error || '파일을 업로드하지 못했습니다.'));
    });
    xhr.addEventListener('error', () => reject(new Error('파일 업로드 중 네트워크 오류가 발생했습니다.')));
    xhr.addEventListener('abort', () => reject(new Error('파일 업로드가 취소되었습니다.')));
    xhr.send(data);
  });
}

function formatSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '–';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024; let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

// macOS Disk Utility and df report volume capacity in decimal units. Keep the
// storage card aligned with the actual values the user sees on the host.
function formatStorageSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '–';
  if (bytes < 1000) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1000; let unit = 0;
  while (value >= 1000 && unit < units.length - 1) { value /= 1000; unit += 1; }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

function pathParts(path) { return path ? path.split('/') : []; }
function parentPath(path = state.currentPath) { const parts = pathParts(path); parts.pop(); return parts.join('/'); }
function nameMatches(name) { return name.toLocaleLowerCase('ko-KR').includes(state.query.toLocaleLowerCase('ko-KR')); }
function fileIconFor(name) {
  const fileName = String(name).trim().toLocaleLowerCase('en-US');
  const extensionAt = fileName.lastIndexOf('.');
  const extension = extensionAt > 0 && extensionAt < fileName.length - 1 ? fileName.slice(extensionAt + 1) : '';
  if (['pdf'].includes(extension)) return { icon: 'file-pdf', kind: 'pdf' };
  if (['doc', 'docx', 'odt', 'rtf', 'pages'].includes(extension)) return { icon: 'file-document', kind: 'document' };
  if (['xls', 'xlsx', 'xlsm', 'ods', 'csv', 'tsv', 'numbers'].includes(extension)) return { icon: 'file-sheet', kind: 'sheet' };
  if (['ppt', 'pptx', 'odp', 'key'].includes(extension)) return { icon: 'file-document', kind: 'presentation' };
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'heic', 'bmp', 'tif', 'tiff', 'avif'].includes(extension)) return { icon: 'file-image', kind: 'image' };
  if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'dmg', 'iso'].includes(extension)) return { icon: 'file-archive', kind: 'archive' };
  if (['mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v'].includes(extension)) return { icon: 'file-video', kind: 'video' };
  if (['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg'].includes(extension)) return { icon: 'file-audio', kind: 'audio' };
  if (['js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'py', 'java', 'go', 'rs', 'c', 'cpp', 'h', 'css', 'html', 'sql', 'sh'].includes(extension)) return { icon: 'file-code', kind: 'code' };
  if (['txt', 'md', 'log', 'json', 'xml', 'yaml', 'yml', 'ini', 'conf'].includes(extension)) return { icon: 'file-text', kind: 'text' };
  return { icon: 'file', kind: 'generic' };
}

function previewKindFor(name) {
  const filename = String(name).trim().toLocaleLowerCase('en-US');
  const extensionAt = filename.lastIndexOf('.');
  const extension = extensionAt > 0 && extensionAt < filename.length - 1 ? filename.slice(extensionAt + 1) : '';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif'].includes(extension)) return 'image';
  if (extension === 'pdf') return 'pdf';
  if (['mp4', 'm4v', 'mov', 'webm'].includes(extension)) return 'video';
  if (['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'].includes(extension)) return 'audio';
  if (['txt', 'md', 'log', 'json', 'xml', 'yaml', 'yml', 'csv', 'tsv', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'py', 'java', 'go', 'rs', 'c', 'cpp', 'h', 'hpp', 'css', 'html', 'htm', 'sql', 'sh'].includes(extension)) return 'text';
  return 'unsupported';
}

function openFilePreview({ name, size, previewUrl, downloadUrl }) {
  const dialog = $('#preview-dialog');
  const content = $('#preview-content');
  const kind = previewKindFor(name);
  $('#preview-title').textContent = name;
  $('#preview-size').textContent = formatSize(size);
  const download = $('#preview-download');
  download.href = downloadUrl;
  download.download = name;
  content.replaceChildren();

  if (kind === 'image') {
    const image = document.createElement('img'); image.src = previewUrl; image.alt = name; image.className = 'preview-image';
    content.append(image);
  } else if (kind === 'pdf') {
    const frame = document.createElement('iframe'); frame.className = 'preview-frame'; frame.src = previewUrl; frame.title = `${name} 미리보기`; frame.setAttribute('sandbox', '');
    content.append(frame);
  } else if (kind === 'video' || kind === 'audio') {
    const media = document.createElement(kind); media.className = `preview-${kind}`; media.src = previewUrl; media.controls = true; media.preload = 'metadata';
    content.append(media);
  } else if (kind === 'text') {
    if (size > 2 * 1024 * 1024) {
      const message = document.createElement('p'); message.className = 'preview-message'; message.textContent = `${formatSize(size)} 텍스트 파일은 미리보기 제한(2 MB)을 초과했습니다. 다운로드하여 확인하세요.`;
      content.append(message);
    } else {
      const message = document.createElement('p'); message.className = 'preview-message'; message.textContent = '파일을 불러오는 중…'; content.append(message);
      void fetch(previewUrl, { credentials: 'same-origin' }).then(async (response) => {
        if (!response.ok) throw new Error('미리보기를 불러오지 못했습니다.');
        const text = document.createElement('pre'); text.className = 'preview-text'; text.textContent = await response.text();
        if (dialog.open && $('#preview-title').textContent === name) content.replaceChildren(text);
      }).catch((error) => {
        if (dialog.open && $('#preview-title').textContent === name) {
          const failure = document.createElement('p'); failure.className = 'preview-message'; failure.textContent = error.message; content.replaceChildren(failure);
        }
      });
    }
  } else {
    const message = document.createElement('p'); message.className = 'preview-message'; message.textContent = '이 파일 형식은 브라우저 미리보기를 지원하지 않습니다. 다운로드하여 확인하세요.';
    content.append(message);
  }
  dialog.showModal();
}

function renderBreadcrumbs() {
  const target = $('#breadcrumbs'); target.replaceChildren();
  const crumbs = [{ name: '내 파일', path: '' }];
  pathParts(state.currentPath).forEach((name, index, parts) => crumbs.push({ name, path: parts.slice(0, index + 1).join('/') }));
  crumbs.forEach((crumb, index) => {
    if (index) {
      const divider = document.createElement('span'); divider.className = 'breadcrumb-divider'; divider.textContent = '›'; target.append(divider);
    }
    const button = document.createElement('button'); button.className = 'crumb'; button.type = 'button'; button.textContent = crumb.name;
    button.addEventListener('click', () => loadFolder(crumb.path)); target.append(button);
  });
  const location = pathParts(state.currentPath).at(-1) ?? '내 파일';
  $('#page-location').textContent = location;
  $('#up-button').disabled = !state.currentPath;
}

function renderV4LogBreadcrumbs() {
  const target = $('#breadcrumbs'); target.replaceChildren();
  const crumbs = [{ name: 'V4Log', path: '' }];
  pathParts(state.v4Logs.path).forEach((name, index, parts) => crumbs.push({ name, path: parts.slice(0, index + 1).join('/') }));
  crumbs.forEach((crumb, index) => {
    if (index) {
      const divider = document.createElement('span'); divider.className = 'breadcrumb-divider'; divider.textContent = '›'; target.append(divider);
    }
    const button = document.createElement('button'); button.className = 'crumb'; button.type = 'button'; button.textContent = crumb.name;
    button.addEventListener('click', () => loadV4Logs(crumb.path)); target.append(button);
  });
  $('#page-location').textContent = pathParts(state.v4Logs.path).at(-1) ?? 'V4Log';
  $('#up-button').disabled = !state.v4Logs.path;
}

function folderNode(folder, depth = 0, { root = false } = {}) {
  const node = document.createElement('div');
  node.className = `folder-tree-node${root ? ' root-node' : ''}`;
  node.dataset.folderPath = folder.path;
  const hasChildren = folder.children.length > 0;
  const expanded = state.expandedFolderPaths.has(folder.path);
  node.classList.toggle('is-expanded', expanded);
  node.classList.toggle('is-active', folder.path === state.currentPath);

  const row = document.createElement('article'); row.className = `folder-tree-row${root ? ' root-folder' : ''}`; row.setAttribute('role', 'treeitem');
  row.style.setProperty('--folder-depth', depth);
  row.dataset.dropFolderPath = folder.path;
  if (!root) {
    row.draggable = true;
    row.setAttribute('aria-label', `${folder.name} 폴더. 드래그하여 다른 폴더로 이동할 수 있습니다.`);
    row.addEventListener('dragstart', (event) => {
      state.draggedFolderPath = folder.path;
      row.classList.add('is-dragging');
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', folder.path);
    });
    row.addEventListener('dragend', clearFolderDragState);
  }
  attachFolderDropTarget(row, folder.path);
  const toggle = document.createElement('button'); toggle.className = 'folder-toggle'; toggle.type = 'button';
  toggle.setAttribute('aria-label', `${folder.name} ${expanded ? '접기' : '펼치기'}`);
  toggle.setAttribute('aria-expanded', String(expanded));
  toggle.disabled = !hasChildren;
  const chevron = document.createElement('span'); chevron.className = 'folder-chevron'; chevron.append(svgIcon('chevron-right'));
  toggle.append(chevron);
  toggle.addEventListener('click', () => setFolderExpanded(folder.path, !state.expandedFolderPaths.has(folder.path)));

  const open = document.createElement('button'); open.className = 'folder-open'; open.type = 'button';
  const icon = svgIcon('folder', 'folder-icon');
  const name = document.createElement('span'); name.className = 'item-name'; name.textContent = folder.name;
  open.append(icon, name); open.addEventListener('click', () => loadFolder(folder.path));
  row.append(toggle, open);
  if (!root) {
    const actions = document.createElement('div'); actions.className = 'folder-actions';
    const rename = document.createElement('button'); rename.className = 'rename-folder'; rename.type = 'button'; rename.textContent = '이름 변경'; rename.addEventListener('click', () => openFolderRenameDialog(folder));
    const remove = document.createElement('button'); remove.className = 'delete-folder'; remove.type = 'button'; remove.textContent = '삭제'; remove.addEventListener('click', () => openFolderDeleteDialog(folder));
    actions.append(rename, remove); row.append(actions);
  }

  const children = document.createElement('div'); children.className = 'folder-tree-children';
  const content = document.createElement('div'); content.className = 'folder-tree-children-content';
  content.append(...folder.children.map((child) => folderNode(child, depth + 1)));
  children.append(content);
  node.append(row, children);
  return node;
}

function fileRow(file) {
  const row = document.createElement('article'); row.className = 'file-row'; row.setAttribute('role', 'row');
  const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.className = 'file-checkbox'; checkbox.dataset.fileId = file.id; checkbox.checked = state.selectedFileIds.has(file.id); checkbox.setAttribute('aria-label', `${file.name} 선택`);
  row.classList.toggle('is-selected', checkbox.checked);
  checkbox.addEventListener('change', () => {
    state.selectedFileIds[checkbox.checked ? 'add' : 'delete'](file.id);
    row.classList.toggle('is-selected', checkbox.checked);
    syncFileSelectionControls();
  });
  const icon = fileIconFor(file.name);
  const name = document.createElement('button'); name.type = 'button'; name.className = 'file-name file-preview-trigger'; name.title = `${file.name} 미리보기`; name.setAttribute('aria-label', `${file.name} 미리보기`); name.append(svgIcon(icon.icon, `file-icon file-icon-${icon.kind}`), document.createTextNode(file.name));
  name.addEventListener('click', () => openFilePreview({ name: file.name, size: file.size, previewUrl: `/api/files/${encodeURIComponent(file.id)}/preview`, downloadUrl: `/api/files/${encodeURIComponent(file.id)}/download` }));
  const metadata = document.createElement('span'); metadata.className = 'file-meta'; metadata.textContent = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(file.createdAt));
  const size = document.createElement('span'); size.className = 'file-size'; size.textContent = formatSize(file.size);
  const actions = document.createElement('div'); actions.className = 'file-actions';
  const download = document.createElement('a'); download.className = 'download'; download.href = `/api/files/${encodeURIComponent(file.id)}/download`; download.download = file.name; download.textContent = '다운로드'; attachDownloadLoading(download, `“${file.name}” 다운로드를 시작하고 있습니다.`);
  const remove = document.createElement('button'); remove.className = 'delete-file'; remove.type = 'button'; remove.setAttribute('aria-label', `${file.name} 삭제`); remove.title = '삭제'; remove.append(svgIcon('trash'));
  remove.addEventListener('click', () => openFileDeleteDialog(file));
  actions.append(download, remove);
  row.append(checkbox, name, metadata, size, actions); return row;
}

function fileTableHeader() {
  const row = document.createElement('article'); row.className = 'file-row file-header'; row.setAttribute('role', 'row');
  const checkbox = document.createElement('input'); checkbox.id = 'select-all-files'; checkbox.type = 'checkbox'; checkbox.className = 'file-checkbox'; checkbox.setAttribute('aria-label', '표시된 파일 전체 선택');
  checkbox.addEventListener('change', () => {
    const visibleFiles = state.directory.files.filter((file) => nameMatches(file.name));
    visibleFiles.forEach((file) => state.selectedFileIds[checkbox.checked ? 'add' : 'delete'](file.id));
    document.querySelectorAll('#file-list .file-checkbox[data-file-id]').forEach((item) => {
      item.checked = checkbox.checked;
      item.closest('.file-row')?.classList.toggle('is-selected', checkbox.checked);
    });
    syncFileSelectionControls();
  });
  const name = document.createElement('span'); name.textContent = '이름';
  const modified = document.createElement('span'); modified.textContent = '수정한 날짜';
  const size = document.createElement('span'); size.textContent = '크기';
  const actions = document.createElement('span'); actions.textContent = '작업';
  row.append(checkbox, name, modified, size, actions); return row;
}

function syncFileSelectionControls() {
  const visibleFiles = state.directory.files.filter((file) => nameMatches(file.name));
  const selectedVisibleCount = visibleFiles.filter((file) => state.selectedFileIds.has(file.id)).length;
  const selectAll = $('#select-all-files');
  if (selectAll) {
    selectAll.disabled = !visibleFiles.length;
    selectAll.checked = visibleFiles.length > 0 && selectedVisibleCount === visibleFiles.length;
    selectAll.indeterminate = selectedVisibleCount > 0 && selectedVisibleCount < visibleFiles.length;
  }
  const button = $('#bulk-download-button');
  const count = state.selectedFileIds.size;
  button.classList.toggle('is-hidden', count === 0);
  button.disabled = count === 0;
  button.setAttribute('aria-hidden', String(count === 0));
  $('#bulk-download-label').textContent = `선택 파일 ${count}개 ZIP 다운로드`;
}

function trashFileRow(file) {
  const row = document.createElement('article'); row.className = 'file-row'; row.setAttribute('role', 'row');
  const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.className = 'file-checkbox'; checkbox.dataset.trashId = file.id; checkbox.dataset.trashType = 'file'; checkbox.checked = state.selectedTrashIds.has(file.id); checkbox.setAttribute('aria-label', `${file.name} 선택`);
  row.classList.toggle('is-selected', checkbox.checked);
  checkbox.addEventListener('change', () => {
    state.selectedTrashIds[checkbox.checked ? 'add' : 'delete'](file.id);
    row.classList.toggle('is-selected', checkbox.checked);
    syncTrashSelectionControls();
  });
  const icon = fileIconFor(file.name);
  const name = document.createElement('span'); name.className = 'file-name'; name.title = file.originalPath ? `원래 위치: /${file.originalPath}` : '원래 위치: 내 파일'; name.append(svgIcon(icon.icon, `file-icon file-icon-${icon.kind}`), document.createTextNode(file.name));
  const metadata = document.createElement('span'); metadata.className = 'file-meta'; metadata.title = file.originalPath ? `원래 위치: /${file.originalPath}` : '원래 위치: 내 파일'; metadata.textContent = `삭제 ${new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(file.trashedAt))}`;
  const size = document.createElement('span'); size.className = 'file-size'; size.textContent = formatSize(file.size);
  const actions = document.createElement('div'); actions.className = 'file-actions';
  const restore = document.createElement('button'); restore.className = 'restore-file'; restore.type = 'button'; restore.textContent = '복원'; restore.addEventListener('click', () => { void restoreTrashEntry(file); });
  const remove = document.createElement('button'); remove.className = 'delete-file'; remove.type = 'button'; remove.setAttribute('aria-label', `${file.name} 영구 삭제`); remove.title = '영구 삭제'; remove.append(svgIcon('trash')); remove.addEventListener('click', () => openTrashDeleteDialog([file]));
  actions.append(restore, remove);
  row.append(checkbox, name, metadata, size, actions); return row;
}

function trashChildRow(entry, depth = 1) {
  const row = document.createElement('article'); row.className = 'file-row trash-child-row'; row.style.setProperty('--trash-depth', depth); row.setAttribute('role', 'row');
  const spacer = document.createElement('span'); spacer.className = 'trash-child-spacer';
  const icon = entry.type === 'folder' ? svgIcon('folder', 'folder-icon') : svgIcon(fileIconFor(entry.name).icon, `file-icon file-icon-${fileIconFor(entry.name).kind}`);
  const name = document.createElement('span'); name.className = 'file-name trash-child-name'; name.append(icon, document.createTextNode(entry.name));
  const metadata = document.createElement('span'); metadata.className = 'file-meta'; metadata.textContent = entry.type === 'folder' ? '폴더' : '';
  const size = document.createElement('span'); size.className = 'file-size'; size.textContent = entry.type === 'folder' ? '' : formatSize(entry.size);
  const actions = document.createElement('span'); actions.className = 'file-actions';
  row.append(spacer, name, metadata, size, actions); return row;
}

function trashFolderRows(folder, depth = 0) {
  const expanded = state.expandedTrashFolderIds.has(folder.id);
  const row = document.createElement('article'); row.className = 'file-row trash-folder-row'; row.setAttribute('role', 'row');
  const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.className = 'file-checkbox'; checkbox.dataset.trashId = folder.id; checkbox.dataset.trashType = 'folder'; checkbox.checked = state.selectedTrashIds.has(folder.id); checkbox.setAttribute('aria-label', `${folder.name} 폴더 선택`);
  row.classList.toggle('is-selected', checkbox.checked);
  checkbox.addEventListener('change', () => {
    state.selectedTrashIds[checkbox.checked ? 'add' : 'delete'](folder.id);
    row.classList.toggle('is-selected', checkbox.checked);
    syncTrashSelectionControls();
  });
  const name = document.createElement('button'); name.className = 'file-name trash-folder-name'; name.type = 'button'; name.setAttribute('aria-expanded', String(expanded)); name.title = expanded ? '폴더 구조 접기' : '폴더 구조 펼치기';
  const toggle = document.createElement('span'); toggle.className = 'trash-folder-chevron'; toggle.append(svgIcon('chevron-right'));
  toggle.classList.toggle('is-expanded', expanded);
  name.append(toggle, svgIcon('folder', 'folder-icon'), document.createTextNode(folder.name));
  name.addEventListener('click', () => {
    state.expandedTrashFolderIds[expanded ? 'delete' : 'add'](folder.id);
    renderTrashList();
  });
  const metadata = document.createElement('span'); metadata.className = 'file-meta'; metadata.title = folder.originalPath ? `원래 위치: /${folder.originalPath}` : '원래 위치: 내 파일'; metadata.textContent = `삭제 ${new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(folder.trashedAt))}`;
  const size = document.createElement('span'); size.className = 'file-size'; size.textContent = formatSize(folder.size);
  const actions = document.createElement('div'); actions.className = 'file-actions';
  const restore = document.createElement('button'); restore.className = 'restore-file'; restore.type = 'button'; restore.textContent = '복원'; restore.addEventListener('click', () => { void restoreTrashEntry(folder); });
  const remove = document.createElement('button'); remove.className = 'delete-file'; remove.type = 'button'; remove.setAttribute('aria-label', `${folder.name} 폴더 영구 삭제`); remove.title = '영구 삭제'; remove.append(svgIcon('trash')); remove.addEventListener('click', () => openTrashDeleteDialog([folder]));
  actions.append(restore, remove);
  row.append(checkbox, name, metadata, size, actions);
  const children = expanded ? folder.children.flatMap((child) => [trashChildRow(child, depth + 1), ...(child.type === 'folder' ? trashChildRows(child, depth + 2) : [])]) : [];
  return [row, ...children];
}

function trashChildRows(folder, depth) {
  return folder.children.flatMap((child) => [trashChildRow(child, depth), ...(child.type === 'folder' ? trashChildRows(child, depth + 1) : [])]);
}

function trashTableHeader() {
  const row = document.createElement('article'); row.className = 'file-row file-header'; row.setAttribute('role', 'row');
  const checkbox = document.createElement('input'); checkbox.id = 'select-all-trash'; checkbox.type = 'checkbox'; checkbox.className = 'file-checkbox'; checkbox.setAttribute('aria-label', '표시된 휴지통 항목 전체 선택');
  checkbox.addEventListener('change', () => {
    const visibleFiles = state.trash.entries.filter((file) => nameMatches(file.name));
    visibleFiles.forEach((file) => state.selectedTrashIds[checkbox.checked ? 'add' : 'delete'](file.id));
    document.querySelectorAll('#trash-list .file-checkbox[data-trash-id]').forEach((item) => {
      item.checked = checkbox.checked;
      item.closest('.file-row')?.classList.toggle('is-selected', checkbox.checked);
    });
    syncTrashSelectionControls();
  });
  const name = document.createElement('span'); name.textContent = '이름';
  const modified = document.createElement('span'); modified.textContent = '삭제한 날짜';
  const size = document.createElement('span'); size.textContent = '크기';
  const actions = document.createElement('span'); actions.textContent = '작업';
  row.append(checkbox, name, modified, size, actions); return row;
}

function syncTrashSelectionControls() {
  const visibleFiles = state.trash.entries.filter((file) => nameMatches(file.name));
  const selectedVisibleCount = visibleFiles.filter((file) => state.selectedTrashIds.has(file.id)).length;
  const selectAll = $('#select-all-trash');
  if (selectAll) {
    selectAll.disabled = !visibleFiles.length;
    selectAll.checked = visibleFiles.length > 0 && selectedVisibleCount === visibleFiles.length;
    selectAll.indeterminate = selectedVisibleCount > 0 && selectedVisibleCount < visibleFiles.length;
  }
  const button = $('#bulk-trash-delete-button');
  const count = state.selectedTrashIds.size;
  button.classList.toggle('is-hidden', count === 0);
  button.disabled = count === 0;
  button.setAttribute('aria-hidden', String(count === 0));
  $('#bulk-trash-delete-label').textContent = `선택 항목 ${count}개 영구 삭제`;
}

function emptyTrash() {
  const panel = document.createElement('section'); panel.className = 'empty-panel file-empty';
  const title = document.createElement('h3'); title.textContent = '휴지통이 비어 있습니다.';
  const description = document.createElement('p'); description.textContent = '삭제한 파일과 폴더는 이곳에서 원래 구조대로 확인·복원하거나 영구 삭제할 수 있습니다.';
  panel.append(title, description); return panel;
}

function renderTrashList() {
  const files = state.trash.entries.filter((file) => nameMatches(file.name));
  const list = $('#trash-list');
  const rows = files.flatMap((file) => file.type === 'folder' ? trashFolderRows(file) : [trashFileRow(file)]);
  list.replaceChildren(...(files.length ? [trashTableHeader(), ...rows] : [state.query ? emptySearch('휴지통') : emptyTrash()]));
  $('#trash-count').textContent = `${files.length}개`;
  syncTrashSelectionControls();
}

function emptyFolder() {
  const panel = document.createElement('section'); panel.className = 'empty-panel';
  const art = document.createElement('div'); art.className = 'folder-illustration';
  const spark = document.createElement('span'); spark.className = 'folder-spark'; art.append(spark);
  const title = document.createElement('h3'); title.textContent = '아직 폴더가 없습니다.';
  const description = document.createElement('p'); description.textContent = '새 폴더를 만들어 파일을 정리해 보세요.';
  const button = document.createElement('button'); button.className = 'outline-button'; button.type = 'button'; button.append(svgIcon('folder-plus'), document.createTextNode('새 폴더'));
  button.addEventListener('click', openFolderDialog);
  panel.append(art, title, description, button); return panel;
}

function emptyFiles() {
  const panel = document.createElement('section'); panel.className = 'empty-panel file-empty';
  const title = document.createElement('h3'); title.textContent = '아직 파일이 없습니다.';
  const description = document.createElement('p'); description.textContent = '아래 업로드 영역에서 파일을 추가해 보세요.';
  const button = document.createElement('button'); button.className = 'outline-button'; button.type = 'button'; button.append(svgIcon('upload'), document.createTextNode('파일 업로드'));
  button.addEventListener('click', () => $('#file-input').click());
  panel.append(title, description, button);
  return panel;
}

function emptySearch(kind) {
  const panel = document.createElement('section'); panel.className = 'empty-panel empty-search';
  const title = document.createElement('h3'); title.textContent = `${kind} 검색 결과가 없습니다.`;
  const description = document.createElement('p'); description.textContent = '다른 검색어로 다시 시도해 보세요.';
  panel.append(title, description); return panel;
}

function allFolderPaths(folders = state.folderTree) {
  return folders.flatMap((folder) => [folder.path, ...allFolderPaths(folder.children)]);
}

function renderFolderTree() {
  const folderList = $('#folder-list');
  const root = { name: '내 파일', path: '', children: state.folderTree };
  folderList.replaceChildren(folderNode(root, 0, { root: true }));
  const folderCount = allFolderPaths().length;
  $('#folder-count').textContent = `${folderCount}개`;
  $('#collapse-folders-button').textContent = state.expandedFolderPaths.has('') ? '모두 접기' : '모두 펼치기';
  $('#collapse-folders-button').disabled = folderCount === 0;
}

async function renderFileList({ animate = false } = {}) {
  const files = state.directory.files.filter((file) => nameMatches(file.name));
  const fileList = $('#file-list');
  const transitionId = ++state.fileListTransitionId;
  if (animate && fileList.childElementCount) {
    fileList.classList.add('is-changing');
    await new Promise((resolve) => window.setTimeout(resolve, 115));
    if (transitionId !== state.fileListTransitionId) return;
  }
  fileList.replaceChildren(...(files.length ? [fileTableHeader(), ...files.map(fileRow)] : [state.query ? emptySearch('파일') : emptyFiles()]));
  $('#file-count').textContent = `${files.length}개`;
  $('#files-title').textContent = `${pathParts(state.currentPath).at(-1) ?? '내 파일'}의 파일`;
  syncFileSelectionControls();
  if (animate) window.requestAnimationFrame(() => {
    if (transitionId === state.fileListTransitionId) fileList.classList.remove('is-changing');
  });
  else fileList.classList.remove('is-changing');
}

function v4LogTableHeader() {
  const row = document.createElement('article'); row.className = 'file-row file-header'; row.setAttribute('role', 'row');
  const type = document.createElement('span'); type.className = 'v4-log-type';
  const name = document.createElement('span'); name.textContent = '이름';
  const modified = document.createElement('span'); modified.textContent = '수정한 날짜';
  const size = document.createElement('span'); size.textContent = '크기';
  const actions = document.createElement('span'); actions.textContent = '작업';
  row.append(type, name, modified, size, actions); return row;
}

function v4LogRow(entry) {
  const row = document.createElement('article'); row.className = 'file-row v4-log-row'; row.setAttribute('role', 'row');
  const icon = entry.type === 'directory' ? null : fileIconFor(entry.name);
  const type = svgIcon(entry.type === 'directory' ? 'folder' : icon.icon, `v4-log-type${icon ? ` file-icon-${icon.kind}` : ''}`);
  const name = document.createElement('button'); name.type = 'button'; name.className = `file-name${entry.type === 'directory' ? ' v4-log-folder' : ' file-preview-trigger'}`; name.append(document.createTextNode(entry.name));
  if (entry.type === 'directory') name.addEventListener('click', () => loadV4Logs(entry.path));
  else name.addEventListener('click', () => openFilePreview({ name: entry.name, size: entry.size, previewUrl: `/api/v4-logs/preview?${new URLSearchParams({ path: entry.path })}`, downloadUrl: `/api/v4-logs/download?${new URLSearchParams({ path: entry.path })}` }));
  const metadata = document.createElement('span'); metadata.className = 'file-meta'; metadata.textContent = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(entry.modifiedAt));
  const size = document.createElement('span'); size.className = 'file-size'; size.textContent = entry.type === 'directory' ? '폴더' : formatSize(entry.size);
  const actions = document.createElement('div'); actions.className = 'file-actions';
  if (entry.type !== 'directory') {
    const download = document.createElement('a'); download.className = 'download'; download.href = `/api/v4-logs/download?${new URLSearchParams({ path: entry.path })}`; download.download = entry.name; download.textContent = '다운로드'; attachDownloadLoading(download, `“${entry.name}” 다운로드를 시작하고 있습니다.`); actions.append(download);
  }
  row.append(type, name, metadata, size, actions); return row;
}

function v4LogParentRow() {
  const parent = parentPath(state.v4Logs.path);
  const row = document.createElement('article'); row.className = 'file-row v4-log-row v4-log-parent'; row.setAttribute('role', 'row');
  const type = svgIcon('folder', 'v4-log-type');
  const name = document.createElement('button'); name.className = 'file-name v4-log-folder'; name.type = 'button'; name.textContent = '...';
  name.title = '상위 폴더로 이동'; name.setAttribute('aria-label', '상위 폴더로 이동');
  name.addEventListener('click', () => loadV4Logs(parent));
  const metadata = document.createElement('span'); metadata.className = 'file-meta'; metadata.textContent = '상위 폴더';
  const size = document.createElement('span'); size.className = 'file-size'; size.textContent = '–';
  const actions = document.createElement('div'); actions.className = 'file-actions';
  row.append(type, name, metadata, size, actions); return row;
}

function emptyV4Logs() {
  const panel = document.createElement('section'); panel.className = 'empty-panel file-empty';
  const title = document.createElement('h3'); title.textContent = '표시할 V4 로그가 없습니다.';
  const description = document.createElement('p'); description.textContent = '이 위치는 읽기 전용입니다.';
  panel.append(title, description); return panel;
}

function renderV4LogList() {
  const entries = state.v4Logs.entries.filter((entry) => nameMatches(entry.name));
  const list = $('#v4-log-list');
  const parent = state.v4Logs.path ? [v4LogParentRow()] : [];
  list.replaceChildren(...(entries.length || parent.length ? [v4LogTableHeader(), ...parent, ...entries.map(v4LogRow)] : [state.query ? emptySearch('V4 로그') : emptyV4Logs()]));
  $('#v4-log-count').textContent = `${entries.length}개`;
  $('#v4-log-title').textContent = state.v4Logs.path ? `${pathParts(state.v4Logs.path).at(-1)}의 V4Log` : 'V4Log';
}

function folderTreeNode(path) {
  return [...$('#folder-list').querySelectorAll('.folder-tree-node')].find((node) => node.dataset.folderPath === path);
}

function canMoveFolder(sourcePath, destinationPath) {
  return Boolean(sourcePath)
    && sourcePath !== destinationPath
    && !destinationPath.startsWith(`${sourcePath}/`);
}

function clearFolderDragState() {
  state.draggedFolderPath = null;
  document.querySelectorAll('.folder-tree-row.is-drop-target, .folder-tree-row.is-dragging').forEach((row) => {
    row.classList.remove('is-drop-target', 'is-dragging');
  });
}

function attachFolderDropTarget(row, destinationPath) {
  row.addEventListener('dragover', (event) => {
    const sourcePath = state.draggedFolderPath || event.dataTransfer?.getData('text/plain');
    if (!canMoveFolder(sourcePath, destinationPath)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    row.classList.add('is-drop-target');
  });
  row.addEventListener('dragleave', (event) => {
    if (!row.contains(event.relatedTarget)) row.classList.remove('is-drop-target');
  });
  row.addEventListener('drop', async (event) => {
    const sourcePath = state.draggedFolderPath || event.dataTransfer?.getData('text/plain');
    event.preventDefault();
    clearFolderDragState();
    if (!canMoveFolder(sourcePath, destinationPath)) return;
    await moveFolder(sourcePath, destinationPath);
  });
}

function moveExpandedFolderPaths(sourcePath, movedPath) {
  state.expandedFolderPaths = new Set([...state.expandedFolderPaths].map((folderPath) => (
    folderPath === sourcePath || folderPath.startsWith(`${sourcePath}/`)
      ? `${movedPath}${folderPath.slice(sourcePath.length)}`
      : folderPath
  )));
  expandFolderAncestors(movedPath);
}

async function moveFolder(sourcePath, destinationPath) {
  if (state.folderMoveInProgress) return;
  state.folderMoveInProgress = true;
  try {
    const result = await request('/api/folders/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: sourcePath, destinationPath })
    });
    const currentWasMoved = state.currentPath === sourcePath || state.currentPath.startsWith(`${sourcePath}/`);
    const nextPath = currentWasMoved ? `${result.path}${state.currentPath.slice(sourcePath.length)}` : state.currentPath;
    moveExpandedFolderPaths(sourcePath, result.path);
    await loadFolder(nextPath);
    await loadFolderTree();
    setStatus(destinationPath ? `“${result.name}” 폴더를 선택한 폴더 안으로 이동했습니다.` : `“${result.name}” 폴더를 내 파일 최상위로 이동했습니다.`);
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    state.folderMoveInProgress = false;
  }
}

function setFolderExpanded(path, expanded) {
  const node = folderTreeNode(path);
  if (!node) return;
  state.expandedFolderPaths[expanded ? 'add' : 'delete'](path);
  node.classList.toggle('is-expanded', expanded);
  const toggle = node.querySelector(':scope > .folder-tree-row .folder-toggle');
  toggle?.setAttribute('aria-expanded', String(expanded));
  toggle?.setAttribute('aria-label', `${node.querySelector(':scope > .folder-tree-row .item-name')?.textContent ?? '폴더'} ${expanded ? '접기' : '펼치기'}`);
  $('#collapse-folders-button').textContent = state.expandedFolderPaths.has('') ? '모두 접기' : '모두 펼치기';
}

function syncFolderTreeState() {
  $('#folder-list').querySelectorAll('.folder-tree-node').forEach((node) => {
    const path = node.dataset.folderPath;
    const expanded = state.expandedFolderPaths.has(path);
    node.classList.toggle('is-expanded', expanded);
    node.classList.toggle('is-active', path === state.currentPath);
    const toggle = node.querySelector(':scope > .folder-tree-row .folder-toggle');
    if (!toggle || toggle.disabled) return;
    toggle.setAttribute('aria-expanded', String(expanded));
    toggle.setAttribute('aria-label', `${node.querySelector(':scope > .folder-tree-row .item-name')?.textContent ?? '폴더'} ${expanded ? '접기' : '펼치기'}`);
  });
  $('#collapse-folders-button').textContent = state.expandedFolderPaths.has('') ? '모두 접기' : '모두 펼치기';
}

function setAllFoldersExpanded(expanded) {
  state.expandedFolderPaths = new Set(expanded ? ['', ...allFolderPaths()] : []);
  syncFolderTreeState();
}

function expandFolderAncestors(path) {
  state.expandedFolderPaths.add('');
  pathParts(path).reduce((ancestor, part) => {
    const next = ancestor ? `${ancestor}/${part}` : part;
    state.expandedFolderPaths.add(next);
    return next;
  }, '');
}

async function loadFolderTree() {
  const data = await request('/api/folders/tree', { headers: {} });
  state.folderTree = data.folders;
  expandFolderAncestors(state.currentPath);
  renderFolderTree();
}

async function loadFolder(path = state.currentPath, { animate = true } = {}) {
  try {
    const data = await request(`/api/folders?${new URLSearchParams({ path })}`, { headers: {} });
    state.currentPath = data.path;
    expandFolderAncestors(data.path);
    state.directory = { files: data.files };
    const availableIds = new Set(data.files.map((file) => file.id));
    state.selectedFileIds = new Set([...state.selectedFileIds].filter((id) => availableIds.has(id)));
    renderBreadcrumbs(); await renderFileList({ animate });
    syncFolderTreeState();
    setStatus('');
  } catch (error) { setStatus(error.message, true); }
}

function setWorkspaceSection(section) {
  state.section = section;
  const isV4Log = section === 'v4log';
  const isTrash = section === 'trash';
  $('#library-layout').hidden = isV4Log || isTrash;
  $('#files-section').hidden = isV4Log || isTrash;
  $('#upload-drop-zone').hidden = isV4Log || isTrash;
  $('#v4-log-section').hidden = !isV4Log;
  $('#trash-section').hidden = !isTrash;
  $('#new-folder-button').hidden = isV4Log || isTrash;
  $('#toolbar-upload').hidden = isV4Log || isTrash;
  $('#up-button').hidden = isV4Log || isTrash;
  $('#file-search').placeholder = isV4Log ? 'V4 로그 파일명으로 검색하세요.' : isTrash ? '휴지통 항목명으로 검색하세요.' : '파일명으로 검색하세요.';
  document.querySelectorAll('.side-nav-item').forEach((button) => {
    const active = button.dataset.nav === section;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
}

async function loadV4Logs(path = state.v4Logs.path) {
  try {
    const data = await request(`/api/v4-logs?${new URLSearchParams({ path })}`, { headers: {} });
    state.v4Logs = { path: data.path, entries: data.entries };
    renderV4LogBreadcrumbs(); renderV4LogList(); setStatus('');
  } catch (error) { setStatus(error.message, true); }
}

async function showFiles() {
  state.query = ''; $('#file-search').value = '';
  setWorkspaceSection('files');
  await loadFolder(state.currentPath);
}

async function showV4Logs() {
  state.query = ''; $('#file-search').value = '';
  setWorkspaceSection('v4log');
  await loadV4Logs(state.v4Logs.path);
}

async function loadTrash() {
  try {
    const data = await request('/api/trash', { headers: {} });
    state.trash = { entries: data.entries };
    state.selectedTrashIds = new Set([...state.selectedTrashIds].filter((id) => data.entries.some((file) => file.id === id)));
    const breadcrumbs = $('#breadcrumbs'); breadcrumbs.replaceChildren();
    const label = document.createElement('span'); label.className = 'crumb'; label.textContent = '휴지통'; breadcrumbs.append(label);
    $('#page-location').textContent = '휴지통';
    $('#up-button').disabled = true;
    renderTrashList(); setStatus('');
  } catch (error) { setStatus(error.message, true); }
}

async function showTrash() {
  state.query = ''; $('#file-search').value = '';
  setWorkspaceSection('trash');
  await loadTrash();
}

function renderStorage(storage) {
  const total = storage.totalBytes; const free = storage.freeBytes; const used = storage.usedBytes;
  const hasCapacity = Number.isFinite(total) && total > 0;
  const freePercent = hasCapacity ? Math.min(100, Math.max(0, Math.round((free / total) * 100))) : 0;
  const usedPercent = hasCapacity ? 100 - freePercent : 0;
  $('#storage-ring').style.setProperty('--storage-progress', usedPercent);
  $('#storage-percent').textContent = `${usedPercent}%`;
  $('#storage-free').textContent = formatStorageSize(free);
  $('#storage-total').textContent = `/ ${formatStorageSize(total)}`;
  $('#storage-used').textContent = formatStorageSize(used);
  $('#storage-free-detail').textContent = formatStorageSize(free);
  $('#mini-storage-ring').style.setProperty('--storage-progress', usedPercent);
  $('#mini-storage-percent').textContent = `${usedPercent}%`;
  $('#mini-storage-value').textContent = `사용 ${formatStorageSize(used)} / ${formatStorageSize(total)}  ${usedPercent}%`;
}

async function loadStorage() {
  try { renderStorage(await request('/api/storage', { headers: {} })); }
  catch { renderStorage({ totalBytes: 0, freeBytes: 0, usedBytes: 0 }); }
}

function openFolderDialog() {
  $('#folder-form').reset(); $('#folder-error').textContent = ''; $('#folder-dialog').showModal();
}

function openFolderRenameDialog(folder) {
  state.pendingRename = { path: folder.path, name: folder.name };
  $('#rename-folder-title').textContent = `“${folder.name}” 폴더의 이름을 바꿀까요?`;
  $('#rename-folder-name').value = folder.name;
  $('#rename-folder-error').textContent = '';
  $('#rename-folder-dialog').showModal();
  $('#rename-folder-name').select();
}

function openFolderDeleteDialog(folder) {
  state.pendingDelete = { type: 'folder', path: folder.path, name: folder.name };
  $('#delete-title').textContent = `“${folder.name}” 폴더를 삭제할까요?`;
  $('#delete-description').textContent = '하위 폴더와 파일이 원래 구조 그대로 휴지통으로 이동합니다. 계속하려면 현재 비밀번호를 입력하세요.';
  $('#delete-submit').textContent = '휴지통으로 이동';
  $('#delete-password').value = ''; $('#delete-error').textContent = '';
  $('#delete-dialog').showModal();
}

function openFileDeleteDialog(file) {
  state.pendingDelete = { type: 'file', id: file.id, name: file.name };
  $('#delete-title').textContent = `“${file.name}” 파일을 삭제할까요?`;
  $('#delete-description').textContent = '웹 목록에서는 제거되지만 암호화 파일과 원본 파일은 이동식 디스크의 .ifile-manager-trash에 보관됩니다. 계속하려면 현재 비밀번호를 입력하세요.';
  $('#delete-submit').textContent = '휴지통으로 이동';
  $('#delete-password').value = ''; $('#delete-error').textContent = '';
  $('#delete-dialog').showModal();
}

function openTrashDeleteDialog(files) {
  const selected = [...files];
  if (!selected.length) return;
  state.pendingDelete = { type: 'trash', items: selected.map((file) => ({ id: file.id, type: file.type })), count: selected.length };
  const isFolder = selected.length === 1 && selected[0].type === 'folder';
  $('#delete-title').textContent = selected.length === 1 ? `“${selected[0].name}” ${isFolder ? '폴더와 그 안의 파일을' : '파일을'} 영구 삭제할까요?` : `${selected.length}개 항목을 영구 삭제할까요?`;
  $('#delete-description').textContent = '휴지통의 암호화 파일과 원본 파일이 이동식 디스크에서 영구 삭제되며 복구할 수 없습니다. 계속하려면 현재 비밀번호를 입력하세요.';
  $('#delete-submit').textContent = '영구 삭제';
  $('#delete-password').value = ''; $('#delete-error').textContent = '';
  $('#delete-dialog').showModal();
}

async function restoreTrashEntry(file) {
  try {
    const endpoint = file.type === 'folder' ? `/api/trash/folders/${encodeURIComponent(file.id)}/restore` : `/api/trash/${encodeURIComponent(file.id)}/restore`;
    const result = await request(endpoint, { method: 'POST' });
    await loadTrash(); await loadFolderTree();
    const subject = file.type === 'folder' ? '폴더와 그 안의 파일을' : '파일을';
    setStatus(result.path ? `“${result.name}” ${subject} /${result.path}에 복원했습니다.` : `“${result.name}” ${subject} 내 파일에 복원했습니다.`);
  } catch (error) { setStatus(error.message, true); }
}

async function uploadSelectedFiles(files) {
  const selectedFiles = [...(files ?? [])];
  if (!selectedFiles.length) return;
  const progress = {
    total: selectedFiles.length,
    completed: 0,
    totalBytes: selectedFiles.reduce((total, file) => total + Math.max(0, file.size ?? 0), 0),
    completedBytes: 0,
    currentFile: selectedFiles[0],
    currentTransferredBytes: 0,
    currentTransferTotal: selectedFiles[0].size ?? 0,
    isSaving: false,
    startedAt: Date.now()
  };
  showOperationLoading('파일 업로드 중…', '파일 업로드를 준비하고 있습니다.');
  beginUploadProgress(progress);
  setStatus(`${selectedFiles.length}개 파일을 암호화 후 업로드 중…`);
  try {
    for (const file of selectedFiles) {
      progress.currentFile = file;
      progress.currentTransferredBytes = 0;
      progress.currentTransferTotal = file.size ?? 0;
      progress.isSaving = false;
      renderUploadProgress(progress);
      await uploadFileWithProgress(file, state.currentPath, ({ loaded, total }) => {
        progress.currentTransferredBytes = loaded;
        progress.currentTransferTotal = total;
        progress.isSaving = loaded >= total;
        renderUploadProgress(progress);
      });
      progress.completed += 1;
      progress.completedBytes += Math.max(0, file.size ?? 0);
      progress.isSaving = false;
      renderUploadProgress(progress);
    }
    await loadFolder(); await refreshStorageAfterMutation();
    setStatus(selectedFiles.length === 1 ? '파일을 암호화하여 업로드했습니다.' : `${selectedFiles.length}개 파일을 암호화하여 업로드했습니다.`);
  }
  catch (error) {
    if (progress.completed) {
      await loadFolder(); await refreshStorageAfterMutation();
      setStatus(`${progress.completed}개 파일을 저장했지만 이후 업로드에 실패했습니다: ${error.message}`, true);
    } else setStatus(error.message, true);
  }
  finally { hideOperationLoading(); }
}

async function refreshStorageAfterMutation() {
  await loadStorage();
  // macOS WatchPaths starts the host collector asynchronously after Docker syncs the change.
  [700, 2_000].forEach((delay) => window.setTimeout(() => { void loadStorage(); }, delay));
}

function downloadSelectedFilesAsZip() {
  const ids = [...state.selectedFileIds];
  if (!ids.length) return;
  showDownloadLoading(`${ids.length}개 파일을 ZIP으로 준비하고 있습니다.`);
  const form = document.createElement('form');
  form.method = 'POST'; form.action = '/api/files/archive'; form.target = 'zip-download-target'; form.hidden = true;
  ids.forEach((id) => {
    const input = document.createElement('input'); input.type = 'hidden'; input.name = 'fileIds'; input.value = id;
    form.append(input);
  });
  document.body.append(form);
  form.submit(); form.remove();
  setStatus(`${ids.length}개 파일을 ZIP으로 준비해 다운로드합니다.`);
}

function attachUploadDropzone(panel) {
  ['dragenter', 'dragover'].forEach((eventName) => panel.addEventListener(eventName, (event) => { event.preventDefault(); panel.classList.add('dragover'); }));
  ['dragleave', 'drop'].forEach((eventName) => panel.addEventListener(eventName, (event) => { event.preventDefault(); panel.classList.remove('dragover'); }));
  panel.addEventListener('drop', (event) => uploadSelectedFiles(event.dataTransfer?.files));
  panel.addEventListener('click', () => $('#file-input').click());
  panel.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); $('#file-input').click(); } });
}

applyIcons();
attachUploadDropzone($('#upload-drop-zone'));
attachDownloadLoading($('#preview-download'), '파일 다운로드를 시작하고 있습니다.');

$('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault(); $('#login-error').textContent = '';
  const form = new FormData(event.currentTarget);
  try {
    const data = await request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(form)) });
    state.user = data.user; showApp();
  } catch (error) { $('#login-error').textContent = error.message; }
});

$('#logout-button').addEventListener('click', async () => {
  try { await request('/api/auth/logout', { method: 'POST' }); } finally { state.user = null; $('#app-panel').hidden = true; $('#login-panel').hidden = false; $('#login-form').reset(); }
});
$('#up-button').addEventListener('click', () => {
  if (state.section === 'v4log') loadV4Logs(parentPath(state.v4Logs.path));
  else loadFolder(parentPath());
});
$('#new-folder-button').addEventListener('click', openFolderDialog);
$('#collapse-folders-button').addEventListener('click', () => setAllFoldersExpanded(!state.expandedFolderPaths.has('')));
$('#file-search').addEventListener('input', (event) => { state.query = event.target.value.trim(); if (state.section === 'v4log') renderV4LogList(); else if (state.section === 'trash') renderTrashList(); else renderFileList(); });
$('#file-input').addEventListener('change', async (event) => { await uploadSelectedFiles(event.target.files); event.target.value = ''; });
$('#bulk-download-button').addEventListener('click', downloadSelectedFilesAsZip);
$('#bulk-trash-delete-button').addEventListener('click', () => openTrashDeleteDialog(state.trash.entries.filter((file) => state.selectedTrashIds.has(file.id))));

document.querySelectorAll('dialog button[value="cancel"]').forEach((button) => button.addEventListener('click', () => button.closest('dialog').close()));
document.querySelectorAll('.side-nav-item').forEach((button) => button.addEventListener('click', () => {
  if (button.dataset.nav === 'files') void showFiles();
  else if (button.dataset.nav === 'v4log') void showV4Logs();
  else if (button.dataset.nav === 'trash') void showTrash();
  else setStatus('이 메뉴는 다음 업데이트에서 제공됩니다. 현재는 내 파일과 V4Log를 사용할 수 있습니다.');
}));

$('#folder-form').addEventListener('submit', async (event) => {
  event.preventDefault(); $('#folder-error').textContent = '';
  try {
    await request('/api/folders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ parentPath: state.currentPath, name: $('#folder-name').value.trim() }) });
    $('#folder-dialog').close(); await loadFolder(); await loadFolderTree(); setStatus('폴더를 만들었습니다.');
  } catch (error) { $('#folder-error').textContent = error.message; }
});
$('#rename-folder-form').addEventListener('submit', async (event) => {
  event.preventDefault(); $('#rename-folder-error').textContent = '';
  const button = $('#rename-folder-submit'); button.disabled = true;
  try {
    const pending = state.pendingRename;
    if (!pending) throw new Error('이름을 변경할 폴더를 찾지 못했습니다.');
    const data = await request('/api/folders', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: pending.path, name: $('#rename-folder-name').value.trim() }) });
    const currentWasRenamed = state.currentPath === pending.path || state.currentPath.startsWith(`${pending.path}/`);
    const nextPath = currentWasRenamed ? `${data.path}${state.currentPath.slice(pending.path.length)}` : state.currentPath;
    $('#rename-folder-dialog').close(); await loadFolder(nextPath); await loadFolderTree(); setStatus('폴더 이름을 변경했습니다.');
    state.pendingRename = null;
  } catch (error) { $('#rename-folder-error').textContent = error.message; } finally { button.disabled = false; }
});
$('#delete-form').addEventListener('submit', async (event) => {
  event.preventDefault(); $('#delete-error').textContent = '';
  const button = $('#delete-submit'); button.disabled = true;
  try {
    const pending = state.pendingDelete;
    if (!pending) throw new Error('삭제할 항목을 찾지 못했습니다.');
    const confirmation = await request('/api/auth/reauthenticate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: $('#delete-password').value }) });
    if (pending.type === 'folder') {
      await request('/api/folders', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: pending.path, reauthenticationToken: confirmation.token }) });
      const currentWasDeleted = state.currentPath === pending.path || state.currentPath.startsWith(`${pending.path}/`);
      $('#delete-dialog').close(); await loadFolder(currentWasDeleted ? parentPath(pending.path) : state.currentPath); await loadFolderTree(); await refreshStorageAfterMutation(); setStatus('폴더와 그 안의 파일을 휴지통으로 이동했습니다.');
    } else if (pending.type === 'trash') {
      const entries = pending.items;
      await request('/api/trash', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fileTrashIds: entries.filter((item) => item.type === 'file').map((item) => item.id), folderTrashIds: entries.filter((item) => item.type === 'folder').map((item) => item.id), reauthenticationToken: confirmation.token }) });
      $('#delete-dialog').close(); await loadTrash(); await refreshStorageAfterMutation(); setStatus(`${pending.count}개 항목을 영구 삭제했습니다.`);
    } else {
      await request(`/api/files/${encodeURIComponent(pending.id)}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reauthenticationToken: confirmation.token }) });
      $('#delete-dialog').close(); await loadFolder(); await refreshStorageAfterMutation(); setStatus('파일을 .ifile-manager-trash로 이동했습니다.');
    }
    state.pendingDelete = null;
  } catch (error) { $('#delete-error').textContent = error.message; } finally { button.disabled = false; }
});

async function showApp() {
  $('#current-user').textContent = `${state.user.username} (${state.user.role})`;
  $('#login-panel').hidden = true; $('#app-panel').hidden = false;
  setWorkspaceSection('files');
  await loadFolder('');
  await Promise.all([loadFolderTree(), loadStorage()]);
}

try { const data = await request('/api/auth/me', { headers: {} }); state.user = data.user; showApp(); } catch { /* Anonymous visitors intentionally see the login screen. */ }
