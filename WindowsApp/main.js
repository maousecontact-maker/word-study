const { app, BrowserWindow, ipcMain, net, session } = require('electron');
const { autoUpdater } = require('electron-updater');
const fs = require('node:fs');
const path = require('node:path');

// 단어장 데이터는 %APPDATA%\단어장\data.json 에 저장됩니다. (앱을 지웠다 깔아도 남아 있음)
const dataFile = () => path.join(app.getPath('userData'), 'data.json');

ipcMain.handle('data:load', () => {
  try {
    return fs.readFileSync(dataFile(), 'utf8');
  } catch {
    return null;
  }
});

// 앱이 갑자기 꺼져도 파일이 깨지지 않도록 임시 파일에 쓴 뒤 바꿔치기
ipcMain.handle('data:save', (_event, json) => {
  const file = dataFile();
  const temp = `${file}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(temp, json, 'utf8');
  fs.renameSync(temp, file);
});

// MARK: - 발음 녹음 저장
// 한 번 받은 원어민 녹음은 %APPDATA%\단어장\pronunciations\ 에 저장해서 다음부터 바로 재생합니다.
const audioDir = () => path.join(app.getPath('userData'), 'pronunciations');
const audioTypes = { ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', mp3: 'audio/mpeg', wav: 'audio/wav' };
/** 단어 → 파일 이름 (renderer에서 이미 a-z, ', -, 공백만 남긴 단어가 옴) */
const audioName = (key) => String(key).toLowerCase().replace(/[^a-z-]/g, '_').slice(0, 60);

ipcMain.handle('audio:load', (_event, key) => {
  const name = audioName(key);
  for (const ext of Object.keys(audioTypes)) {
    try {
      return { bytes: fs.readFileSync(path.join(audioDir(), `${name}.${ext}`)), type: audioTypes[ext] };
    } catch {
      // 이 확장자로는 없음
    }
  }
  return null;
});

ipcMain.handle('audio:download', async (_event, key, url) => {
  const ext = new URL(url).pathname.split('.').pop().toLowerCase();
  if (!url.startsWith('https://') || !audioTypes[ext]) return null;
  try {
    const response = await net.fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < 500 || bytes.length > 3_000_000) return null; // 에러 글자나 너무 큰 파일은 버림
    fs.mkdirSync(audioDir(), { recursive: true });
    const file = path.join(audioDir(), `${audioName(key)}.${ext}`);
    fs.writeFileSync(`${file}.tmp`, bytes);
    fs.renameSync(`${file}.tmp`, file);
    return { bytes, type: audioTypes[ext] };
  } catch {
    return null;
  }
});

function createWindow() {
  const win = new BrowserWindow({
    width: 900,
    height: 760,
    minWidth: 420,
    minHeight: 500,
    title: '단어장',
    autoHideMenuBar: true,
    backgroundColor: '#f2f2f7',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  return win;
}

// MARK: - 업데이트
// 앱을 켤 때, 그리고 "업데이트 확인"을 누를 때 GitHub Releases에서 새 버전을 찾습니다.
// 있으면 자동으로 받고, 받는 동안 화면 아래에 진행률을 보여줍니다.
// 다 받으면 "지금 다시 시작"을 누르거나, 앱을 끌 때 설치됩니다.
//
// state: idle(아직 확인 안 함) | checking | latest(최신) | downloading | downloaded | error | dev(개발 실행 중)
let updateStatus = { state: app.isPackaged ? 'idle' : 'dev' };
let mainWindow = null;

function setUpdateStatus(next) {
  updateStatus = next;
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('update:status', updateStatus);
}

autoUpdater.on('checking-for-update', () => setUpdateStatus({ state: 'checking' }));
autoUpdater.on('update-not-available', () => setUpdateStatus({ state: 'latest' }));
autoUpdater.on('update-available', (info) =>
  setUpdateStatus({ state: 'downloading', version: info.version, percent: 0 }));
autoUpdater.on('download-progress', (p) =>
  setUpdateStatus({
    state: 'downloading',
    version: updateStatus.version,
    percent: p.percent,
    transferred: p.transferred,
    total: p.total,
    bytesPerSecond: p.bytesPerSecond,
  }));
autoUpdater.on('update-downloaded', (info) => setUpdateStatus({ state: 'downloaded', version: info.version }));
// 인터넷이 없거나 GitHub에 접속이 안 돼도 앱은 그냥 계속 씁니다.
autoUpdater.on('error', (error) => {
  console.error('업데이트 실패:', error?.message ?? error);
  setUpdateStatus({ state: 'error', version: updateStatus.version, message: String(error?.message ?? error) });
});

function checkForUpdates() {
  if (!app.isPackaged) return;
  // 이미 확인하거나 받는 중이면 다시 시작하지 않습니다.
  if (['checking', 'downloading', 'downloaded'].includes(updateStatus.state)) return;
  autoUpdater.checkForUpdates().catch(() => {}); // 실패는 위의 'error'에서 처리
}

ipcMain.handle('update:get', () => ({ ...updateStatus, appVersion: app.getVersion() }));
ipcMain.handle('update:check', () => checkForUpdates());
ipcMain.handle('update:install', () => {
  if (updateStatus.state === 'downloaded') autoUpdater.quitAndInstall();
});

// 위키낱말사전(발음 녹음)은 앱 이름을 밝힌 요청을 권장합니다. 이름 없는 요청은 막힐 수 있어요.
function identifyToWikimedia() {
  const userAgent = `WordStudy/${app.getVersion()} (https://github.com/maousecontact-maker/word-study)`;
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ['https://*.wiktionary.org/*', 'https://*.wikimedia.org/*'] },
    (details, callback) => callback({ requestHeaders: { ...details.requestHeaders, 'User-Agent': userAgent } }),
  );
}

app.whenReady().then(() => {
  identifyToWikimedia();
  mainWindow = createWindow();
  checkForUpdates();
});

app.on('window-all-closed', () => app.quit());
