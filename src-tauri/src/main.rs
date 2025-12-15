#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use notify::{Watcher, RecursiveMode, Event};
use serde::{Deserialize, Serialize};
use tauri::Manager;

#[derive(Debug, Serialize, Deserialize)]
struct VaultEntry {
    name: String,
    path: String,
    #[serde(rename = "type")]
    entry_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    content: Option<String>,
}

struct AppState {
    vault_path: Arc<Mutex<Option<String>>>,
    watcher: Arc<Mutex<Option<notify::RecommendedWatcher>>>,
}

#[tauri::command]
async fn select_vault(app_handle: tauri::AppHandle) -> Result<String, String> {
    use tauri::api::dialog::FileDialogBuilder;
    
    let (tx, rx) = std::sync::mpsc::channel();
    
    FileDialogBuilder::new()
        .set_title("Select Obsidian Vault Folder")
        .pick_folder(move |folder_path| {
            tx.send(folder_path).ok();
        });
    
    let folder = rx.recv().map_err(|e| format!("Dialog error: {}", e))?;
    
    if let Some(path) = folder {
        let path_str = path.to_string_lossy().to_string();
        
        // Store the vault path
        if let Some(state) = app_handle.try_state::<AppState>() {
            if let Ok(mut vault_path) = state.vault_path.lock() {
                *vault_path = Some(path_str.clone());
            }
            
            // Start watching the vault
            start_watching(app_handle.clone(), path_str.clone(), &state);
        }
        
        Ok(path_str)
    } else {
        Err("No folder selected".to_string())
    }
}

#[tauri::command]
fn read_vault_dir(path: String) -> Result<Vec<VaultEntry>, String> {
    let path_buf = PathBuf::from(&path);
    
    if !path_buf.exists() {
        return Err(format!("Path does not exist: {}", path));
    }
    
    let mut entries = Vec::new();
    
    match fs::read_dir(&path_buf) {
        Ok(dir_entries) => {
            for entry in dir_entries {
                if let Ok(entry) = entry {
                    let entry_path = entry.path();
                    let name = entry.file_name().to_string_lossy().to_string();
                    
                    // Skip hidden files
                    if name.starts_with('.') {
                        continue;
                    }
                    
                    if entry_path.is_dir() {
                        entries.push(VaultEntry {
                            name,
                            path: entry_path.to_string_lossy().to_string(),
                            entry_type: "directory".to_string(),
                            content: None,
                        });
                    } else if entry_path.is_file() && name.ends_with(".md") {
                        let content = fs::read_to_string(&entry_path)
                            .unwrap_or_else(|_| String::new());
                        
                        entries.push(VaultEntry {
                            name,
                            path: entry_path.to_string_lossy().to_string(),
                            entry_type: "file".to_string(),
                            content: Some(content),
                        });
                    }
                }
            }
        }
        Err(e) => return Err(format!("Failed to read directory: {}", e)),
    }
    
    Ok(entries)
}

#[tauri::command]
fn get_stored_vault_path(state: tauri::State<AppState>) -> Result<Option<String>, String> {
    if let Ok(vault_path) = state.vault_path.lock() {
        Ok(vault_path.clone())
    } else {
        Err("Failed to access vault path".to_string())
    }
}

fn start_watching(app_handle: tauri::AppHandle, vault_path: String, state: &tauri::State<AppState>) {
    use notify::EventKind;
    use std::sync::mpsc::channel;
    
    // Stop existing watcher if any
    if let Ok(mut watcher_guard) = state.watcher.lock() {
        *watcher_guard = None;
    }
    
    let (tx, rx) = channel();
    
    let mut watcher = notify::recommended_watcher(move |res: Result<Event, notify::Error>| {
        if let Ok(event) = res {
            match event.kind {
                EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_) => {
                    let _ = tx.send(());
                }
                _ => {}
            }
        }
    }).ok();
    
    if let Some(ref mut w) = watcher {
        let _ = w.watch(vault_path.as_ref(), RecursiveMode::Recursive);
        
        // Spawn a thread to handle file change events with debouncing
        let app_handle_clone = app_handle.clone();
        std::thread::spawn(move || {
            let mut last_event_time = std::time::Instant::now();
            
            loop {
                if let Ok(_) = rx.recv_timeout(Duration::from_millis(100)) {
                    last_event_time = std::time::Instant::now();
                }
                
                // Debounce: only emit event if 500ms have passed since last change
                if last_event_time.elapsed() >= Duration::from_millis(500) 
                    && last_event_time.elapsed() < Duration::from_millis(600) {
                    let _ = app_handle_clone.emit_all("vault-changed", ());
                }
            }
        });
    }
    
    // Store the watcher
    if let Ok(mut watcher_guard) = state.watcher.lock() {
        *watcher_guard = watcher;
    }
}

fn main() {
    tauri::Builder::default()
        .manage(AppState {
            vault_path: Arc::new(Mutex::new(None)),
            watcher: Arc::new(Mutex::new(None)),
        })
        .invoke_handler(tauri::generate_handler![
            select_vault,
            read_vault_dir,
            get_stored_vault_path
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
