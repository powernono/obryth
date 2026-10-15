use obryth_core::{
    sync::{FolderTransport, SyncTransport},
    vault::atomic_write,
    *,
};
use std::{fs, path::Path};

fn draft(title: &str, body: &str, tags: &[&str]) -> NoteDraft {
    NoteDraft {
        title: title.into(),
        body: body.into(),
        tags: tags.iter().map(|s| s.to_string()).collect(),
        ..Default::default()
    }
}
fn edit(note: &Note, body: &str) -> NoteDraft {
    NoteDraft {
        id: Some(note.id.clone()),
        title: note.title.clone(),
        body: body.into(),
        tags: note.tags.clone(),
        kind: note.kind.clone(),
        pinned: note.pinned,
        base_revision: Some(note.revision.clone()),
        source: note.source.clone(),
    }
}
fn peer(source: &Vault, path: &Path) -> Vault {
    fs::create_dir_all(path.join(".obryth")).unwrap();
    fs::copy(
        source.root.join(".obryth/vault.json"),
        path.join(".obryth/vault.json"),
    )
    .unwrap();
    fs::write(path.join(".obryth/sync.key"), source.sync_key().unwrap()).unwrap();
    Vault::open(path).unwrap()
}

#[test]
fn markdown_is_portable_and_unknown_metadata_survives() {
    let temp = tempfile::tempdir().unwrap();
    let vault = Vault::open(temp.path()).unwrap();
    let note = vault
        .save(draft(
            "中文笔记",
            "<custom-widget mode=\"x\">保留</custom-widget>\n\n```rust\nfn main() {}\n```\n",
            &["开发"],
        ))
        .unwrap();
    let path = vault.path(&note.id).unwrap();
    let text = fs::read_to_string(&path).unwrap();
    assert_eq!(markdown::decode(&text).unwrap(), note);
    let text = text.replacen("---\n", "---\ncustomField: keep-me\n", 1);
    atomic_write(&path, text.as_bytes()).unwrap();
    vault.refresh().unwrap();
    let changed = vault.get(&note.id).unwrap();
    assert_eq!(changed.extra["customField"], "keep-me");
    let saved = vault.save(edit(&changed, "updated")).unwrap();
    assert_eq!(saved.extra["customField"], "keep-me");
}
#[test]
fn stale_save_and_external_changes_are_not_overwritten() {
    let temp = tempfile::tempdir().unwrap();
    let vault = Vault::open(temp.path()).unwrap();
    let a = vault.save(draft("A", "first", &[])).unwrap();
    let b = vault.save(edit(&a, "second")).unwrap();
    assert!(vault
        .save(edit(&a, "stale"))
        .unwrap_err()
        .to_string()
        .contains("REVISION_CONFLICT"));
    let path = vault.path(&a.id).unwrap();
    let mut external = b.clone();
    external.body = "external".into();
    fs::write(path, markdown::encode(&external).unwrap()).unwrap();
    assert!(vault.save(edit(&b, "clobber")).is_err());
    vault.refresh().unwrap();
    assert_eq!(vault.get(&a.id).unwrap().body, "external");
}
#[test]
fn chinese_search_and_scope_exclusions_work_before_pagination() {
    let temp = tempfile::tempdir().unwrap();
    let vault = Vault::open(temp.path()).unwrap();
    vault
        .save(draft("设计", "研究 WebDAV 同步设计", &["work"]))
        .unwrap();
    vault
        .save(draft("Private", "WebDAV 同步秘密", &["work", "private"]))
        .unwrap();
    let scope = KnowledgeScope {
        include_tags: vec!["work".into()],
        exclude_tags: vec!["private".into()],
    };
    for query in ["同步", "WebDAV", "设计"] {
        let hits = vault
            .list(&NoteQuery {
                text: query.into(),
                scope: scope.clone(),
                limit: 1,
                ..Default::default()
            })
            .unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].note.title, "设计");
    }
}
#[test]
fn deleted_notes_leave_history_and_tombstones() {
    let temp = tempfile::tempdir().unwrap();
    let vault = Vault::open(temp.path()).unwrap();
    let note = vault.save(draft("Delete me", "old", &[])).unwrap();
    vault.delete(&note.id, &note.revision).unwrap();
    assert!(vault.get(&note.id).is_err());
    assert_eq!(vault.history(&note.id).unwrap().len(), 2);
}
#[test]
fn four_devices_converge_and_deleted_notes_do_not_resurrect() {
    let temp = tempfile::tempdir().unwrap();
    let a = Vault::open(temp.path().join("a")).unwrap();
    let b = peer(&a, &temp.path().join("b"));
    let c = peer(&a, &temp.path().join("c"));
    let d = peer(&a, &temp.path().join("d"));
    let remote = FolderTransport(temp.path().join("remote"));
    let note = a.save(draft("Shared", "seed", &["shared"])).unwrap();
    a.sync(&remote).unwrap();
    for v in [&b, &c, &d] {
        v.sync(&remote).unwrap();
        assert_eq!(v.get(&note.id).unwrap().body, "seed");
    }
    let changed = b.save(edit(&b.get(&note.id).unwrap(), "second")).unwrap();
    b.sync(&remote).unwrap();
    a.sync(&remote).unwrap();
    assert_eq!(a.get(&note.id).unwrap().body, "second");
    b.delete(&note.id, &changed.revision).unwrap();
    b.sync(&remote).unwrap();
    d.sync(&remote).unwrap();
    c.sync(&remote).unwrap();
    a.sync(&remote).unwrap();
    for v in [&a, &b, &c, &d] {
        assert!(v.get(&note.id).is_err());
        assert_eq!(v.sync(&remote).unwrap().uploaded, 0);
    }
}
#[test]
fn overlapping_edits_are_retained_as_conflicts() {
    let temp = tempfile::tempdir().unwrap();
    let a = Vault::open(temp.path().join("a")).unwrap();
    let b = peer(&a, &temp.path().join("b"));
    let remote = FolderTransport(temp.path().join("remote"));
    let note = a.save(draft("Shared", "base\n", &[])).unwrap();
    a.sync(&remote).unwrap();
    b.sync(&remote).unwrap();
    a.save(edit(&note, "ours\n")).unwrap();
    b.save(edit(&b.get(&note.id).unwrap(), "theirs\n")).unwrap();
    a.sync(&remote).unwrap();
    let result = b.sync(&remote).unwrap();
    assert_eq!(result.conflicts.len(), 1);
    assert_eq!(b.get(&note.id).unwrap().body, "theirs\n");
    assert!(b
        .history(&note.id)
        .unwrap()
        .iter()
        .any(|r| r.note.as_ref().is_some_and(|n| n.body == "ours\n")));
}
#[test]
fn nonoverlapping_edits_merge() {
    let temp = tempfile::tempdir().unwrap();
    let a = Vault::open(temp.path().join("a")).unwrap();
    let b = peer(&a, &temp.path().join("b"));
    let remote = FolderTransport(temp.path().join("remote"));
    let note = a
        .save(draft("Shared", "one\ntwo\nthree\nfour\n", &[]))
        .unwrap();
    a.sync(&remote).unwrap();
    b.sync(&remote).unwrap();
    a.save(edit(&note, "ONE\ntwo\nthree\nfour\n")).unwrap();
    b.save(edit(&b.get(&note.id).unwrap(), "one\ntwo\nthree\nFOUR\n"))
        .unwrap();
    a.sync(&remote).unwrap();
    assert!(b.sync(&remote).unwrap().conflicts.is_empty());
    a.sync(&remote).unwrap();
    assert_eq!(a.get(&note.id).unwrap().body, "ONE\ntwo\nthree\nFOUR\n");
}
#[test]
fn wrong_keys_never_partially_import() {
    let temp = tempfile::tempdir().unwrap();
    let a = Vault::open(temp.path().join("a")).unwrap();
    let b = peer(&a, &temp.path().join("b"));
    let remote = FolderTransport(temp.path().join("remote"));
    a.save(draft("Secret", "not plaintext in storage", &[]))
        .unwrap();
    a.sync(&remote).unwrap();
    for name in remote.list().unwrap() {
        let bytes = remote.get(&name).unwrap();
        assert!(!String::from_utf8_lossy(&bytes).contains("not plaintext"));
    }
    fs::write(b.root.join(".obryth/sync.key"), [42u8; 32]).unwrap();
    assert!(b
        .sync(&remote)
        .unwrap_err()
        .to_string()
        .contains("KEY_MISMATCH"));
    assert!(b.list(&NoteQuery::default()).unwrap().is_empty());
}
#[test]
fn note_proposals_do_not_write_without_review() {
    let temp = tempfile::tempdir().unwrap();
    let vault = Vault::open(temp.path()).unwrap();
    let note = vault.save(draft("A", "original", &[])).unwrap();
    dispatch(
        &vault,
        "knowledge.propose",
        serde_json::json!({"noteId":note.id,"baseRevision":note.revision,"body":"proposed"}),
    )
    .unwrap();
    assert_eq!(vault.get(&note.id).unwrap().body, "original");
}
#[test]
fn replaying_a_sync_is_idempotent() {
    let temp = tempfile::tempdir().unwrap();
    let a = Vault::open(temp.path().join("a")).unwrap();
    let b = peer(&a, &temp.path().join("b"));
    let remote = FolderTransport(temp.path().join("remote"));
    a.save(draft("A", "body", &[])).unwrap();
    a.sync(&remote).unwrap();
    b.sync(&remote).unwrap();
    let first = b.revisions().unwrap().len();
    for _ in 0..3 {
        let report = b.sync(&remote).unwrap();
        assert_eq!(report.downloaded, 0);
        assert_eq!(report.uploaded, 0);
    }
    assert_eq!(b.revisions().unwrap().len(), first);
}
#[test]
fn a_new_device_remembers_deletions_before_it_has_seen_the_note() {
    let temp = tempfile::tempdir().unwrap();
    let a = Vault::open(temp.path().join("a")).unwrap();
    let b = peer(&a, &temp.path().join("b"));
    let remote = FolderTransport(temp.path().join("remote"));
    let note = a.save(draft("Gone", "body", &[])).unwrap();
    a.delete(&note.id, &note.revision).unwrap();
    a.sync(&remote).unwrap();
    b.sync(&remote).unwrap();
    assert!(b.get(&note.id).is_err());
    drop(b);
    let b = Vault::open(temp.path().join("b")).unwrap();
    assert!(b.get(&note.id).is_err());
    assert_eq!(b.history(&note.id).unwrap().len(), 2);
}
#[test]
fn rebuilding_the_index_preserves_remote_history_and_external_markdown() {
    let temp = tempfile::tempdir().unwrap();
    let a = Vault::open(temp.path().join("a")).unwrap();
    let b = peer(&a, &temp.path().join("b"));
    let remote = FolderTransport(temp.path().join("remote"));
    let note = a.save(draft("History", "first", &[])).unwrap();
    a.save(edit(&note, "second")).unwrap();
    a.sync(&remote).unwrap();
    b.sync(&remote).unwrap();
    let mut changed = b.get(&note.id).unwrap();
    changed.body = "external after index loss".into();
    fs::write(
        b.path(&note.id).unwrap(),
        markdown::encode(&changed).unwrap(),
    )
    .unwrap();
    let root = b.root.clone();
    drop(b);
    fs::remove_file(root.join(".obryth/index.sqlite")).unwrap();
    let rebuilt = Vault::open(root).unwrap();
    assert_eq!(
        rebuilt.get(&note.id).unwrap().body,
        "external after index loss"
    );
    assert_eq!(rebuilt.history(&note.id).unwrap().len(), 3);
}
#[test]
fn resolved_conflicts_have_both_parents_and_converge() {
    let temp = tempfile::tempdir().unwrap();
    let a = Vault::open(temp.path().join("a")).unwrap();
    let b = peer(&a, &temp.path().join("b"));
    let remote = FolderTransport(temp.path().join("remote"));
    let note = a.save(draft("Conflict", "base", &[])).unwrap();
    a.sync(&remote).unwrap();
    b.sync(&remote).unwrap();
    a.save(edit(&note, "ours")).unwrap();
    b.save(edit(&b.get(&note.id).unwrap(), "theirs")).unwrap();
    a.sync(&remote).unwrap();
    let report = b.sync(&remote).unwrap();
    b.resolve_conflict(
        &report.conflicts[0],
        edit(&b.get(&note.id).unwrap(), "both"),
    )
    .unwrap();
    b.sync(&remote).unwrap();
    assert!(a.sync(&remote).unwrap().conflicts.is_empty());
    assert_eq!(a.get(&note.id).unwrap().body, "both");
}
#[cfg(unix)]
#[test]
fn symlinked_parent_cannot_escape_the_vault() {
    use std::os::unix::fs::symlink;
    let temp = tempfile::tempdir().unwrap();
    let outside = temp.path().join("outside");
    fs::create_dir(&outside).unwrap();
    let vault = Vault::open(temp.path().join("vault")).unwrap();
    symlink(&outside, vault.root.join("notes")).unwrap();
    assert!(vault.save(draft("Escape", "secret", &[])).is_err());
    assert_eq!(fs::read_dir(outside).unwrap().count(), 0);
}
#[test]
fn attachments_are_deduplicated_encrypted_and_downloaded_before_notes() {
    let temp = tempfile::tempdir().unwrap();
    let a = Vault::open(temp.path().join("a")).unwrap();
    let b = peer(&a, &temp.path().join("b"));
    let file = temp.path().join("output.txt");
    fs::write(&file, "attachment-private-output").unwrap();
    let first = a.import_attachment(&file).unwrap();
    let second = a.import_attachment(&file).unwrap();
    assert_eq!(first.path, second.path);
    let note = a
        .save(draft("Log", &format!("[output](../{})", first.path), &[]))
        .unwrap();
    let remote = FolderTransport(temp.path().join("remote"));
    a.sync(&remote).unwrap();
    let names = remote.list().unwrap();
    assert_eq!(names.iter().filter(|s| s.starts_with("blob-")).count(), 1);
    for name in names {
        assert!(!String::from_utf8_lossy(&remote.get(&name).unwrap())
            .contains("attachment-private-output"));
    }
    b.sync(&remote).unwrap();
    assert_eq!(b.get(&note.id).unwrap().body, note.body);
    assert_eq!(
        fs::read_to_string(b.root.join(first.path)).unwrap(),
        "attachment-private-output"
    );
}
#[test]
fn missing_attachment_does_not_publish_a_note() {
    let temp = tempfile::tempdir().unwrap();
    let a = Vault::open(temp.path()).unwrap();
    assert!(a
        .save(draft("Broken", "[file](../attachments/missing.txt)", &[]))
        .is_err());
    assert!(a.list(&NoteQuery::default()).unwrap().is_empty());
}
