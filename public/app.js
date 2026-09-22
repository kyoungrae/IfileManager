const state = { user: null, currentPath: '', pendingDeletePath: '' };
const $ = (selector) => document.querySelector(selector);

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
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024; let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

function pathParts(path) { return path ? path.split('/') : []; }
function parentPath() { const parts = pathParts(state.currentPath); parts.pop(); return parts.join('/'); }

function renderBreadcrumbs() {
  const target = $('#breadcrumbs'); target.replaceChildren();
  const crumbs = [{ name: '저장소', path: '' }];
  pathParts(state.currentPath).forEach((name, index, parts) => crumbs.push({ name, path: parts.slice(0, index + 1).join('/') }));
  crumbs.forEach((crumb, index) => {
    if (index) target.append(' / ');
    const button = document.createElement('button'); button.className = 'crumb'; button.textContent = crumb.name;
    button.addEventListener('click', () => loadFolder(crumb.path)); target.append(button);
  });
  $('#up-button').disabled = !state.currentPath;
}

function folderCard(folder) {
  const card = document.createElement('article'); card.className = 'folder-card';
  const open = document.createElement('button'); open.className = 'folder-open'; open.title = folder.name;
  const icon = document.createElement('span'); icon.className = 'folder-icon'; icon.textContent = '▰';
  const name = document.createElement('span'); name.className = 'item-name'; name.textContent = folder.name;
  open.append(icon, name); open.addEventListener('click', () => loadFolder(folder.path));
  const remove = document.createElement('button'); remove.className = 'delete-folder'; remove.textContent = '삭제'; remove.addEventListener('click', () => openDeleteDialog(folder));
  card.append(open, remove); return card;
}

function fileRow(file) {
  const row = document.createElement('article'); row.className = 'file-row';
  const name = document.createElement('span'); name.className = 'file-name'; name.textContent = file.name; name.title = file.name;
  const metadata = document.createElement('span'); metadata.className = 'file-meta'; metadata.textContent = `${formatSize(file.size)} · ${new Date(file.createdAt).toLocaleDateString('ko-KR')}`;
  const download = document.createElement('a'); download.className = 'download'; download.href = `/api/files/${encodeURIComponent(file.id)}/download`; download.textContent = '다운로드';
  row.append(name, metadata, download); return row;
}

async function loadFolder(path = state.currentPath) {
  setStatus('불러오는 중…');
  try {
    const data = await request(`/api/folders?${new URLSearchParams({ path })}`, { headers: {} });
    state.currentPath = data.path;
    renderBreadcrumbs();
    const folders = $('#folder-list'); folders.replaceChildren(...data.folders.map(folderCard));
    if (!data.folders.length) folders.append(Object.assign(document.createElement('p'), { className: 'empty', textContent: '폴더가 없습니다.' }));
    const files = $('#file-list'); files.replaceChildren(...data.files.map(fileRow));
    if (!data.files.length) files.append(Object.assign(document.createElement('p'), { className: 'empty', textContent: '파일이 없습니다.' }));
    $('#folder-count').textContent = `${data.folders.length}개`;
    $('#file-count').textContent = `${data.files.length}개`;
    setStatus('');
  } catch (error) { setStatus(error.message, true); }
}

function openDeleteDialog(folder) {
  state.pendingDeletePath = folder.path;
  $('#delete-title').textContent = `“${folder.name}” 폴더를 삭제할까요?`;
  $('#delete-password').value = ''; $('#delete-error').textContent = '';
  $('#delete-dialog').showModal();
}

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
$('#new-folder-button').addEventListener('click', () => { $('#folder-form').reset(); $('#folder-error').textContent = ''; $('#folder-dialog').showModal(); });
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
    $('#delete-dialog').close(); await loadFolder(); setStatus('폴더와 그 안의 파일을 삭제했습니다.');
  } catch (error) { $('#delete-error').textContent = error.message; } finally { button.disabled = false; }
});
$('#file-input').addEventListener('change', async (event) => {
  const file = event.target.files?.[0]; if (!file) return;
  const data = new FormData(); data.append('folderPath', state.currentPath); data.append('file', file);
  setStatus(`“${file.name}” 암호화 후 업로드 중…`);
  try { await request('/api/files', { method: 'POST', body: data }); await loadFolder(); setStatus('파일을 암호화하여 업로드했습니다.'); }
  catch (error) { setStatus(error.message, true); }
  finally { event.target.value = ''; }
});

async function showApp() {
  $('#current-user').textContent = `${state.user.username} (${state.user.role})`;
  $('#login-panel').hidden = true; $('#app-panel').hidden = false; await loadFolder('');
}

try { const data = await request('/api/auth/me', { headers: {} }); state.user = data.user; showApp(); } catch { /* Login panel is intentional for anonymous visitors. */ }
