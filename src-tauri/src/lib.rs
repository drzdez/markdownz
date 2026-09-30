//! Native side of Markdownz: reading and watching files, persisting state and
//! routing "open this file" requests (command line, second instance, macOS
//! file associations) to the single viewer window.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};

#[derive(Serialize)]
struct Doc {
    path: String,
    content: String,
}

/// Files requested before the frontend was ready to receive events.
#[derive(Default)]
struct Pending {
    ready: bool,
    files: Vec<String>,
}

/// Watches parent directories (not the files) so atomic "write temp + rename"
/// saves done by most editors are still noticed.
struct DocWatcher {
    watcher: Mutex<Option<RecommendedWatcher>>,
    dirs: Mutex<HashSet<PathBuf>>,
    files: Arc<Mutex<HashSet<String>>>,
}

fn path_key(path: &Path) -> String {
    let s = path.to_string_lossy();
    if cfg!(any(windows, target_os = "macos")) {
        s.to_lowercase()
    } else {
        s.into_owned()
    }
}

#[tauri::command]
fn read_doc(path: String) -> Result<Doc, String> {
    let canonical = dunce::canonicalize(&path).map_err(|e| format!("{path}: {e}"))?;
    let bytes = std::fs::read(&canonical).map_err(|e| format!("{path}: {e}"))?;
    let bytes = bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(&bytes);
    Ok(Doc {
        path: canonical.to_string_lossy().into_owned(),
        content: String::from_utf8_lossy(bytes).into_owned(),
    })
}

/// Canonical path of an existing file.
#[tauri::command]
fn resolve_path(path: String) -> Result<String, String> {
    let canonical = dunce::canonicalize(&path).map_err(|e| format!("{path}: {e}"))?;
    if !canonical.is_file() {
        return Err(format!("{path}: not a file"));
    }
    Ok(canonical.to_string_lossy().into_owned())
}

/// Raw file content (PDF and other binary formats), sent as an ArrayBuffer.
#[tauri::command]
fn read_binary(path: String) -> Result<tauri::ipc::Response, String> {
    let bytes = std::fs::read(&path).map_err(|e| format!("{path}: {e}"))?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Opens `path` in another application: `program` with `args` ("{file}" is
/// replaced by the path, which is appended when there is no placeholder), or
/// the system "choose an application" dialog when `program` is None.
#[tauri::command]
async fn open_with(path: String, program: Option<String>, args: Option<Vec<String>>) -> Result<(), String> {
    let file = dunce::canonicalize(&path).map_err(|e| format!("{path}: {e}"))?;
    if !file.is_file() {
        return Err(format!("{path}: not a file"));
    }
    match program {
        Some(program) => {
            let file = file.to_string_lossy().into_owned();
            let mut args = args.unwrap_or_default();
            if !args.iter().any(|a| a.contains("{file}")) {
                args.push("{file}".into());
            }
            std::process::Command::new(&program)
                .args(args.iter().map(|a| a.replace("{file}", &file)))
                .spawn()
                .map(|_| ())
                .map_err(|e| format!("{program}: {e}"))
        }
        None => choose_application(&file).await,
    }
}

#[cfg(windows)]
async fn choose_application(file: &Path) -> Result<(), String> {
    // The shell's "How do you want to open this file?" dialog.
    std::process::Command::new("rundll32.exe")
        .arg("shell32.dll,OpenAs_RunDLL")
        .arg(file)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[cfg(target_os = "linux")]
async fn choose_application(file: &Path) -> Result<(), String> {
    use std::os::fd::AsFd;
    let handle = std::fs::File::open(file).map_err(|e| e.to_string())?;
    ashpd::desktop::open_uri::OpenFileRequest::default()
        .ask(true)
        .send_file(&handle.as_fd())
        .await
        .map(|_| ())
        .map_err(|e| format!("xdg-desktop-portal: {e}"))
}

#[cfg(not(any(windows, target_os = "linux")))]
async fn choose_application(_file: &Path) -> Result<(), String> {
    // macOS has no system chooser; the frontend lets the user pick an app bundle instead.
    Err("not supported on this platform".into())
}

#[tauri::command]
fn watch_docs(paths: Vec<String>, state: State<'_, DocWatcher>) -> Result<(), String> {
    let files: Vec<PathBuf> = paths.iter().map(PathBuf::from).collect();
    let wanted: HashSet<PathBuf> = files
        .iter()
        .filter_map(|p| p.parent().map(Path::to_path_buf))
        .collect();

    *state.files.lock().unwrap() = files.iter().map(|p| path_key(p)).collect();

    let mut guard = state.watcher.lock().unwrap();
    let Some(watcher) = guard.as_mut() else {
        return Ok(());
    };
    let mut dirs = state.dirs.lock().unwrap();
    for dir in dirs.difference(&wanted) {
        let _ = watcher.unwatch(dir);
    }
    for dir in wanted.difference(&dirs.clone()) {
        if let Err(e) = watcher.watch(dir, RecursiveMode::NonRecursive) {
            eprintln!("cannot watch {}: {e}", dir.display());
        }
    }
    *dirs = wanted;
    Ok(())
}

fn state_file(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    if name.is_empty() || !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err(format!("invalid state name {name:?}"));
    }
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(format!("{name}.json")))
}

#[tauri::command]
fn load_state(app: AppHandle, name: String) -> Result<Option<String>, String> {
    let file = state_file(&app, &name)?;
    match std::fs::read_to_string(file) {
        Ok(data) => Ok(Some(data)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn save_state(app: AppHandle, name: String, data: String) -> Result<(), String> {
    let file = state_file(&app, &name)?;
    let tmp = file.with_extension("json.tmp");
    std::fs::write(&tmp, data).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &file).map_err(|e| e.to_string())
}

#[tauri::command]
fn take_startup_files(state: State<'_, Mutex<Pending>>) -> Vec<String> {
    let mut pending = state.lock().unwrap();
    pending.ready = true;
    std::mem::take(&mut pending.files)
}

#[tauri::command]
fn print_page(window: WebviewWindow) -> Result<(), String> {
    window.print().map_err(|e| e.to_string())
}

/// Existing files named on a command line; relative paths are resolved against `cwd`.
/// Anything else (flags, OS-specific extras) is ignored.
fn files_from_args(args: impl IntoIterator<Item = String>, cwd: &Path) -> Vec<String> {
    args.into_iter()
        .filter(|a| !a.starts_with('-'))
        .map(|a| cwd.join(a))
        .filter(|p| p.is_file())
        .map(|p| p.to_string_lossy().into_owned())
        .collect()
}

fn open_files(app: &AppHandle, files: Vec<String>) {
    if files.is_empty() {
        return;
    }
    let state = app.state::<Mutex<Pending>>();
    let mut pending = state.lock().unwrap();
    if pending.ready {
        let _ = app.emit("open-files", files);
    } else {
        pending.files.extend(files);
    }
    drop(pending);
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn create_watcher(app: AppHandle, files: Arc<Mutex<HashSet<String>>>) -> Option<RecommendedWatcher> {
    let watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        let Ok(event) = res else { return };
        if !matches!(event.kind, EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_)) {
            return;
        }
        let files = files.lock().unwrap();
        for path in event.paths {
            if files.contains(&path_key(&path)) {
                let _ = app.emit("doc-changed", path.to_string_lossy().into_owned());
            }
        }
    });
    match watcher {
        Ok(w) => Some(w),
        Err(e) => {
            eprintln!("file watching disabled: {e}");
            None
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let cwd = std::env::current_dir().unwrap_or_default();
    let startup = files_from_args(std::env::args().skip(1), &cwd);

    tauri::Builder::default()
        // Must be registered first: a second launch hands its files to this instance.
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            open_files(app, files_from_args(argv.into_iter().skip(1), Path::new(&cwd)));
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(Mutex::new(Pending { ready: false, files: startup }))
        .setup(|app| {
            let files = Arc::new(Mutex::new(HashSet::new()));
            app.manage(DocWatcher {
                watcher: Mutex::new(create_watcher(app.handle().clone(), files.clone())),
                dirs: Mutex::new(HashSet::new()),
                files,
            });
            // The frontend shows the window after the first render to avoid a
            // blank flash; this is a fallback in case it fails to start.
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_secs(3));
                if let Some(window) = handle.get_webview_window("main") {
                    if !window.is_visible().unwrap_or(true) {
                        let _ = window.show();
                    }
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            read_doc,
            resolve_path,
            read_binary,
            open_with,
            watch_docs,
            load_state,
            save_state,
            take_startup_files,
            print_page
        ])
        .build(tauri::generate_context!())
        .expect("error while building Markdownz")
        .run(|_app, _event| {
            // macOS delivers files opened via Finder / file association as events.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = _event {
                let files = urls
                    .into_iter()
                    .filter_map(|u| u.to_file_path().ok())
                    .map(|p| p.to_string_lossy().into_owned())
                    .collect();
                open_files(_app, files);
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn args_keep_only_existing_files() {
        let cwd = std::env::temp_dir();
        std::fs::write(cwd.join("markdownz-args-test.md"), "x").unwrap();
        let args = ["--flag", "always", "markdownz-args-test.md"].map(String::from);
        let files = files_from_args(args, &cwd);
        assert_eq!(files, vec![cwd.join("markdownz-args-test.md").to_string_lossy().into_owned()]);
        std::fs::remove_file(cwd.join("markdownz-args-test.md")).unwrap();
    }

    #[test]
    fn read_doc_strips_bom() {
        let file = std::env::temp_dir().join("markdownz-bom-test.md");
        std::fs::write(&file, b"\xEF\xBB\xBF# Title").unwrap();
        let doc = read_doc(file.to_string_lossy().into_owned()).unwrap();
        assert_eq!(doc.content, "# Title");
        std::fs::remove_file(file).unwrap();
    }
}
