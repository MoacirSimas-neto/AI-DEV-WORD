#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod sidecar;

use sidecar::{confirm_tool_install, desktop_bootstrap, get_backend_status, restart_backend, SidecarManager};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, RunEvent, WindowEvent};

struct AppLifecycle {
    quitting: AtomicBool,
    tray_ready: AtomicBool,
}

fn restore_main_window(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
        let _ = app.emit("window-visibility", true);
    }
}

#[tauri::command]
fn minimize_to_tray(app: AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.hide();
        let _ = app.emit("window-visibility", false);
    }
}

#[tauri::command]
fn quit_app(
    app: AppHandle,
    manager: tauri::State<'_, Arc<SidecarManager>>,
    lifecycle: tauri::State<'_, Arc<AppLifecycle>>,
) {
    lifecycle.quitting.store(true, Ordering::SeqCst);
    manager.stop();
    app.exit(0);
}

fn main() {
    let manager = Arc::new(SidecarManager::new());
    let lifecycle = Arc::new(AppLifecycle {
        quitting: AtomicBool::new(false),
        tray_ready: AtomicBool::new(false),
    });

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Arc::clone(&manager))
        .manage(Arc::clone(&lifecycle))
        .invoke_handler(tauri::generate_handler![
            get_backend_status,
            restart_backend,
            desktop_bootstrap,
            confirm_tool_install,
            minimize_to_tray,
            quit_app
        ])
        .setup({
            let mgr = Arc::clone(&manager);
            let lc = Arc::clone(&lifecycle);
            move |app| {
                mgr.start_async(app.handle().clone());

                let open_item = MenuItem::with_id(app, "open", "Abrir AI Dev World", true, None::<&str>)?;
                let quit_item = MenuItem::with_id(app, "quit", "Encerrar completamente", true, None::<&str>)?;
                let menu = Menu::with_items(app, &[&open_item, &quit_item])?;

                let mut tray_builder = TrayIconBuilder::with_id("main-tray")
                    .menu(&menu)
                    .tooltip("AI Dev World")
                    .show_menu_on_left_click(false)
                    .on_menu_event(move |app, event| match event.id.as_ref() {
                        "open" => restore_main_window(app),
                        "quit" => {
                            restore_main_window(app);
                            let _ = app.emit("tray-quit-requested", ());
                        }
                        _ => {}
                    })
                    .on_tray_icon_event(|tray, event| {
                        if let TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        }
                        | TrayIconEvent::DoubleClick {
                            button: MouseButton::Left,
                            ..
                        } = event
                        {
                            restore_main_window(tray.app_handle());
                        }
                    });

                if let Some(icon) = app.default_window_icon().cloned() {
                    tray_builder = tray_builder.icon(icon);
                }

                if tray_builder.build(app).is_ok() {
                    lc.tray_ready.store(true, Ordering::SeqCst);
                }

                Ok(())
            }
        })
        .on_window_event({
            let lc = Arc::clone(&lifecycle);
            move |window, event| {
                if window.label() == "main" {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        if !lc.quitting.load(Ordering::SeqCst) && lc.tray_ready.load(Ordering::SeqCst) {
                            api.prevent_close();
                            let _ = window.emit("close-requested", ());
                        }
                    }
                }
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
