(() => {
  const APP = {
    cache: {},
    cacheTTL: 60 * 60 * 1000,
    nativeSupported: ['.mp4', '.webm', '.ogg'],
    ffmpeg: null,
    localRepo: null,
    playlists: {}
  };

  const els = {
    loader: document.getElementById('loader'),
    error: document.getElementById('error'),
    content: document.getElementById('content'),
    modal: document.getElementById('videoModal'),
    player: document.getElementById('player'),
    canvas: document.getElementById('ffmpegCanvas'),
    modalTitle: document.getElementById('modalTitle'),
    modalInfo: document.getElementById('modalInfo'),
    transcodeStatus: document.getElementById('transcodeStatus'),
    closeModal: document.getElementById('closeModal')
  };

  async function initFFmpeg() {
    if (APP.ffmpeg) return APP.ffmpeg;
    const { createFFmpeg } = FFmpeg;
    APP.ffmpeg = createFFmpeg({ log: false });
    await APP.ffmpeg.load();
    return APP.ffmpeg;
  }

  function initLocalRepo() {
    const path = location.pathname.replace(/^\/[^/]+\/?/, '');
    const match = path.match(/^\/([^/]+)\/([^/]+)\/?/);
    APP.localRepo = match ? { owner: match[1], repo: match[2] } : null;
  }

  function getCache(key) {
    const raw = localStorage.getItem(`vg_cache_${key}`);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      return Date.now() - parsed.ts < APP.cacheTTL ? parsed.data : null;
    } catch { return null; }
  }

  function setCache(key, data) {
    localStorage.setItem(`vg_cache_${key}`, JSON.stringify({ ts: Date.now(), data }));
  }

  function parseRepoUrl(url) {
    const clean = url.trim();
    if (!clean.startsWith('https://github.com/')) return null;
    const parts = clean.replace('https://github.com/', '').split('/');
    return parts.length >= 2 ? { owner: parts[0], repo: parts[1] } : null;
  }

  async function fetchRepoTree(repo, branch = 'main') {
    const cacheKey = `${repo.owner}/${repo.repo}/${branch}`;
    const cached = getCache(cacheKey);
    if (cached) return cached;

    const res = await fetch(`https://api.github.com/repos/${repo.owner}/${repo.repo}/git/trees/${branch}?recursive=1`);
    if (!res.ok) throw new Error(`API Error ${res.status}: ${repo.owner}/${repo.repo}`);
    const data = await res.json();
    setCache(cacheKey, data.tree);
    return data.tree;
  }

  function buildPlaylists(tree, repoName = 'Локальные') {
    tree.forEach(item => {
      if (item.type !== 'blob') return;
      const ext = item.path.slice(item.path.lastIndexOf('.')).toLowerCase();
      if (!['.mp4', '.webm', '.ogg', '.mov', '.mkv', '.avi', '.flv'].includes(ext)) return;
      if (!item.path.startsWith('videos/')) return;

      const relative = item.path.replace('videos/', '');
      const parts = relative.split('/');
      const playlist = parts.length > 1 ? parts[0] : 'Одиночные видео';
      const fileName = parts[parts.length - 1];
      const rawUrl = `https://raw.githubusercontent.com/${repoName}/main/${item.path}`;

      if (!APP.playlists[playlist]) APP.playlists[playlist] = [];
      APP.playlists[playlist].push({
        title: fileName.replace(/\.[^/.]+$/, ''),
        url: rawUrl,
        ext,
        path: item.path,
        native: APP.nativeSupported.includes(ext)
      });
    });
  }

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
      section.innerHTML = `<h2>${pl}</h2><div class="grid"></div>`;
      els.content.appendChild(section);
      const grid = section.querySelector('.grid');

      APP.playlists[pl].forEach(v => {
        const card = document.createElement('div');
        card.className = 'card';
        card.innerHTML = `
          <div class="card-thumb">🎞️</div>
          <div class="card-info">
            <div class="card-title">${v.title}</div>
            <div class="card-meta">${v.ext.toUpperCase()} • ${v.path.split('/').slice(0, -1).join('/') || 'Корень'}</div>
          </div>`;
        card.addEventListener('click', () => openVideo(v));
        grid.appendChild(card);
      });
    });
    els.content.classList.remove('hidden');
  }

  async function openVideo(v) {
    els.modalTitle.textContent = v.title;
    els.modalInfo.textContent = `${v.path} (${v.ext.toUpperCase()})`;
    els.transcodeStatus.classList.remove('hidden');
    els.player.classList.add('hidden');
    els.canvas.classList.add('hidden');

    if (v.native) {
      els.transcodeStatus.classList.add('hidden');
      els.player.classList.remove('hidden');
      els.player.src = v.url;
      els.modal.showModal();
      await els.player.play();
      return;
    }

    try {
      const ffmpeg = await initFFmpeg();
      const inputName = 'input' + v.ext;
      const outputName = 'output.mp4';
      
      const response = await fetch(v.url);
      const buffer = await response.arrayBuffer();
      ffmpeg.FS('writeFile', inputName, new Uint8Array(buffer));

      els.transcodeStatus.textContent = `⏳ Конвертация ${v.ext} → MP4... (может занять время)`;
      
      await ffmpeg.run('-i', inputName, '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', outputName);
      
      const data = ffmpeg.FS('readFile', outputName);
      const blob = new Blob([data.buffer], { type: 'video/mp4' });
      const objectUrl = URL.createObjectURL(blob);

      els.transcodeStatus.classList.add('hidden');
      els.player.classList.remove('hidden');
      els.player.src = objectUrl;
      els.modal.showModal();
      await els.player.play();

      // Очистка
      ffmpeg.FS('unlink', inputName);
      ffmpeg.FS('unlink', outputName);
    } catch (err) {
      els.transcodeStatus.textContent = `❌ Ошибка конвертации: ${err.message}`;
      console.error(err);
    }
  }

  els.closeModal.addEventListener('click', () => {
    els.player.pause();
    els.player.src = '';
    els.modal.close();
  });

  els.modal.addEventListener('click', e => { if (e.target === els.modal) els.closeModal.click(); });

  async function load() {
    try {
      if (APP.localRepo) {
        const tree = await fetchRepoTree(APP.localRepo);
        buildPlaylists(tree, `${APP.localRepo.owner}/${APP.localRepo.repo}`);
      }

      const res = await fetch('videolist.txt');
      if (res.ok) {
        const text = await res.text();
        for (const line of text.split('\n').filter(l => l.trim())) {
          const repo = parseRepoUrl(line);
          if (repo) {
            try {
              const tree = await fetchRepoTree(repo);
              buildPlaylists(tree, `${repo.owner}/${repo.repo}`);
            } catch (e) { console.warn(e); }
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

  document.addEventListener('DOMContentLoaded', () => { initLocalRepo(); load(); });
})();
