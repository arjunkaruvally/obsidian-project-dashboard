const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
    selectVault: () => ipcRenderer.invoke('select-vault'),
    readVault: (vaultPath) => ipcRenderer.invoke('read-vault', vaultPath),
    getStoredVaultPath: () => ipcRenderer.invoke('get-stored-vault-path'),
    onVaultChange: (callback) => {
        ipcRenderer.on('vault-changed', callback);
    },
    removeVaultChangeListener: () => {
        ipcRenderer.removeAllListeners('vault-changed');
    }
});
