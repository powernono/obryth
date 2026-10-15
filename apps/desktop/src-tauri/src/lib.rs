mod browser;
#[cfg(feature = "native-smoke")]
mod native_smoke;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Arc, Mutex},
};
use tauri::{ipc::Channel, Manager, State, Webview};
pub struct AppState {
    pub root: PathBuf,
    pub streams: Arc<Mutex<HashMap<String, tokio::sync::mpsc::Sender<()>>>>,
}
pub fn vault_root() -> PathBuf {
    std::env::var_os("OBRYTH_VAULT")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            std::env::var_os("HOME")
                .or_else(|| std::env::var_os("USERPROFILE"))
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from("."))
                .join("Obryth")
        })
}
pub fn trusted(webview: &Webview) -> Result<(), String> {
    if webview.label() != "main" {
        return Err("native commands are restricted to the application view".into());
    }
    let url = webview.url().map_err(|e| e.to_string())?;
    let app_origin = (url.scheme() == "tauri" && url.host_str() == Some("localhost"))
        || (matches!(url.scheme(), "http" | "https")
            && url.host_str() == Some("tauri.localhost")
            && url.port().is_none());
    let dev_origin = cfg!(debug_assertions)
        && url.scheme() == "http"
        && matches!(url.host_str(), Some("localhost" | "127.0.0.1"))
        && url.port() == Some(1420);
    if !app_origin && !dev_origin {
        return Err("native command origin is not trusted".into());
    }
    Ok(())
}
#[tauri::command]
async fn rpc(
    webview: Webview,
    state: State<'_, AppState>,
    method: String,
    params: Value,
) -> Result<Value, String> {
    trusted(&webview)?;
    obryth_cli::service::call(&state.root, &method, params)
        .await
        .map_err(|e| format!("{e:#}"))
}
#[tauri::command]
async fn terminal_watch(
    webview: Webview,
    state: State<'_, AppState>,
    id: String,
    stream_id: String,
    after_seq: i64,
    channel: Channel<Value>,
) -> Result<(), String> {
    trusted(&webview)?;
    uuid::Uuid::parse_str(&stream_id).map_err(|e| e.to_string())?;
    let (tx, mut rx) = tokio::sync::mpsc::channel(1);
    state.streams.lock().unwrap().insert(stream_id.clone(), tx);
    let streams = state.streams.clone();
    let root = state.root.clone();
    tauri::async_runtime::spawn(async move {
        let mut seq = after_seq;
        loop {
            let page = match obryth_cli::agent::dispatch(
                &root,
                "agent.terminal.output",
                json!({"id":id,"afterSeq":seq,"waitMs":1000}),
            )
            .await
            {
                Ok(value) => value,
                Err(error) => {
                    let _ = channel.send(json!({"type":"error","message":format!("{error:#}")}));
                    break;
                }
            };
            seq = page["nextSeq"].as_i64().unwrap_or(seq);
            let done = page["exited"] == true || page["resyncRequired"] == true;
            if channel.send(json!({"type":"page","page":page})).is_err() {
                break;
            }
            // One outstanding page; acknowledge only after xterm.write has drained it.
            if rx.recv().await.is_none() {
                break;
            }
            if done {
                break;
            }
        }
        streams.lock().unwrap().remove(&stream_id);
    });
    Ok(())
}
#[tauri::command]
async fn terminal_ack(
    webview: Webview,
    state: State<'_, AppState>,
    stream_id: String,
) -> Result<(), String> {
    trusted(&webview)?;
    if let Some(tx) = state.streams.lock().unwrap().get(&stream_id) {
        tx.try_send(()).map_err(|e| e.to_string())?;
    }
    Ok(())
}
#[tauri::command]
async fn terminal_unwatch(
    webview: Webview,
    state: State<'_, AppState>,
    stream_id: String,
) -> Result<(), String> {
    trusted(&webview)?;
    state.streams.lock().unwrap().remove(&stream_id);
    Ok(())
}
pub fn run() {
    let root = vault_root();
    tauri::Builder::default()
        .manage(AppState {
            root,
            streams: Arc::new(Mutex::new(HashMap::new())),
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            if std::env::var_os("OBRYTH_PROSPERO_BIN").is_none() {
                let filename = if cfg!(windows) {
                    "binaries/prosperod-rs.exe"
                } else {
                    "binaries/prosperod-rs"
                };
                let mut candidates = Vec::new();
                if let Ok(resources) = app.path().resource_dir() {
                    candidates.push(resources.join(filename));
                }
                #[cfg(debug_assertions)]
                candidates.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(filename));
                for path in candidates {
                    if path.exists() {
                        std::env::set_var("OBRYTH_PROSPERO_BIN", path);
                        break;
                    }
                }
            }
            Ok(())
        })
        .on_page_load(|_webview, _payload| {
            #[cfg(feature = "native-smoke")]
            native_smoke::start(_webview, _payload);
        })
        .invoke_handler({
            let common: Box<dyn Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync> =
                Box::new(tauri::generate_handler![
                    rpc,
                    terminal_watch,
                    terminal_ack,
                    terminal_unwatch,
                    browser::browser_create,
                    browser::browser_bounds,
                    browser::browser_navigate,
                    browser::browser_close,
                    browser::browser_action,
                    browser::browser_script,
                    browser::browser_imports,
                    browser::browser_import
                ]);
            #[cfg(feature = "native-smoke")]
            let special: Box<
                dyn Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync,
            > = Box::new(tauri::generate_handler![
                native_smoke::native_smoke_report,
                native_smoke::native_smoke_progress,
                native_smoke::native_smoke_chrome
            ]);
            move |invoke| {
                #[cfg(feature = "native-smoke")]
                if matches!(
                    invoke.message.command(),
                    "native_smoke_report" | "native_smoke_progress" | "native_smoke_chrome"
                ) {
                    return special(invoke);
                }
                common(invoke)
            }
        })
        .run(tauri::generate_context!())
        .expect("Obryth desktop runtime failed");
}
