const { app, BrowserWindow, Menu, shell, dialog } = require('electron');
const path = require('path');
const proxyServer = require('./src/proxy-server');
const webServer = require('./src/web-server');
const systemProxyManager = require('./src/system-proxy-manager');

const PROXY_PORT = parseInt(process.env.PROXY_PORT || '8888', 10);
const WEB_PORT = parseInt(process.env.WEB_PORT || '8899', 10);

let mainWindow = null;
let isQuitting = false;

// 确保单实例运行
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit(0);
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

function setupMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    }] : []),
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' }
      ]
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '刷新' },
        { role: 'forceReload', label: '强制刷新' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '重置缩放' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' }
      ]
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize', label: '最小化' },
        { role: 'zoom', label: '缩放' },
        ...(isMac ? [
          { type: 'separator' },
          { role: 'front', label: '前置所有窗口' }
        ] : [
          { role: 'close', label: '关闭' }
        ])
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

async function createWindow() {
  setupMenu();

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1000,
    minHeight: 650,
    title: 'HQ Network Debugger & MapLocal Mock',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    },
    show: false
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // 外部链接交由系统默认浏览器打开
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  await mainWindow.loadURL(`http://127.0.0.1:${WEB_PORT}`);
}

async function shutdown() {
  if (isQuitting) return;
  isQuitting = true;
  console.log('[Electron] 正在关闭代理服务并还原系统代理...');
  try {
    systemProxyManager.restore();
    await proxyServer.stop();
    webServer.stop();
  } catch (err) {
    console.error('[Electron] 停止服务时出错:', err);
  }
}

app.whenReady().then(async () => {
  try {
    console.log('[Electron] 正在启动后端服务...');
    // 1. 启动代理内核
    await proxyServer.start(PROXY_PORT);
    // 2. 启动 Web 控制台
    webServer.start(WEB_PORT);
    // 3. 创建主窗口
    await createWindow();
  } catch (err) {
    console.error('[Electron] 启动失败:', err);
    dialog.showErrorBox('启动失败', `代理服务启动失败: ${err.message}`);
    app.quit();
  }
});

app.on('window-all-closed', async () => {
  await shutdown();
  app.quit();
});

app.on('before-quit', async (event) => {
  if (!isQuitting) {
    event.preventDefault();
    await shutdown();
    app.exit(0);
  }
});
