use obryth_core::{sync::FolderTransport, *};
use rusqlite::params;
use serde_json::json;

fn range(from: &str, to: &str, zone: &str) -> ActivityQuery {
    ActivityQuery {
        from: from.into(),
        to: to.into(),
        time_zone: zone.into(),
        kind: None,
    }
}
fn page(range: ActivityQuery) -> ActivityPageQuery {
    ActivityPageQuery {
        range,
        cursor: None,
        limit: 20,
        note_id: None,
    }
}
fn save(vault: &Vault, previous: Option<&Note>, body: &str) -> Note {
    vault
        .save(NoteDraft {
            id: previous.map(|n| n.id.clone()),
            base_revision: previous.map(|n| n.revision.clone()),
            title: "测试笔记".into(),
            body: body.into(),
            kind: "memo".into(),
            ..Default::default()
        })
        .unwrap()
}
fn timestamp(vault: &Vault, revision: &str, time: &str) {
    vault.db.execute("UPDATE revisions SET timestamp=?1,payload=json_set(payload,'$.timestamp',?1) WHERE id=?2", params![time, revision]).unwrap();
}

#[test]
fn counts_versions_groups_days_and_keeps_deleted_history() {
    let temp = tempfile::tempdir().unwrap();
    let vault = Vault::open(temp.path()).unwrap();
    let a = save(&vault, None, "第一版");
    let b = save(&vault, Some(&a), "第二版");
    let c = save(&vault, Some(&b), "跨日第三版");
    timestamp(&vault, &a.revision, "2026-01-01T15:59:00Z");
    timestamp(&vault, &b.revision, "2026-01-01T15:59:30Z");
    timestamp(&vault, &c.revision, "2026-01-01T16:00:00Z");
    let query = range("2026-01-01", "2026-01-03", "Asia/Shanghai");
    let summary = vault.activity(&query).unwrap();
    assert_eq!(summary.total_saves, 3);
    assert_eq!(summary.active_days, 2);
    assert_eq!(summary.days[0].saves, 2);
    assert_eq!(summary.days[0].notes, 1);
    let feed = vault.activity_feed(&page(query.clone())).unwrap();
    assert_eq!(feed.items.len(), 2);
    assert_eq!(feed.items[1].note.body, "第二版");
    assert_eq!(feed.items[1].save_count, 2);
    vault.delete(&c.id, &c.revision).unwrap();
    assert_eq!(vault.activity(&query).unwrap().total_saves, 3);
    assert!(vault
        .activity_feed(&page(query.clone()))
        .unwrap()
        .items
        .iter()
        .all(|item| item.deleted));
    let mut versions_query = page(range("2026-01-01", "2026-01-02", "Asia/Shanghai"));
    versions_query.note_id = Some(c.id);
    versions_query.limit = 1;
    let first = vault.activity_versions(&versions_query).unwrap();
    assert_eq!(first.items[0].note.body, "第二版");
    versions_query.cursor = first.next_cursor;
    let next = vault.activity_versions(&versions_query).unwrap();
    assert_eq!(next.items[0].note.body, "第一版");
    assert!(next.next_cursor.is_none());
    let mut filtered = query;
    filtered.kind = Some("document".into());
    assert_eq!(vault.activity(&filtered).unwrap().total_saves, 0);
}

#[test]
fn timezone_year_boundary_and_dst_are_calendar_based() {
    let temp = tempfile::tempdir().unwrap();
    let vault = Vault::open(temp.path()).unwrap();
    for (i, time) in [
        "2025-12-31T16:00:00Z",
        "2026-03-08T04:59:00Z",
        "2026-03-08T05:00:00Z",
        "2026-03-09T03:59:00Z",
        "2026-03-09T04:00:00Z",
    ]
    .iter()
    .enumerate()
    {
        let note = save(&vault, None, &i.to_string());
        timestamp(&vault, &note.revision, time);
    }
    let year = vault
        .activity(&range("2026-01-01", "2027-01-01", "Asia/Shanghai"))
        .unwrap();
    assert_eq!(year.total_saves, 5);
    assert_eq!(year.years, vec![2026]);
    let day = vault
        .activity(&range("2026-03-08", "2026-03-09", "America/New_York"))
        .unwrap();
    assert_eq!(day.total_saves, 2);
    assert!(vault
        .activity(&range("2026-01-01", "2027-01-01", "invalid/zone"))
        .is_err());
    assert!(vault
        .activity(&range("2026-01-01", "2025-01-01", "UTC"))
        .is_err());
}

#[test]
fn pagination_is_not_limited_by_the_note_index_and_breaks_timestamp_ties() {
    let temp = tempfile::tempdir().unwrap();
    let vault = Vault::open(temp.path()).unwrap();
    let note = save(&vault, None, "原始笔记");
    timestamp(&vault, &note.revision, "2026-06-01T00:00:00Z");
    // Bulk fixture: 230 independent snapshots, all with the same timestamp.
    for i in 0..230 {
        let mut snapshot = note.clone();
        snapshot.id = format!("note-{i:03}");
        snapshot.revision = format!("revision-{i:03}");
        let value = json!({"id": snapshot.revision,"noteId":snapshot.id,"timestamp":"2026-06-01T00:00:00Z","note":snapshot});
        vault
            .db
            .execute(
                "INSERT OR IGNORE INTO revisions VALUES(?1,?2,?3,?4)",
                params![
                    value["id"].as_str(),
                    value["noteId"].as_str(),
                    value["timestamp"].as_str(),
                    value.to_string()
                ],
            )
            .unwrap();
        vault
            .db
            .execute(
                "INSERT OR IGNORE INTO revisions VALUES(?1,?2,?3,?4)",
                params![
                    value["id"].as_str(),
                    value["noteId"].as_str(),
                    value["timestamp"].as_str(),
                    value.to_string()
                ],
            )
            .unwrap();
    }
    let query = range("2026-01-01", "2027-01-01", "UTC");
    assert_eq!(vault.activity(&query).unwrap().total_saves, 231);
    let mut query = page(query);
    let mut ids = std::collections::HashSet::new();
    loop {
        let result = vault.activity_feed(&query).unwrap();
        assert!(result.items.len() <= 20);
        for item in result.items {
            assert!(ids.insert(item.note_id));
        }
        query.cursor = result.next_cursor;
        if query.cursor.is_none() {
            break;
        }
    }
    assert_eq!(ids.len(), 231);
    query.cursor = Some("invalid!".into());
    assert!(vault.activity_feed(&query).is_err());
}

#[test]
fn restore_and_repeated_sync_count_only_distinct_saved_versions() {
    let temp = tempfile::tempdir().unwrap();
    let a = Vault::open(temp.path().join("a")).unwrap();
    let peer = temp.path().join("b");
    std::fs::create_dir_all(peer.join(".obryth")).unwrap();
    std::fs::copy(
        a.root.join(".obryth/vault.json"),
        peer.join(".obryth/vault.json"),
    )
    .unwrap();
    std::fs::write(peer.join(".obryth/sync.key"), a.sync_key().unwrap()).unwrap();
    let b = Vault::open(peer).unwrap();
    let first = save(&a, None, "first");
    let last = save(&a, Some(&first), "last");
    dispatch(
        &a,
        "notes.restore",
        json!({"id":last.id,"revision":first.revision}),
    )
    .unwrap();
    let day = chrono::Utc::now().date_naive();
    let query = range(
        &day.to_string(),
        &(day + chrono::Duration::days(1)).to_string(),
        "UTC",
    );
    assert_eq!(a.activity(&query).unwrap().total_saves, 3);
    let remote = FolderTransport(temp.path().join("remote"));
    a.sync(&remote).unwrap();
    b.sync(&remote).unwrap();
    b.sync(&remote).unwrap();
    a.sync(&remote).unwrap();
    assert_eq!(b.activity(&query).unwrap().total_saves, 3);
    assert_eq!(a.activity(&query).unwrap().total_saves, 3);
}
