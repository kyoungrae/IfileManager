const state = {
  user: null,
  currentPath: '',
  pendingDeletePath: '',
  directory: { folders: [], files: [] },
  query: '',
  view: 'grid'
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
  grid: '<rect x="4" y="4" width="6" height="6" rx=".5"/><rect x="14" y="4" width="6" height="6" rx=".5"/><rect x="4" y="14" width="6" height="6" rx=".5"/><rect x="14" y="14" width="6" height="6" rx=".5"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6h.01M4 12h.01M4 18h.01"/>',
  'file-up': '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M12 18v-6M9.5 14.5 12 12l2.5 2.5"/>'
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
function parentPath() { const parts = pathParts(state.currentPath); parts.pop(); return parts.join('/'); }
function nameMatches(name) { return name.toLocaleLowerCase('ko-KR').includes(state.query.toLocaleLowerCase('ko-KR')); }

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

function folderCard(folder) {
  const card = document.createElement('article'); card.className = 'folder-card';
  const open = document.createElement('button'); open.className = 'folder-open'; open.type = 'button'; open.title = folder.name;
  const icon = svgIcon('folder', 'folder-icon');
  const name = document.createElement('span'); name.className = 'item-name'; name.textContent = folder.name;
  open.append(icon, name); open.addEventListener('click', () => loadFolder(folder.path));
  const remove = document.createElement('button'); remove.className = 'delete-folder'; remove.type = 'button'; remove.textContent = '삭제'; remove.addEventListener('click', () => openDeleteDialog(folder));
  card.append(open, remove); return card;
}

function fileRow(file) {
  const row = document.createElement('article'); row.className = 'file-row';
  const name = document.createElement('span'); name.className = 'file-name'; name.textContent = file.name; name.title = file.name;
  const metadata = document.createElement('span'); metadata.className = 'file-meta'; metadata.textContent = `${formatSize(file.size)} · ${new Date(file.createdAt).toLocaleDateString('ko-KR')}`;
  const download = document.createElement('a'); download.className = 'download'; download.href = `/api/files/${encodeURIComponent(file.id)}/download`; download.textContent = '다운로드';
  row.append(name, metadata, download); return row;
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
  const panel = document.createElement('section'); panel.className = 'empty-panel upload-zone'; panel.tabIndex = 0;
  const illustration = document.createElement('div'); illustration.className = 'upload-illustration'; illustration.innerHTML = '<svg viewBox="0 0 64 54" aria-hidden="true"><path d="M18 43H12a10 10 0 0 1-.7-20 15 15 0 0 1 29.2-3.5A12 12 0 1 1 46 43h-5"/><path d="M32 43V22m0 0-8 8m8-8 8 8"/></svg>';
  const title = document.createElement('h3'); title.textContent = '파일을 이곳에 끌어다 놓으세요';
  const description = document.createElement('p'); description.textContent = '또는 컴퓨터에서 선택하세요';
  const button = document.createElement('button'); button.className = 'upload-button'; button.type = 'button'; button.append(svgIcon('upload'), document.createTextNode('파일 업로드'));
  button.addEventListener('click', () => $('#file-input').click());
  const note = document.createElement('p'); note.className = 'upload-note'; note.textContent = '업로드한 파일은 암호화되어 저장됩니다.';
  panel.append(illustration, title, description, button, note);
  ['dragenter', 'dragover'].forEach((eventName) => panel.addEventListener(eventName, (event) => { event.preventDefault(); panel.classList.add('dragover'); }));
  ['dragleave', 'drop'].forEach((eventName) => panel.addEventListener(eventName, (event) => { event.preventDefault(); panel.classList.remove('dragover'); }));
  panel.addEventListener('drop', (event) => uploadSelectedFile(event.dataTransfer?.files?.[0]));
  panel.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); $('#file-input').click(); } });
  return panel;
}

function emptySearch(kind) {
  const panel = document.createElement('section'); panel.className = 'empty-panel empty-search';
  const title = document.createElement('h3'); title.textContent = `${kind} 검색 결과가 없습니다.`;
  const description = document.createElement('p'); description.textContent = '다른 검색어로 다시 시도해 보세요.';
  panel.append(title, description); return panel;
}

function renderDirectory() {
  const folders = state.directory.folders.filter((folder) => nameMatches(folder.name));
  const files = state.directory.files.filter((file) => nameMatches(file.name));
  const folderList = $('#folder-list'); const fileList = $('#file-list');
  folderList.classList.toggle('list-view', state.view === 'list');
  folderList.replaceChildren(...(folders.length ? folders.map(folderCard) : [state.query ? emptySearch('폴더') : emptyFolder()]));
  fileList.replaceChildren(...(files.length ? files.map(fileRow) : [state.query ? emptySearch('파일') : emptyFiles()]));
  $('#folder-count').textContent = `${folders.length}개`;
  $('#file-count').textContent = `${files.length}개`;
}

async function loadFolder(path = state.currentPath) {
  setStatus('불러오는 중…');
  try {
    const data = await request(`/api/folders?${new URLSearchParams({ path })}`, { headers: {} });
    state.currentPath = data.path;
    state.directory = { folders: data.folders, files: data.files };
    renderBreadcrumbs(); renderDirectory(); setStatus('');
  } catch (error) { setStatus(error.message, true); }
}

function setView(view) {
  state.view = view;
  const grid = view === 'grid';
  $('#grid-view-button').classList.toggle('active', grid); $('#list-view-button').classList.toggle('active', !grid);
  $('#grid-view-button').setAttribute('aria-pressed', String(grid)); $('#list-view-button').setAttribute('aria-pressed', String(!grid));
  renderDirectory();
}

function renderStorage(storage) {
  const total = storage.totalBytes; const free = storage.freeBytes; const used = storage.usedBytes;
  const freePercent = total ? Math.min(100, Math.max(0, Math.round((free / total) * 100))) : 0;
  $('#storage-ring').style.setProperty('--storage-progress', freePercent);
  $('#storage-percent').textContent = `${freePercent}%`;
  $('#storage-free').textContent = formatStorageSize(free);
  $('#storage-total').textContent = `/ ${formatStorageSize(total)}`;
  $('#storage-used').textContent = formatStorageSize(used);
  $('#storage-free-detail').textContent = formatStorageSize(free);
  $('#mini-storage-ring').style.setProperty('--storage-progress', freePercent);
  $('#mini-storage-percent').textContent = `${freePercent}%`;
  $('#mini-storage-value').textContent = `${formatStorageSize(free)} / ${formatStorageSize(total)}  ${freePercent}%`;
}

async function loadStorage() {
  try { renderStorage(await request('/api/storage', { headers: {} })); } catch { $('#mini-storage-value').textContent = '정보를 불러오지 못했습니다.'; }
}

function openFolderDialog() {
  $('#folder-form').reset(); $('#folder-error').textContent = ''; $('#folder-dialog').showModal();
}

function openDeleteDialog(folder) {
  state.pendingDeletePath = folder.path;
  $('#delete-title').textContent = `“${folder.name}” 폴더를 삭제할까요?`;
  $('#delete-password').value = ''; $('#delete-error').textContent = '';
  $('#delete-dialog').showModal();
}

async function uploadSelectedFile(file) {
  if (!file) return;
  const data = new FormData(); data.append('folderPath', state.currentPath); data.append('file', file);
  setStatus(`“${file.name}” 암호화 후 업로드 중…`);
  try { await request('/api/files', { method: 'POST', body: data }); await loadFolder(); await loadStorage(); setStatus('파일을 암호화하여 업로드했습니다.'); }
  catch (error) { setStatus(error.message, true); }
}

applyIcons();

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
$('#up-button').addEventListener('click', () => loadFolder(parentPath()));
$('#new-folder-button').addEventListener('click', openFolderDialog);
$('#file-search').addEventListener('input', (event) => { state.query = event.target.value.trim(); renderDirectory(); });
$('#grid-view-button').addEventListener('click', () => setView('grid'));
$('#list-view-button').addEventListener('click', () => setView('list'));
$('#file-input').addEventListener('change', async (event) => { await uploadSelectedFile(event.target.files?.[0]); event.target.value = ''; });

document.querySelectorAll('dialog button[value="cancel"]').forEach((button) => button.addEventListener('click', () => button.closest('dialog').close()));
document.querySelectorAll('.side-nav-item').forEach((button) => button.addEventListener('click', () => {
  if (button.dataset.nav !== 'files') setStatus('이 메뉴는 다음 업데이트에서 제공됩니다. 현재는 내 파일을 사용할 수 있습니다.');
}));

$('#folder-form').addEventListener('submit', async (event) => {
  event.preventDefault(); $('#folder-error').textContent = '';
  try {
    await request('/api/folders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ parentPath: state.currentPath, name: $('#folder-name').value.trim() }) });
    $('#folder-dialog').close(); await loadFolder(); setStatus('폴더를 만들었습니다.');
  } catch (error) { $('#folder-error').textContent = error.message; }
});
$('#delete-form').addEventListener('submit', async (event) => {
  event.preventDefault(); $('#delete-error').textContent = '';
  const button = $('#delete-submit'); button.disabled = true;
  try {
    const confirmation = await request('/api/auth/reauthenticate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: $('#delete-password').value }) });
    await request('/api/folders', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: state.pendingDeletePath, reauthenticationToken: confirmation.token }) });
    $('#delete-dialog').close(); await loadFolder(); await loadStorage(); setStatus('폴더와 그 안의 파일을 삭제했습니다.');
  } catch (error) { $('#delete-error').textContent = error.message; } finally { button.disabled = false; }
});

async function showApp() {
  $('#current-user').textContent = `${state.user.username} (${state.user.role})`;
  $('#login-panel').hidden = true; $('#app-panel').hidden = false;
  await Promise.all([loadFolder(''), loadStorage()]);
}

try { const data = await request('/api/auth/me', { headers: {} }); state.user = data.user; showApp(); } catch { /* Anonymous visitors intentionally see the login screen. */ }
