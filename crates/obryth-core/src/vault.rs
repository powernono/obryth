use crate::{markdown, types::*};
use anyhow::{bail, Context, Result};
use chrono::Utc;
use fs2::FileExt;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    time::Duration,
};
use uuid::Uuid;
use walkdir::WalkDir;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultIdentity {
    pub id: String,
    pub name: String,
}

pub struct Vault {
    pub root: PathBuf,
    pub db: Connection,
    pub identity: VaultIdentity,
    pub device: String,
}

pub fn atomic_write(path: &Path, bytes: &[u8]) -> Result<()> {
    let parent = path.parent().context("missing parent directory")?;
    fs::create_dir_all(parent)?;
    let mut file = tempfile::NamedTempFile::new_in(parent)?;
    file.write_all(bytes)?;
    file.as_file().sync_all()?;
    file.persist(path).map_err(|error| error.error)?;
    #[cfg(unix)]
    File::open(parent)?.sync_all()?;
    Ok(())
}
pub fn private_write(path: &Path, bytes: &[u8]) -> Result<()> {
    atomic_write(path, bytes)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
    }
    Ok(())
}
pub fn hash(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}
pub fn now() -> String {
    Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Nanos, true)
}

impl Vault {
    pub fn open(root: impl AsRef<Path>) -> Result<Self> {
        fs::create_dir_all(root.as_ref())?;
        let root = fs::canonicalize(root)?;
        fs::create_dir_all(root.join(".obryth"))?;
        let bootstrap = OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(root.join(".obryth/bootstrap.lock"))?;
        bootstrap.lock_exclusive()?;
        let identity_path = root.join(".obryth/vault.json");
        if !identity_path.exists() {
            let identity = VaultIdentity {
                id: Uuid::new_v4().to_string(),
                name: root
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .into(),
            };
            atomic_write(&identity_path, &serde_json::to_vec_pretty(&identity)?)?;
        }
        let device_path = root.join(".obryth/device");
        if !device_path.exists() {
            private_write(&device_path, Uuid::new_v4().to_string().as_bytes())?;
        }
        let identity = serde_json::from_slice(&fs::read(identity_path)?)?;
        let device = fs::read_to_string(device_path)?.trim().to_string();
        let db = Connection::open(root.join(".obryth/index.sqlite"))?;
        db.busy_timeout(Duration::from_secs(10))?;
        db.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
          CREATE TABLE IF NOT EXISTS notes(id TEXT PRIMARY KEY, path TEXT UNIQUE, title TEXT NOT NULL, body TEXT NOT NULL, tags TEXT NOT NULL, pinned INTEGER NOT NULL, updated_at TEXT NOT NULL, revision TEXT NOT NULL, payload TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, file_hash TEXT NOT NULL);
          CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(id UNINDEXED,title,body,tokenize='trigram');
          CREATE TABLE IF NOT EXISTS revisions(id TEXT PRIMARY KEY, note_id TEXT NOT NULL, timestamp TEXT NOT NULL, payload TEXT NOT NULL);
          CREATE INDEX IF NOT EXISTS revision_notes ON revisions(note_id,timestamp);
          CREATE INDEX IF NOT EXISTS revision_activity ON revisions(timestamp,id);
          CREATE TABLE IF NOT EXISTS applied(id TEXT PRIMARY KEY);
          CREATE TABLE IF NOT EXISTS sync_seen(id TEXT PRIMARY KEY);
          CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS chats(id TEXT PRIMARY KEY,title TEXT NOT NULL,provider TEXT NOT NULL,model TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS chat_messages(seq INTEGER PRIMARY KEY,chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,role TEXT NOT NULL,content TEXT NOT NULL,citations TEXT NOT NULL,created_at TEXT NOT NULL);
          CREATE INDEX IF NOT EXISTS chat_history ON chat_messages(chat_id,seq);
          CREATE TABLE IF NOT EXISTS file_state(path TEXT PRIMARY KEY,bytes INTEGER NOT NULL,modified TEXT NOT NULL,hash TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS embeddings(note_id TEXT PRIMARY KEY,revision TEXT NOT NULL,profile TEXT NOT NULL,vector TEXT NOT NULL);")?;
        db.execute(
            "ATTACH DATABASE ?1 AS history",
            [root
                .join(".obryth/history.sqlite")
                .to_string_lossy()
                .as_ref()],
        )?;
        db.execute_batch("PRAGMA history.journal_mode=WAL;
          CREATE TABLE IF NOT EXISTS history.chats(id TEXT PRIMARY KEY,title TEXT NOT NULL,provider TEXT NOT NULL,model TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS history.chat_messages(seq INTEGER PRIMARY KEY,chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,role TEXT NOT NULL,content TEXT NOT NULL,citations TEXT NOT NULL,created_at TEXT NOT NULL);
          CREATE INDEX IF NOT EXISTS history.chat_history ON chat_messages(chat_id,seq);
          CREATE TABLE IF NOT EXISTS history.settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
          INSERT OR IGNORE INTO history.settings SELECT * FROM main.settings;
          INSERT OR IGNORE INTO history.chats SELECT * FROM main.chats;
          INSERT OR IGNORE INTO history.chat_messages SELECT * FROM main.chat_messages;
          CREATE TABLE IF NOT EXISTS embedding_chunks(note_id TEXT NOT NULL,revision TEXT NOT NULL,profile TEXT NOT NULL,part INTEGER NOT NULL,line INTEGER NOT NULL,text TEXT NOT NULL,vector TEXT NOT NULL,PRIMARY KEY(note_id,profile,part));")?;
        drop(bootstrap);
        let vault = Self {
            root,
            db,
            identity,
            device,
        };
        vault.recover()?;
        vault.refresh()?;
        Ok(vault)
    }
    pub(crate) fn lock(&self) -> Result<File> {
        let file = OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(self.root.join(".obryth/write.lock"))?;
        file.lock_exclusive()?;
        Ok(file)
    }
    pub fn list(&self, query: &NoteQuery) -> Result<Vec<SearchHit>> {
        let scope_include = serde_json::to_string(&query.scope.include_tags)?;
        let scope_exclude = serde_json::to_string(&query.scope.exclude_tags)?;
        let use_fts = query.text.chars().count() >= 3;
        let text_clause = if query.text.is_empty() {
            "1=1"
        } else if use_fts {
            "id IN (SELECT id FROM notes_fts WHERE notes_fts MATCH ?3)"
        } else {
            "(title LIKE ?3 ESCAPE '\\' OR body LIKE ?3 ESCAPE '\\')"
        };
        let text_param = if use_fts {
            format!("\"{}\"", query.text.replace('"', "\"\""))
        } else {
            format!(
                "%{}%",
                query
                    .text
                    .replace('\\', "\\\\")
                    .replace('%', "\\%")
                    .replace('_', "\\_")
            )
        };
        let sql = format!("SELECT payload FROM notes WHERE deleted=0 AND
          (json_array_length(?1)=0 OR EXISTS(SELECT 1 FROM json_each(notes.tags) t JOIN json_each(?1) s ON t.value=s.value)) AND
          NOT EXISTS(SELECT 1 FROM json_each(notes.tags) t JOIN json_each(?2) s ON t.value=s.value) AND
          {text_clause} ORDER BY pinned DESC,updated_at DESC,id LIMIT ?4 OFFSET ?5");
        let mut stmt = self.db.prepare(&sql)?;
        let rows = stmt.query_map(
            params![
                scope_include,
                scope_exclude,
                text_param,
                query.limit.clamp(1, 500) as i64,
                query.offset as i64
            ],
            |row| row.get::<_, String>(0),
        )?;
        rows.map(|row| {
            let note: Note = serde_json::from_str(&row?)?;
            let (excerpt, line) = markdown::excerpt(&note.body, &query.text);
            Ok(SearchHit {
                note,
                excerpt,
                line,
            })
        })
        .collect()
    }
    pub fn get(&self, id: &str) -> Result<Note> {
        let json: String = self
            .db
            .query_row(
                "SELECT payload FROM notes WHERE id=?1 AND deleted=0",
                [id],
                |row| row.get(0),
            )
            .context("note not found")?;
        Ok(serde_json::from_str(&json)?)
    }
    pub fn path(&self, id: &str) -> Result<PathBuf> {
        let path: String =
            self.db
                .query_row("SELECT path FROM notes WHERE id=?1", [id], |row| row.get(0))?;
        self.safe_path(&path)
    }
    pub(crate) fn safe_path(&self, relative: &str) -> Result<PathBuf> {
        let path = Path::new(relative);
        if path.is_absolute()
            || path
                .components()
                .any(|part| !matches!(part, std::path::Component::Normal(_)))
        {
            bail!("invalid vault path");
        }
        let joined = self.root.join(path);
        let mut existing = joined.as_path();
        while !existing.exists() {
            existing = existing.parent().context("missing vault parent")?;
        }
        if !fs::canonicalize(existing)?.starts_with(&self.root) {
            bail!("path escapes vault");
        }
        Ok(joined)
    }
    pub fn save(&self, draft: NoteDraft) -> Result<Note> {
        let _lock = self.lock()?;
        self.save_locked(draft, vec![])
    }
    fn save_locked(&self, draft: NoteDraft, extra_parents: Vec<String>) -> Result<Note> {
        let previous = draft.id.as_deref().map(|id| self.get(id)).transpose()?;
        if let Some(old) = &previous {
            if draft.base_revision.as_deref() != Some(old.revision.as_str()) {
                bail!("REVISION_CONFLICT: reload or merge before saving");
            }
            let path = self.path(&old.id)?;
            if !path.exists() || hash(&fs::read(path)?) != self.file_hash(&old.id)? {
                bail!("EXTERNAL_CHANGE: refresh before saving");
            }
        }
        let timestamp = now();
        let mut tags = draft.tags;
        tags.sort();
        tags.dedup();
        let mut note = Note {
            id: previous
                .as_ref()
                .map(|n| n.id.clone())
                .unwrap_or_else(|| Uuid::new_v4().to_string()),
            title: draft.title,
            body: draft.body,
            tags,
            kind: if draft.kind.is_empty() {
                "document".into()
            } else {
                draft.kind
            },
            pinned: draft.pinned,
            created_at: previous
                .as_ref()
                .map(|n| n.created_at.clone())
                .unwrap_or(timestamp.clone()),
            updated_at: timestamp.clone(),
            revision: String::new(),
            source: draft.source,
            extra: previous
                .as_ref()
                .map(|n| n.extra.clone())
                .unwrap_or_default(),
        };
        note.revision = hash(&serde_json::to_vec(&note)?);
        let mut parents = previous.map(|n| vec![n.revision]).unwrap_or_default();
        parents.extend(extra_parents);
        parents.sort();
        parents.dedup();
        self.commit(Some(note.clone()), &note.id, parents)?;
        Ok(note)
    }
    fn file_hash(&self, id: &str) -> Result<String> {
        Ok(self
            .db
            .query_row("SELECT file_hash FROM notes WHERE id=?1", [id], |r| {
                r.get(0)
            })?)
    }
    pub fn delete(&self, id: &str, base: &str) -> Result<()> {
        let _lock = self.lock()?;
        let note = self.get(id)?;
        if note.revision != base {
            bail!("REVISION_CONFLICT");
        }
        if self.path(id)?.exists() && hash(&fs::read(self.path(id)?)?) != self.file_hash(id)? {
            bail!("EXTERNAL_CHANGE: refresh before deleting");
        }
        self.commit(None, id, vec![note.revision])?;
        Ok(())
    }
    pub(crate) fn commit(
        &self,
        note: Option<Note>,
        id: &str,
        parents: Vec<String>,
    ) -> Result<Revision> {
        let sequence_path = self.root.join(".obryth/sequence");
        let sequence = fs::read_to_string(&sequence_path)
            .ok()
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(0)
            + 1;
        private_write(&sequence_path, sequence.to_string().as_bytes())?;
        let attachments = note
            .as_ref()
            .map(|n| self.attachment_refs(&n.body))
            .transpose()?
            .unwrap_or_default();
        let mut revision = Revision {
            id: String::new(),
            note_id: id.into(),
            parents,
            device: self.device.clone(),
            sequence,
            note,
            timestamp: now(),
            attachments,
        };
        revision.id = revision
            .note
            .as_ref()
            .map(|n| n.revision.clone())
            .unwrap_or_else(|| {
                hash(&serde_json::to_vec(&revision).expect("serializable revision"))
            });
        let bytes = serde_json::to_vec(&revision)?;
        // The durable event precedes materialization. Recovery replays incomplete commits.
        atomic_write(
            &self.root.join(format!(
                ".obryth/events/{}/{sequence:020}.json",
                self.device
            )),
            &bytes,
        )?;
        atomic_write(&self.root.join(".obryth/pending-commit.json"), &bytes)?;
        self.apply(&revision)?;
        fs::remove_file(self.root.join(".obryth/pending-commit.json"))?;
        Ok(revision)
    }
    pub(crate) fn apply(&self, revision: &Revision) -> Result<()> {
        self.apply_at(revision, None)
    }
    fn apply_at(&self, revision: &Revision, relative_hint: Option<&str>) -> Result<()> {
        let target = self
            .root
            .join(format!(".obryth/revisions/{}.json", revision.id));
        atomic_write(&target, &serde_json::to_vec(revision)?)?;
        let old_path: Option<String> = self
            .db
            .query_row(
                "SELECT path FROM notes WHERE id=?1",
                [&revision.note_id],
                |r| r.get(0),
            )
            .optional()?;
        let relative = relative_hint
            .map(str::to_owned)
            .or(old_path)
            .unwrap_or_else(|| format!("notes/{}.md", revision.note_id));
        atomic_write(
            &self.root.join(".obryth/pending-apply.json"),
            &serde_json::to_vec(&serde_json::json!({"revision":revision,"path":relative}))?,
        )?;
        atomic_write(
            &self
                .root
                .join(format!(".obryth/heads/{}.json", revision.note_id)),
            &serde_json::to_vec(&serde_json::json!({"revision":revision,"path":relative}))?,
        )?;
        let path = self.safe_path(&relative)?;
        if let Some(note) = &revision.note {
            let encoded = markdown::encode(note)?;
            atomic_write(&path, encoded.as_bytes())?;
            self.index(note, &relative, &hash(encoded.as_bytes()))?;
        } else {
            if path.exists() {
                let trash = self.root.join(format!(
                    ".obryth/trash/{}-{}.md",
                    revision.note_id, revision.id
                ));
                fs::create_dir_all(trash.parent().unwrap())?;
                fs::rename(&path, trash)?;
            }
            self.db.execute("INSERT INTO notes VALUES(?1,?2,'','','[]',0,?3,?4,'null',1,'') ON CONFLICT(id) DO UPDATE SET deleted=1,revision=excluded.revision",params![revision.note_id,relative,revision.timestamp,revision.id])?;
            self.db
                .execute("DELETE FROM notes_fts WHERE id=?1", [&revision.note_id])?;
            self.db.execute(
                "DELETE FROM embeddings WHERE note_id=?1",
                [&revision.note_id],
            )?;
        }
        self.db.execute(
            "INSERT OR IGNORE INTO revisions VALUES(?1,?2,?3,?4)",
            params![
                revision.id,
                revision.note_id,
                revision.timestamp,
                serde_json::to_string(revision)?
            ],
        )?;
        self.db
            .execute("INSERT OR IGNORE INTO applied VALUES(?1)", [&revision.id])?;
        fs::remove_file(self.root.join(".obryth/pending-apply.json"))?;
        Ok(())
    }
    fn index(&self, note: &Note, path: &str, file_hash: &str) -> Result<()> {
        let tx = self.db.unchecked_transaction()?;
        tx.execute("INSERT INTO notes VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,0,?10) ON CONFLICT(id) DO UPDATE SET path=excluded.path,title=excluded.title,body=excluded.body,tags=excluded.tags,pinned=excluded.pinned,updated_at=excluded.updated_at,revision=excluded.revision,payload=excluded.payload,deleted=0,file_hash=excluded.file_hash",params![note.id,path,note.title,note.body,serde_json::to_string(&note.tags)?,note.pinned,note.updated_at,note.revision,serde_json::to_string(note)?,file_hash])?;
        tx.execute("DELETE FROM notes_fts WHERE id=?1", [&note.id])?;
        tx.execute(
            "INSERT INTO notes_fts VALUES(?1,?2,?3)",
            params![note.id, note.title, note.body],
        )?;
        tx.execute(
            "DELETE FROM embeddings WHERE note_id=?1 AND revision<>?2",
            params![note.id, note.revision],
        )?;
        let metadata = fs::metadata(self.safe_path(path)?)?;
        tx.execute("INSERT INTO file_state VALUES(?1,?2,?3,?4) ON CONFLICT(path) DO UPDATE SET bytes=excluded.bytes,modified=excluded.modified,hash=excluded.hash",params![path,metadata.len(),format!("{:?}",metadata.modified()?),file_hash])?;
        tx.execute(
            "DELETE FROM embedding_chunks WHERE note_id=?1 AND revision<>?2",
            params![note.id, note.revision],
        )?;
        tx.commit()?;
        Ok(())
    }
    fn recover(&self) -> Result<()> {
        let _lock = self.lock()?;
        let rebuild: bool = self.db.query_row(
            "SELECT NOT EXISTS(SELECT 1 FROM notes) AND NOT EXISTS(SELECT 1 FROM revisions)",
            [],
            |r| r.get(0),
        )?;
        let archive = self.root.join(".obryth/revisions");
        if rebuild && archive.exists() {
            for entry in fs::read_dir(archive)? {
                let revision: Revision = serde_json::from_slice(&fs::read(entry?.path())?)?;
                self.db.execute(
                    "INSERT OR IGNORE INTO revisions VALUES(?1,?2,?3,?4)",
                    params![
                        revision.id,
                        revision.note_id,
                        revision.timestamp,
                        serde_json::to_string(&revision)?
                    ],
                )?;
            }
        }
        let heads = self.root.join(".obryth/heads");
        if rebuild && heads.exists() {
            for entry in fs::read_dir(heads)? {
                let value: serde_json::Value = serde_json::from_slice(&fs::read(entry?.path())?)?;
                let revision: Revision = serde_json::from_value(value["revision"].clone())?;
                let stored: Option<String> = self
                    .db
                    .query_row(
                        "SELECT revision FROM notes WHERE id=?1",
                        [&revision.note_id],
                        |r| r.get(0),
                    )
                    .optional()?;
                if stored.as_deref() != Some(&revision.id) {
                    let relative = value["path"].as_str().context("missing recovered path")?;
                    let path = self.safe_path(relative)?;
                    let external = if let Some(note) = &revision.note {
                        fs::read(&path).ok().filter(|bytes| {
                            markdown::encode(note)
                                .is_ok_and(|expected| bytes.as_slice() != expected.as_bytes())
                        })
                    } else {
                        None
                    };
                    self.apply_at(&revision, Some(relative))?;
                    // Markdown remains authoritative, including edits made while the index was missing.
                    if let Some(bytes) = external {
                        atomic_write(&path, &bytes)?;
                    }
                }
            }
        }
        let materialization = self.root.join(".obryth/pending-apply.json");
        if materialization.exists() {
            let value: serde_json::Value = serde_json::from_slice(&fs::read(&materialization)?)?;
            let revision = serde_json::from_value(value["revision"].clone())?;
            self.apply_at(&revision, value["path"].as_str())?;
        }
        let pending = self.root.join(".obryth/pending-commit.json");
        if pending.exists() {
            let revision = serde_json::from_slice(&fs::read(&pending)?)?;
            self.apply(&revision)?;
            fs::remove_file(pending)?;
        }
        Ok(())
    }
    pub fn refresh(&self) -> Result<usize> {
        self.refresh_files(false)
    }
    pub fn refresh_files(&self, force: bool) -> Result<usize> {
        let _lock = self.lock()?;
        let mut changed = 0;
        let mut seen = std::collections::HashSet::new();
        for entry in WalkDir::new(&self.root)
            .follow_links(false)
            .into_iter()
            .filter_entry(|e| e.file_name() != ".obryth")
            .filter_map(|e| e.ok())
        {
            if !entry.file_type().is_file()
                || entry
                    .path()
                    .extension()
                    .is_none_or(|ext| ext != "md" && ext != "markdown")
            {
                continue;
            }
            let relative = entry
                .path()
                .strip_prefix(&self.root)?
                .to_string_lossy()
                .replace('\\', "/");
            let existing: Option<(String, String)> = self
                .db
                .query_row(
                    "SELECT id,file_hash FROM notes WHERE path=?1 AND deleted=0",
                    [&relative],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .optional()?;
            if !force {
                if let Some((id, hash)) = &existing {
                    let metadata = fs::metadata(entry.path())?;
                    let cached:bool=self.db.query_row("SELECT EXISTS(SELECT 1 FROM file_state WHERE path=?1 AND bytes=?2 AND modified=?3 AND hash=?4)",params![relative,metadata.len(),format!("{:?}",metadata.modified()?),hash],|r|r.get(0))?;
                    if cached {
                        seen.insert(id.clone());
                        continue;
                    }
                }
            }
            let text = fs::read_to_string(entry.path())?;
            let file_hash = hash(text.as_bytes());
            if let Some((id, old_hash)) = &existing {
                seen.insert(id.clone());
                if *old_hash == file_hash {
                    continue;
                }
            }
            let mut note = match markdown::decode(&text) {
                Ok(note) => note,
                Err(_) => Note {
                    id: existing
                        .as_ref()
                        .map(|x| x.0.clone())
                        .unwrap_or_else(|| Uuid::new_v4().to_string()),
                    title: text
                        .lines()
                        .find_map(|line| line.strip_prefix("# "))
                        .unwrap_or_else(|| {
                            entry
                                .path()
                                .file_stem()
                                .unwrap()
                                .to_str()
                                .unwrap_or("Untitled")
                        })
                        .into(),
                    body: text.clone(),
                    tags: vec![],
                    kind: "document".into(),
                    pinned: false,
                    created_at: now(),
                    updated_at: now(),
                    revision: String::new(),
                    source: None,
                    extra: Default::default(),
                },
            };
            Uuid::parse_str(&note.id).context("invalid note UUID")?;
            if existing.as_ref().is_some_and(|(id, _)| id != &note.id) {
                bail!("note UUID cannot change in place: {relative}");
            }
            if !seen.insert(note.id.clone()) && existing.as_ref().is_none_or(|e| e.0 != note.id) {
                bail!("duplicate note UUID in {relative}");
            }
            let previous = self.get(&note.id).ok();
            note.updated_at = now();
            note.revision.clear();
            note.revision = hash(&serde_json::to_vec(&note)?);
            // Preserve the external path before the journal writes the canonical file.
            self.index(&note, &relative, &file_hash)?;
            self.commit(
                Some(note.clone()),
                &note.id,
                previous.map(|n| vec![n.revision]).unwrap_or_default(),
            )?;
            changed += 1;
        }
        let mut stmt = self
            .db
            .prepare("SELECT id,revision FROM notes WHERE deleted=0")?;
        let active = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
            .collect::<Result<Vec<_>, _>>()?;
        for (id, revision) in active {
            if !seen.contains(&id) && !self.path(&id)?.exists() {
                self.commit(None, &id, vec![revision])?;
                changed += 1;
            }
        }
        Ok(changed)
    }
    pub fn history(&self, id: &str) -> Result<Vec<Revision>> {
        let mut stmt = self
            .db
            .prepare("SELECT payload FROM revisions WHERE note_id=?1 ORDER BY timestamp DESC")?;
        let rows = stmt
            .query_map([id], |r| r.get::<_, String>(0))?
            .map(|row| Ok(serde_json::from_str(&row?)?))
            .collect();
        rows
    }
    pub fn backlinks(&self, id: &str) -> Result<Vec<SearchHit>> {
        let note = self.get(id)?;
        let mut query = NoteQuery {
            text: format!("[[{}]]", note.title),
            limit: 500,
            ..Default::default()
        };
        let mut found = self.list(&query)?;
        query.text = format!("[[{}]]", id);
        for hit in self.list(&query)? {
            if !found.iter().any(|n| n.note.id == hit.note.id) {
                found.push(hit);
            }
        }
        Ok(found)
    }
    pub fn setting(&self, key: &str) -> Result<Option<serde_json::Value>> {
        let value: Option<String> = self
            .db
            .query_row(
                "SELECT value FROM history.settings WHERE key=?1",
                [key],
                |r| r.get(0),
            )
            .optional()?;
        value
            .map(|v| serde_json::from_str(&v).map_err(Into::into))
            .transpose()
    }
    pub fn set_setting(&self, key: &str, value: &serde_json::Value) -> Result<()> {
        self.db.execute("INSERT INTO history.settings VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",params![key,serde_json::to_string(value)?])?;
        Ok(())
    }
    pub fn revisions(&self) -> Result<Vec<Revision>> {
        let mut stmt = self
            .db
            .prepare("SELECT payload FROM revisions ORDER BY timestamp,id")?;
        let rows = stmt
            .query_map([], |r| r.get::<_, String>(0))?
            .map(|row| Ok(serde_json::from_str(&row?)?))
            .collect();
        rows
    }
    pub fn resolve_conflict(&self, id: &str, draft: NoteDraft) -> Result<Note> {
        if id.len() != 64 || !id.chars().all(|c| c.is_ascii_hexdigit()) {
            bail!("invalid conflict identity");
        }
        let _lock = self.lock()?;
        let path = self.root.join(format!(".obryth/conflicts/{id}.json"));
        let conflict: serde_json::Value = serde_json::from_slice(&fs::read(&path)?)?;
        let remote: Revision = serde_json::from_value(conflict["remote"].clone())?;
        if draft.id.as_deref() != Some(remote.note_id.as_str()) {
            bail!("conflict note identity mismatch");
        }
        let note = self.save_locked(draft, vec![remote.id])?;
        fs::remove_file(path)?;
        Ok(note)
    }
    pub(crate) fn remember(&self, revision: &Revision) -> Result<()> {
        atomic_write(
            &self
                .root
                .join(format!(".obryth/revisions/{}.json", revision.id)),
            &serde_json::to_vec(revision)?,
        )?;
        self.db.execute(
            "INSERT OR IGNORE INTO revisions VALUES(?1,?2,?3,?4)",
            params![
                revision.id,
                revision.note_id,
                revision.timestamp,
                serde_json::to_string(revision)?
            ],
        )?;
        Ok(())
    }
    pub(crate) fn commit_for_sync(&self, note: Note, parents: Vec<String>) -> Result<Revision> {
        self.commit(Some(note.clone()), &note.id, parents)
    }
    pub fn import_markdown(&self, path: &Path) -> Result<Vec<Note>> {
        let files = if path.is_dir() {
            WalkDir::new(path)
                .follow_links(false)
                .into_iter()
                .filter_map(|e| e.ok())
                .filter(|e| {
                    e.file_type().is_file() && e.path().extension().is_some_and(|s| s == "md")
                })
                .map(|e| e.into_path())
                .collect::<Vec<_>>()
        } else {
            vec![path.to_path_buf()]
        };
        let mut notes = vec![];
        for file in files {
            let body = fs::read_to_string(&file)?;
            let old = markdown::decode(&body).ok();
            notes.push(self.save(NoteDraft {
                title: old.as_ref().map(|n| n.title.clone()).unwrap_or_else(|| {
                    file.file_stem()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .into()
                }),
                body: old.as_ref().map(|n| n.body.clone()).unwrap_or(body),
                tags: old.map(|n| n.tags).unwrap_or_default(),
                ..Default::default()
            })?);
        }
        Ok(notes)
    }
}
