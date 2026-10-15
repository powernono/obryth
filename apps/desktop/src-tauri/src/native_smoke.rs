use serde_json::Value;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{webview::PageLoadPayload, Manager, Webview};
static STARTED: AtomicBool = AtomicBool::new(false);
#[tauri::command]
pub async fn native_smoke_chrome(webview: Webview, app: tauri::AppHandle) -> Result<Value, String> {
    crate::trusted(&webview)?;
    let config = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == "main")
        .ok_or("main config missing")?;
    let window = app.get_window("main").ok_or("main window missing")?;
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let outer = window.outer_size().map_err(|e| e.to_string())?;
    Ok(
        serde_json::json!({"macos":cfg!(target_os="macos"),"style":config.title_bar_style,"hiddenTitle":config.hidden_title,"trafficLights":config.traffic_light_position,"transparent":config.transparent,"outerHeight":outer.height as f64/scale}),
    )
}
pub fn start(webview: &Webview, payload: &PageLoadPayload<'_>) {
    if webview.label() != "main" || payload.event() != tauri::webview::PageLoadEvent::Finished {
        return;
    }
    let Ok(site) = std::env::var("OBRYTH_SMOKE_SITE") else {
        return;
    };
    if STARTED.swap(true, Ordering::SeqCst) {
        return;
    }
    eprintln!("native smoke: page ready {}", payload.url());
    let script = include_str!("native_smoke.js")
        .replace("__SMOKE_SITE__", &serde_json::to_string(&site).unwrap());
    let _ = webview.eval(script);
}
#[tauri::command]
pub async fn native_smoke_report(
    webview: Webview,
    app: tauri::AppHandle,
    report: Value,
) -> Result<(), String> {
    crate::trusted(&webview)?;
    let path = std::env::var("OBRYTH_SMOKE_REPORT").map_err(|e| e.to_string())?;
    obryth_core::vault::private_write(
        std::path::Path::new(&path),
        &serde_json::to_vec_pretty(&report).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    app.exit(if report["ok"] == true { 0 } else { 1 });
    Ok(())
}

#[tauri::command]
pub async fn native_smoke_progress(webview: Webview, phase: String) -> Result<(), String> {
    crate::trusted(&webview)?;
    eprintln!("native smoke: {phase}");
    Ok(())
}
