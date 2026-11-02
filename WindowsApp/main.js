const { app, BrowserWindow, dialog, ipcMain } = require('electron');
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

// 앱을 켤 때 GitHub Releases에 새 버전이 있는지 확인하고, 있으면 몰래 받아둡니다.
// 다 받으면 지금 다시 시작할지 묻고, 나중에 하면 앱을 끌 때 설치됩니다.
function checkForUpdates(win) {
  if (!app.isPackaged) return;
  autoUpdater.on('update-downloaded', async (info) => {
    const { response } = await dialog.showMessageBox(win, {
      type: 'info',
      title: '업데이트',
      message: `새 버전(${info.version})이 준비됐어요.`,
      detail: '지금 다시 시작해서 업데이트할까요? 나중에 하면 앱을 끌 때 자동으로 설치돼요.',
      buttons: ['지금 다시 시작', '나중에'],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) autoUpdater.quitAndInstall();
  });
  // 인터넷이 없거나 GitHub에 접속이 안 돼도 앱은 그냥 계속 씁니다.
  autoUpdater.on('error', (error) => console.error('업데이트 확인 실패:', error?.message ?? error));
  autoUpdater.checkForUpdates().catch(() => {});
}

app.whenReady().then(() => {
  const win = createWindow();
  checkForUpdates(win);
});

app.on('window-all-closed', () => app.quit());
