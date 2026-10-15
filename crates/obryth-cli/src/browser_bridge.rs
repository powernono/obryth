use anyhow::{bail, Context, Result};
use serde_json::{json, Value};
use std::{
    io::{Read, Write},
    path::Path,
};
pub fn run(root: &Path) -> Result<()> {
    let mut input = std::io::stdin().lock();
    let mut output = std::io::stdout().lock();
    loop {
        let mut header = [0; 4];
        match input.read_exact(&mut header) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::UnexpectedEof => break,
            Err(error) => return Err(error.into()),
        }
        let len = u32::from_le_bytes(header) as usize;
        if len > 1024 * 1024 {
            bail!("native message exceeds 1 MiB");
        }
        let mut bytes = vec![0; len];
        input.read_exact(&mut bytes)?;
        let result = (|| -> Result<Value> {
            let value: Value = serde_json::from_slice(&bytes)?;
            let url = reqwest::Url::parse(value["url"].as_str().context("missing site URL")?)?;
            if !matches!(url.scheme(), "https" | "http") {
                bail!("invalid site scheme");
            }
            let host = url.host_str().context("missing site host")?;
            let cookies = value["cookies"].as_array().context("missing cookies")?;
            if cookies.len() > 1000 {
                bail!("too many cookies");
            }
            for cookie in cookies {
                let domain = cookie["domain"]
                    .as_str()
                    .context("missing cookie domain")?
                    .trim_start_matches('.');
                if !(host == domain || host.ends_with(&format!(".{domain}"))) {
                    bail!("cookie is outside the authorized site");
                }
            }
            let vault = obryth_core::Vault::open(root)?;
            let id = uuid::Uuid::new_v4().to_string();
            let payload =
                obryth_core::sync::encrypt(&vault.sync_key()?, "obryth-browser-import-v1", &bytes)?;
            obryth_core::vault::private_write(
                &root.join(format!(".obryth/browser-imports/{id}.enc")),
                &payload,
            )?;
            Ok(
                json!({"ok":true,"id":id,"count":cookies.len(),"message":"Open Obryth browser and confirm this import"}),
            )
        })();
        let reply = serde_json::to_vec(
            &result.unwrap_or_else(|error| json!({"ok":false,"error":error.to_string()})),
        )?;
        output.write_all(&(reply.len() as u32).to_le_bytes())?;
        output.write_all(&reply)?;
        output.flush()?;
    }
    Ok(())
}
