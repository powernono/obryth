use crate::{trusted, AppState};
use serde_json::{json, Value};
use std::fs;
use tauri::{
    webview::WebviewBuilder, AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, State,
    Webview, WebviewUrl,
};
type Reply<T> = Result<T, String>;
#[derive(serde::Deserialize)]
pub struct BrowserBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub visible: bool,
}
fn valid_label(label: &str) -> Reply<()> {
    if !label.starts_with("browser-") || uuid::Uuid::parse_str(&label[8..]).is_err() {
        return Err("invalid browser view label".into());
    }
    Ok(())
}
fn view(app: &AppHandle, label: &str) -> Reply<Webview> {
    valid_label(label)?;
    app.get_webview(label)
        .ok_or_else(|| "browser view is closed".into())
}
fn site_url(url: &str) -> Reply<url::Url> {
    let value = url::Url::parse(url).map_err(|e| e.to_string())?;
    if !matches!(value.scheme(), "https" | "http")
        || value.host_str().is_none()
        || !value.username().is_empty()
        || value.password().is_some()
    {
        return Err("only HTTP(S) sites without embedded credentials are supported".into());
    }
    Ok(value)
}
fn dimensions(x: f64, y: f64, width: f64, height: f64) -> Reply<()> {
    if [x, y, width, height].iter().any(|n| !n.is_finite())
        || width < 1.
        || height < 1.
        || width > 20000.
        || height > 20000.
    {
        return Err("invalid browser geometry".into());
    }
    Ok(())
}
#[tauri::command]
pub async fn browser_create(
    webview: Webview,
    app: AppHandle,
    state: State<'_, AppState>,
    label: String,
    url: String,
    bounds: BrowserBounds,
) -> Reply<()> {
    let BrowserBounds {
        x,
        y,
        width,
        height,
        visible,
    } = bounds;
    trusted(&webview)?;
    valid_label(&label)?;
    dimensions(x, y, width, height)?;
    let url = site_url(&url)?;
    let vault = obryth_core::Vault::open(&state.root).map_err(|e| e.to_string())?;
    let scripts = vault
        .setting("browser.scripts")
        .map_err(|e| e.to_string())?
        .unwrap_or(json!([]));
    let mut builder = WebviewBuilder::new(&label, WebviewUrl::External(url))
        .on_navigation(|url| matches!(url.scheme(), "http" | "https"))
        .on_page_load(|child, payload| {
            if payload.event() != tauri::webview::PageLoadEvent::Finished {
                return;
            }
            let app = child.app_handle().clone();
            let label = child.label().to_owned();
            let _ = child.eval_with_callback(
                "JSON.stringify({url:location.href,title:document.title.slice(0,200)})",
                move |raw| {
                    if let Ok(value) = serde_json::from_str::<Value>(&raw) {
                        let data = if let Some(text) = value.as_str() {
                            serde_json::from_str::<Value>(text).unwrap_or(Value::Null)
                        } else {
                            value
                        };
                        if data["url"]
                            .as_str()
                            .is_some_and(|url| site_url(url).is_ok())
                        {
                            let _ = app.emit_to(
                                "main",
                                "obryth-browser-state",
                                json!({"label":label,"url":data["url"],"title":data["title"]}),
                            );
                        }
                    }
                },
            );
        });
    for script in scripts.as_array().cloned().unwrap_or_default() {
        if let (Some(host), Some(code)) = (script["host"].as_str(), script["code"].as_str()) {
            let host = serde_json::to_string(host).unwrap();
            builder=builder.initialization_script(format!("if(location.hostname==={host}){{try{{{code}\n}}catch(error){{console.error('Obryth user script',error)}}}}"));
        }
    }
    #[cfg(target_os = "macos")]
    {
        let uuid = uuid::Uuid::parse_str(&vault.identity.id).map_err(|e| e.to_string())?;
        builder = builder.data_store_identifier(*uuid.as_bytes());
    }
    #[cfg(target_os = "windows")]
    {
        builder = builder.data_directory(state.root.join(".obryth/browser/default"));
    }
    let window = app.get_window("main").ok_or("main window unavailable")?;
    let child = window
        .add_child(
            builder,
            LogicalPosition::new(x, y),
            LogicalSize::new(width, height),
        )
        .map_err(|e| e.to_string())?;
    if !visible {
        child.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}
#[tauri::command]
pub async fn browser_bounds(
    webview: Webview,
    app: AppHandle,
    label: String,
    bounds: BrowserBounds,
) -> Reply<()> {
    let BrowserBounds {
        x,
        y,
        width,
        height,
        visible,
    } = bounds;
    trusted(&webview)?;
    dimensions(x, y, width, height)?;
    let child = view(&app, &label)?;
    if visible {
        child
            .set_position(LogicalPosition::new(x, y))
            .map_err(|e| e.to_string())?;
        child
            .set_size(LogicalSize::new(width, height))
            .map_err(|e| e.to_string())?;
        child.show().map_err(|e| e.to_string())?;
    } else {
        child.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}
#[tauri::command]
pub async fn browser_navigate(
    webview: Webview,
    app: AppHandle,
    label: String,
    url: String,
) -> Reply<()> {
    trusted(&webview)?;
    view(&app, &label)?
        .navigate(site_url(&url)?)
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn browser_close(webview: Webview, app: AppHandle, label: String) -> Reply<()> {
    trusted(&webview)?;
    if let Ok(child) = view(&app, &label) {
        child.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}
#[tauri::command]
pub async fn browser_action(
    webview: Webview,
    app: AppHandle,
    state: State<'_, AppState>,
    label: String,
    action: String,
) -> Reply<Value> {
    trusted(&webview)?;
    let child = view(&app, &label)?;
    match action.as_str() {
        "back" => child.eval("history.back()").map_err(|e| e.to_string())?,
        "forward" => child.eval("history.forward()").map_err(|e| e.to_string())?,
        "reload" => child.eval("location.reload()").map_err(|e| e.to_string())?,
        "clip" | "read" => {
            let (tx, rx) = tokio::sync::oneshot::channel();
            let tx = std::sync::Mutex::new(Some(tx));
            child.eval_with_callback("JSON.stringify({title:document.title,url:location.href,text:(getSelection()?.toString()||document.body.innerText).slice(0,200000)})",move|value|{if let Some(tx)=tx.lock().unwrap().take(){let _=tx.send(value);}}).map_err(|e|e.to_string())?;
            let raw = tokio::time::timeout(std::time::Duration::from_secs(5), rx)
                .await
                .map_err(|_| "page script timed out")?
                .map_err(|_| "page closed")?;
            let value: Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
            let data: Value = if let Some(text) = value.as_str() {
                serde_json::from_str(text).map_err(|e| e.to_string())?
            } else {
                value
            };
            let note=obryth_cli::service::call(&state.root,"notes.save",json!({"title":data["title"],"body":format!("Source: {}\n\n{}",data["url"].as_str().unwrap_or(""),data["text"].as_str().unwrap_or("")),"tags":["clipping"],"kind":"document","source":data["url"]})).await.map_err(|e|e.to_string())?;
            return Ok(note);
        }
        _ => return Err("unknown browser action".into()),
    }
    Ok(json!(true))
}
#[tauri::command]
pub async fn browser_script(
    webview: Webview,
    state: State<'_, AppState>,
    host: String,
    code: String,
) -> Reply<()> {
    trusted(&webview)?;
    let parsed = site_url(&format!("https://{host}"))?;
    if parsed.host_str() != Some(host.as_str()) || code.len() > 256 * 1024 {
        return Err("invalid script host or size".into());
    }
    let vault = obryth_core::Vault::open(&state.root).map_err(|e| e.to_string())?;
    let mut scripts = vault
        .setting("browser.scripts")
        .map_err(|e| e.to_string())?
        .and_then(|v| v.as_array().cloned())
        .unwrap_or_default();
    scripts.retain(|s| s["host"] != host);
    if !code.is_empty() {
        scripts.push(json!({"host":host,"code":code}));
    }
    vault
        .set_setting("browser.scripts", &json!(scripts))
        .map_err(|e| e.to_string())
}
fn pending(root: &std::path::Path, id: &str) -> Reply<Value> {
    uuid::Uuid::parse_str(id).map_err(|e| e.to_string())?;
    let vault = obryth_core::Vault::open(root).map_err(|e| e.to_string())?;
    let raw = fs::read(root.join(format!(".obryth/browser-imports/{id}.enc")))
        .map_err(|e| e.to_string())?;
    let raw = obryth_core::sync::decrypt(
        &vault.sync_key().map_err(|e| e.to_string())?,
        "obryth-browser-import-v1",
        &raw,
    )
    .map_err(|e| e.to_string())?;
    serde_json::from_slice(&raw).map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn browser_imports(webview: Webview, state: State<'_, AppState>) -> Reply<Vec<Value>> {
    trusted(&webview)?;
    let path = state.root.join(".obryth/browser-imports");
    let mut list = vec![];
    if path.exists() {
        for file in fs::read_dir(path).map_err(|e| e.to_string())? {
            let file = file.map_err(|e| e.to_string())?;
            let id = file
                .path()
                .file_stem()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned();
            if let Ok(data) = pending(&state.root, &id) {
                let url = site_url(data["url"].as_str().unwrap_or(""))?;
                list.push(json!({"id":id,"host":url.host_str(),"count":data["cookies"].as_array().map(|v|v.len()).unwrap_or(0)}));
            }
        }
    }
    Ok(list)
}
#[tauri::command]
pub async fn browser_import(
    webview: Webview,
    app: AppHandle,
    state: State<'_, AppState>,
    label: String,
    id: String,
) -> Reply<Value> {
    trusted(&webview)?;
    let child = view(&app, &label)?;
    let data = pending(&state.root, &id)?;
    let site = site_url(data["url"].as_str().unwrap_or(""))?;
    let mut imported = 0;
    let mut skipped = 0;
    for c in data["cookies"].as_array().ok_or("missing cookie array")? {
        if c.get("partitionKey").is_some() && !c["partitionKey"].is_null() {
            skipped += 1;
            continue;
        }
        let domain = c["domain"].as_str().unwrap_or("");
        let stripped = domain.trim_start_matches('.');
        let host = site.host_str().unwrap();
        if stripped.is_empty() || !(host == stripped || host.ends_with(&format!(".{stripped}"))) {
            skipped += 1;
            continue;
        }
        let Some(name) = c["name"].as_str() else {
            skipped += 1;
            continue;
        };
        let mut cookie = cookie::Cookie::build((
            name.to_owned(),
            c["value"].as_str().unwrap_or("").to_owned(),
        ))
        .domain(domain.to_owned())
        .path(c["path"].as_str().unwrap_or("/").to_owned());
        // WKWebView interprets the presence of NSHTTPCookieSecure as enabled,
        // including wry's string "FALSE". Leave false attributes absent.
        if c["secure"].as_bool().unwrap_or(true) {
            cookie = cookie.secure(true);
        }
        if c["httpOnly"].as_bool().unwrap_or(false) {
            cookie = cookie.http_only(true);
        }
        cookie = cookie.same_site(match c["sameSite"].as_str() {
            Some("strict") => cookie::SameSite::Strict,
            Some("no_restriction") => cookie::SameSite::None,
            _ => cookie::SameSite::Lax,
        });
        if let Some(seconds) = c["expirationDate"].as_f64() {
            if let Ok(time) = cookie::time::OffsetDateTime::from_unix_timestamp(seconds as i64) {
                cookie = cookie.expires(time);
            }
        }
        match child.set_cookie(cookie.build()) {
            Ok(()) => imported += 1,
            Err(_) => skipped += 1,
        }
    }
    fs::remove_file(state.root.join(format!(".obryth/browser-imports/{id}.enc")))
        .map_err(|e| e.to_string())?;
    Ok(json!({"imported":imported,"skipped":skipped}))
}
