use crate::{vault::atomic_write, Vault};
use anyhow::{bail, Context, Result};
use serde_json::{json, Value};
use std::{fs, path::Path};
fn manifest(value: &Value) -> Result<(&str, &str)> {
    let id = value["id"].as_str().context("missing plugin id")?;
    let entry = value["entry"].as_str().context("missing plugin entry")?;
    if id.is_empty()
        || id.len() > 120
        || !id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '.' | '-'))
        || id.starts_with('.')
        || value["apiVersion"] != 1
        || entry != "entry.js"
    {
        bail!("plugins require apiVersion 1, a lowercase id, and a bundled entry.js");
    }
    let permissions = value["permissions"]
        .as_array()
        .context("missing plugin permissions")?;
    if permissions.iter().any(|v| {
        !matches!(
            v.as_str(),
            Some("notes.read" | "notes.propose" | "commands" | "panels" | "network")
        )
    }) {
        bail!("unsupported plugin permission");
    }
    if let Some(hosts) = value["networkHosts"].as_array() {
        for host in hosts {
            let url = url::Url::parse(host.as_str().context("invalid network origin")?)?;
            if url.scheme() != "https"
                || url.host_str().is_none()
                || !url.username().is_empty()
                || url.password().is_some()
                || url.path() != "/"
                || url.query().is_some()
            {
                bail!("plugin network hosts must be HTTPS origins");
            }
        }
    }
    Ok((id, entry))
}
impl Vault {
    pub fn remove_plugin(&self, id: &str) -> Result<()> {
        let value = json!({"id":id,"apiVersion":1,"entry":"entry.js","permissions":[]});
        manifest(&value)?;
        fs::remove_dir_all(self.root.join(".obryth/plugins").join(id))?;
        Ok(())
    }
    pub fn plugin_fetch(&self, id: &str, endpoint: &str) -> Result<Value> {
        use std::io::Read;
        let plugin = self
            .plugins()?
            .into_iter()
            .find(|p| p["manifest"]["id"] == id)
            .context("plugin is not installed")?;
        let m = &plugin["manifest"];
        if !m["permissions"]
            .as_array()
            .is_some_and(|p| p.iter().any(|p| p == "network"))
        {
            bail!("plugin network permission not granted");
        }
        let url = url::Url::parse(endpoint)?;
        let origin = url.origin().ascii_serialization();
        if url.scheme() != "https"
            || !url.username().is_empty()
            || url.password().is_some()
            || !m["networkHosts"].as_array().is_some_and(|hosts| {
                hosts.iter().any(|host| {
                    host.as_str()
                        .is_some_and(|h| h.trim_end_matches('/') == origin)
                })
            })
        {
            bail!("plugin network origin not granted");
        }
        let response = reqwest::blocking::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(std::time::Duration::from_secs(20))
            .build()?
            .get(url)
            .send()?;
        let status = response.status().as_u16();
        let mut bytes = vec![];
        response.take(1024 * 1024 + 1).read_to_end(&mut bytes)?;
        if bytes.len() > 1024 * 1024 {
            bail!("plugin response exceeds 1 MiB");
        }
        Ok(json!({"status":status,"body":String::from_utf8(bytes)?}))
    }
    pub fn install_plugin(&self, source: &Path) -> Result<Value> {
        let root = fs::canonicalize(source)?;
        let metadata = fs::read(root.join("manifest.json"))?;
        if metadata.len() > 64 * 1024 {
            bail!("plugin manifest exceeds 64 KiB");
        }
        let value: Value = serde_json::from_slice(&metadata)?;
        let (id, entry) = manifest(&value)?;
        let entry_path = fs::canonicalize(root.join(entry))?;
        if !entry_path.starts_with(&root) {
            bail!("plugin entry escapes its directory");
        }
        let bytes = fs::read(entry_path)?;
        if bytes.len() > 2 * 1024 * 1024 {
            bail!("plugin bundle exceeds 2 MiB");
        }
        std::str::from_utf8(&bytes)?;
        atomic_write(
            &self.root.join(format!(".obryth/plugins/{id}/entry.js")),
            &bytes,
        )?;
        atomic_write(
            &self
                .root
                .join(format!(".obryth/plugins/{id}/manifest.json")),
            &metadata,
        )?;
        Ok(value)
    }
    pub fn plugins(&self) -> Result<Vec<Value>> {
        let mut plugins = vec![];
        let root = self.root.join(".obryth/plugins");
        if !root.exists() {
            return Ok(plugins);
        }
        for entry in fs::read_dir(root)? {
            let entry = entry?;
            if !entry.file_type()?.is_dir() {
                continue;
            }
            let value: Value =
                serde_json::from_slice(&fs::read(entry.path().join("manifest.json"))?)?;
            manifest(&value)?;
            let code = fs::read_to_string(entry.path().join("entry.js"))?;
            plugins.push(json!({"manifest":value,"code":code}));
        }
        Ok(plugins)
    }
}
