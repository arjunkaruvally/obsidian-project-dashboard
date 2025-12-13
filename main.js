const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const chokidar = require('chokidar');

let mainWindow;
let vaultWatcher = null;
let currentVaultPath = null;

// Store for persisting vault path
const Store = require('electron-store');
const store = new Store();

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        },
        title: 'Obsidian Vault Dashboard',
        backgroundColor: '#0a0e1a'
    });

    mainWindow.loadFile('index.html');

    // Create menu
    const template = [
        {
            label: 'File',
            submenu: [
                {
                    label: 'Open Vault',
                    accelerator: 'CmdOrCtrl+O',
                    click: () => {
                        selectVault();
                    }
                },
                { type: 'separator' },
                {
                    label: 'Quit',
                    accelerator: 'CmdOrCtrl+Q',
                    click: () => {
                        app.quit();
                    }
                }
            ]
        },
        {
            label: 'View',
            submenu: [
                { role: 'reload' },
                { role: 'toggleDevTools' },
                { type: 'separator' },
                { role: 'resetZoom' },
                { role: 'zoomIn' },
                { role: 'zoomOut' }
            ]
        }
    ];

    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
}

async function selectVault() {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory'],
        title: 'Select Obsidian Vault Folder'
    });

    if (!result.canceled && result.filePaths.length > 0) {
        const vaultPath = result.filePaths[0];
        currentVaultPath = vaultPath;

        // Store vault path for next launch
        store.set('lastVaultPath', vaultPath);

        // Start watching the vault
        startWatching(vaultPath);

        return vaultPath;
    }
    return null;
}

function startWatching(vaultPath) {
    // Stop existing watcher if any
    if (vaultWatcher) {
        vaultWatcher.close();
    }

    // Watch for changes in markdown files
    vaultWatcher = chokidar.watch(vaultPath, {
        ignored: /(^|[\/\\])\../, // ignore dotfiles
        persistent: true,
        ignoreInitial: true,
        depth: 10
    });

    let debounceTimer;
    const notifyChange = () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('vault-changed');
            }
        }, 500); // 500ms debounce
    };

    vaultWatcher
        .on('add', notifyChange)
        .on('change', notifyChange)
        .on('unlink', notifyChange);

    console.log(`Watching vault: ${vaultPath}`);
}

async function readVaultDirectory(dirPath) {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const result = [];

    for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);

        if (entry.isDirectory()) {
            result.push({
                name: entry.name,
                path: fullPath,
                type: 'directory'
            });
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
            const content = await fs.readFile(fullPath, 'utf-8');
            result.push({
                name: entry.name,
                path: fullPath,
                type: 'file',
                content: content
            });
        }
    }

    return result;
}

// IPC Handlers
ipcMain.handle('select-vault', async () => {
    return await selectVault();
});

ipcMain.handle('read-vault', async (event, vaultPath) => {
    try {
        return await readVaultDirectory(vaultPath);
    } catch (error) {
        console.error('Error reading vault:', error);
        throw error;
    }
});

ipcMain.handle('get-stored-vault-path', () => {
    return store.get('lastVaultPath', null);
});

app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (vaultWatcher) {
        vaultWatcher.close();
    }
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
