use serde::Serialize;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

#[cfg(target_os = "windows")]
use std::os::windows::io::AsRawHandle;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[cfg(target_os = "windows")]
mod win_job {
    use std::ffi::c_void;
    use std::ptr::null_mut;

    const JOB_OBJECT_EXTENDED_LIMIT_INFORMATION: u32 = 9;
    const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE: u32 = 0x00002000;

    #[repr(C)]
    struct BasicLimitInformation {
        per_process_user_time_limit: i64,
        per_job_user_time_limit: i64,
        limit_flags: u32,
        minimum_working_set_size: usize,
        maximum_working_set_size: usize,
        active_process_limit: u32,
        affinity: usize,
        priority_class: u32,
        scheduling_class: u32,
    }

    #[repr(C)]
    struct IoCounters {
        read_operation_count: u64,
        write_operation_count: u64,
        other_operation_count: u64,
        read_transfer_count: u64,
        write_transfer_count: u64,
        other_transfer_count: u64,
    }

    #[repr(C)]
    struct ExtendedLimitInformation {
        basic_limit_information: BasicLimitInformation,
        io_info: IoCounters,
        process_memory_limit: usize,
        job_memory_limit: usize,
        peak_process_memory_used: usize,
        peak_job_memory_used: usize,
    }

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn CreateJobObjectW(lp_job_attributes: *mut c_void, lp_name: *const u16) -> *mut c_void;
        fn SetInformationJobObject(
            h_job: *mut c_void,
            job_object_info_class: u32,
            lp_job_object_info: *const c_void,
            cb_job_object_info_length: u32,
        ) -> i32;
        fn AssignProcessToJobObject(h_job: *mut c_void, h_process: *mut c_void) -> i32;
        fn CloseHandle(h_object: *mut c_void) -> i32;
    }

    pub struct JobObject(*mut c_void);
    unsafe impl Send for JobObject {}
    unsafe impl Sync for JobObject {}

    impl JobObject {
        pub fn create_kill_on_close() -> Option<Self> {
            unsafe {
                let handle = CreateJobObjectW(null_mut(), null_mut());
                if handle.is_null() {
                    return None;
                }
                let mut info: ExtendedLimitInformation = std::mem::zeroed();
                info.basic_limit_information.limit_flags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                let ok = SetInformationJobObject(
                    handle,
                    JOB_OBJECT_EXTENDED_LIMIT_INFORMATION,
                    (&info as *const ExtendedLimitInformation).cast(),
                    std::mem::size_of::<ExtendedLimitInformation>() as u32,
                );
                if ok == 0 {
                    CloseHandle(handle);
                    return None;
                }
                Some(Self(handle))
            }
        }

        pub fn assign(&self, process_handle: *mut c_void) -> bool {
            unsafe { AssignProcessToJobObject(self.0, process_handle) != 0 }
        }
    }

    impl Drop for JobObject {
        fn drop(&mut self) {
            unsafe {
                CloseHandle(self.0);
            }
        }
    }
}

#[derive(Clone, Serialize)]
pub struct BackendStatus {
    pub status: String,
    pub port: u16,
    pub pid: Option<u32>,
    pub error: Option<String>,
}

#[derive(Clone, Serialize)]
pub struct DesktopBootstrapResult {
    pub port: u16,
    pub code: String,
}

pub struct SidecarManager {
    child: Mutex<Option<Child>>,
    #[cfg(target_os = "windows")]
    job: Mutex<Option<win_job::JobObject>>,
    starting: std::sync::atomic::AtomicBool,
    bootstrap_secret: Mutex<String>,
    status: Mutex<BackendStatus>,
}

impl SidecarManager {
    pub fn new() -> Self {
        Self {
            child: Mutex::new(None),
            #[cfg(target_os = "windows")]
            job: Mutex::new(win_job::JobObject::create_kill_on_close()),
            starting: std::sync::atomic::AtomicBool::new(false),
            bootstrap_secret: Mutex::new(String::new()),
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
        if self
            .starting
            .swap(true, std::sync::atomic::Ordering::SeqCst)
        {
            return;
        }
        let mgr = Arc::clone(self);
        std::thread::spawn(move || {
            mgr.start_blocking(&app);
            mgr.starting
                .store(false, std::sync::atomic::Ordering::SeqCst);
        });
    }

    fn start_blocking(&self, app: &AppHandle) {
        self.stop();

        let port = pick_available_port(4517);
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

        let secret = generate_random_hex_32();
        *self.bootstrap_secret.lock().unwrap() = secret.clone();

        let mut cmd = Command::new(&node_bin);
        cmd.arg(&entry_script)
            .current_dir(&server_dir)
            .env("AIDW_PORT", port.to_string())
            .env("AIDW_DATA_DIR", data_dir.to_string_lossy().to_string())
            .env("AIDW_DESKTOP_BOOTSTRAP_SECRET", &secret)
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
        #[cfg(target_os = "windows")]
        if let Some(ref job) = *self.job.lock().unwrap() {
            let _ = job.assign(child.as_raw_handle());
        }
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

fn bundled_server_dir(resource_dir: &Path) -> Option<PathBuf> {
    [resource_dir.join("_up_/server"), resource_dir.join("server")]
        .into_iter()
        .find(|dir| dir.join("src/index.ts").is_file())
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
        if let Some(server_dir) = bundled_server_dir(&res_dir) {
            return Ok((node_bin, server_dir, PathBuf::from("src/index.ts")));
        }
    }

    // Dev fallback: workspace/server
    let dev_server = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .join("server");
    if cfg!(debug_assertions) && dev_server.join("src/index.ts").exists() {
        return Ok((node_bin, dev_server, PathBuf::from("src/index.ts")));
    }

    Err("Entrada do backend (server/src/index.ts) não encontrada".into())
}

#[cfg(test)]
mod tests {
    #[test]
    fn resolves_sidecar_from_packaged_resource_tree() {
        let root = std::env::temp_dir().join(format!("aidw-sidecar-path-{}", std::process::id()));
        let server = root.join("_up_/server");
        std::fs::create_dir_all(server.join("src")).unwrap();
        std::fs::write(server.join("src/index.ts"), "").unwrap();
        assert_eq!(super::bundled_server_dir(&root), Some(server));
    }
}

#[tauri::command]
pub fn get_backend_status(state: tauri::State<'_, Arc<SidecarManager>>) -> BackendStatus {
    state.get_status()
}

#[tauri::command]
pub fn restart_backend(app: AppHandle, state: tauri::State<'_, Arc<SidecarManager>>) {
    state.start_async(app);
}

#[tauri::command]
pub fn desktop_bootstrap(
    state: tauri::State<'_, Arc<SidecarManager>>,
) -> Result<DesktopBootstrapResult, String> {
    let status = state.get_status();
    if status.status != "ready" {
        return Err("Backend ainda não está pronto".into());
    }
    let secret = state.bootstrap_secret.lock().unwrap().clone();
    if secret.is_empty() {
        return Err("Segredo de bootstrap indisponível".into());
    }
    let port = status.port;
    let addr = format!("127.0.0.1:{port}");
    let mut stream = TcpStream::connect_timeout(
        &addr.parse().map_err(|e| format!("Endereço inválido: {e}"))?,
        Duration::from_millis(800),
    )
    .map_err(|e| format!("Falha ao conectar ao backend: {e}"))?;
    let _ = stream.set_read_timeout(Some(Duration::from_millis(1200)));
    let req = format!(
        "POST /api/desktop-bootstrap HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nx-aidw-desktop-secret: {secret}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
    );
    stream
        .write_all(req.as_bytes())
        .map_err(|e| format!("Falha ao enviar bootstrap: {e}"))?;
    let mut resp = String::new();
    stream
        .read_to_string(&mut resp)
        .map_err(|e| format!("Falha ao ler resposta de bootstrap: {e}"))?;
    let (_, body) = resp
        .split_once("\r\n\r\n")
        .ok_or_else(|| "Resposta HTTP inválida do backend".to_string())?;
    if !resp.starts_with("HTTP/1.1 200") && !resp.starts_with("HTTP/1.0 200") {
        return Err("Bootstrap rejeitado pelo backend".into());
    }
    let code = extract_json_string(body, "code")
        .ok_or_else(|| "Código de pareamento ausente na resposta".to_string())?;
    Ok(DesktopBootstrapResult { port, code })
}

#[tauri::command]
pub fn confirm_tool_install(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<SidecarManager>>,
    tool_id: String,
    title: String,
    details: String,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

    let approved = app
        .dialog()
        .message(details)
        .title(title)
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Confirmar instalação".to_string(),
            "Cancelar".to_string(),
        ))
        .blocking_show();

    if !approved {
        return Ok(None);
    }

    let status = state.get_status();
    if status.status != "ready" {
        return Err("Backend ainda não está pronto".into());
    }
    let secret = state.bootstrap_secret.lock().unwrap().clone();
    if secret.is_empty() {
        return Err("Segredo de bootstrap indisponível".into());
    }
    let port = status.port;
    let addr = format!("127.0.0.1:{port}");
    let payload = format!("{{\"toolId\":\"{}\"}}", tool_id.replace('"', ""));
    let mut stream = TcpStream::connect_timeout(
        &addr.parse().map_err(|e| format!("Endereço inválido: {e}"))?,
        Duration::from_millis(800),
    )
    .map_err(|e| format!("Falha ao conectar ao backend: {e}"))?;
    let _ = stream.set_read_timeout(Some(Duration::from_millis(1200)));
    let req = format!(
        "POST /api/setup/consent HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nx-aidw-desktop-secret: {secret}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        payload.len(),
        payload
    );
    stream
        .write_all(req.as_bytes())
        .map_err(|e| format!("Falha ao solicitar consentimento: {e}"))?;
    let mut resp = String::new();
    stream
        .read_to_string(&mut resp)
        .map_err(|e| format!("Falha ao ler resposta de consentimento: {e}"))?;
    let (_, body) = resp
        .split_once("\r\n\r\n")
        .ok_or_else(|| "Resposta HTTP inválida do backend".to_string())?;
    if !resp.starts_with("HTTP/1.1 200") && !resp.starts_with("HTTP/1.0 200") {
        return Err("Consentimento rejeitado pelo backend".into());
    }
    let nonce = extract_json_string(body, "nonce")
        .ok_or_else(|| "Nonce ausente na resposta".to_string())?;
    Ok(Some(nonce))
}

fn extract_json_string(json: &str, key: &str) -> Option<String> {
    let needle = format!("\"{key}\":\"");
    let start = json.find(&needle)? + needle.len();
    let rest = &json[start..];
    let end = rest.find('"')?;
    Some(rest[..end].to_string())
}

fn generate_random_hex_32() -> String {
    let mut buf = [0u8; 32];
    #[cfg(target_os = "windows")]
    {
        #[link(name = "bcrypt")]
        unsafe extern "system" {
            fn BCryptGenRandom(
                h_algorithm: *mut std::ffi::c_void,
                pb_buffer: *mut u8,
                cb_buffer: u32,
                dw_flags: u32,
            ) -> i32;
        }
        unsafe {
            // BCRYPT_USE_SYSTEM_PREFERRED_RNG = 0x00000002
            let _ = BCryptGenRandom(std::ptr::null_mut(), buf.as_mut_ptr(), 32, 2);
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        if let Ok(mut f) = std::fs::File::open("/dev/urandom") {
            let _ = f.read_exact(&mut buf);
        }
    }
    buf.iter().map(|b| format!("{b:02x}")).collect()
}
