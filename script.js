(() => {
  const APP = {
    cache: {},
    cacheTTL: 60 * 60 * 1000, // 1 час
    videoExts: ['.mp4', '.webm', '.ogg', '.mov', '.mkv'],
    localRepo: null,
    playlists: {}
  };

  const els = {
    loader: document.getElementById('loader'),
    error: document.getElementById('error'),
    content: document.getElementById('content'),
    modal: document.getElementById('videoModal'),
    player: document.getElementById('player'),
    modalTitle: document.getElementById('modalTitle'),
    modalInfo: document.getElementById('modalInfo'),
    closeModal: document.getElementById('closeModal')
  };

  // Инициализация текущего репо
  function initLocalRepo() {
    const path = location.pathname.replace(/^\/[^/]+\/?/, '');
    const match = path.match(/^\/([^/]+)\/([^/]+)\/?/);
    if (match) {
      APP.localRepo = { owner: match[1], repo: match[2] };
    }
  }

  // Чтение кэша
  function getCache(key) {
    const raw = localStorage.getItem(`vg_cache_${key}`);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (Date.now() - parsed.ts < APP.cacheTTL) return parsed.data;
    } catch {}
    return null;
  }

  // Запись в кэш
  function setCache(key, data) {
    localStorage.setItem(`vg_cache_${key}`, JSON.stringify({ ts: Date.now(), data }));
  }

  // Парсинг URL репозитория
  function parseRepoUrl(url) {
    const clean = url.trim();
    if (!clean || !clean.startsWith('https://github.com/')) return null;
    const parts = clean.replace('https://github.com/', '').split('/');
    if (parts.length < 2) return null;
    return { owner: parts[0], repo: parts[1] };
  }

  // Получение дерева файлов репозитория
  async function fetchRepoTree(repo, branch = 'main') {
    const cacheKey = `${repo.owner}/${repo.repo}/${branch}`;
    const cached = getCache(cacheKey);
    if (cached) return cached;

    const url = `https://api.github.com/repos/${repo.owner}/${repo.repo}/git/trees/${branch}?recursive=1`;
    const res = await fetch(url);
    if (!res.ok) {
      if (res.status === 403) throw new Error('Превышен лимит API GitHub. Попробуйте позже или добавьте токен.');
      throw new Error(`Не удалось загрузить ${repo.owner}/${repo.repo}`);
    }
    const data = await res.json();
    setCache(cacheKey, data.tree);
    return data.tree;
  }

  // Группировка видео по плейлистам
  function buildPlaylists(tree, repoName = 'Локальные') {
    tree.forEach(item => {
      if (item.type !== 'blob') return;
      const ext = item.path.slice(item.path.lastIndexOf('.')).toLowerCase();
      if (!APP.videoExts.includes(ext)) return;
      if (!item.path.startsWith('videos/')) return;

      const relative = item.path.replace('videos/', '');
      const parts = relative.split('/');
      const playlist = parts.length > 1 ? parts[0] : 'Одиночные видео';
      const fileName = parts[parts.length - 1];
      const rawUrl = `https://raw.githubusercontent.com/${repoName}/${branch}/${item.path}`;

      if (!APP.playlists[playlist]) APP.playlists[playlist] = [];
      APP.playlists[playlist].push({ title: fileName.replace(/\.[^/.]+$/, ''), url: rawUrl, path: item.path });
    });
  }

  // Рендер
  function render() {
    els.content.innerHTML = '';
    const sorted = Object.keys(APP.playlists).sort();
    
    if (sorted.length === 0) {
      els.content.innerHTML = '<p style="text-align:center;color:var(--text-muted)">Видео не найдены. Добавьте файлы в папку videos/.</p>';
      els.content.classList.remove('hidden');
      return;
    }

    sorted.forEach(pl => {
      const section = document.createElement('section');
      section.className = 'playlist';
      section.innerHTML = `<h2>${pl}</h2><div class="grid" data-playlist="${pl}"></div>`;
      els.content.appendChild(section);

      const grid = section.querySelector('.grid');
      APP.playlists[pl].forEach(v => {
        const card = document.createElement('div');
        card.className = 'card';
        card.innerHTML = `
          <div class="card-thumb">🎞️</div>
          <div class="card-info">
            <div class="card-title">${v.title}</div>
            <div class="card-meta">${v.path.split('/').slice(0, -1).join('/') || 'Корень videos/'}</div>
          </div>
        `;
        card.addEventListener('click', () => openVideo(v));
        grid.appendChild(card);
      });
    });

    els.content.classList.remove('hidden');
  }

  // Модальное окно
  function openVideo(v) {
    els.modalTitle.textContent = v.title;
    els.modalInfo.textContent = `Путь: ${v.path}`;
    els.player.src = v.url;
    els.modal.showModal();
    els.player.play();
  }

  els.closeModal.addEventListener('click', () => {
    els.player.pause();
    els.player.src = '';
    els.modal.close();
  });

  els.modal.addEventListener('click', (e) => {
    if (e.target === els.modal) els.closeModal.click();
  });

  // Основная логика
  async function load() {
    try {
      // 1. Локальные видео
      if (APP.localRepo) {
        const tree = await fetchRepoTree(APP.localRepo);
        buildPlaylists(tree, `${APP.localRepo.owner}/${APP.localRepo.repo}`);
      }

      // 2. Внешние репозитории из videolist.txt
      const res = await fetch('videolist.txt');
      if (res.ok) {
        const text = await res.text();
        const lines = text.split('\n').filter(l => l.trim());
        for (const line of lines) {
          const repo = parseRepoUrl(line);
          if (repo) {
            try {
              const tree = await fetchRepoTree(repo);
              buildPlaylists(tree, `${repo.owner}/${repo.repo}`);
            } catch (e) {
              console.warn(`Пропуск ${line}: ${e.message}`);
            }
          }
        }
      }

      render();
    } catch (err) {
      els.error.textContent = `Ошибка: ${err.message}`;
      els.error.classList.remove('hidden');
    } finally {
      els.loader.classList.add('hidden');
    }
  }

  // Определение ветки (fallback на main)
  let branch = 'main';
  document.addEventListener('DOMContentLoaded', () => {
    initLocalRepo();
    load();
  });
})();
