use crate::{
    sync::{FolderTransport, WebDavTransport},
    types::*,
    Vault,
};
use anyhow::{bail, Context, Result};
use serde_json::{json, Value};
use std::{fs, path::Path};

fn text<'a>(value: &'a Value, key: &str) -> Result<&'a str> {
    value[key]
        .as_str()
        .with_context(|| format!("missing {key}"))
}
pub fn dispatch(vault: &Vault, method: &str, params: Value) -> Result<Value> {
    match method {
        "plugins.list" => Ok(json!(vault.plugins()?)),
        "plugins.remove" => {
            vault.remove_plugin(text(&params, "id")?)?;
            Ok(json!(true))
        }
        "plugins.fetch" => vault.plugin_fetch(text(&params, "pluginId")?, text(&params, "url")?),
        "plugins.install" => vault.install_plugin(Path::new(text(&params, "path")?)),
        "chat.create" => vault.create_chat(
            text(&params, "title")?,
            text(&params, "providerId")?,
            text(&params, "model")?,
        ),
        "chat.list" => Ok(json!(vault.list_chats(
            params["offset"].as_u64().unwrap_or(0) as usize,
            params["limit"].as_u64().unwrap_or(50) as usize
        )?)),
        "chat.history" => Ok(json!(vault.chat_messages(
            text(&params, "id")?,
            params["before"].as_i64(),
            params["limit"].as_u64().unwrap_or(50) as usize
        )?)),
        "vault.info" => Ok(
            json!({"id":vault.identity.id,"name":vault.identity.name,"root":vault.root,"protocolVersion":crate::PROTOCOL_VERSION}),
        ),
        "notes.list" | "knowledge.search" => Ok(serde_json::to_value(
            vault.list(&serde_json::from_value::<NoteQuery>(params)?)?,
        )?),
        "notes.get" => Ok(serde_json::to_value(vault.get(text(&params, "id")?)?)?),
        "notes.path" => Ok(json!(vault.path(text(&params, "id")?)?)),
        "notes.save" => Ok(serde_json::to_value(
            vault.save(serde_json::from_value(params)?)?,
        )?),
        "notes.delete" => {
            vault.delete(text(&params, "id")?, text(&params, "baseRevision")?)?;
            Ok(json!(true))
        }
        "notes.history" => Ok(serde_json::to_value(vault.history(text(&params, "id")?)?)?),
        "notes.activity" => Ok(serde_json::to_value(
            vault.activity(&serde_json::from_value(params)?)?,
        )?),
        "notes.activityFeed" => Ok(serde_json::to_value(
            vault.activity_feed(&serde_json::from_value(params)?)?,
        )?),
        "notes.activityVersions" => Ok(serde_json::to_value(
            vault.activity_versions(&serde_json::from_value(params)?)?,
        )?),
        "notes.backlinks" => Ok(serde_json::to_value(
            vault.backlinks(text(&params, "id")?)?,
        )?),
        "notes.refresh" => Ok(json!({"changed":vault.refresh_files(true)?})),
        "notes.import" => Ok(serde_json::to_value(
            vault.import_markdown(Path::new(text(&params, "path")?))?,
        )?),
        "attachments.import" => Ok(json!(
            vault.import_attachment(Path::new(text(&params, "path")?))?
        )),
        "notes.restore" => {
            let id = text(&params, "id")?;
            let revision = text(&params, "revision")?;
            let old = vault
                .history(id)?
                .into_iter()
                .find(|r| r.note.as_ref().is_some_and(|n| n.revision == revision))
                .and_then(|r| r.note)
                .context("history version not found")?;
            let current = vault.get(id)?;
            Ok(serde_json::to_value(vault.save(NoteDraft {
                id: Some(id.into()),
                title: old.title,
                body: old.body,
                tags: old.tags,
                kind: old.kind,
                pinned: old.pinned,
                base_revision: Some(current.revision),
                source: old.source,
            })?)?)
        }
        "conflicts.list" => {
            let root = vault.root.join(".obryth/conflicts");
            let mut entries = vec![];
            if root.exists() {
                for entry in fs::read_dir(root)? {
                    entries.push(serde_json::from_slice::<Value>(&fs::read(entry?.path())?)?);
                }
            }
            Ok(json!(entries))
        }
        "conflicts.resolve" => Ok(serde_json::to_value(vault.resolve_conflict(
            text(&params, "id")?,
            serde_json::from_value(params["draft"].clone())?,
        )?)?),
        "settings.get" => Ok(vault.setting(text(&params, "key")?)?.unwrap_or(Value::Null)),
        "settings.set" => {
            let key = text(&params, "key")?;
            if matches!(key, "providers" | "daemon") {
                bail!("reserved setting");
            }
            vault.set_setting(key, &params["value"])?;
            Ok(json!(true))
        }
        "providers.list" => Ok(serde_json::to_value(vault.profiles()?)?),
        "providers.save" => {
            let profile: ProviderProfile = serde_json::from_value(params["profile"].clone())?;
            if let Some(secret) = params["secret"].as_str() {
                crate::provider::save_secret(&profile.secret_ref, secret)?;
            }
            vault.save_profile(profile)?;
            Ok(json!(true))
        }
        "providers.models" => {
            let profile: ProviderProfile = serde_json::from_value(params["profile"].clone())?;
            Ok(json!(crate::provider::models(
                &profile,
                params["secret"].as_str()
            )?))
        }
        "knowledge.ask" => {
            let profile = vault
                .profiles()?
                .into_iter()
                .find(|p| p.id == params["profileId"])
                .context("configure an API provider first")?;
            let scope: KnowledgeScope =
                serde_json::from_value(params.get("scope").cloned().unwrap_or(json!({})))?;
            let question = text(&params, "question")?;
            let conversation = params["conversationId"].as_str();
            if let Some(id) = conversation {
                vault.append_chat_message(id, "user", question, &json!([]))?;
            }
            let mut hits = vault.list(&NoteQuery {
                text: question.into(),
                scope: scope.clone(),
                limit: 12,
                ..Default::default()
            })?;
            if hits.is_empty() {
                hits = vault.list(&NoteQuery {
                    scope,
                    limit: 12,
                    ..Default::default()
                })?;
            }
            let answer = crate::provider::complete(
                &profile,
                text(&params, "model")?,
                question,
                &hits,
                params["secret"].as_str(),
            )?;
            if let Some(id) = conversation {
                let citations=hits.iter().map(|hit|json!({"noteId":hit.note.id,"revision":hit.note.revision,"title":hit.note.title,"excerpt":hit.excerpt,"line":hit.line})).collect::<Vec<_>>();
                vault.append_chat_message(id, "assistant", &answer, &json!(citations))?;
            }
            Ok(json!({"answer":answer,"sources":hits}))
        }
        "knowledge.read" => {
            let scope: KnowledgeScope =
                serde_json::from_value(params.get("scope").cloned().unwrap_or(json!({})))?;
            let note = vault.get(text(&params, "id")?)?;
            if !scope.allows(&note) {
                bail!("note is outside the knowledge scope");
            }
            Ok(json!(note))
        }
        "knowledge.propose" => {
            let note = vault.get(text(&params, "noteId")?)?;
            if note.revision != text(&params, "baseRevision")? {
                bail!("REVISION_CONFLICT: proposal needs the current note version");
            }
            let id = uuid::Uuid::new_v4().to_string();
            let proposal = json!({"id":id,"noteId":note.id,"baseRevision":note.revision,"body":text(&params,"body")?,"status":"pending"});
            crate::vault::atomic_write(
                &vault.root.join(format!(".obryth/proposals/{id}.json")),
                &serde_json::to_vec_pretty(&proposal)?,
            )?;
            Ok(proposal)
        }
        "knowledge.proposals" => {
            let path = vault.root.join(".obryth/proposals");
            let mut entries = vec![];
            if path.exists() {
                for entry in fs::read_dir(path)? {
                    entries.push(serde_json::from_slice::<Value>(&fs::read(entry?.path())?)?);
                }
            }
            Ok(json!(entries))
        }
        "knowledge.review" => {
            let id = text(&params, "id")?;
            uuid::Uuid::parse_str(id)?;
            let path = vault.root.join(format!(".obryth/proposals/{id}.json"));
            let proposal: Value = serde_json::from_slice(&fs::read(&path)?)?;
            if params["accept"] == true {
                let note = vault.get(text(&proposal, "noteId")?)?;
                vault.save(NoteDraft {
                    id: Some(note.id),
                    title: note.title,
                    body: text(&proposal, "body")?.into(),
                    tags: note.tags,
                    kind: note.kind,
                    pinned: note.pinned,
                    base_revision: Some(text(&proposal, "baseRevision")?.into()),
                    source: note.source,
                })?;
            }
            fs::remove_file(path)?;
            Ok(json!(true))
        }
        "knowledge.index" | "knowledge.semantic" => {
            let profile = vault
                .profiles()?
                .into_iter()
                .find(|p| p.id == params["profileId"])
                .context("embedding provider not found")?;
            let scope: KnowledgeScope =
                serde_json::from_value(params.get("scope").cloned().unwrap_or(json!({})))?;
            if method == "knowledge.index" {
                Ok(
                    json!({"indexed":vault.semantic_index(&profile,text(&params,"model")?,&scope,params["secret"].as_str())?}),
                )
            } else {
                Ok(json!(vault.semantic_search(
                    &profile,
                    text(&params, "model")?,
                    text(&params, "query")?,
                    &scope,
                    params["secret"].as_str()
                )?))
            }
        }
        "sync.configure" => {
            let endpoint = text(&params, "endpoint")?;
            let parsed = url::Url::parse(endpoint)?;
            if parsed.scheme() != "https"
                && !matches!(parsed.host_str(), Some("localhost" | "127.0.0.1" | "::1"))
            {
                bail!("WebDAV credentials require HTTPS outside loopback");
            }
            if let Some(password) = params["password"].as_str() {
                crate::provider::save_secret("obryth.sync.webdav", password)?;
            }
            vault.set_setting(
                "sync.webdav",
                &json!({"endpoint":endpoint,"username":text(&params,"username")?}),
            )?;
            Ok(json!(true))
        }
        "sync.pairing" => vault.export_pairing(),
        "sync.run" => {
            if let Some(path) = params["folder"].as_str() {
                Ok(json!(vault.sync(&FolderTransport(path.into()))?))
            } else {
                let password = if let Some(password) = params["password"].as_str() {
                    password.to_owned()
                } else {
                    crate::provider::secret(text(&params, "secretRef")?)?
                };
                let transport = WebDavTransport::new(
                    text(&params, "endpoint")?,
                    text(&params, "username")?,
                    &password,
                    &vault.identity.id,
                )?;
                Ok(json!(vault.sync(&transport)?))
            }
        }
        _ => bail!("unknown method: {method}"),
    }
}
