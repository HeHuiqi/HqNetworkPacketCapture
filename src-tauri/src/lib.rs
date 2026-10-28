use std::net::TcpStream;
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::Manager;

static BACKEND_CHILD: Mutex<Option<Child>> = Mutex::new(None);

fn cleanup_backend() {
    let mut lock = match BACKEND_CHILD.lock() {
        Ok(guard) => guard,
        Err(_) => return,
    };

    if let Some(mut child) = lock.take() {
        let pid = child.id();
        log::info!("Shutting down backend process (PID: {})...", pid);

        #[cfg(unix)]
        {
            unsafe {
                libc::kill(pid as i32, libc::SIGTERM);
            }
        }
        #[cfg(not(unix))]
        {
            let _ = child.kill();
        }

        // Wait up to 1.5 seconds for graceful shutdown
        let start = Instant::now();
        loop {
            match child.try_wait() {
                Ok(Some(status)) => {
                    log::info!("Backend process exited cleanly with status: {:?}", status);
                    break;
                }
                Ok(None) => {
                    if start.elapsed() > Duration::from_millis(1500) {
                        log::warn!("Backend process did not exit in time, killing forcefully...");
                        let _ = child.kill();
                        let _ = child.wait();
                        break;
                    }
                    std::thread::sleep(Duration::from_millis(50));
                }
                Err(e) => {
                    log::error!("Error waiting for backend process: {}", e);
                    break;
                }
            }
        }
    }
}

fn resolve_paths(app: &tauri::AppHandle) -> (PathBuf, PathBuf, PathBuf) {
    // Check if we are running in a bundled release app
    if let Ok(resource_dir) = app.path().resource_dir() {
        let backend_dir = resource_dir.join("backend");
        let bundled_node = backend_dir.join("bin").join("node");
        let bundled_index = backend_dir.join("index.js");

        if bundled_index.exists() {
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                if bundled_node.exists() {
                    let _ = std::fs::set_permissions(
                        &bundled_node,
                        std::fs::Permissions::from_mode(0o755),
                    );
                }
            }
            let node_bin = if bundled_node.exists() {
                bundled_node
            } else {
                PathBuf::from("node")
            };
            return (node_bin, bundled_index, backend_dir);
        }
    }

    // Fallback to development mode (workspace root)
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let root = if cwd.join("index.js").exists() {
        cwd
    } else if cwd.join("../index.js").exists() {
        cwd.join("..")
    } else {
        cwd
    };

    let index_js = root.join("index.js");
    let node_bin = PathBuf::from("node");
    (node_bin, index_js, root)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .setup(|app| {
            let handle = app.handle();
            let (node_bin, index_js, work_dir) = resolve_paths(handle);

            log::info!(
                "Starting backend proxy...\n  Node: {}\n  Script: {}\n  CWD: {}",
                node_bin.display(),
                index_js.display(),
                work_dir.display()
            );

            let mut cmd = Command::new(&node_bin);
            cmd.arg(&index_js);
            cmd.current_dir(&work_dir);
            cmd.stdin(std::process::Stdio::piped());
            cmd.env("NODE_ENV", "production");
            cmd.env("PROXY_PORT", "8888");
            cmd.env("WEB_PORT", "8899");

            match cmd.spawn() {
                Ok(child) => {
                    log::info!("Backend proxy server spawned with PID: {}", child.id());
                    if let Ok(mut lock) = BACKEND_CHILD.lock() {
                        *lock = Some(child);
                    }
                }
                Err(err) => {
                    log::error!("Failed to spawn backend proxy: {}", err);
                }
            }

            // Wait until Web Server is up on port 8899 (max 10 seconds)
            log::info!("Waiting for web console to become ready on 127.0.0.1:8899...");
            let start = Instant::now();
            let timeout = Duration::from_secs(10);
            let mut ready = false;

            while start.elapsed() < timeout {
                if TcpStream::connect("127.0.0.1:8899").is_ok() {
                    ready = true;
                    log::info!(
                        "Web console ready in {}ms!",
                        start.elapsed().as_millis()
                    );
                    break;
                }
                std::thread::sleep(Duration::from_millis(50));
            }

            if !ready {
                log::warn!("Timeout waiting for port 8899, proceeding anyway");
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                log::info!("Window close requested, exiting application...");
                window.app_handle().exit(0);
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|_app_handle, event| match event {
        tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit => {
            cleanup_backend();
        }
        _ => {}
    });
}
