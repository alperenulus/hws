(() => {
  // %25 küçültülmüş, orijinal alanla aynı merkezde (önceki: left 0.08 top 0.34 width 0.84 height 0.26)
  const GUIDE = { left: 0.185, top: 0.3725, width: 0.63, height: 0.195 };

  let cars = dbLoad();
  let stream = null;
  let worker = null;
  let liveTimer = null;
  let busyScanning = false;
  let editingId = null; // null = adding a new car
  let scanMode = 'camera';

  const el = (id) => document.getElementById(id);
  const video = el('video');
  const canvas = el('captureCanvas');
  const guideBox = el('guideBox');
  const guideLabel = el('guideLabel');
  const scanStatus = el('scanStatus');
  const scanResult = el('scanResult');
  const cameraModeEl = el('cameraMode');
  const codeModeEl = el('codeMode');
  const codeInput = el('codeInput');

  // ---------- Scan mode: camera vs. manual code entry ----------
  function setScanMode(mode) {
    scanMode = mode;
    document.querySelectorAll('.mode-btn').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
    cameraModeEl.hidden = mode !== 'camera';
    codeModeEl.hidden = mode !== 'code';
    scanStatus.textContent = '';
    scanResult.innerHTML = '';
    updateGuideOverlay(null);
    if (mode === 'camera') {
      if (document.getElementById('screen-scan').classList.contains('active')) startCamera();
    } else {
      stopCamera();
      codeInput.focus();
    }
  }

  document.querySelectorAll('.mode-btn').forEach((btn) => {
    btn.addEventListener('click', () => setScanMode(btn.dataset.mode));
  });

  function runCodeSearch() {
    const text = codeInput.value.trim();
    if (!text) return;
    renderScanResult([text], text);
  }
  el('btnCodeSearch').addEventListener('click', runCodeSearch);
  codeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') runCodeSearch();
  });

  // ---------- Tabs ----------
  function showScreen(name) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === `screen-${name}`));
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.screen === name));
    if (name === 'scan') { if (scanMode === 'camera') startCamera(); } else stopCamera();
    if (name === 'list') renderList();
  }

  document.querySelectorAll('.tab').forEach((t) => {
    t.addEventListener('click', () => showScreen(t.dataset.screen));
  });

  // ---------- Camera ----------
  function positionGuideBox() {
    guideBox.style.left = `${GUIDE.left * 100}%`;
    guideBox.style.top = `${GUIDE.top * 100}%`;
    guideBox.style.width = `${GUIDE.width * 100}%`;
    guideBox.style.height = `${GUIDE.height * 100}%`;
    guideLabel.style.left = `${GUIDE.left * 100}%`;
    guideLabel.style.width = `${GUIDE.width * 100}%`;
    guideLabel.style.top = `${GUIDE.top * 100}%`;
  }
  positionGuideBox();

  function updateGuideOverlay(topMatch) {
    guideBox.classList.remove('match-owned', 'match-wanted', 'match-none');
    if (!topMatch || topMatch.score < 0.4) {
      guideLabel.hidden = true;
      return;
    }
    const { car } = topMatch;
    guideLabel.hidden = false;
    if (car.status === 'owned') {
      guideBox.classList.add('match-owned');
      guideLabel.className = 'guide-label label-owned';
      guideLabel.textContent = `✓ Bende Var — ${car.name || car.number}`;
    } else if (car.status === 'wanted') {
      guideBox.classList.add('match-wanted');
      guideLabel.className = 'guide-label label-wanted';
      guideLabel.textContent = `★ Arıyorum — ${car.name || car.number}`;
    } else {
      guideBox.classList.add('match-none');
      guideLabel.className = 'guide-label label-none';
      guideLabel.textContent = `${car.name || car.number} — Bilinmiyor`;
    }
  }

  async function startCamera() {
    if (stream) return;
    scanStatus.textContent = '';
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      video.srcObject = stream;
      await video.play();
    } catch (err) {
      console.error('camera error', err);
      scanStatus.textContent = 'Kameraya erişilemedi: ' + (err && err.message ? err.message : err) +
        '. Ayarlar > Safari > Kamera izinlerini kontrol et.';
    }
  }

  function stopCamera() {
    if (liveTimer) { clearInterval(liveTimer); liveTimer = null; }
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
  }

  function getCoverCrop(videoW, videoH, boxW, boxH) {
    const videoRatio = videoW / videoH;
    const boxRatio = boxW / boxH;
    let drawW, drawH, offsetX, offsetY;
    if (videoRatio > boxRatio) {
      drawH = videoH;
      drawW = videoH * boxRatio;
      offsetX = (videoW - drawW) / 2;
      offsetY = 0;
    } else {
      drawW = videoW;
      drawH = videoW / boxRatio;
      offsetX = 0;
      offsetY = (videoH - drawH) / 2;
    }
    return { drawW, drawH, offsetX, offsetY };
  }

  function captureGuideCrop() {
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return null;
    const boxEl = video.parentElement.getBoundingClientRect();
    const { drawW, drawH, offsetX, offsetY } = getCoverCrop(vw, vh, boxEl.width, boxEl.height);

    const cropX = offsetX + drawW * GUIDE.left;
    const cropY = offsetY + drawH * GUIDE.top;
    const cropW = drawW * GUIDE.width;
    const cropH = drawH * GUIDE.height;

    const targetW = 1000;
    const scale = targetW / cropW;
    canvas.width = Math.round(cropW * scale);
    canvas.height = Math.round(cropH * scale);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  // ---------- OCR ----------
  async function getWorker() {
    if (worker) return worker;
    worker = await Tesseract.createWorker('eng', 1, {
      workerPath: 'vendor/worker.min.js',
      corePath: 'vendor/tesseract-core-lstm.js',
      langPath: 'vendor',
      workerBlobURL: false,
    });
    return worker;
  }

  async function runScan() {
    if (busyScanning) return;
    const cropped = captureGuideCrop();
    if (!cropped) {
      scanStatus.textContent = 'Kamera henüz hazır değil, birazdan tekrar dene.';
      return;
    }
    busyScanning = true;
    scanStatus.textContent = 'Okunuyor...';
    try {
      const w = await getWorker();
      const { data } = await w.recognize(cropped);
      const lines = (data.text || '').split(/\r?\n/).filter((l) => l.trim());
      renderScanResult(lines, data.text || '');
    } catch (err) {
      console.error('OCR error', err);
      scanStatus.textContent = 'Tanıma hatası: ' + (err && err.message ? err.message : err);
    } finally {
      busyScanning = false;
    }
  }

  el('btnCapture').addEventListener('click', runScan);
  el('chkLive').addEventListener('change', (e) => {
    if (e.target.checked) {
      liveTimer = setInterval(runScan, 2800);
      runScan();
    } else if (liveTimer) {
      clearInterval(liveTimer); liveTimer = null;
    }
  });

  function statusLabel(status) {
    if (status === 'owned') return 'Bende Var';
    if (status === 'wanted') return 'Arıyorum';
    return 'Bilinmiyor';
  }
  function statusClass(status) {
    if (status === 'owned') return 'badge-owned';
    if (status === 'wanted') return 'badge-wanted';
    return 'badge-none';
  }

  function renderScanResult(lines, rawText) {
    const matches = findMatches(lines, cars, { limit: 5, minScore: 0.4 });
    scanStatus.textContent = '';

    if (matches.length === 0) {
      updateGuideOverlay(null);
      scanResult.innerHTML = `
        <div class="result-card no-match">
          <p>Eşleşme bulunamadı.</p>
          <p class="raw-text">${escapeHtml(rawText).slice(0, 200)}</p>
          <button class="btn-primary" id="btnAddFromScan">Yeni Araç Olarak Ekle</button>
        </div>`;
      el('btnAddFromScan').addEventListener('click', () => openEditModal(null, { rawText }));
      return;
    }

    const top = matches[0];
    updateGuideOverlay(top);
    const rest = matches.slice(1).filter((m) => m.score >= 0.4);
    const topCard = renderMatchCard(top, true);
    const restCards = rest.map((m) => renderMatchCard(m, false)).join('');

    scanResult.innerHTML = `${topCard}<div class="alt-matches">${restCards}</div>`;
    wireMatchCardButtons();
  }

  function renderMatchCard(match, isTop) {
    const { car, score } = match;
    const pct = Math.round(score * 100);
    return `
      <div class="result-card ${isTop ? 'top-match' : 'alt-match'}" data-id="${car.id}">
        <div class="result-head">
          <strong>${escapeHtml(car.name || '(isim yok)')}</strong>
          <span class="score">%${pct}</span>
        </div>
        <div class="result-sub">${escapeHtml(car.number || '')}</div>
        <span class="badge ${statusClass(car.status)}">${statusLabel(car.status)}</span>
        <div class="row-buttons compact">
          <button data-action="owned" data-id="${car.id}">Bende Var</button>
          <button data-action="wanted" data-id="${car.id}">Arıyorum</button>
          <button data-action="none" data-id="${car.id}">Bilinmiyor</button>
          <button data-action="edit" data-id="${car.id}">Düzenle</button>
        </div>
      </div>`;
  }

  function wireMatchCardButtons() {
    scanResult.querySelectorAll('button[data-action]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const action = btn.dataset.action;
        if (action === 'edit') { openEditModal(id); return; }
        const car = cars.find((c) => c.id === id);
        if (!car) return;
        car.status = action;
        cars = dbUpsert(cars, car);
        // Refresh the badge in place without re-running OCR.
        const card = scanResult.querySelector(`.result-card[data-id="${id}"]`);
        if (card) {
          const badge = card.querySelector('.badge');
          badge.className = `badge ${statusClass(car.status)}`;
          badge.textContent = statusLabel(car.status);
          if (card.classList.contains('top-match')) updateGuideOverlay({ car, score: 1 });
        }
      });
    });
  }

  function escapeHtml(s) {
    return (s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ---------- List screen ----------
  let currentFilter = 'all';

  document.querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      currentFilter = chip.dataset.filter;
      renderList();
    });
  });
  el('searchInput').addEventListener('input', renderList);
  el('btnAddCar').addEventListener('click', () => openEditModal(null));

  function renderList() {
    const q = el('searchInput').value.trim().toLowerCase();
    const listEl = el('carList');
    let filtered = cars.slice().sort((a, b) => (a.name || '').localeCompare(b.name || '', 'tr'));

    if (currentFilter !== 'all') filtered = filtered.filter((c) => c.status === currentFilter);
    if (q) {
      filtered = filtered.filter((c) =>
        (c.name || '').toLowerCase().includes(q) || (c.number || '').toLowerCase().includes(q));
    }

    if (filtered.length === 0) {
      listEl.innerHTML = '<li class="empty-hint">Liste boş. Sağ alttaki + ile ekleyebilir ya da Ayarlar\'dan içe aktarabilirsin.</li>';
      return;
    }

    listEl.innerHTML = filtered.map((c) => `
      <li class="car-row" data-id="${c.id}">
        <div class="car-row-main">
          <strong>${escapeHtml(c.name || '(isim yok)')}</strong>
          <span class="car-number">${escapeHtml(c.number || '')}</span>
        </div>
        <span class="badge ${statusClass(c.status)}" data-cycle="${c.id}">${statusLabel(c.status)}</span>
      </li>`).join('');

    listEl.querySelectorAll('.badge[data-cycle]').forEach((badge) => {
      badge.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = badge.dataset.cycle;
        const car = cars.find((c) => c.id === id);
        if (!car) return;
        const order = ['none', 'owned', 'wanted'];
        car.status = order[(order.indexOf(car.status) + 1) % order.length];
        cars = dbUpsert(cars, car);
        renderList();
      });
    });
    listEl.querySelectorAll('.car-row').forEach((row) => {
      row.addEventListener('click', () => openEditModal(row.dataset.id));
    });
  }

  // ---------- Edit / Add modal ----------
  const modal = el('editModal');
  function openEditModal(id, prefill) {
    editingId = id;
    const car = id ? cars.find((c) => c.id === id) : null;
    el('editModalTitle').textContent = car ? 'Araç Düzenle' : 'Araç Ekle';
    el('editName').value = car ? car.name || '' : '';
    el('editNumber').value = car ? car.number || '' : '';
    el('editStatus').value = car ? car.status || 'none' : 'none';
    el('editDelete').style.display = car ? '' : 'none';
    modal.classList.remove('hidden');
    if (!car && prefill) el('editName').focus();
  }
  function closeEditModal() { modal.classList.add('hidden'); editingId = null; }

  el('editCancel').addEventListener('click', closeEditModal);
  el('editSave').addEventListener('click', () => {
    const name = el('editName').value.trim();
    const number = el('editNumber').value.trim();
    const status = el('editStatus').value;
    if (!name && !number) { closeEditModal(); return; }
    const car = editingId ? cars.find((c) => c.id === editingId) : { id: dbMakeId() };
    car.name = name;
    car.number = number;
    car.status = status;
    cars = dbUpsert(cars, car);
    closeEditModal();
    renderList();
  });
  el('editDelete').addEventListener('click', () => {
    if (!editingId) return;
    cars = dbDelete(cars, editingId);
    closeEditModal();
    renderList();
  });

  // ---------- Import / export ----------
  function parseImportText(text) {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const out = [];
    for (const line of lines) {
      if (/^(isim|ad|name)\s*[,;\t]/i.test(line)) continue; // skip header row
      const parts = line.split(/\t|;|,/).map((p) => p.trim());
      const name = parts[0] || '';
      const number = parts[1] || '';
      const statusRaw = (parts[2] || '').toLowerCase();
      let status = 'none';
      if (/bende|sahip|\bvar\b|owned|have/.test(statusRaw)) status = 'owned';
      else if (/ariyorum|arıyorum|wanted|istiyorum|want/.test(statusRaw)) status = 'wanted';
      if (!name && !number) continue;
      out.push({ id: dbMakeId(), name, number, status });
    }
    return out;
  }

  function mergeImported(entries) {
    for (const entry of entries) {
      const existing = cars.find((c) =>
        (entry.number && normLoose(c.number) === normLoose(entry.number)) ||
        (entry.name && normName(c.name) === normName(entry.name)));
      if (existing) {
        existing.name = entry.name || existing.name;
        existing.number = entry.number || existing.number;
        if (entry.status !== 'none') existing.status = entry.status;
      } else {
        cars.push(entry);
      }
    }
    dbSave(cars);
  }

  el('btnImportText').addEventListener('click', () => {
    const text = el('importText').value;
    const entries = parseImportText(text);
    if (entries.length === 0) { alert('İçe aktarılacak satır bulunamadı.'); return; }
    mergeImported(entries);
    el('importText').value = '';
    alert(`${entries.length} satır işlendi.`);
    renderList();
  });

  el('fileImport').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    let entries = [];
    if (file.name.endsWith('.json')) {
      try {
        const parsed = JSON.parse(text);
        const arr = Array.isArray(parsed) ? parsed : [];
        entries = arr.map((o) => ({
          id: dbMakeId(),
          name: o.name || o.isim || o.ad || '',
          number: o.number || o.seriNo || o.seri_no || o.no || '',
          status: o.status === 'owned' || o.status === 'wanted' ? o.status : 'none',
        })).filter((o) => o.name || o.number);
      } catch (err) {
        alert('JSON dosyası okunamadı: ' + err.message);
        return;
      }
    } else {
      entries = parseImportText(text);
    }
    if (entries.length === 0) { alert('İçe aktarılacak kayıt bulunamadı.'); return; }
    mergeImported(entries);
    alert(`${entries.length} kayıt işlendi.`);
    renderList();
    e.target.value = '';
  });

  function downloadBlob(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  el('btnExportJson').addEventListener('click', () => {
    downloadBlob('hotwheels-liste.json', JSON.stringify(cars, null, 2), 'application/json');
  });
  el('btnExportCsv').addEventListener('click', () => {
    const rows = ['isim,seri_no,durum'];
    for (const c of cars) {
      const statusWord = c.status === 'owned' ? 'bende' : c.status === 'wanted' ? 'ariyorum' : '';
      rows.push([c.name, c.number, statusWord].map((v) => `"${(v || '').replace(/"/g, '""')}"`).join(','));
    }
    downloadBlob('hotwheels-liste.csv', rows.join('\n'), 'text/csv');
  });
  el('btnClearAll').addEventListener('click', () => {
    if (confirm('Tüm liste silinsin mi? Bu işlem geri alınamaz.')) {
      dbClearAll();
      cars = [];
      renderList();
    }
  });

  // ---------- Boot ----------
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js').catch((err) => console.warn('SW register failed', err));
  }
  showScreen('scan');
})();
