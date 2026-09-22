const state = {
  user: null,
  currentPath: '',
  pendingDelete: null,
  pendingRename: null,
  directory: { files: [] },
  folderTree: [],
  expandedFolderPaths: new Set(['']),
  fileListTransitionId: 0,
  section: 'files',
  v4Logs: { path: '', entries: [] },
  query: ''
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
  'file-up': '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M12 18v-6M9.5 14.5 12 12l2.5 2.5"/>',
  'chevron-right': '<path d="m9 18 6-6-6-6"/>'
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
function parentPath(path = state.currentPath) { const parts = pathParts(path); parts.pop(); return parts.join('/'); }
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
  const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.className = 'file-checkbox'; checkbox.setAttribute('aria-label', `${file.name} 선택`);
  const name = document.createElement('span'); name.className = 'file-name'; name.title = file.name; name.append(svgIcon('file-up', 'file-icon'), document.createTextNode(file.name));
  const metadata = document.createElement('span'); metadata.className = 'file-meta'; metadata.textContent = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(file.createdAt));
  const size = document.createElement('span'); size.className = 'file-size'; size.textContent = formatSize(file.size);
  const actions = document.createElement('div'); actions.className = 'file-actions';
  const download = document.createElement('a'); download.className = 'download'; download.href = `/api/files/${encodeURIComponent(file.id)}/download`; download.textContent = '다운로드';
  const remove = document.createElement('button'); remove.className = 'delete-file'; remove.type = 'button'; remove.setAttribute('aria-label', `${file.name} 삭제`); remove.title = '삭제'; remove.append(svgIcon('trash'));
  remove.addEventListener('click', () => openFileDeleteDialog(file));
  actions.append(download, remove);
  row.append(checkbox, name, metadata, size, actions); return row;
}

function fileTableHeader() {
  const row = document.createElement('article'); row.className = 'file-row file-header'; row.setAttribute('role', 'row');
  const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.className = 'file-checkbox'; checkbox.disabled = true; checkbox.setAttribute('aria-label', '전체 파일 선택');
  const name = document.createElement('span'); name.textContent = '이름';
  const modified = document.createElement('span'); modified.textContent = '수정한 날짜';
  const size = document.createElement('span'); size.textContent = '크기';
  const actions = document.createElement('span'); actions.textContent = '작업';
  row.append(checkbox, name, modified, size, actions); return row;
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
  const type = svgIcon(entry.type === 'directory' ? 'folder' : 'file-up', 'v4-log-type');
  const name = document.createElement(entry.type === 'directory' ? 'button' : 'span'); name.className = `file-name${entry.type === 'directory' ? ' v4-log-folder' : ''}`; name.append(document.createTextNode(entry.name));
  if (entry.type === 'directory') { name.type = 'button'; name.addEventListener('click', () => loadV4Logs(entry.path)); }
  const metadata = document.createElement('span'); metadata.className = 'file-meta'; metadata.textContent = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(entry.modifiedAt));
  const size = document.createElement('span'); size.className = 'file-size'; size.textContent = entry.type === 'directory' ? '폴더' : formatSize(entry.size);
  const actions = document.createElement('div'); actions.className = 'file-actions';
  if (entry.type === 'directory') {
    const open = document.createElement('button'); open.className = 'log-open'; open.type = 'button'; open.textContent = '열기'; open.addEventListener('click', () => loadV4Logs(entry.path)); actions.append(open);
  } else {
    const download = document.createElement('a'); download.className = 'download'; download.href = `/api/v4-logs/download?${new URLSearchParams({ path: entry.path })}`; download.textContent = '다운로드'; actions.append(download);
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
  const open = document.createElement('button'); open.className = 'log-open'; open.type = 'button'; open.textContent = '열기'; open.addEventListener('click', () => loadV4Logs(parent));
  actions.append(open); row.append(type, name, metadata, size, actions); return row;
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
    renderBreadcrumbs(); await renderFileList({ animate });
    syncFolderTreeState();
    setStatus('');
  } catch (error) { setStatus(error.message, true); }
}

function setWorkspaceSection(section) {
  state.section = section;
  const isV4Log = section === 'v4log';
  $('#library-layout').hidden = isV4Log;
  $('#files-section').hidden = isV4Log;
  $('#upload-drop-zone').hidden = isV4Log;
  $('#v4-log-section').hidden = !isV4Log;
  $('#new-folder-button').hidden = isV4Log;
  $('#toolbar-upload').hidden = isV4Log;
  $('#up-button').hidden = isV4Log;
  $('#file-search').placeholder = isV4Log ? 'V4 로그 파일명으로 검색하세요.' : '파일명으로 검색하세요.';
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
  $('#delete-description').textContent = '하위 폴더와 파일도 함께 삭제되며 복구할 수 없습니다. 계속하려면 현재 비밀번호를 입력하세요.';
  $('#delete-password').value = ''; $('#delete-error').textContent = '';
  $('#delete-dialog').showModal();
}

function openFileDeleteDialog(file) {
  state.pendingDelete = { type: 'file', id: file.id, name: file.name };
  $('#delete-title').textContent = `“${file.name}” 파일을 삭제할까요?`;
  $('#delete-description').textContent = '암호화되어 저장된 파일이 영구 삭제되며 복구할 수 없습니다. 계속하려면 현재 비밀번호를 입력하세요.';
  $('#delete-password').value = ''; $('#delete-error').textContent = '';
  $('#delete-dialog').showModal();
}

async function uploadSelectedFiles(files) {
  const selectedFiles = [...(files ?? [])];
  if (!selectedFiles.length) return;
  const data = new FormData(); data.append('folderPath', state.currentPath); selectedFiles.forEach((file) => data.append('files', file));
  setStatus(selectedFiles.length === 1 ? `“${selectedFiles[0].name}” 암호화 후 업로드 중…` : `${selectedFiles.length}개 파일을 암호화 후 업로드 중…`);
  try {
    const result = await request('/api/files', { method: 'POST', body: data });
    await loadFolder(); await refreshStorageAfterMutation();
    setStatus(result.files.length === 1 ? '파일을 암호화하여 업로드했습니다.' : `${result.files.length}개 파일을 암호화하여 업로드했습니다.`);
  }
  catch (error) { setStatus(error.message, true); }
}

async function refreshStorageAfterMutation() {
  await loadStorage();
  // macOS WatchPaths starts the host collector asynchronously after Docker syncs the change.
  [700, 2_000].forEach((delay) => window.setTimeout(() => { void loadStorage(); }, delay));
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
$('#file-search').addEventListener('input', (event) => { state.query = event.target.value.trim(); if (state.section === 'v4log') renderV4LogList(); else renderFileList(); });
$('#file-input').addEventListener('change', async (event) => { await uploadSelectedFiles(event.target.files); event.target.value = ''; });

document.querySelectorAll('dialog button[value="cancel"]').forEach((button) => button.addEventListener('click', () => button.closest('dialog').close()));
document.querySelectorAll('.side-nav-item').forEach((button) => button.addEventListener('click', () => {
  if (button.dataset.nav === 'files') void showFiles();
  else if (button.dataset.nav === 'v4log') void showV4Logs();
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
      $('#delete-dialog').close(); await loadFolder(currentWasDeleted ? parentPath(pending.path) : state.currentPath); await loadFolderTree(); await refreshStorageAfterMutation(); setStatus('폴더와 그 안의 파일을 삭제했습니다.');
    } else {
      await request(`/api/files/${encodeURIComponent(pending.id)}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reauthenticationToken: confirmation.token }) });
      $('#delete-dialog').close(); await loadFolder(); await refreshStorageAfterMutation(); setStatus('파일을 삭제했습니다.');
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
