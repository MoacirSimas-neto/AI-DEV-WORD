use serde::Serialize;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Clone, Serialize)]
pub struct BackendStatus {
    pub status: String,
    pub port: u16,
    pub pid: Option<u32>,
    pub error: Option<String>,
}

pub struct SidecarManager {
    child: Mutex<Option<Child>>,
    status: Mutex<BackendStatus>,
}

impl SidecarManager {
    pub fn new() -> Self {
        Self {
            child: Mutex::new(None),
            status: Mutex::new(BackendStatus {
                status: "starting".into(),
                port: 4517,
                pid: None,
                error: None,
            }),
        }
    }

    pub fn get_status(&self) -> BackendStatus {
        self.status.lock().unwrap().clone()
    }

    fn set_status(&self, app: &AppHandle, next: BackendStatus) {
        *self.status.lock().unwrap() = next.clone();
        let _ = app.emit("backend-status", next);
    }

    pub fn stop(&self) {
        if let Some(mut child) = self.child.lock().unwrap().take() {
            let pid = child.id();
            #[cfg(target_os = "windows")]
            {
                let _ = Command::new("taskkill")
                    .args(["/F", "/T", "/PID", &pid.to_string()])
                    .creation_flags(CREATE_NO_WINDOW)
                    .output();
            }
            let _ = child.kill();
            let _ = child.wait();
        }
    }

    pub fn start_async(self: &Arc<Self>, app: AppHandle) {
        let mgr = Arc::clone(self);
        std::thread::spawn(move || {
            mgr.start_blocking(&app);
        });
    }

    fn start_blocking(&self, app: &AppHandle) {
        self.stop();

        let default_port: u16 = 4517;
        if is_backend_healthy(default_port) {
            self.set_status(
                app,
                BackendStatus {
                    status: "ready".into(),
                    port: default_port,
                    pid: None,
                    error: None,
                },
            );
            return;
        }

        let port = pick_available_port(default_port);
        self.set_status(
            app,
            BackendStatus {
                status: "starting".into(),
                port,
                pid: None,
                error: None,
            },
        );

        let (node_bin, server_dir, entry_script) = match resolve_paths(app) {
            Ok(paths) => paths,
            Err(err) => {
                self.set_status(
                    app,
                    BackendStatus {
                        status: "error".into(),
                        port,
                        pid: None,
                        error: Some(err),
                    },
                );
                return;
            }
        };

        let data_dir = app
            .path()
            .app_data_dir()
            .unwrap_or_else(|_| std::env::temp_dir().join("ai-dev-world"));
        let _ = std::fs::create_dir_all(&data_dir);

        let mut cmd = Command::new(&node_bin);
        cmd.arg(&entry_script)
            .current_dir(&server_dir)
            .env("AIDW_PORT", port.to_string())
            .env("AIDW_DATA_DIR", data_dir.to_string_lossy().to_string())
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped());

        #[cfg(target_os = "windows")]
        cmd.creation_flags(CREATE_NO_WINDOW);

        let child = match cmd.spawn() {
            Ok(c) => c,
            Err(e) => {
                self.set_status(
                    app,
                    BackendStatus {
                        status: "error".into(),
                        port,
                        pid: None,
                        error: Some(format!("Falha ao iniciar Node sidecar: {e}")),
                    },
                );
                return;
            }
        };

        let pid = child.id();
        *self.child.lock().unwrap() = Some(child);

        let deadline = Instant::now() + Duration::from_secs(12);
        while Instant::now() < deadline {
            if is_backend_healthy(port) {
                self.set_status(
                    app,
                    BackendStatus {
                        status: "ready".into(),
                        port,
                        pid: Some(pid),
                        error: None,
                    },
                );
                return;
            }
            if let Some(ref mut c) = *self.child.lock().unwrap() {
                if let Ok(Some(exit)) = c.try_wait() {
                    let mut stderr_msg = String::new();
                    if let Some(mut err_pipe) = c.stderr.take() {
                        let _ = err_pipe.read_to_string(&mut stderr_msg);
                    }
                    let detail = if stderr_msg.trim().is_empty() {
                        format!("Backend encerrou prematuramente ({exit})")
                    } else {
                        stderr_msg.lines().take(3).collect::<Vec<_>>().join(" | ")
                    };
                    self.set_status(
                        app,
                        BackendStatus {
                            status: "error".into(),
                            port,
                            pid: None,
                            error: Some(detail),
                        },
                    );
                    return;
                }
            }
            std::thread::sleep(Duration::from_millis(120));
        }

        self.stop();
        self.set_status(
            app,
            BackendStatus {
                status: "error".into(),
                port,
                pid: None,
                error: Some("Tempo limite aguardando /api/session do backend".into()),
            },
        );
    }
}

fn pick_available_port(preferred: u16) -> u16 {
    if TcpListener::bind(("127.0.0.1", preferred)).is_ok() {
        return preferred;
    }
    TcpListener::bind(("127.0.0.1", 0))
        .and_then(|l| l.local_addr())
        .map(|a| a.port())
        .unwrap_or(preferred)
}

fn is_backend_healthy(port: u16) -> bool {
    let addr = format!("127.0.0.1:{port}");
    let Ok(mut stream) = TcpStream::connect_timeout(
        &addr.parse().unwrap(),
        Duration::from_millis(250),
    ) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(400)));
    let req = format!("GET /api/session HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n");
    if stream.write_all(req.as_bytes()).is_err() {
        return false;
    }
    let mut buf = [0u8; 64];
    match stream.read(&mut buf) {
        Ok(n) if n > 0 => {
            let head = String::from_utf8_lossy(&buf[..n]);
            head.starts_with("HTTP/1.1 200") || head.starts_with("HTTP/1.0 200")
        }
        _ => false,
    }
}

fn resolve_paths(app: &AppHandle) -> Result<(PathBuf, PathBuf, PathBuf), String> {
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(Path::to_path_buf))
        .ok_or_else(|| "Não foi possível localizar diretório do executável".to_string())?;

    let node_candidates = [
        exe_dir.join("node.exe"),
        exe_dir.join("node-x86_64-pc-windows-msvc.exe"),
        exe_dir.join("binaries/node-x86_64-pc-windows-msvc.exe"),
        PathBuf::from("node"),
    ];
    let node_bin = node_candidates
        .into_iter()
        .find(|p| p == Path::new("node") || p.exists())
        .ok_or_else(|| "Runtime Node sidecar não encontrado".to_string())?;

    if let Ok(res_dir) = app.path().resource_dir() {
        let bundled_server = res_dir.join("server");
        let bundled_entry = bundled_server.join("src").join("index.ts");
        if bundled_entry.exists() {
            return Ok((node_bin, bundled_server, PathBuf::from("src/index.ts")));
        }
    }

    // Dev fallback: workspace/server
    let dev_server = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .join("server");
    if dev_server.join("src/index.ts").exists() {
        return Ok((node_bin, dev_server, PathBuf::from("src/index.ts")));
    }

    Err("Entrada do backend (server/src/index.ts) não encontrada".into())
}

#[tauri::command]
pub fn get_backend_status(state: tauri::State<'_, Arc<SidecarManager>>) -> BackendStatus {
    state.get_status()
}

#[tauri::command]
pub fn restart_backend(app: AppHandle, state: tauri::State<'_, Arc<SidecarManager>>) {
    state.start_async(app);
}
