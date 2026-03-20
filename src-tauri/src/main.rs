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

#[tauri::command]
fn save_planner_data(app_handle: tauri::AppHandle, data: String) -> Result<(), String> {
    let app_dir = app_handle
        .path_resolver()
        .app_data_dir()
        .ok_or("Could not get app data directory")?;
    
    fs::create_dir_all(&app_dir).map_err(|e| format!("Failed to create app dir: {}", e))?;
    
    let planner_file = app_dir.join("planner_data.json");
    fs::write(&planner_file, data).map_err(|e| format!("Failed to save planner data: {}", e))?;
    
    Ok(())
}

#[tauri::command]
fn load_planner_data(app_handle: tauri::AppHandle) -> Result<Option<String>, String> {
    let app_dir = app_handle
        .path_resolver()
        .app_data_dir()
        .ok_or("Could not get app data directory")?;
    
    let planner_file = app_dir.join("planner_data.json");
    
    if planner_file.exists() {
        let content = fs::read_to_string(&planner_file)
            .map_err(|e| format!("Failed to read planner data: {}", e))?;
        Ok(Some(content))
    } else {
        Ok(None)
    }
}

#[tauri::command]
fn start_watching_vault(app_handle: tauri::AppHandle, path: String, state: tauri::State<AppState>) -> Result<(), String> {
    // Store vault path and start file watcher without showing folder picker
    if let Ok(mut vault_path) = state.vault_path.lock() {
        *vault_path = Some(path.clone());
    }
    start_watching(app_handle, path, &state);
    Ok(())
}

#[tauri::command]
fn fetch_ical_url(url: String) -> Result<String, String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;
    
    let response = client
        .get(&url)
        .header("User-Agent", "ObsidianVaultDashboard/1.0")
        .send()
        .map_err(|e| format!("Failed to fetch URL: {}", e))?;
    
    if !response.status().is_success() {
        return Err(format!("HTTP error: {}", response.status()));
    }
    
    response.text()
        .map_err(|e| format!("Failed to read response: {}", e))
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
            get_stored_vault_path,
            save_planner_data,
            load_planner_data,
            start_watching_vault,
            fetch_ical_url
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
