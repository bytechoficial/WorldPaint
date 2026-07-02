if (typeof CONFIG === 'undefined') {
  document.body.innerHTML = `
    <div style="text-align:center;margin-top:80px;font-family:sans-serif;padding:20px">
      <h1>WorldPaint</h1>
      <p>Crie o arquivo <code>config.js</code> baseado no <code>config.example.js</code>
      com seu token do GitHub.</p>
    </div>`;
  throw new Error('config.js n\u00e3o encontrado');
}

const CELL_SIZE = 0.001;
const MIN_ZOOM_FOR_DRAWING = 12;
let map, currentUser = null, drawingsMeta = [], markers = [];
let selectedLat = null, selectedLng = null;
let drawingCanvas, drawingCtx, isDrawing = false, pixelGrid = [];
let lastX, lastY;
let currentTool = 'freehand', currentColor = '#ff0000', brushSize = 3, isEraser = false;

const $ = id => document.getElementById(id);

async function init() {
  await auth.init();
  currentUser = auth.currentUser;
  await loadDrawingsMeta();
  initMap();
  initAuthUI();
  initDrawingUI();
  updateAuthUI();
}

async function loadDrawingsMeta() {
  const file = await api.readOrCreateFile(
    'data/drawings_index.json',
    JSON.stringify({ drawings: [] })
  );
  drawingsMeta = JSON.parse(file.content).drawings || [];
}

async function saveDrawingsMeta() {
  const meta = drawingsMeta.map(d => ({
    id: d.id, cellKey: d.cellKey, lat: d.lat, lng: d.lng,
    author: d.author, createdAt: d.createdAt, type: d.type
  }));
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const file = await api.getFile('data/drawings_index.json');
      if (!file) throw new Error('Index n\u00e3o encontrado');
      await api.updateFile(
        'data/drawings_index.json',
        JSON.stringify({ drawings: meta }, null, 2),
        file.sha
      );
      return;
    } catch (e) {
      if (!e.message.includes('SHA')) throw e;
    }
  }
  throw new Error('Erro ao salvar \u00edndice');
}

function initMap() {
  map = L.map('map', { worldCopyJump: true }).setView([0, 0], 2);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://openstreetmap.org/copyright">OpenStreetMap</a>'
  }).addTo(map);

  drawingsMeta.forEach(d => addMarker(d));

  map.on('click', e => {
    if (!currentUser) { showToast('Fa\u00e7a login para desenhar!'); return; }
    if (map.getZoom() < MIN_ZOOM_FOR_DRAWING) { showToast('Aproxime mais do mapa!'); return; }

    const lat = Math.round(e.latlng.lat / CELL_SIZE) * CELL_SIZE;
    const lng = Math.round(e.latlng.lng / CELL_SIZE) * CELL_SIZE;
    const cellKey = `${lat},${lng}`;

    if (drawingsMeta.some(d => d.cellKey === cellKey)) {
      showToast('Este local j\u00e1 tem um desenho!');
      return;
    }

    selectedLat = lat;
    selectedLng = lng;
    openDrawingModal(`Desenhar em ${lat.toFixed(4)}, ${lng.toFixed(4)}`);
  });
}

function addMarker(d) {
  const marker = L.circleMarker([d.lat, d.lng], {
    radius: 8, fillColor: '#ff4444', color: '#fff',
    weight: 2, opacity: 1, fillOpacity: 0.8
  }).addTo(map);

  marker.bindPopup(`
    <div class="drawing-popup">
      <canvas class="popup-canvas" id="popup-${d.id}" width="160" height="160"></canvas>
      <p><strong>${d.author}</strong></p>
      <p style="font-size:11px;color:#666">${new Date(d.createdAt).toLocaleString('pt-BR')}</p>
      ${d.author === currentUser ? `<button class="btn-delete" onclick="deleteDrawing('${d.id}')">Excluir</button>` : ''}
    </div>`);

  marker.on('popupopen', () => loadFullDrawing(d.id));
  markers.push(marker);
}

async function loadFullDrawing(id) {
  const file = await api.getFile(`data/drawings/${id}.json`);
  if (!file) return;
  const d = JSON.parse(file.content);
  const canvas = $(`popup-${id}`);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const img = new Image();
  img.onload = () => ctx.drawImage(img, 0, 0, 160, 160);
  img.src = d.canvasData;
}

async function deleteDrawing(id) {
  if (!confirm('Excluir este desenho?')) return;
  try {
    const file = await api.getFile(`data/drawings/${id}.json`);
    if (file) {
      await api.request('DELETE',
        `/repos/${CONFIG.GITHUB_OWNER}/${CONFIG.GITHUB_REPO}/contents/data/drawings/${id}.json`,
        { message: 'WorldPaint: excluir desenho', sha: file.sha }
      );
    }
  } catch (_) {}

  drawingsMeta = drawingsMeta.filter(d => d.id !== id);
  await saveDrawingsMeta();
  markers.forEach(m => map.removeLayer(m));
  markers = [];
  drawingsMeta.forEach(d => addMarker(d));
  showToast('Desenho exclu\u00eddo!');
}

function initAuthUI() {
  $('btn-login').onclick = () => openAuthModal('login');
  $('btn-register').onclick = () => openAuthModal('register');
  $('btn-logout').onclick = () => {
    auth.logout();
    currentUser = null;
    updateAuthUI();
    showToast('Sess\u00e3o encerrada');
  };
  $('auth-modal-close').onclick = () => $('auth-modal').style.display = 'none';
  $('auth-form').onsubmit = async e => {
    e.preventDefault();
    const username = $('auth-username').value.trim();
    const password = $('auth-password').value;
    const mode = $('auth-form').dataset.mode;
    if (!username || !password) { showToast('Preencha todos os campos'); return; }
    try {
      if (mode === 'login') await auth.login(username, password);
      else await auth.register(username, password);
      currentUser = auth.currentUser;
      updateAuthUI();
      $('auth-modal').style.display = 'none';
      showToast(mode === 'login' ? 'Login efetuado!' : 'Conta criada!');
    } catch (err) {
      showToast(err.message);
    }
  };
}

function openAuthModal(mode) {
  $('auth-modal-title').textContent = mode === 'login' ? 'Login' : 'Registrar';
  $('auth-submit-btn').textContent = mode === 'login' ? 'Entrar' : 'Criar conta';
  $('auth-form').dataset.mode = mode;
  $('auth-username').value = '';
  $('auth-password').value = '';
  $('auth-modal').style.display = '';
}

function updateAuthUI() {
  if (currentUser) {
    $('btn-login').style.display = 'none';
    $('btn-register').style.display = 'none';
    $('user-info').style.display = '';
    $('username-display').textContent = currentUser;
  } else {
    $('btn-login').style.display = '';
    $('btn-register').style.display = '';
    $('user-info').style.display = 'none';
  }
}

function initDrawingUI() {
  const canvas = $('drawing-canvas');
  drawingCanvas = canvas;
  drawingCtx = canvas.getContext('2d');

  canvas.onmousedown = startDraw;
  canvas.onmousemove = draw;
  canvas.onmouseup = stopDraw;
  canvas.onmouseleave = stopDraw;

  document.querySelectorAll('[data-mode]').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('[data-mode]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentTool = btn.dataset.mode;
      if (currentTool === 'pixel') initPixelGrid();
    };
  });

  $('color-picker').oninput = e => { currentColor = e.target.value; };
  $('brush-size').oninput = e => {
    brushSize = parseInt(e.target.value);
    $('brush-label').textContent = e.target.value;
  };
  $('eraser-mode').onchange = e => { isEraser = e.target.checked; };
  $('clear-canvas').onclick = () => {
    drawingCtx.fillStyle = '#ffffff';
    drawingCtx.fillRect(0, 0, CONFIG.DRAWING_SIZE, CONFIG.DRAWING_SIZE);
    pixelGrid = [];
  };
  $('cancel-drawing').onclick = () => $('drawing-modal').style.display = 'none';
  $('drawing-modal-close').onclick = () => $('drawing-modal').style.display = 'none';
  $('save-drawing').onclick = saveDrawing;
}

function openDrawingModal(title) {
  $('drawing-coords').textContent = title;
  drawingCtx.fillStyle = '#ffffff';
  drawingCtx.fillRect(0, 0, CONFIG.DRAWING_SIZE, CONFIG.DRAWING_SIZE);
  pixelGrid = [];
  currentTool = 'freehand';
  isEraser = false;
  $('eraser-mode').checked = false;
  document.querySelectorAll('[data-mode]').forEach(b => b.classList.remove('active'));
  document.querySelector('[data-mode="freehand"]').classList.add('active');
  $('drawing-modal').style.display = '';
}

function startDraw(e) {
  const rect = drawingCanvas.getBoundingClientRect();
  const scaleX = CONFIG.DRAWING_SIZE / rect.width;
  const scaleY = CONFIG.DRAWING_SIZE / rect.height;
  const x = (e.clientX - rect.left) * scaleX;
  const y = (e.clientY - rect.top) * scaleY;

  if (currentTool === 'pixel') {
    pixelClick(x, y);
    return;
  }

  isDrawing = true;
  lastX = x;
  lastY = y;
}

function draw(e) {
  if (!isDrawing) return;
  const rect = drawingCanvas.getBoundingClientRect();
  const scaleX = CONFIG.DRAWING_SIZE / rect.width;
  const scaleY = CONFIG.DRAWING_SIZE / rect.height;
  const x = (e.clientX - rect.left) * scaleX;
  const y = (e.clientY - rect.top) * scaleY;

  drawingCtx.beginPath();
  drawingCtx.moveTo(lastX, lastY);
  drawingCtx.lineTo(x, y);
  drawingCtx.strokeStyle = isEraser ? '#ffffff' : currentColor;
  drawingCtx.lineWidth = isEraser ? brushSize * 3 : brushSize;
  drawingCtx.lineCap = 'round';
  drawingCtx.lineJoin = 'round';
  drawingCtx.stroke();

  lastX = x;
  lastY = y;
}

function stopDraw() {
  isDrawing = false;
}

function initPixelGrid() {
  const cols = CONFIG.DRAWING_SIZE / CONFIG.PIXEL_SIZE;
  const rows = CONFIG.DRAWING_SIZE / CONFIG.PIXEL_SIZE;
  pixelGrid = Array.from({ length: rows }, () => Array(cols).fill(null));
  drawPixelGridLines();
}

function pixelClick(x, y) {
  const col = Math.floor(x / CONFIG.PIXEL_SIZE);
  const row = Math.floor(y / CONFIG.PIXEL_SIZE);
  const cols = CONFIG.DRAWING_SIZE / CONFIG.PIXEL_SIZE;
  const rows = CONFIG.DRAWING_SIZE / CONFIG.PIXEL_SIZE;
  if (col < 0 || col >= cols || row < 0 || row >= rows) return;

  const color = isEraser ? null : currentColor;
  pixelGrid[row] = pixelGrid[row] || [];
  pixelGrid[row][col] = color;

  drawingCtx.fillStyle = color || '#ffffff';
  drawingCtx.fillRect(col * CONFIG.PIXEL_SIZE, row * CONFIG.PIXEL_SIZE,
    CONFIG.PIXEL_SIZE, CONFIG.PIXEL_SIZE);
  drawPixelGridLines();
}

function drawPixelGridLines() {
  drawingCtx.strokeStyle = '#cccccc';
  drawingCtx.lineWidth = 0.5;
  for (let x = 0; x <= CONFIG.DRAWING_SIZE; x += CONFIG.PIXEL_SIZE) {
    drawingCtx.beginPath();
    drawingCtx.moveTo(x, 0);
    drawingCtx.lineTo(x, CONFIG.DRAWING_SIZE);
    drawingCtx.stroke();
  }
  for (let y = 0; y <= CONFIG.DRAWING_SIZE; y += CONFIG.PIXEL_SIZE) {
    drawingCtx.beginPath();
    drawingCtx.moveTo(0, y);
    drawingCtx.lineTo(CONFIG.DRAWING_SIZE, y);
    drawingCtx.stroke();
  }
}

async function saveDrawing() {
  if (!currentUser) { showToast('Fa\u00e7a login primeiro!'); return; }

  const canvasData = drawingCanvas.toDataURL('image/png');
  const id = crypto.randomUUID ? crypto.randomUUID() :
    Date.now().toString(36) + Math.random().toString(36).slice(2);

  const drawing = {
    id, cellKey: `${selectedLat},${selectedLng}`,
    lat: selectedLat, lng: selectedLng,
    author: currentUser, createdAt: new Date().toISOString(),
    type: currentTool, canvasData
  };

  try {
    await api.createFile(
      `data/drawings/${id}.json`,
      JSON.stringify(drawing, null, 2),
      `WorldPaint: novo desenho por ${currentUser}`
    );

    const meta = {
      id, cellKey: drawing.cellKey, lat: drawing.lat, lng: drawing.lng,
      author: drawing.author, createdAt: drawing.createdAt, type: drawing.type
    };
    drawingsMeta.push(meta);
    await saveDrawingsMeta();

    addMarker(meta);
    $('drawing-modal').style.display = 'none';
    showToast('Desenho salvo!');
  } catch (err) {
    showToast('Erro ao salvar: ' + err.message);
  }
}

function showToast(msg) {
  const toast = $('toast');
  toast.textContent = msg;
  toast.className = 'toast show';
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.className = 'toast', 3000);
}

document.addEventListener('DOMContentLoaded', init);
