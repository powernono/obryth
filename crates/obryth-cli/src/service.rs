use anyhow::{bail, Context, Result};
use axum::{
    extract::{DefaultBodyLimit, State},
    http::{HeaderMap, StatusCode},
    routing::post,
    Json, Router,
};
use fs2::FileExt;
use obryth_core::{
    vault::{atomic_write, private_write},
    Vault,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs,
    net::{IpAddr, Ipv4Addr, SocketAddr},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{Arc, Mutex},
    time::Duration,
};
use uuid::Uuid;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Connection {
    pub protocol_version: u32,
    pub pid: u32,
    pub url: String,
    pub token: String,
}
#[derive(Clone)]
struct ServiceState {
    vault: Arc<Mutex<Vault>>,
    root: PathBuf,
    token: String,
}
#[derive(Deserialize)]
struct Request {
    method: String,
    #[serde(default)]
    params: Value,
    #[serde(default)]
    id: Value,
}

pub async fn serve(root: PathBuf) -> Result<()> {
    let vault = Vault::open(&root)?;
    let root = vault.root.clone();
    let lock = fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(root.join(".obryth/service.lock"))?;
    lock.try_lock_exclusive()
        .context("a note service is already running for this vault")?;
    let listener =
        tokio::net::TcpListener::bind(SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 0)).await?;
    let token = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
    let connection = Connection {
        protocol_version: 1,
        pid: std::process::id(),
        url: format!("http://{}", listener.local_addr()?),
        token: token.clone(),
    };
    private_write(
        &root.join(".obryth/connection.json"),
        &serde_json::to_vec(&connection)?,
    )?;
    let state = ServiceState {
        vault: Arc::new(Mutex::new(vault)),
        root,
        token,
    };
    let (refresh_tx, mut refresh_rx) = tokio::sync::mpsc::channel::<()>(1);
    use notify::Watcher;
    let watched_root = state.root.clone();
    let watcher = notify::recommended_watcher(move |result: notify::Result<notify::Event>| {
        if let Ok(event) = result {
            if event.paths.iter().any(|path| {
                path.strip_prefix(&watched_root)
                    .is_ok_and(|relative| !relative.starts_with(".obryth"))
                    && (path
                        .extension()
                        .is_some_and(|ext| ext == "md" || ext == "markdown")
                        || path.is_dir()
                        || matches!(
                            event.kind,
                            notify::EventKind::Remove(notify::event::RemoveKind::Folder)
                        ))
            }) {
                let _ = refresh_tx.try_send(());
            }
        }
    });
    let mut watcher = watcher.ok();
    if let Some(watch) = watcher.as_mut() {
        if watch
            .watch(&state.root, notify::RecursiveMode::Recursive)
            .is_err()
        {
            watcher = None;
        }
    }
    let fallback = if watcher.is_some() { 60 } else { 3 };
    let refresh = state.vault.clone();
    tokio::spawn(async move {
        loop {
            if fallback == 3 {
                tokio::time::sleep(Duration::from_secs(3)).await;
            } else {
                tokio::select! {_=tokio::time::sleep(Duration::from_secs(fallback))=>{},message=refresh_rx.recv()=>{if message.is_none(){tokio::time::sleep(Duration::from_secs(3)).await;}else{tokio::time::sleep(Duration::from_millis(120)).await;while refresh_rx.try_recv().is_ok(){}}}}
            }
            let vault = refresh.clone();
            let _ = tokio::task::spawn_blocking(move || {
                if let Ok(vault) = vault.lock() {
                    if let Err(error) = vault.refresh() {
                        eprintln!("index refresh: {error:#}");
                    }
                }
            })
            .await;
        }
    });
    let app = Router::new()
        .route("/rpc", post(rpc))
        .layer(DefaultBodyLimit::max(16 * 1024 * 1024))
        .with_state(state);
    axum::serve(listener, app)
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await?;
    drop(watcher);
    drop(lock);
    Ok(())
}
async fn rpc(
    State(state): State<ServiceState>,
    headers: HeaderMap,
    Json(request): Json<Request>,
) -> Result<Json<Value>, StatusCode> {
    if headers.get("authorization").and_then(|s| s.to_str().ok())
        != Some(&format!("Bearer {}", state.token))
    {
        return Err(StatusCode::UNAUTHORIZED);
    }
    let id = request.id;
    let result = if request.method.starts_with("agent.") {
        crate::agent::dispatch(&state.root, &request.method, request.params).await
    } else {
        let root = state.root.clone();
        let shared = state.vault.clone();
        tokio::task::spawn_blocking(move || {
            // Network work gets a separate SQLite connection; editing remains responsive.
            if request.method.starts_with("sync.")
                || matches!(
                    request.method.as_str(),
                    "knowledge.ask"
                        | "knowledge.index"
                        | "knowledge.semantic"
                        | "providers.models"
                        | "plugins.fetch"
                )
            {
                let vault = Vault::open(root)?;
                obryth_core::dispatch(&vault, &request.method, request.params)
            } else {
                let vault = shared
                    .lock()
                    .map_err(|_| anyhow::anyhow!("note service lock poisoned"))?;
                obryth_core::dispatch(&vault, &request.method, request.params)
            }
        })
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    };
    Ok(Json(match result {
        Ok(result) => json!({"jsonrpc":"2.0","id":id,"result":result}),
        Err(error) => {
            json!({"jsonrpc":"2.0","id":id,"error":{"code":-32000,"message":format!("{error:#}")}})
        }
    }))
}
pub fn read_connection(root: &Path) -> Result<Connection> {
    let connection: Connection =
        serde_json::from_slice(&fs::read(root.join(".obryth/connection.json"))?)?;
    let url = url_for(&connection)?;
    if connection.protocol_version != 1 || connection.token.len() != 64 || url.path() != "/" {
        bail!("invalid note service descriptor");
    }
    Ok(connection)
}
fn url_for(connection: &Connection) -> Result<reqwest::Url> {
    let url = reqwest::Url::parse(&connection.url)?;
    if url.scheme() != "http"
        || !matches!(url.host_str(), Some("127.0.0.1" | "::1"))
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
    {
        bail!("note service must use authenticated loopback");
    }
    Ok(url)
}
pub async fn call_at(connection: &Connection, method: &str, params: Value) -> Result<Value> {
    let url = url_for(connection)?.join("rpc")?;
    let response:Value=reqwest::Client::builder().timeout(Duration::from_secs(120)).redirect(reqwest::redirect::Policy::none()).build()?.post(url).bearer_auth(&connection.token).json(&json!({"jsonrpc":"2.0","id":Uuid::new_v4().to_string(),"method":method,"params":params})).send().await?.error_for_status()?.json().await?;
    if let Some(error) = response.get("error") {
        bail!("{}", error["message"].as_str().unwrap_or("RPC failed"));
    }
    Ok(response["result"].clone())
}
pub async fn call(root: &Path, method: &str, params: Value) -> Result<Value> {
    let connection = ensure(root).await?;
    let result = call_at(&connection, method, params.clone()).await;
    // An older detached service can outlive an application update. These new
    // read models can safely use the same SQLite vault without restarting it
    // or interrupting writes and terminal sessions owned by that service.
    if matches!(
        method,
        "notes.activity" | "notes.activityFeed" | "notes.activityVersions"
    ) && result
        .as_ref()
        .is_err_and(|error| error.to_string() == format!("unknown method: {method}"))
    {
        let root = root.to_owned();
        let method = method.to_owned();
        return tokio::task::spawn_blocking(move || {
            obryth_core::dispatch(&Vault::open(root)?, &method, params)
        })
        .await?;
    }
    result
}
pub async fn ensure(root: &Path) -> Result<Connection> {
    if let Ok(connection) = read_connection(root) {
        if tokio::time::timeout(
            Duration::from_secs(2),
            call_at(&connection, "vault.info", json!({})),
        )
        .await
        .is_ok_and(|r| r.is_ok())
        {
            return Ok(connection);
        }
    }
    fs::create_dir_all(root.join(".obryth"))?;
    let executable = std::env::var_os("OBRYTH_CLI")
        .map(PathBuf::from)
        .unwrap_or(std::env::current_exe()?);
    let log = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(root.join(".obryth/service.log"))?;
    let mut command = Command::new(executable);
    command
        .arg("--vault")
        .arg(root)
        .arg("serve")
        .stdin(Stdio::null())
        .stdout(Stdio::from(log.try_clone()?))
        .stderr(Stdio::from(log));
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    command
        .spawn()
        .context("could not start Obryth note service; set OBRYTH_CLI to the obryth binary")?;
    for _ in 0..100 {
        tokio::time::sleep(Duration::from_millis(100)).await;
        if let Ok(connection) = read_connection(root) {
            if call_at(&connection, "vault.info", json!({})).await.is_ok() {
                return Ok(connection);
            }
        }
    }
    bail!("note service startup timed out; inspect .obryth/service.log")
}
pub fn write_pairing(root: &Path, pairing: &Value) -> Result<()> {
    use base64::Engine;
    fs::create_dir_all(root.join(".obryth"))?;
    let identity: obryth_core::vault::VaultIdentity =
        serde_json::from_value(pairing["vault"].clone())?;
    uuid::Uuid::parse_str(&identity.id)?;
    let key = base64::engine::general_purpose::STANDARD
        .decode(pairing["key"].as_str().context("missing pairing key")?)?;
    if key.len() != 32 {
        bail!("invalid pairing key");
    }
    if root.join(".obryth/vault.json").exists() {
        bail!("join requires a new empty vault directory");
    }
    atomic_write(
        &root.join(".obryth/vault.json"),
        &serde_json::to_vec(&identity)?,
    )?;
    private_write(&root.join(".obryth/sync.key"), &key)?;
    Ok(())
}
