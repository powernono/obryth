use anyhow::{bail, Context, Result};
use prospero_client::Client;
use prospero_protocol_rs::{
    AgentSend, AgentSessionCreate, CreateTerminal, SessionQuery, TerminalQuery, TerminalSize,
};
use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::Duration,
};

pub fn home(root: &Path) -> PathBuf {
    std::env::var_os("OBRYTH_PROSPERO_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| root.join(".obryth/prospero"))
}
pub async fn client(root: &Path) -> Result<Client> {
    let dir = home(root);
    if let Ok(client) = Client::from_home(&dir) {
        if client.health().await.is_ok() {
            return Ok(client);
        }
    }
    fs::create_dir_all(&dir)?;
    let lock_path = dir.join("obryth-startup.lock");
    // GUI panes and independent CLI processes may request the runtime together.
    let _startup_lock = tokio::task::spawn_blocking(move || -> Result<fs::File> {
        let file = fs::OpenOptions::new()
            .create(true)
            .read(true)
            .write(true)
            .truncate(false)
            .open(lock_path)?;
        fs2::FileExt::lock_exclusive(&file)?;
        Ok(file)
    })
    .await??;
    if let Ok(client) = Client::from_home(&dir) {
        if client.health().await.is_ok() {
            return Ok(client);
        }
    }
    let executable=std::env::var_os("OBRYTH_PROSPERO_BIN").map(PathBuf::from).or_else(||std::env::current_exe().ok().and_then(|p|p.parent().map(|p|p.join(if cfg!(windows){"prosperod-rs.exe"}else{"prosperod-rs"})))).filter(|p|p.exists()).context("Prospero runtime not found. Run pnpm prospero:build and set OBRYTH_PROSPERO_BIN, or attach OBRYTH_PROSPERO_HOME.")?;
    fs::create_dir_all(&dir)?;
    let log = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join("obryth-runtime.log"))?;
    let bind = std::env::var("OBRYTH_PROSPERO_BIND").unwrap_or_else(|_| "127.0.0.1".into());
    let mut command = Command::new(executable);
    let loopback = if bind == "localhost" {
        Some(std::net::IpAddr::V4(std::net::Ipv4Addr::LOCALHOST))
    } else {
        bind.parse::<std::net::IpAddr>()
            .ok()
            .filter(|ip| ip.is_loopback())
    };
    if let Some(ip) = loopback {
        // Upstream `start` defaults to port 7423 and rejects port zero. Its
        // authenticated `serve` entry supports ephemeral loopback ports and
        // reclaims the prior port on restart, avoiding other Prospero installs.
        command
            .args([
                "serve",
                "--listen",
                &std::net::SocketAddr::new(ip, 0).to_string(),
                "--data-dir",
            ])
            .arg(&dir);
    } else {
        command
            .args(["start", "--no-bonjour", "--bind", &bind, "--home"])
            .arg(&dir);
        if let Ok(port) = std::env::var("OBRYTH_PROSPERO_PORT") {
            command.args(["--port", &port]);
        }
    }
    command
        .env("PROSPERO_HOME", &dir)
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
    command.spawn()?;
    for _ in 0..100 {
        tokio::time::sleep(Duration::from_millis(100)).await;
        if let Ok(client) = Client::from_home(&dir) {
            if client.health().await.is_ok() {
                return Ok(client);
            }
        }
    }
    bail!("Prospero startup timed out")
}
pub fn detected() -> Value {
    let paths = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect::<Vec<_>>())
        .unwrap_or_default();
    json!(["codex", "claude", "opencode", "dsh", "grok", "trae"]
        .iter()
        .map(|name| {
            let executable = paths
                .iter()
                .flat_map(|p| {
                    if cfg!(windows) {
                        vec![p.join(format!("{name}.exe")), p.join(format!("{name}.cmd"))]
                    } else {
                        vec![p.join(name)]
                    }
                })
                .find(|p| p.is_file());
            json!({"id":name,"installed":executable.is_some(),"path":executable})
        })
        .collect::<Vec<_>>())
}
pub async fn dispatch(root: &Path, method: &str, params: Value) -> Result<Value> {
    if method == "agent.detect" {
        return Ok(detected());
    }
    let client = client(root).await?;
    let id = || params["id"].as_str().context("missing session id");
    match method {
        "agent.health" => Ok(serde_json::to_value(client.health().await?)?),
        "agent.sessions" => Ok(serde_json::to_value(
            client
                .sessions(serde_json::from_value::<SessionQuery>(params)?)
                .await?,
        )?),
        "agent.create" => Ok(serde_json::to_value(
            client
                .create_agent(&serde_json::from_value::<AgentSessionCreate>(params)?)
                .await?,
        )?),
        "agent.send" => {
            client
                .agent_send(
                    id()?,
                    &serde_json::from_value::<AgentSend>(params["input"].clone())?,
                )
                .await?;
            Ok(json!(true))
        }
        "agent.interrupt" => {
            client.agent_interrupt(id()?).await?;
            Ok(json!(true))
        }
        "agent.close" => {
            client.close_agent(id()?).await?;
            Ok(json!(true))
        }
        "agent.permission" => {
            client
                .agent_permission(id()?, &serde_json::from_value(params["decision"].clone())?)
                .await?;
            Ok(json!(true))
        }
        "agent.question" => {
            client
                .agent_question(id()?, &serde_json::from_value(params["decision"].clone())?)
                .await?;
            Ok(json!(true))
        }
        "agent.terminal.create" => Ok(serde_json::to_value(
            client
                .create_terminal(&serde_json::from_value::<CreateTerminal>(params)?)
                .await?,
        )?),
        "agent.terminal.output" => Ok(serde_json::to_value(
            client
                .terminal_output(
                    id()?,
                    TerminalQuery {
                        after_seq: params["afterSeq"].as_i64(),
                        wait_ms: Some(params["waitMs"].as_u64().unwrap_or(1000).min(5000) as u32),
                    },
                )
                .await?,
        )?),
        "agent.terminal.snapshot" => Ok(serde_json::to_value(
            client.terminal_snapshot(id()?).await?,
        )?),
        "agent.terminal.input" => {
            use base64::Engine;
            let bytes = base64::engine::general_purpose::STANDARD.decode(
                params["dataB64"]
                    .as_str()
                    .context("missing terminal input")?,
            )?;
            client.terminal_input(id()?, &bytes).await?;
            Ok(json!(true))
        }
        "agent.terminal.resize" => {
            client
                .terminal_resize(
                    id()?,
                    serde_json::from_value::<TerminalSize>(params["size"].clone())?,
                )
                .await?;
            Ok(json!(true))
        }
        "agent.terminal.close" => {
            client.close_terminal(id()?).await?;
            Ok(json!(true))
        }
        "agent.request" => {
            let connection: prospero_client::Connection =
                serde_json::from_slice(&fs::read(home(root).join("connection.json"))?)?;
            let path = params["path"].as_str().context("missing API path")?;
            if !path.starts_with("/v1/")
                || path.contains("..")
                || path.contains(['\\', '#'])
                || path.starts_with("/v1/shutdown")
            {
                bail!("invalid Prospero API path");
            }
            let verb =
                reqwest::Method::from_bytes(params["verb"].as_str().unwrap_or("GET").as_bytes())?;
            let url = reqwest::Url::parse(&connection.base_url)?.join(path)?;
            let mut request = reqwest::Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .timeout(Duration::from_secs(90))
                .build()?
                .request(verb, url)
                .bearer_auth(connection.token);
            if let Some(body) = params.get("body") {
                request = request.json(body);
            }
            let response = request.send().await?.error_for_status()?;
            let text = response.text().await?;
            if text.is_empty() {
                Ok(Value::Null)
            } else {
                Ok(serde_json::from_str(&text)?)
            }
        }
        _ => bail!("unknown agent operation"),
    }
}
