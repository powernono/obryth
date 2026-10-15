use crate::{
    types::*,
    vault::{atomic_write, hash, now},
    Vault,
};
use aes_gcm::{
    aead::{Aead, Payload},
    Aes256Gcm, KeyInit, Nonce,
};
use anyhow::{bail, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use rand::RngCore;
use reqwest::blocking::Client;
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    time::Duration,
};
use uuid::Uuid;

pub trait SyncTransport {
    fn list(&self) -> Result<Vec<String>>;
    fn get(&self, name: &str) -> Result<Vec<u8>>;
    fn put(&self, name: &str, bytes: &[u8]) -> Result<()>;
}
pub struct FolderTransport(pub PathBuf);
impl SyncTransport for FolderTransport {
    fn list(&self) -> Result<Vec<String>> {
        fs::create_dir_all(&self.0)?;
        Ok(fs::read_dir(&self.0)?
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().is_ok_and(|t| t.is_file()))
            .map(|e| e.file_name().to_string_lossy().into())
            .collect())
    }
    fn get(&self, name: &str) -> Result<Vec<u8>> {
        validate_name(name)?;
        Ok(fs::read(self.0.join(name))?)
    }
    fn put(&self, name: &str, bytes: &[u8]) -> Result<()> {
        validate_name(name)?;
        atomic_write(&self.0.join(name), bytes)
    }
}
fn validate_name(name: &str) -> Result<()> {
    if name.is_empty() || name.contains(['/', '\\']) || name.starts_with('.') {
        bail!("invalid sync object name");
    }
    Ok(())
}
pub struct WebDavTransport {
    client: Client,
    url: url::Url,
    username: String,
    password: String,
}
impl WebDavTransport {
    pub fn new(endpoint: &str, username: &str, password: &str, vault_id: &str) -> Result<Self> {
        Uuid::parse_str(vault_id)?;
        let mut url = url::Url::parse(endpoint)?;
        if !matches!(url.scheme(), "https" | "http") {
            bail!("WebDAV requires HTTP(S)");
        }
        if url.scheme() == "http"
            && !matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "::1"))
        {
            bail!("WebDAV credentials require HTTPS outside loopback");
        }
        if !url.username().is_empty() || url.password().is_some() || url.query().is_some() {
            bail!("credentials and query strings are not allowed in endpoint");
        }
        if !url.path().ends_with('/') {
            url.set_path(&format!("{}/", url.path()));
        }
        let client = Client::builder()
            .timeout(Duration::from_secs(30))
            .redirect(reqwest::redirect::Policy::none())
            .build()?;
        for segment in ["obryth", vault_id, "objects"] {
            url = url.join(&format!("{segment}/"))?;
            let status = client
                .request(reqwest::Method::from_bytes(b"MKCOL")?, url.clone())
                .basic_auth(username, Some(password))
                .send()?
                .status();
            if !(status.is_success() || status.as_u16() == 405) {
                bail!("WebDAV MKCOL failed: {status}");
            }
        }
        Ok(Self {
            client,
            url,
            username: username.into(),
            password: password.into(),
        })
    }
}
impl SyncTransport for WebDavTransport {
    fn list(&self) -> Result<Vec<String>> {
        let xml=self.client.request(reqwest::Method::from_bytes(b"PROPFIND")?,self.url.clone()).basic_auth(&self.username,Some(&self.password)).header("Depth","1").header("Content-Type","application/xml").body("<?xml version=\"1.0\"?><d:propfind xmlns:d=\"DAV:\"><d:prop><d:resourcetype/></d:prop></d:propfind>").send()?.error_for_status()?.text()?;
        let mut reader = quick_xml::Reader::from_str(&xml);
        let mut in_href = false;
        let mut names = vec![];
        loop {
            match reader.read_event()? {
                quick_xml::events::Event::Start(e) if e.local_name().as_ref() == b"href" => {
                    in_href = true
                }
                quick_xml::events::Event::End(e) if e.local_name().as_ref() == b"href" => {
                    in_href = false
                }
                quick_xml::events::Event::Text(e) if in_href => {
                    let text = e.decode()?.into_owned();
                    let url = self.url.join(&text)?;
                    if let Some(name) = url.path_segments().and_then(|mut s| s.next_back()) {
                        let name = percent_encoding::percent_decode_str(name)
                            .decode_utf8()?
                            .into_owned();
                        if name.ends_with(".enc") {
                            validate_name(&name)?;
                            names.push(name);
                        }
                    }
                }
                quick_xml::events::Event::Eof => break,
                _ => {}
            }
        }
        Ok(names)
    }
    fn get(&self, name: &str) -> Result<Vec<u8>> {
        validate_name(name)?;
        Ok(self
            .client
            .get(self.url.join(name)?)
            .basic_auth(&self.username, Some(&self.password))
            .send()?
            .error_for_status()?
            .bytes()?
            .to_vec())
    }
    fn put(&self, name: &str, bytes: &[u8]) -> Result<()> {
        validate_name(name)?;
        self.client
            .put(self.url.join(name)?)
            .basic_auth(&self.username, Some(&self.password))
            .header("Content-Type", "application/octet-stream")
            .body(bytes.to_vec())
            .send()?
            .error_for_status()?;
        Ok(())
    }
}
#[derive(Serialize, Deserialize)]
struct Envelope {
    version: u32,
    nonce: String,
    ciphertext: String,
}
pub fn encrypt(key: &[u8; 32], aad: &str, bytes: &[u8]) -> Result<Vec<u8>> {
    let mut nonce = [0u8; 12];
    rand::rngs::OsRng.fill_bytes(&mut nonce);
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| anyhow::anyhow!("invalid key"))?;
    let ciphertext = cipher
        .encrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: bytes,
                aad: aad.as_bytes(),
            },
        )
        .map_err(|_| anyhow::anyhow!("encryption failed"))?;
    Ok(serde_json::to_vec(&Envelope {
        version: 1,
        nonce: STANDARD.encode(nonce),
        ciphertext: STANDARD.encode(ciphertext),
    })?)
}
pub fn decrypt(key: &[u8; 32], aad: &str, bytes: &[u8]) -> Result<Vec<u8>> {
    let envelope: Envelope = serde_json::from_slice(bytes)?;
    if envelope.version != 1 {
        bail!("unsupported encrypted format");
    }
    let nonce = STANDARD.decode(envelope.nonce)?;
    if nonce.len() != 12 {
        bail!("invalid nonce");
    }
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| anyhow::anyhow!("invalid key"))?;
    cipher
        .decrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: &STANDARD.decode(envelope.ciphertext)?,
                aad: aad.as_bytes(),
            },
        )
        .map_err(|_| anyhow::anyhow!("KEY_MISMATCH: encrypted data authentication failed"))
}
pub fn key_from_file(path: &Path) -> Result<[u8; 32]> {
    fs::read(path)?
        .try_into()
        .map_err(|_| anyhow::anyhow!("vault key must contain 32 bytes"))
}
impl Vault {
    pub fn sync_key(&self) -> Result<[u8; 32]> {
        use fs2::FileExt;
        let lock = fs::OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(self.root.join(".obryth/key.lock"))?;
        lock.lock_exclusive()?;
        let path = self.root.join(".obryth/sync.key");
        if !path.exists() {
            let mut key = [0; 32];
            rand::rngs::OsRng.fill_bytes(&mut key);
            crate::vault::private_write(&path, &key)?;
        }
        key_from_file(&path)
    }
    pub fn export_pairing(&self) -> Result<serde_json::Value> {
        Ok(
            serde_json::json!({"version":1,"vault":self.identity,"key":STANDARD.encode(self.sync_key()?)}),
        )
    }
    pub fn sync<T: SyncTransport + ?Sized>(&self, transport: &T) -> Result<SyncReport> {
        self.refresh()?;
        let key = self.sync_key()?;
        let remote = transport.list()?.into_iter().collect::<HashSet<_>>();
        let mut report = SyncReport::default();
        let mut incoming = vec![];
        for name in &remote {
            if !name.ends_with(".enc") || name.starts_with("blob-") {
                continue;
            }
            let id = name.trim_end_matches(".enc");
            let processed:bool=self.db.query_row("SELECT EXISTS(SELECT 1 FROM sync_seen WHERE id=?1) OR EXISTS(SELECT 1 FROM applied WHERE id=?1)",[id],|r|r.get(0))?;
            if processed {
                continue;
            }
            let revision: Revision =
                serde_json::from_slice(&decrypt(&key, &self.identity.id, &transport.get(name)?)?)?;
            Uuid::parse_str(&revision.note_id)?;
            Uuid::parse_str(&revision.device)?;
            if revision.id != id
                || revision.id.len() != 64
                || !revision.id.chars().all(|c| c.is_ascii_hexdigit())
            {
                bail!("invalid remote revision identity");
            }
            if revision
                .note
                .as_ref()
                .is_some_and(|n| n.id != revision.note_id || n.revision != revision.id)
            {
                bail!("revision note identity mismatch");
            }
            incoming.push(revision);
        }
        // Authenticate all unknown data before applying any changes.
        let mut blobs = HashMap::new();
        for revision in &incoming {
            for reference in &revision.attachments {
                crate::attachments::validate(reference)?;
                if !blobs.contains_key(&reference.digest) {
                    let bytes = if let Ok(bytes) = self.attachment_bytes(reference) {
                        bytes
                    } else {
                        decrypt(
                            &key,
                            &format!("{}:blob:{}", self.identity.id, reference.digest),
                            &transport.get(&format!("blob-{}.enc", reference.digest))?,
                        )?
                    };
                    if hash(&bytes) != reference.digest {
                        bail!("attachment authentication digest mismatch");
                    }
                    blobs.insert(reference.digest.clone(), bytes);
                }
            }
        }
        let write_lock = self.lock()?;
        for revision in &incoming {
            for reference in &revision.attachments {
                self.materialize_attachment(reference, &blobs[&reference.digest])?;
            }
        }
        let mut graph = self
            .revisions()?
            .into_iter()
            .map(|r| (r.id.clone(), r))
            .collect::<HashMap<_, _>>();
        for revision in &incoming {
            graph.insert(revision.id.clone(), revision.clone());
        }
        fn depth(
            id: &str,
            graph: &HashMap<String, Revision>,
            visiting: &mut HashSet<String>,
        ) -> Result<usize> {
            if !visiting.insert(id.into()) {
                bail!("cyclic revision history");
            }
            let depth = if let Some(revision) = graph.get(id) {
                revision
                    .parents
                    .iter()
                    .map(|p| depth(p, graph, visiting))
                    .collect::<Result<Vec<_>>>()?
                    .into_iter()
                    .max()
                    .unwrap_or(0)
                    + 1
            } else {
                0
            };
            visiting.remove(id);
            Ok(depth)
        }
        let superseded = incoming
            .iter()
            .flat_map(|revision| revision.parents.clone())
            .collect::<HashSet<_>>();
        let mut ordered = vec![];
        for revision in incoming {
            let d = depth(&revision.id, &graph, &mut HashSet::new())?;
            ordered.push((d, revision));
        }
        ordered.sort_by(|a, b| a.0.cmp(&b.0).then(a.1.id.cmp(&b.1.id)));
        for (_, revision) in ordered {
            self.remember(&revision)?;
            report.downloaded += 1;
            if superseded.contains(&revision.id) {
                self.db
                    .execute("INSERT OR IGNORE INTO sync_seen VALUES(?1)", [&revision.id])?;
                continue;
            }
            let current: Option<String> = self
                .db
                .query_row(
                    "SELECT revision FROM notes WHERE id=?1",
                    [&revision.note_id],
                    |r| r.get(0),
                )
                .optional()?;
            match current {
                None => self.apply(&revision)?,
                Some(current) if ancestor(&current, &revision.id, &graph) => {
                    self.apply(&revision)?
                }
                Some(current) if ancestor(&revision.id, &current, &graph) => {}
                Some(current) => {
                    let old = self.get(&revision.note_id).ok();
                    let base = common_ancestor(&current, &revision.id, &graph)
                        .and_then(|id| graph.get(&id))
                        .and_then(|r| r.note.as_ref());
                    let merged = match (base, old.as_ref(), revision.note.as_ref()) {
                        (Some(base), Some(ours), Some(theirs))
                            if ours.title == theirs.title
                                && ours.tags == theirs.tags
                                && ours.kind == theirs.kind
                                && ours.pinned == theirs.pinned =>
                        {
                            diffy::merge(&base.body, &ours.body, &theirs.body)
                                .ok()
                                .map(|body| {
                                    let mut note = ours.clone();
                                    note.body = body;
                                    note.updated_at = now();
                                    note.revision.clear();
                                    note.revision = hash(&serde_json::to_vec(&note).unwrap());
                                    note
                                })
                        }
                        _ => None,
                    };
                    if let Some(note) = merged {
                        let merged =
                            self.commit_for_sync(note, vec![current, revision.id.clone()])?;
                        graph.insert(merged.id.clone(), merged);
                    } else {
                        atomic_write(
                            &self
                                .root
                                .join(format!(".obryth/conflicts/{}.json", revision.id)),
                            &serde_json::to_vec_pretty(
                                &serde_json::json!({"id":revision.id,"local":old,"remote":revision}),
                            )?,
                        )?;
                        report.conflicts.push(revision.id.clone());
                    }
                }
            }
            self.db
                .execute("INSERT OR IGNORE INTO sync_seen VALUES(?1)", [&revision.id])?;
        }
        let conflicts = self.root.join(".obryth/conflicts");
        if conflicts.exists() {
            for entry in fs::read_dir(conflicts)? {
                let entry = entry?;
                let value: serde_json::Value = serde_json::from_slice(&fs::read(entry.path())?)?;
                let remote: Revision = serde_json::from_value(value["remote"].clone())?;
                let current: Option<String> = self
                    .db
                    .query_row(
                        "SELECT revision FROM notes WHERE id=?1",
                        [&remote.note_id],
                        |r| r.get(0),
                    )
                    .optional()?;
                if let Some(current) = current {
                    if ancestor(&remote.id, &current, &graph)
                        && value["local"]["revision"]
                            .as_str()
                            .is_none_or(|id| ancestor(id, &current, &graph))
                    {
                        fs::remove_file(entry.path())?;
                        report.conflicts.retain(|id| id != &remote.id);
                    }
                }
            }
        }
        let outgoing = self.revisions()?;
        drop(write_lock);
        let mut uploaded_blobs = HashSet::new();
        for revision in &outgoing {
            for reference in &revision.attachments {
                let name = format!("blob-{}.enc", reference.digest);
                if !remote.contains(&name) && uploaded_blobs.insert(name.clone()) {
                    transport.put(
                        &name,
                        &encrypt(
                            &key,
                            &format!("{}:blob:{}", self.identity.id, reference.digest),
                            &self.attachment_bytes(reference)?,
                        )?,
                    )?;
                }
            }
        }
        for revision in outgoing {
            let name = format!("{}.enc", revision.id);
            if !remote.contains(&name) {
                transport.put(
                    &name,
                    &encrypt(&key, &self.identity.id, &serde_json::to_vec(&revision)?)?,
                )?;
                report.uploaded += 1;
            }
        }
        Ok(report)
    }
}
fn ancestor(needle: &str, id: &str, graph: &HashMap<String, Revision>) -> bool {
    let mut pending = vec![id.to_string()];
    let mut seen = HashSet::new();
    while let Some(id) = pending.pop() {
        if id == needle {
            return true;
        }
        if seen.insert(id.clone()) {
            if let Some(rev) = graph.get(&id) {
                pending.extend(rev.parents.clone());
            }
        }
    }
    false
}
fn common_ancestor(a: &str, b: &str, graph: &HashMap<String, Revision>) -> Option<String> {
    let mut pending = vec![a.to_string()];
    let mut seen = HashSet::new();
    while let Some(id) = pending.pop() {
        if ancestor(&id, b, graph) {
            return Some(id);
        }
        if seen.insert(id.clone()) {
            if let Some(rev) = graph.get(&id) {
                pending.extend(rev.parents.clone());
            }
        }
    }
    None
}
