// Tauri IPC Initialization Script
// This script initializes the Tauri API for the application

(function () {
    'use strict';

    // Check if we're running in Tauri
    const isTauri = window.__TAURI_INTERNALS__ !== undefined;

    if (isTauri) {
        console.log('Tauri environment detected, initializing API...');

        // The __TAURI__ global should be automatically available in Tauri v2
        // If it's not, we need to wait for it to load
        const waitForTauri = setInterval(() => {
            if (window.__TAURI__) {
                console.log('Tauri API initialized successfully!');
                clearInterval(waitForTauri);

                // Dispatch event to notify app that Tauri is ready
                window.dispatchEvent(new Event('tauri-ready'));
            }
        }, 50);

        // Timeout after 5 seconds
        setTimeout(() => {
            clearInterval(waitForTauri);
            if (!window.__TAURI__) {
                console.error('Tauri API failed to load within 5 seconds');
            }
        }, 5000);
    } else {
        console.log('Not running in Tauri environment');
    }
})();
