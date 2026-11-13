#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod sidecar;

use sidecar::{desktop_bootstrap, get_backend_status, restart_backend, SidecarManager};
use std::sync::Arc;
use tauri::RunEvent;

fn main() {
    let manager = Arc::new(SidecarManager::new());

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Arc::clone(&manager))
        .invoke_handler(tauri::generate_handler![
            get_backend_status,
            restart_backend,
            desktop_bootstrap
        ])
        .setup({
            let mgr = Arc::clone(&manager);
            move |app| {
                mgr.start_async(app.handle().clone());
                Ok(())
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building AI Dev World desktop shell");

    app.run(move |_app_handle, event| {
        if let RunEvent::Exit = event {
            manager.stop();
        }
    });
}
