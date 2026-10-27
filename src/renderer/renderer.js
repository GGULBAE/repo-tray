'use strict';

(() => {
  const app = document.getElementById('app');
  const modalRoot = document.getElementById('modal-root');
  const toastRoot = document.getElementById('toast-root');
  const demo = new URLSearchParams(location.search).get('demo') === '1';
  const glyphs = {
    branch: '<path d="M6 3v12a3 3 0 1 0 3 3"/><circle cx="6" cy="3" r="2"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M18 8a7 7 0 0 1-7 7H6"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
    settings: '<path d="m9 3-.7 2.1-2 .9-2-.4-2 3.4 1.4 1.7v2.6L2.3 15l2 3.4 2-.4 2 .9L9 21h4l.7-2.1 2-.9 2 .4 2-3.4-1.4-1.7v-2.6L19.7 9l-2-3.4-2 .4-2-.9L13 3Z"/><circle cx="11" cy="12" r="3"/>',
    repo: '<path d="M5 3h13a1 1 0 0 1 1 1v17H6a3 3 0 0 1-3-3V5a2 2 0 0 1 2-2Z"/><path d="M3 17a3 3 0 0 1 3-3h13M8 7h6M8 10h4"/>',
    refresh: '<path d="M20 7a8 8 0 0 0-13-3L3 8m0-5v5h5M4 17a8 8 0 0 0 13 3l4-4m0 5v-5h-5"/>',
    download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    chevron: '<path d="m9 6 6 6-6 6"/>',
    down: '<path d="m7 10 5 5 5-5"/>',
    bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
    quiet: '<path d="M9 4a6 6 0 0 1 9 5c0 3 .5 5 2 7M6 7v2c0 6-3 6-3 8h14M10 21h4M3 3l18 18"/>',
    folder: '<path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/><path d="M3 9h18"/>',
    monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8m-4-4v4"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-9h.01"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    hide: '<path d="M4 15h16M7 6l5 5 5-5"/>',
    pause: '<path d="M8 5v14M16 5v14"/>',
    play: '<path d="m8 4 12 8-12 8Z"/>',
    alert: '<path d="m10.3 3.5-8 14A2 2 0 0 0 4 20h16a2 2 0 0 0 1.7-2.5l-8-14a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4m0 3h.01"/>',
    gitcommit: '<circle cx="12" cy="12" r="4"/><path d="M3 12h5m8 0h5"/>',
    trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
    external: '<path d="M14 3h7v7m0-7L10 14M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5"/>',
    shield: '<path d="M12 2 3 6v6c0 5 9 10 9 10s9-5 9-10V6Z"/><path d="m8 12 3 3 5-6"/>',
  };
  const icon = (name, cls = '') => `<svg viewBox="0 0 24 24" aria-hidden="true"${cls ? ` class="${cls}"` : ''}>${glyphs[name] || glyphs.repo}</svg>`;
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
  const numberLabel = (value) => num(value).toLocaleString('ko-KR');
  const dateValue = (value) => value ? new Date(value).getTime() : 0;
  const timeLabel = (value) => dateValue(value) ? new Date(value).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false }) : '아직 확인 전';
  const relative = (value) => {
    const timestamp = dateValue(value);
    if (!timestamp) return '아직 확인 전';
    const minutes = Math.floor(Math.max(0, Date.now() - timestamp) / 60000);
    return minutes < 1 ? '방금 확인' : minutes < 60 ? `${minutes}분 전 확인` : minutes < 1440 ? `${Math.floor(minutes / 60)}시간 전 확인` : `${Math.floor(minutes / 1440)}일 전 확인`;
  };
  const intervalLabel = (minutes) => num(minutes) % 1440 === 0 ? `${num(minutes) / 1440}일마다` : num(minutes) % 60 === 0 ? `${num(minutes) / 60}시간마다` : `${num(minutes)}분마다`;
  const presets = [60, 300, 1440];
  const settingsDefaults = { defaultIntervalMinutes: 60, launchAtLogin: true };
  let state = { repositories: [], settings: settingsDefaults, scan: { running: false, found: [], errors: [], scannedDirectories: 0 }, platform: '', gitAvailable: true, appVersion: '0.1.0' };
  let page = routePage();
  let search = '';
  let discoverySearch = '';
  let selectedPaths = new Set();
  const chosenGroupPaths = new Map();
  let modalId = null;
  let removeConfirm = false;
  let abortConfirm = false;
  let modalStrategy = 'merge';
  let modalInterval = null;
  let addInterval = '60';
  let defaultInterval = null;
  const intervalModes = new Map();
  let busy = new Set();
  let lastError = '';
  let toastTimer;
  let api = window.repoTray;

  function routePage() {
    const value = location.hash.replace(/^#/, '');
    return ['settings', 'discovery'].includes(value) ? value : 'overview';
  }
  function setPage(value) {
    page = value;
    modalId = null;
    lastError = '';
    location.hash = value;
    render();
  }
  function currentRepo() { return state.repositories.find((repo) => repo.id === modalId); }
  function repoState(repo) { return repo.state || {}; }
  function pathKey(value) {
    const raw = String(value || '');
    return state.platform === 'win32' ? raw.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase() : raw;
  }
  function repositoryGroupKey(repo) {
    const key = repo.groupKey || repo.state?.groupKey;
    return key ? `git:${pathKey(key)}` : `path:${pathKey(repo.path)}`;
  }
  function discoveryGroups() {
    const groups = new Map();
    const foundByPath = new Map();
    const monitoredByPath = new Map(state.repositories.map((repo) => [pathKey(repo.path), repo]));
    const selectedOrder = new Map([...selectedPaths].map((path, index) => [pathKey(path), index]));
    const rememberedPaths = new Set([...chosenGroupPaths.values()].map(pathKey));
    for (const repo of state.scan.found || []) {
      if (!repo || typeof repo.path !== 'string') continue;
      const monitored = monitoredByPath.get(pathKey(repo.path));
      const key = repositoryGroupKey(repo.groupKey || repo.state?.groupKey ? repo : monitored || repo);
      if (!groups.has(key)) groups.set(key, { key, members: [], monitored: [] });
      const group = groups.get(key);
      if (!group.members.some((member) => pathKey(member.path) === pathKey(repo.path))) group.members.push(repo);
      foundByPath.set(pathKey(repo.path), group);
    }
    for (const repo of state.repositories) {
      const group = groups.get(repositoryGroupKey(repo)) || foundByPath.get(pathKey(repo.path));
      if (!group) continue;
      group.monitored.push(repo);
      if (!group.members.some((member) => pathKey(member.path) === pathKey(repo.path))) {
        group.members.push({ ...repo, bare: false, registeredOnly: true });
      }
    }
    return [...groups.values()].map((group) => {
      const workFolders = group.members.filter((member) => !member.bare);
      const memberPaths = new Map(group.members.map((member) => [pathKey(member.path), member]));
      const checked = group.members.filter((member) => selectedOrder.has(pathKey(member.path)))
        .sort((a, b) => selectedOrder.get(pathKey(a.path)) - selectedOrder.get(pathKey(b.path)))[0];
      const remembered = memberPaths.get(pathKey(chosenGroupPaths.get(group.key)))
        || group.members.find((member) => rememberedPaths.has(pathKey(member.path)));
      const representative = group.monitored[0] || checked || remembered
        || workFolders.find((member) => !member.linkedWorktree) || workFolders[0] || group.members[0];
      // Remember the actual folder, so newly discovered worktrees cannot replace
      // a folder the user is looking at or has already selected.
      chosenGroupPaths.set(group.key, representative.path);
      const original = group.members.find((member) => !member.linkedWorktree && !member.bare);
      return {
        ...group, workFolders, representative,
        name: original?.name || group.monitored[0]?.name || representative.name,
        registered: group.monitored.length > 0,
        selectable: group.monitored.length === 0 && workFolders.length > 0,
      };
    });
  }
  function visibleDiscoveryGroups() {
    const query = discoverySearch.toLowerCase();
    return discoveryGroups().filter((group) => `${group.name} ${group.members.map((member) => `${member.name} ${member.path}`).join(' ')}`.toLowerCase().includes(query));
  }
  function reconcileDiscoverySelections() {
    const groups = discoveryGroups();
    const eligible = new Map();
    for (const group of groups) {
      if (group.selectable) group.workFolders.forEach((member) => eligible.set(pathKey(member.path), group));
    }
    const seenGroups = new Set();
    selectedPaths = new Set([...selectedPaths].filter((path) => {
      const group = eligible.get(pathKey(path));
      if (!group || seenGroups.has(group.key)) return false;
      seenGroups.add(group.key);
      chosenGroupPaths.set(group.key, path);
      return true;
    }));
  }
  function isPending(repo) {
    const git = repoState(repo);
    return !!repo.pending || num(git.behind) > 0 || !!git.operation || (git.conflicts || []).length > 0;
  }
  function repoStatus(repo) {
    const git = repoState(repo);
    if (repo.syncing) return { text: '동기화 중', tone: 'blue', icon: 'refresh', spinning: true, note: '완료될 때까지 기다려 주세요' };
    if (repo.checking) return { text: '확인 중', tone: 'blue', icon: 'refresh', spinning: true, note: '원격 변경을 확인합니다' };
    if (git.operation || (git.conflicts || []).length) return { text: '충돌 확인 필요', tone: 'red', icon: 'alert', note: `${(git.conflicts || []).length}개 파일 · ${git.operation || 'Git 작업'} 진행 중` };
    if (repo.error || git.error) return { text: '확인 필요', tone: 'amber', icon: 'alert', note: '상세 화면에서 확인하세요' };
    if (git.dirty && isPending(repo)) return { text: '작업 중 · 변경 있음', tone: 'amber', icon: 'pause', note: '로컬 변경을 정리한 뒤 동기화' };
    if (num(git.ahead) > 0 && num(git.behind) > 0) return { text: '병합 필요', tone: 'red', icon: 'branch', note: `받을 커밋 ${git.behind} · 보낼 커밋 ${git.ahead}` };
    if (num(git.behind) > 0) return { text: `업데이트 ${git.behind}개`, tone: 'red', icon: 'download', note: '새 커밋을 받을 수 있습니다' };
    if (repo.pending) return { text: '원격 변경 있음', tone: 'red', icon: 'branch', note: '브랜치 변경을 확인하세요' };
    if (repo.paused) return { text: '일시정지', tone: 'gray', icon: 'pause', note: '주기 확인을 멈췄습니다' };
    if (!repo.state) return { text: '확인 대기', tone: 'gray', icon: 'clock', note: '첫 원격 확인을 기다립니다' };
    if (!git.branch || git.branch === 'HEAD') return { text: '브랜치 선택 필요', tone: 'amber', icon: 'branch', note: '현재 브랜치를 확인하세요' };
    if (!git.upstream) return { text: '추적 브랜치 없음', tone: 'gray', icon: 'branch', note: 'Git에서 upstream을 설정하세요' };
    if (git.dirty) return { text: '로컬 작업 중', tone: 'gray', icon: 'gitcommit', note: '원격 변경 없음' };
    if (num(git.ahead) > 0) return { text: '로컬 커밋 있음', tone: 'blue', icon: 'gitcommit', note: `보낼 커밋 ${git.ahead}개` };
    return { text: '최신 상태', tone: 'green', icon: 'check', note: relative(repo.lastCheckedAt) };
  }
  function tag(status) { return `<span class="tag ${status.tone}">${icon(status.icon, status.spinning ? 'loading-spinner' : '')}${esc(status.text)}</span>`; }
  function attentionRepos() { return state.repositories.filter(isPending); }
  function nextCheck() {
    const next = state.repositories.filter((r) => !r.paused).map((r) => dateValue(r.nextCheckAt)).filter(Boolean).sort((a, b) => a - b)[0];
    if (!next) return { value: '—', unit: '', detail: state.repositories.length ? '저장소를 확인하면 예약됩니다' : '저장소를 등록해 주세요' };
    const minutes = Math.max(0, Math.ceil((next - Date.now()) / 60000));
    if (minutes < 1) return { value: '곧', unit: '', detail: '다음 원격 확인을 준비합니다' };
    return { value: minutes >= 60 ? String(Math.floor(minutes / 60)) : String(minutes), unit: minutes >= 60 ? '시간 후' : '분 후', detail: `다음 확인 ${timeLabel(next)}` };
  }
  function focusSnapshot() {
    const element = document.activeElement;
    if (!element || !element.dataset.focus) return null;
    return { key: element.dataset.focus, start: element.selectionStart, end: element.selectionEnd };
  }
  function ensureFocusKeys() {
    const counts = new Map();
    document.querySelectorAll('button, input, select, a').forEach((element) => {
      if (element.dataset.focus) return;
      const key = `${element.tagName}-${element.dataset.action || element.dataset.setting || element.name || 'control'}-${element.dataset.id || element.dataset.path || ''}`;
      const count = counts.get(key) || 0;
      counts.set(key, count + 1);
      element.dataset.focus = `auto-${key}-${count}`;
    });
  }
  function restoreFocus(snapshot) {
    if (!snapshot) return;
    const element = document.querySelector(`[data-focus="${CSS.escape(snapshot.key)}"]`);
    if (!element) return;
    element.focus({ preventScroll: true });
    if (typeof element.setSelectionRange === 'function' && snapshot.start !== null) {
      try { element.setSelectionRange(snapshot.start, snapshot.end); } catch (_) { /* Number inputs have no selection range. */ }
    }
  }
  function render() {
    const focus = focusSnapshot();
    const pending = attentionRepos().length;
    const checking = state.repositories.some((r) => r.checking || r.syncing);
    const titles = { overview: '저장소', discovery: '저장소 찾기', settings: '설정' };
    app.innerHTML = `${demo ? '<div class="demo-banner">미리보기 · 예시 데이터로 표시되는 화면입니다. 실제 저장소는 변경되지 않습니다.</div>' : ''}
      <div class="layout">
        <aside class="sidebar" aria-label="주 메뉴">
          <div class="brand"><span class="brand-mark">${icon('branch')}</span><span>Repo Tray</span></div>
          <div class="nav-label">WORKSPACE</div>
          <nav>${[['overview', 'grid', '저장소'], ['discovery', 'search', '저장소 찾기'], ['settings', 'settings', '설정']].map(([key, symbol, title]) => `<button class="nav-item ${page === key ? 'active' : ''}" data-page="${key}" data-focus="nav-${key}" title="${title}" ${page === key ? 'aria-current="page"' : ''}>${icon(symbol)}<span>${title}</span>${key === 'overview' && pending ? `<span class="nav-count">${pending}</span>` : ''}</button>`).join('')}</nav>
          <div class="sidebar-bottom"><div class="sidebar-note"><strong>${icon('quiet')} 조용한 동기화</strong>원격 변경은 트레이로 알려드려요.<br>받아올 준비가 되면 클릭하세요.</div><div class="version">REPO TRAY · ${esc(state.appVersion || '0.1.0')}</div></div>
        </aside>
        <main class="main"><header class="topbar"><div class="breadcrumb"><span>내 워크스페이스</span>${icon('chevron')}<span>${titles[page]}</span></div><div class="topbar-actions"><span class="live-status"><span class="status-dot ${pending ? 'red' : state.gitAvailable === false ? 'gray' : ''}"></span>${pending ? `변경 확인 대기 ${pending}개` : checking ? '원격 확인 중' : '백그라운드 확인'}</span><button class="icon-button" data-action="hide" title="트레이로 숨기기" aria-label="트레이로 숨기기">${icon('hide')}</button></div></header>
        <div class="main-content">${state.gitAvailable === false ? `<div class="app-error">${icon('alert')}<div><strong>Git을 찾을 수 없습니다.</strong><br>Git을 설치한 뒤 Repo Tray를 다시 실행해 주세요.</div><button class="button small" data-action="git-download">설치 안내 ${icon('external')}</button></div>` : ''}${state.startupError || state.storageWarnings?.length ? `<div class="app-error" role="alert">${icon('alert')}<div><strong>앱 설정을 확인해 주세요.</strong><br>${[state.startupError, ...(state.storageWarnings || [])].filter(Boolean).map((warning) => esc(typeof warning === 'string' ? warning : warning.message || String(warning))).join('<br>')}</div></div>` : ''}${lastError ? `<div class="app-error" role="alert">${icon('alert')}<span>${esc(lastError)}</span><button class="icon-button" data-action="dismiss-error" aria-label="오류 메시지 닫기">${icon('close')}</button></div>` : ''}${page === 'discovery' ? discoveryPage() : page === 'settings' ? settingsPage() : overviewPage()}</div></main>
      </div>`;
    renderModal();
    ensureFocusKeys();
    restoreFocus(focus);
  }

  function overviewPage() {
    const repos = state.repositories;
    const pending = attentionRepos().length;
    const next = nextCheck();
    const checking = busy.has('checkAll') || repos.some((r) => r.checking);
    const filtered = repos.filter((repo) => `${repo.name} ${repo.path} ${repoState(repo).branch || ''}`.toLowerCase().includes(search.toLowerCase()));
    return `<div class="page-heading"><div><p class="eyebrow">YOUR REPOSITORIES</p><h1>내 저장소</h1><p class="page-description">원격 변경을 확인하고, 준비되면 동기화하세요.</p></div><div class="heading-actions"><button class="button" data-action="check-all" ${!repos.length || checking ? 'disabled' : ''}>${icon('refresh', checking ? 'loading-spinner' : '')}${checking ? '확인 중' : '지금 확인'}</button><button class="button primary" data-page="discovery">${icon('plus')}저장소 추가</button></div></div>
      <div class="stats-grid"><div class="stat-card"><span class="stat-icon">${icon('repo')}</span><div class="stat-label">모니터링 저장소</div><div class="stat-value">${repos.length}<small>개</small></div><div class="stat-detail">${repos.filter((r) => !r.paused).length}개 확인 중${repos.some((r) => r.paused) ? ` · ${repos.filter((r) => r.paused).length}개 일시정지` : ''}</div></div><div class="stat-card ${pending ? 'attention' : ''}"><span class="stat-icon">${icon('download')}</span><div class="stat-label">업데이트 대기</div><div class="stat-value">${pending}<small>개 저장소</small></div><div class="stat-detail">${pending ? '변경 내역을 확인해 주세요' : '확인할 새 변경이 없습니다'}</div></div><div class="stat-card"><span class="stat-icon">${icon('clock')}</span><div class="stat-label">다음 확인</div><div class="stat-value">${next.value}<small>${next.unit}</small></div><div class="stat-detail">${next.detail}</div></div></div>
      ${pending ? `<div class="attention-banner">${icon('download')}<div><strong>${pending}개 저장소에 확인할 변경이 있어요.</strong><p>작업 파일은 그대로입니다. 내용을 확인한 뒤 동기화할 수 있어요.</p></div><button class="button small" data-action="open-first-pending">변경 확인 ${icon('chevron')}</button></div>` : ''}
      <section class="panel"><div class="panel-toolbar"><h2 class="panel-title">등록된 저장소 <span class="count-badge">${repos.length}</span></h2>${repos.length ? searchInput('repo-search', search, '이름, 경로, 브랜치 검색') : ''}</div>
      ${!repos.length ? `<div class="empty-state"><div class="empty-symbol">${icon('repo')}</div><h2>첫 저장소를 연결해 보세요</h2><p>PC에서 Git 저장소를 찾아 등록하면<br>원격 변경을 주기적으로 확인해 드립니다.</p><button class="button primary" data-page="discovery">${icon('search')}저장소 찾기</button></div>` : !filtered.length ? '<div class="empty-state compact"><p>검색 결과가 없습니다. 다른 이름이나 경로로 찾아보세요.</p></div>' : `<div class="table-scroll"><table class="repo-table"><thead><tr><th scope="col">저장소 / 브랜치</th><th scope="col">상태</th><th scope="col">확인 주기</th><th scope="col"><span class="sr-only">작업</span></th></tr></thead><tbody>${filtered.map(repoRow).join('')}</tbody></table></div>`}
      <div class="panel-footer"><span class="quiet-note">${icon('quiet')}팝업 알림 없이 트레이 아이콘으로 알려드립니다.</span><span>${state.platform === 'win32' ? 'Windows' : state.platform === 'darwin' ? 'macOS' : '이 PC'}에서 모니터링 중</span></div></section><p class="footer-hint">${icon('shield')}원격 확인은 작업 파일을 바꾸지 않습니다. 동기화는 선택한 저장소의 현재 추적 브랜치에 적용됩니다.</p>`;
  }
  function repoRow(repo) {
    const status = repoStatus(repo);
    const git = repoState(repo);
    const sameGroup = state.repositories.filter((item) => repositoryGroupKey(item) === repositoryGroupKey(repo)).length;
    return `<tr><td><div class="repo-name-line"><span class="repo-symbol">${icon('repo')}</span><div class="repo-main-text"><button class="repo-name-button" data-action="open-repo" data-id="${esc(repo.id)}" data-focus="repo-${esc(repo.id)}">${esc(repo.name || repo.path.split(/[\\/]/).pop())}</button><div class="repo-path" title="${esc(repo.path)}">${esc(repo.path)}</div>${sameGroup > 1 ? `<div class="same-group-note">같은 저장소 · ${sameGroup}개 작업 폴더 등록</div>` : ''}</div></div><div class="repo-meta">${icon('branch')}<span class="branch" title="${esc(git.branch || '')}">${esc(git.branch || '브랜치 확인 전')}</span>${git.upstream ? `<span class="divider">·</span><span title="${esc(git.upstream)}">${esc(git.remote || 'origin')}</span>` : ''}</div></td><td>${tag(status)}<span class="cell-note">${esc(status.note)}</span></td><td><button class="interval-button" data-action="open-repo" data-id="${esc(repo.id)}" title="확인 주기 변경">${icon('clock')}${intervalLabel(repo.intervalMinutes || 60)}</button><span class="cell-note">${repo.paused ? '일시정지' : relative(repo.lastCheckedAt)}</span></td><td class="row-action"><button class="button small ${isPending(repo) ? 'danger' : ''}" data-action="open-repo" data-id="${esc(repo.id)}">${isPending(repo) ? '변경 확인' : '상세'}${icon('chevron')}</button></td></tr>`;
  }
  function searchInput(id, value, placeholder) { return `<label class="search-box"><span class="sr-only">${placeholder}</span>${icon('search')}<input type="search" data-input="${id}" data-focus="${id}" value="${esc(value)}" placeholder="${placeholder}" autocomplete="off" spellcheck="false"></label>`; }
  function discoveryPage() {
    const scan = state.scan;
    const groups = discoveryGroups();
    const filtered = visibleDiscoveryGroups();
    const selectable = filtered.filter((group) => group.selectable);
    const allSelected = selectable.length > 0 && selectable.every((group) => selectedPaths.has(group.representative.path));
    const errors = Array.isArray(scan.errors) ? scan.errors.length : num(scan.errors);
    const denied = Array.isArray(scan.deniedPaths) ? scan.deniedPaths.length : num(scan.deniedPaths);
    const skipped = num(scan.skippedCount);
    return `<div class="page-heading"><div><p class="eyebrow">DISCOVER REPOSITORIES</p><h1>저장소 찾기</h1><p class="page-description">이 PC의 Git 저장소를 찾아 모니터링에 등록하세요.</p></div></div>
      <div class="scan-card">${icon('monitor')}<div><h2>${scan.running ? 'Git 저장소를 찾고 있어요' : '필요한 폴더에서, 조용하게 찾기'}</h2><p>직접 만들거나 clone한 프로젝트를 찾습니다. Homebrew 등 설치 도구·패키지 캐시는 제외합니다.<br>문서(Documents), 바탕 화면(Desktop), 외장 드라이브의 저장소는 <strong>폴더 선택</strong>으로 직접 지정해 주세요.</p><div class="scan-actions">${scan.running ? `<button class="button" data-action="cancel-scan">${icon('close')}검색 중지</button>` : `<button class="button primary" data-action="scan-full" ${busy.has('scan') ? 'disabled' : ''}>${icon('search')}기본 폴더에서 찾기</button><button class="button" data-action="scan-folder" ${busy.has('scan') ? 'disabled' : ''}>${icon('folder')}폴더 선택</button>`}</div><div class="scan-stats">${scan.running ? '<span class="scan-dot"></span>' : ''}${numberLabel(scan.scannedDirectories)}개 폴더 확인 · ${groups.length}개 저장소 발견${skipped ? ` · ${numberLabel(skipped)}개 폴더 제외` : ''}${denied ? ` · 접근 불가 ${numberLabel(denied)}개` : errors ? ` · 탐색 오류 ${numberLabel(errors)}개` : ''}${scan.cancelled ? ' · 검색 중지됨' : ''}</div>${denied ? '<p class="scan-access-note">접근할 수 없는 폴더는 다시 묻지 않고 건너뛰었습니다. 필요한 저장소의 폴더를 직접 선택해 주세요.</p>' : ''}</div></div>
      <section class="panel"><div class="panel-toolbar"><h2 class="panel-title">발견한 저장소 <span class="count-badge">${groups.length}</span></h2>${groups.length ? searchInput('discovery-search', discoverySearch, '이름 또는 경로 검색') : ''}</div>
      ${!groups.length ? `<div class="empty-state"><div class="empty-symbol">${icon(scan.running ? 'search' : 'folder')}</div><h2>${scan.running ? '폴더를 살펴보고 있습니다' : '검색한 저장소가 여기에 표시됩니다'}</h2><p>${scan.running ? '발견하는 순서대로 목록에 나타납니다.' : '기본 폴더 탐색 또는 폴더 선택으로 시작하세요.'}</p></div>` : !filtered.length ? '<div class="empty-state compact"><p>검색 결과가 없습니다.</p></div>' : `<div class="table-scroll"><table class="repo-table discovery-table"><thead><tr><th><input class="checkbox" type="checkbox" data-action="select-all" aria-label="검색 결과에서 등록 가능한 저장소 모두 선택" ${allSelected ? 'checked' : ''} ${!selectable.length ? 'disabled' : ''}></th><th scope="col">저장소 / 작업 폴더</th><th scope="col">종류</th><th scope="col">상태</th></tr></thead><tbody>${filtered.map(discoveryGroupRow).join('')}</tbody></table></div>`}
      ${groups.length ? `<div class="selection-toolbar"><span class="selection-count">${selectedPaths.size}개 선택됨</span><div class="inline-actions">${intervalEditor('add-interval', addInterval)}<button class="button primary" data-action="add-selected" ${!selectedPaths.size || busy.has('add') ? 'disabled' : ''}>${icon('plus')}${busy.has('add') ? '등록 중' : '모니터링에 추가'}</button></div></div>` : ''}</section><p class="footer-hint">${icon('info')}같은 저장소의 워크트리는 한 행으로 표시합니다. 사용할 작업 폴더를 선택하면 해당 경로만 모니터링합니다.</p>`;
  }
  function discoveryGroupRow(group) {
    const repo = group.representative;
    const folders = group.workFolders;
    const multipleFolders = folders.length > 1;
    const knownName = group.name || repo.path.split(/[\\/]/).pop();
    return `<tr data-repository-group="${esc(group.key)}"><td><input class="checkbox" type="checkbox" data-action="select-path" data-group="${esc(group.key)}" data-path="${esc(repo.path)}" data-focus="group-check-${esc(group.key)}" aria-label="${esc(knownName)} 선택" ${selectedPaths.has(repo.path) ? 'checked' : ''} ${!group.selectable || busy.has('add') ? 'disabled' : ''}></td><td><div class="discovery-name-line"><span class="repo-name-button">${esc(knownName)}</span>${folders.length ? `<span class="worktree-count">작업 폴더 ${folders.length}개</span>` : ''}</div>${multipleFolders ? `<label class="worktree-picker"><span class="sr-only">${esc(knownName)} 작업 폴더</span><select class="form-select worktree-select" data-select="worktree-path" data-group="${esc(group.key)}" data-focus="worktree-${esc(group.key)}" title="${esc(repo.path)}" ${group.registered || busy.has('add') ? 'disabled' : ''}>${folders.map((folder) => `<option value="${esc(folder.path)}" ${pathKey(folder.path) === pathKey(repo.path) ? 'selected' : ''}>${group.monitored.some((item) => pathKey(item.path) === pathKey(folder.path)) ? '[등록됨] ' : folder.linkedWorktree ? '[워크트리] ' : '[기본] '}${esc(folder.path)}</option>`).join('')}</select></label>` : `<div class="repo-path" title="${esc(repo.path)}">${esc(repo.path)}</div>`}${group.monitored.length > 1 ? `<span class="cell-note">기존에 등록된 ${group.monitored.length}개 작업 폴더는 내 저장소에서 각각 관리합니다.</span>` : ''}</td><td><span class="tag gray">${folders.length ? multipleFolders || repo.linkedWorktree ? '워크트리 포함' : 'Git 저장소' : 'Bare 저장소'}</span></td><td>${group.registered ? '<span class="tag green">등록됨</span>' : !folders.length ? '<span class="muted">작업 폴더 없음</span>' : '<span class="muted">미등록</span>'}</td></tr>`;
  }
  function intervalEditor(id, value) {
    const actual = num(value) || 60;
    const custom = intervalModes.has(id) ? intervalModes.get(id) : !presets.includes(actual);
    return `<div class="interval-editor"><label class="sr-only" for="${id}">확인 주기</label><select id="${id}" class="form-select" data-select="${id}" data-focus="${id}"><option value="60" ${actual === 60 ? 'selected' : ''}>1시간마다</option><option value="300" ${actual === 300 ? 'selected' : ''}>5시간마다</option><option value="1440" ${actual === 1440 ? 'selected' : ''}>1일마다</option><option value="custom" ${custom ? 'selected' : ''}>직접 입력</option></select>${custom ? `<input class="form-input" type="number" min="1" max="10080" step="1" data-input="${id}-custom" data-focus="${id}-custom" value="${esc(value)}" aria-label="확인 주기 (분)"><span class="unit">분마다</span>` : ''}</div>`;
  }
  function settingsPage() {
    const settings = state.settings;
    const development = state.isPackaged === false;
    return `<div class="page-heading"><div><p class="eyebrow">PREFERENCES</p><h1>설정</h1><p class="page-description">내 작업 흐름에 맞게 Repo Tray를 설정하세요.</p></div></div>
      <section class="panel settings-panel"><div class="section-heading"><h2>실행 및 확인 주기</h2><p>앱은 트레이에 상주하며 등록한 저장소의 원격 변경을 확인합니다.</p></div><div class="setting-row"><div><div class="setting-title">로그인할 때 자동 실행</div><p class="setting-description">${development ? '설치된 앱에서 사용할 수 있습니다. 개발 실행 중에는 자동 실행을 등록하지 않습니다.' : 'PC를 켜면 트레이에서 조용히 시작합니다.'}</p></div><label class="switch"><input type="checkbox" data-setting="launchAtLogin" aria-label="로그인할 때 자동 실행" ${settings.launchAtLogin ? 'checked' : ''} ${development || busy.has('settings') ? 'disabled' : ''}><span class="switch-track"></span></label></div><div class="setting-row"><div><div class="setting-title">새 저장소의 기본 확인 주기</div><p class="setting-description">등록된 저장소의 주기는 상세 화면에서 각각 변경할 수 있습니다.</p></div><div class="inline-actions">${intervalEditor('default-interval', defaultInterval ?? String(settings.defaultIntervalMinutes || 60))}<button class="button small" data-action="save-default" ${busy.has('settings') ? 'disabled' : ''}>저장</button></div></div></section>
      <section class="panel settings-panel"><div class="section-heading"><h2>변경을 알려드리는 방식</h2><p>작업에 집중할 수 있도록 알림은 조용하게 유지합니다.</p></div><div class="setting-row"><div><div class="setting-title">트레이 아이콘으로 표시</div><p class="setting-description">원격 변경이 발견되면 트레이 아이콘이 빨간색으로 바뀝니다.<br>아이콘을 클릭하면 변경 내역과 동기화 버튼이 표시됩니다.</p></div><span class="tag red"><span class="status-dot red"></span>변경 확인 대기</span></div><div class="settings-info"><strong>동기화는 버튼을 눌렀을 때만 실행합니다.</strong><br>로컬 작업이 있으면 먼저 정리할 수 있도록 안내합니다. 병합이나 리베이스가 필요한 경우 방법을 직접 선택할 수 있습니다.</div></section>
      <section class="panel"><div class="setting-row"><div class="settings-about"><span class="brand-mark">${icon('branch')}</span><div><h3>Repo Tray</h3><p>버전 ${esc(state.appVersion || '0.1.0')} · ${state.platform === 'win32' ? 'Windows' : state.platform === 'darwin' ? 'macOS' : 'Desktop'}${demo ? ' · 미리보기' : ''}</p></div></div><span class="tag ${state.gitAvailable === false ? 'amber' : 'green'}">${icon(state.gitAvailable === false ? 'alert' : 'check')}${state.gitAvailable === false ? 'Git 설치 필요' : 'Git 사용 가능'}</span></div></section>`;
  }

  function openRepo(id) {
    modalId = id;
    const repo = currentRepo();
    if (!repo) { modalId = null; return; }
    modalInterval = String(repo.intervalMinutes || 60);
    intervalModes.set('repo-interval', !presets.includes(num(modalInterval)));
    modalStrategy = 'merge';
    removeConfirm = false;
    abortConfirm = false;
    renderModal();
    document.getElementById('repo-modal-title')?.focus();
  }
  function closeModal() {
    const id = modalId;
    modalId = null;
    removeConfirm = false;
    abortConfirm = false;
    modalRoot.innerHTML = '';
    document.querySelector(`[data-focus="repo-${CSS.escape(id || '')}"]`)?.focus();
  }
  function renderModal() {
    const focus = focusSnapshot();
    if (!modalId) { modalRoot.innerHTML = ''; return; }
    const repo = currentRepo();
    if (!repo) { modalId = null; modalRoot.innerHTML = ''; return; }
    const git = repoState(repo);
    const pending = isPending(repo);
    const divergent = num(git.ahead) > 0 && num(git.behind) > 0;
    const working = !!repo.syncing || busy.has(`sync-${repo.id}`) || busy.has(`abort-${repo.id}`);
    const checkBusy = !!repo.checking || busy.has(`check-${repo.id}`);
    const operation = git.operation;
    const hasBehind = num(git.behind) > 0;
    const canSync = hasBehind && !git.dirty && !operation && !(git.conflicts || []).length && !!git.upstream && !!git.branch && git.branch !== 'HEAD' && !working && !checkBusy;
    const commits = git.incomingCommits || [];
    const errorText = repo.error || git.error;
    const changed = git.changedFiles || [];
    const remoteOnly = repo.pending && !hasBehind && !operation && !(git.conflicts || []).length;
    let banner = '';
    if (operation || (git.conflicts || []).length) banner = `<div class="detail-banner red">${icon('alert')}<div><strong>${esc(operation === 'rebase' ? '리베이스' : operation === 'merge' ? '병합' : 'Git 작업')}가 진행 중입니다.</strong>충돌한 파일을 편집기에서 정리하고 Git 작업을 마무리해 주세요.${['merge', 'rebase'].includes(operation) ? ' 시작 전 상태로 돌아가려면 아래 중단 버튼을 사용하세요.' : ''}</div></div>`;
    else if (git.dirty) banner = `<div class="detail-banner amber">${icon('pause')}<div><strong>이 저장소에서 수정 중인 파일이 있어요.</strong>변경 내용을 커밋하거나 별도로 보관한 뒤 다시 확인해 주세요. 정리되면 동기화할 수 있습니다.</div></div>`;
    else if (divergent) banner = `<div class="detail-banner amber">${icon('branch')}<div><strong>로컬과 원격에 서로 다른 커밋이 있습니다.</strong>원격 ${num(git.behind)}개, 로컬 ${num(git.ahead)}개 커밋을 합칠 방법을 선택해 주세요.</div></div>`;
    else if (hasBehind) banner = `<div class="detail-banner green">${icon('download')}<div><strong>원격의 새 커밋 ${num(git.behind)}개를 받을 수 있어요.</strong>${esc(git.upstream)}의 변경을 현재 ${esc(git.branch)} 브랜치에 반영합니다.</div></div>`;
    else if (remoteOnly) banner = `<div class="detail-banner gray">${icon('branch')}<div><strong>원격 브랜치에 변경이 발견되었습니다.</strong>현재 브랜치에 받을 커밋은 없습니다. 다른 브랜치로 이동하려면 사용 중인 Git 도구에서 선택해 주세요.</div></div>`;
    else if (!git.upstream) banner = `<div class="detail-banner gray">${icon('branch')}<div><strong>현재 브랜치의 추적 대상이 없습니다.</strong>사용 중인 Git 도구에서 upstream을 설정한 뒤 다시 확인해 주세요.</div></div>`;
    else banner = `<div class="detail-banner green">${icon('check')}<div><strong>현재 브랜치에 받을 변경이 없습니다.</strong>${num(git.ahead) > 0 ? `원격에 보내지 않은 로컬 커밋 ${num(git.ahead)}개가 있습니다.` : '다음 확인 시간에 원격 변경을 다시 살펴봅니다.'}</div></div>`;
    modalRoot.innerHTML = `<div class="modal-backdrop" data-action="backdrop"><section class="modal wide" role="dialog" aria-modal="true" aria-labelledby="repo-modal-title" tabindex="-1"><header class="modal-header"><div><h2 class="modal-title" id="repo-modal-title" tabindex="-1">${esc(repo.name)}</h2><p class="modal-path">${esc(repo.path)}</p></div><button class="icon-button" data-action="close-modal" data-focus="close-modal" title="닫기" aria-label="상세 화면 닫기">${icon('close')}</button></header><div class="modal-body"><div class="detail-summary"><div class="detail-branch">${icon('branch')}<code>${esc(git.branch || '브랜치 확인 전')}</code>${git.upstream ? `${icon('chevron')}<code>${esc(git.upstream)}</code>` : ''}</div>${tag(repoStatus(repo))}</div>
      ${errorText ? `<div class="detail-banner red" role="alert">${icon('alert')}<div><strong>Git 작업을 완료하지 못했습니다.</strong>${esc(errorText)}</div></div>` : ''}${banner}
      ${(git.conflicts || []).length ? `<div class="detail-label">충돌한 파일 <span class="count-badge">${git.conflicts.length}</span></div><div class="file-list">${git.conflicts.map((file) => `<div class="file-item">${esc(typeof file === 'string' ? file : file.path)}</div>`).join('')}</div>` : ''}
      ${git.dirty && changed.length ? `<div class="detail-label">로컬 변경 <span class="count-badge">${changed.length}</span></div><div class="file-list">${changed.slice(0, 30).map((file) => `<div class="file-item">${esc(file.status || 'M')} &nbsp; ${esc(file.path || file)}</div>`).join('')}${changed.length > 30 ? `<div class="file-item">외 ${changed.length - 30}개</div>` : ''}</div>` : ''}
      ${hasBehind || commits.length ? `<div class="detail-label">받아올 커밋 <span class="count-badge">${num(git.behind) || commits.length}</span></div><div class="commit-list">${commits.length ? commits.map((commit) => `<div class="commit-row">${icon('gitcommit')}<span>${esc(commit.subject || commit.message || '(메시지 없음)')}</span><code>${esc((commit.hash || '').slice(0, 7))}</code></div>`).join('') : '<div class="commit-row"><span>커밋 내용을 불러오려면 원격을 다시 확인해 주세요.</span></div>'}${num(git.behind) > commits.length && commits.length ? `<div class="commit-row"><span class="muted">외 ${num(git.behind) - commits.length}개 커밋</span></div>` : ''}</div>` : ''}
      ${remoteOnly && (git.remoteBranches || []).length ? `<div class="detail-label">원격 브랜치</div><div class="commit-list">${git.remoteBranches.slice(0, 30).map((branch) => `<div class="commit-row">${icon('branch')}<span>${esc(branch.name || branch)}</span><code>${esc((branch.hash || '').slice(0, 7))}</code></div>`).join('')}</div>` : ''}
      ${divergent && !operation ? `<div class="detail-label">변경을 합치는 방법</div><div class="sync-options"><label class="sync-option ${modalStrategy === 'merge' ? 'selected' : ''}"><input type="radio" name="strategy" value="merge" data-focus="strategy-merge" ${modalStrategy === 'merge' ? 'checked' : ''}><span><strong>병합 (Merge)</strong><small>기존 커밋 이력을 유지하고<br>병합 커밋을 만듭니다.</small></span></label><label class="sync-option ${modalStrategy === 'rebase' ? 'selected' : ''}"><input type="radio" name="strategy" value="rebase" data-focus="strategy-rebase" ${modalStrategy === 'rebase' ? 'checked' : ''}><span><strong>리베이스 (Rebase)</strong><small>로컬 커밋을 원격 변경 뒤에<br>다시 적용합니다.</small></span></label></div>` : ''}
      <div class="detail-settings"><span class="detail-label">확인 주기</span><div class="inline-actions">${intervalEditor('repo-interval', modalInterval || String(repo.intervalMinutes || 60))}<button class="button small" data-action="save-repo-interval" ${busy.has('update') ? 'disabled' : ''}>적용</button></div></div><div class="detail-actions"><button class="button link" data-action="open-folder">${icon('folder')}폴더 열기</button><button class="button link" data-action="toggle-pause">${icon(repo.paused ? 'play' : 'pause')}${repo.paused ? '모니터링 재개' : '모니터링 일시정지'}</button><button class="button link danger-link" data-action="ask-remove">${icon('trash')}목록에서 제거</button></div>${removeConfirm ? `<div class="remove-confirm"><span>모니터링 목록에서 제거할까요?<br>저장소 파일은 그대로 유지됩니다.</span><div class="inline-actions"><button class="button small" data-action="cancel-remove">취소</button><button class="button small danger" data-action="remove-repo">제거</button></div></div>` : ''}${abortConfirm && ['merge', 'rebase'].includes(operation) ? `<div class="remove-confirm"><span>${operation === 'merge' ? '병합' : '리베이스'}를 중단하고 시작 전 상태로 돌아갈까요?<br>이 작업 중에 진행한 충돌 해결 내용은 되돌아갈 수 있습니다.</span><div class="inline-actions"><button class="button small" data-action="cancel-abort">계속 작업</button><button class="button small danger" data-action="confirm-abort" ${working ? 'disabled' : ''}>중단하기</button></div></div>` : ''}</div>
      <footer class="modal-footer"><span class="cell-note">${relative(repo.lastCheckedAt)}${repo.paused ? ' · 일시정지' : ''}</span><div class="right">${['merge', 'rebase'].includes(operation) ? `<button class="button danger" data-action="abort-operation" ${working ? 'disabled' : ''}>${operation === 'merge' ? '병합' : '리베이스'} 중단</button>` : ''}<button class="button" data-action="check-repo" ${working || checkBusy ? 'disabled' : ''}>${icon('refresh', checkBusy ? 'loading-spinner' : '')}다시 확인</button>${remoteOnly ? `<button class="button primary" data-action="acknowledge" ${working ? 'disabled' : ''}>${icon('check')}확인했어요</button>` : `<button class="button primary" data-action="sync-repo" ${!canSync ? 'disabled' : ''}>${icon(working ? 'refresh' : 'download', working ? 'loading-spinner' : '')}${working ? '처리 중' : divergent ? (modalStrategy === 'rebase' ? '리베이스로 동기화' : '병합하여 동기화') : '동기화'}</button>`}</div></footer></section></div>`;
    ensureFocusKeys();
    restoreFocus(focus);
  }
  function notify(message, error = false) {
    clearTimeout(toastTimer);
    toastRoot.innerHTML = `<div class="toast ${error ? 'error' : ''}" role="${error ? 'alert' : 'status'}">${icon(error ? 'alert' : 'check')}<span>${esc(message)}</span></div>`;
    toastTimer = setTimeout(() => { toastRoot.innerHTML = ''; }, error ? 7000 : 3500);
  }
  function normalizeState(value) {
    if (!value || !Array.isArray(value.repositories)) return;
    state = { ...state, ...value, repositories: value.repositories, settings: { ...settingsDefaults, ...value.settings }, scan: { running: false, found: [], errors: [], deniedPaths: [], skippedCount: 0, scannedDirectories: 0, ...value.scan } };
    reconcileDiscoverySelections();
  }
  async function perform(key, fn, success) {
    if (busy.has(key)) return;
    busy.add(key);
    lastError = '';
    render();
    try {
      const result = await fn();
      if (result && result.ok === false) throw new Error(result.error || '작업을 완료하지 못했습니다.');
      if (result && Array.isArray(result.repositories)) normalizeState(result);
      else normalizeState(await api.getState());
      if (success) notify(success);
      return result;
    } catch (error) {
      lastError = error?.message || String(error);
      notify(lastError, true);
    } finally {
      busy.delete(key);
      render();
    }
  }
  function validInterval(value) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 10080) throw new Error('확인 주기는 1~10,080분 사이의 정수로 입력해 주세요.');
    return parsed;
  }

  document.addEventListener('click', async (event) => {
    const navigation = event.target.closest('[data-page]');
    if (navigation) { setPage(navigation.dataset.page); return; }
    const button = event.target.closest('[data-action]');
    if (!button || button.disabled) return;
    const action = button.dataset.action;
    const repo = currentRepo();
    try {
      if (action === 'open-repo') openRepo(button.dataset.id);
      else if (action === 'open-first-pending') openRepo(attentionRepos()[0]?.id);
      else if (action === 'close-modal' || (action === 'backdrop' && event.target === button)) closeModal();
      else if (action === 'hide') await api.hideWindow();
      else if (action === 'dismiss-error') { lastError = ''; render(); }
      else if (action === 'git-download') await api.openExternal({ url: 'https://git-scm.com/downloads' });
      else if (action === 'check-all') await perform('checkAll', () => api.checkNow({}));
      else if (action === 'scan-full' || action === 'scan-folder') {
        selectedPaths.clear();
        await perform('scan', () => api.scan({ mode: action === 'scan-full' ? 'full' : 'folder' }));
      } else if (action === 'cancel-scan') await perform('cancelScan', () => api.cancelScan());
      else if (action === 'select-path') {
        const group = discoveryGroups().find((item) => item.key === button.dataset.group);
        const member = group?.workFolders.find((item) => pathKey(item.path) === pathKey(button.dataset.path));
        if (!group?.selectable || !member || busy.has('add')) return;
        const paths = new Set(group.members.map((item) => pathKey(item.path)));
        selectedPaths = new Set([...selectedPaths].filter((path) => !paths.has(pathKey(path))));
        chosenGroupPaths.set(group.key, member.path);
        if (button.checked) selectedPaths.add(member.path);
        render();
      } else if (action === 'select-all') {
        if (busy.has('add')) return;
        for (const group of visibleDiscoveryGroups().filter((item) => item.selectable)) {
          const paths = new Set(group.members.map((item) => pathKey(item.path)));
          selectedPaths = new Set([...selectedPaths].filter((path) => !paths.has(pathKey(path))));
          if (button.checked) selectedPaths.add(group.representative.path);
        }
        render();
      } else if (action === 'add-selected') {
        const intervalMinutes = validInterval(addInterval);
        const paths = [...selectedPaths];
        const groups = discoveryGroups();
        const eligiblePaths = new Set(groups.filter((group) => group.selectable).flatMap((group) => group.workFolders.map((member) => member.path)));
        if (!paths.length || paths.some((path) => !eligiblePaths.has(path))) throw new Error('저장소 목록이 변경되었습니다. 사용할 작업 폴더를 다시 선택해 주세요.');
        await perform('add', () => api.addRepositories({ paths, intervalMinutes }), '선택한 저장소를 등록했습니다.');
      } else if (action === 'save-default') {
        const defaultIntervalMinutes = validInterval(defaultInterval ?? state.settings.defaultIntervalMinutes);
        await perform('settings', () => api.setSettings({ defaultIntervalMinutes }), '기본 확인 주기를 저장했습니다.');
        defaultInterval = null;
      } else if (action === 'check-repo' && repo) await perform(`check-${repo.id}`, () => api.checkNow({ id: repo.id }));
      else if (action === 'sync-repo' && repo) {
        const git = repoState(repo);
        const strategy = num(git.ahead) > 0 && num(git.behind) > 0 ? modalStrategy : 'ff-only';
        await perform(`sync-${repo.id}`, () => api.syncRepository({ id: repo.id, strategy }), '동기화 작업이 완료되었습니다.');
      } else if (action === 'abort-operation' && repo) { abortConfirm = true; renderModal(); }
      else if (action === 'cancel-abort') { abortConfirm = false; renderModal(); }
      else if (action === 'confirm-abort' && repo) {
        await perform(`abort-${repo.id}`, () => api.abortOperation({ id: repo.id }), '진행 중인 Git 작업을 중단했습니다.');
        abortConfirm = false;
        renderModal();
      }
      else if (action === 'acknowledge' && repo) await perform('acknowledge', () => api.acknowledge({ id: repo.id }), '원격 변경을 확인했습니다.');
      else if (action === 'open-folder' && repo) await api.openFolder({ id: repo.id });
      else if (action === 'save-repo-interval' && repo) {
        const intervalMinutes = validInterval(modalInterval);
        await perform('update', () => api.updateRepository({ id: repo.id, intervalMinutes }), '확인 주기를 변경했습니다.');
      } else if (action === 'toggle-pause' && repo) await perform('update', () => api.updateRepository({ id: repo.id, paused: !repo.paused }), repo.paused ? '모니터링을 다시 시작했습니다.' : '모니터링을 일시정지했습니다.');
      else if (action === 'ask-remove') { removeConfirm = true; renderModal(); }
      else if (action === 'cancel-remove') { removeConfirm = false; renderModal(); }
      else if (action === 'remove-repo' && repo) {
        await perform('remove', () => api.removeRepository({ id: repo.id }), '모니터링 목록에서 제거했습니다.');
        if (!state.repositories.some((r) => r.id === repo.id)) closeModal();
      }
    } catch (error) { notify(error?.message || String(error), true); }
  });
  document.addEventListener('input', (event) => {
    const key = event.target.dataset.input;
    if (key === 'repo-search') { search = event.target.value; render(); }
    if (key === 'discovery-search') { discoverySearch = event.target.value; render(); }
    if (key === 'add-interval-custom') addInterval = event.target.value;
    if (key === 'default-interval-custom') defaultInterval = event.target.value;
    if (key === 'repo-interval-custom') modalInterval = event.target.value;
  });
  document.addEventListener('change', async (event) => {
    const select = event.target.dataset.select;
    if (select === 'worktree-path') {
      const group = discoveryGroups().find((item) => item.key === event.target.dataset.group);
      const member = group?.workFolders.find((item) => item.path === event.target.value);
      if (!group?.selectable || !member || busy.has('add')) return;
      const memberPaths = new Set(group.members.map((item) => pathKey(item.path)));
      const wasSelected = [...selectedPaths].some((path) => memberPaths.has(pathKey(path)));
      selectedPaths = new Set([...selectedPaths].filter((path) => !memberPaths.has(pathKey(path))));
      chosenGroupPaths.set(group.key, member.path);
      if (wasSelected) selectedPaths.add(member.path);
      render();
      return;
    }
    const value = event.target.value === 'custom' ? '30' : event.target.value;
    if (select) intervalModes.set(select, event.target.value === 'custom');
    if (select === 'add-interval') { addInterval = value; render(); }
    if (select === 'default-interval') { defaultInterval = value; render(); }
    if (select === 'repo-interval') { modalInterval = value; renderModal(); }
    if (event.target.name === 'strategy') { modalStrategy = event.target.value; renderModal(); }
    if (event.target.dataset.setting === 'launchAtLogin') await perform('settings', () => api.setSettings({ launchAtLogin: event.target.checked }), '자동 실행 설정을 저장했습니다.');
  });
  document.addEventListener('keydown', (event) => {
    if (!modalId) return;
    if (event.key === 'Escape') { event.preventDefault(); closeModal(); }
    if (event.key === 'Tab') {
      const elements = [...modalRoot.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]')].filter((node) => node.offsetParent !== null);
      if (!elements.length) return;
      const first = elements[0], last = elements[elements.length - 1];
      if (event.shiftKey && (document.activeElement === first || !elements.includes(document.activeElement))) { last.focus(); event.preventDefault(); }
      else if (!event.shiftKey && (document.activeElement === last || !elements.includes(document.activeElement))) { first.focus(); event.preventDefault(); }
    }
  });
  window.addEventListener('hashchange', () => { page = routePage(); modalId = null; render(); });

  function demoApi() {
    let listener = () => {};
    const now = Date.now();
    const repositories = [
      { id: 'demo-1', name: 'workspace-app', path: '/Users/developer/Projects/workspace-app', intervalMinutes: 60, lastCheckedAt: now - 90000, nextCheckAt: now + 420000, pending: true, state: { branch: 'main', upstream: 'origin/main', remote: 'origin', ahead: 0, behind: 3, dirty: false, conflicts: [], incomingCommits: [{ hash: 'a92c7f4', subject: '워크스페이스 목록의 필터와 검색 개선' }, { hash: '18b21e3', subject: '프로젝트 설정 화면의 접근성 수정' }, { hash: '4f29a18', subject: '빌드 설정 업데이트' }] } },
      { id: 'demo-2', name: 'design-system', path: '/Users/developer/Projects/design-system', intervalMinutes: 300, lastCheckedAt: now - 240000, nextCheckAt: now + 2700000, pending: false, state: { branch: 'main', upstream: 'origin/main', remote: 'origin', ahead: 0, behind: 0, dirty: false, conflicts: [] } },
      { id: 'demo-3', name: 'personal-site', path: '/Users/developer/Projects/personal-site', intervalMinutes: 60, lastCheckedAt: now - 180000, nextCheckAt: now + 900000, pending: true, state: { branch: 'feature/blog', upstream: 'origin/feature/blog', remote: 'origin', ahead: 1, behind: 2, dirty: false, conflicts: [], incomingCommits: [{ hash: '8290ec3', subject: '블로그 글 목록과 태그 필터 추가' }, { hash: '123fb82', subject: '이미지 로딩 성능 개선' }] } },
    ];
    const data = { repositories, settings: { defaultIntervalMinutes: 60, launchAtLogin: true }, scan: { running: false, found: [], scannedDirectories: 0, errors: [] }, platform: 'darwin', isPackaged: false, gitAvailable: true, appVersion: '0.1.0' };
    const emit = () => listener(structuredClone(data));
    return {
      getState: async () => structuredClone(data), subscribe: (fn) => { listener = fn; return () => {}; },
      hideWindow: async () => notify('실제 앱에서는 창을 숨기고 트레이에 상주합니다.'),
      scan: async () => { data.scan.running = true; emit(); await new Promise((resolve) => setTimeout(resolve, 700)); data.scan = { running: false, scannedDirectories: 1874, errors: [{ path: '/private', message: 'Permission denied' }], found: [...repositories.map((r) => ({ name: r.name, path: r.path })), { name: 'api-service', path: '/Users/developer/Projects/api-service' }, { name: 'dotfiles', path: '/Users/developer/Projects/dotfiles' }, { name: 'archive.git', path: '/Users/developer/Backups/archive.git', bare: true }] }; emit(); },
      cancelScan: async () => { data.scan.running = false; data.scan.cancelled = true; emit(); },
      addRepositories: async ({ paths, intervalMinutes }) => { paths.forEach((path) => data.repositories.push({ id: `demo-${Date.now()}-${Math.random()}`, path, name: path.split('/').pop(), intervalMinutes, pending: false, lastCheckedAt: Date.now(), nextCheckAt: Date.now() + intervalMinutes * 60000, state: { branch: 'main', upstream: 'origin/main', remote: 'origin', ahead: 0, behind: 0, dirty: false } })); emit(); },
      updateRepository: async ({ id, ...updates }) => { Object.assign(data.repositories.find((r) => r.id === id), updates); emit(); },
      removeRepository: async ({ id }) => { data.repositories = data.repositories.filter((r) => r.id !== id); emit(); },
      checkNow: async ({ id } = {}) => { const targets = data.repositories.filter((r) => !id || r.id === id); targets.forEach((r) => { r.checking = true; }); emit(); await new Promise((resolve) => setTimeout(resolve, 600)); targets.forEach((r) => { r.checking = false; r.lastCheckedAt = Date.now(); r.nextCheckAt = Date.now() + r.intervalMinutes * 60000; }); emit(); },
      syncRepository: async ({ id }) => { const repo = data.repositories.find((r) => r.id === id); repo.syncing = true; emit(); await new Promise((resolve) => setTimeout(resolve, 700)); repo.syncing = false; repo.pending = false; repo.state.behind = 0; repo.state.incomingCommits = []; repo.lastCheckedAt = Date.now(); emit(); },
      abortOperation: async ({ id }) => { const repo = data.repositories.find((r) => r.id === id); repo.state.operation = null; repo.state.conflicts = []; emit(); },
      acknowledge: async ({ id }) => { data.repositories.find((r) => r.id === id).pending = false; emit(); },
      setSettings: async (updates) => { Object.assign(data.settings, updates); emit(); },
      openFolder: async () => notify('미리보기에서는 실제 폴더를 열지 않습니다.'),
      openExternal: async () => notify('미리보기에서는 외부 페이지를 열지 않습니다.'),
    };
  }
  async function initialize() {
    if (demo) api = demoApi();
    if (!api) {
      app.innerHTML = '<div class="boot-screen"><span class="boot-mark">R</span><div class="missing-bridge"><h1>Repo Tray</h1><p>이 화면은 Repo Tray 데스크탑 앱에서 실행됩니다.<br>앱을 실행해 저장소 모니터링을 시작해 주세요.</p></div></div>';
      return;
    }
    try {
      normalizeState(await api.getState());
      addInterval = String(state.settings.defaultIntervalMinutes || 60);
      api.subscribe((value) => { normalizeState(value); render(); });
      render();
    } catch (error) {
      app.innerHTML = `<div class="boot-screen"><span class="boot-mark">R</span><div class="missing-bridge"><h1>앱을 시작하지 못했습니다</h1><p>${esc(error?.message || error)}</p></div></div>`;
    }
  }
  initialize();
})();
