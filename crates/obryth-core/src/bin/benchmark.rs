use anyhow::{bail, Context, Result};
use obryth_core::{KnowledgeScope, NoteDraft, NoteQuery, Vault};
use serde_json::json;
use std::{path::PathBuf, time::Instant};
fn elapsed(start: Instant) -> f64 {
    start.elapsed().as_secs_f64() * 1000.
}
fn percentile(values: &mut [f64], fraction: f64) -> f64 {
    values.sort_by(f64::total_cmp);
    values[((values.len() - 1) as f64 * fraction).round() as usize]
}
fn main() -> Result<()> {
    let mut args = std::env::args().skip(1);
    let root = PathBuf::from(
        args.next()
            .context("usage: benchmark NEW_DIRECTORY [NOTES=10000] [MESSAGES=200000]")?,
    );
    let count = args
        .next()
        .map(|s| s.parse())
        .transpose()?
        .unwrap_or(10000usize);
    let messages = args
        .next()
        .map(|s| s.parse())
        .transpose()?
        .unwrap_or(200000usize);
    if root.exists() {
        bail!("benchmark requires a new directory");
    }
    let start = Instant::now();
    let vault = Vault::open(&root)?;
    // Bulk-seed a reproducible read fixture. Durable edits are tested separately below.
    std::fs::create_dir_all(root.join("notes"))?;
    let tx = vault.db.unchecked_transaction()?;
    for index in 0..count {
        let timestamp = obryth_core::vault::now();
        let mut note=obryth_core::Note{id:uuid::Uuid::new_v4().to_string(),title:format!("Dataset note {index:05}"),body:format!("# Dataset {index}\n\nWebDAV knowledge benchmark 开发记录。\n\n[[Dataset note {:05}]]\n",index.saturating_sub(1)),tags:vec![if index%10==0{"private".into()}else{"dev".into()}],kind:"document".into(),pinned:false,created_at:timestamp.clone(),updated_at:timestamp,revision:String::new(),source:None,extra:Default::default()};
        note.revision = obryth_core::vault::hash(&serde_json::to_vec(&note)?);
        let relative = format!("notes/{}.md", note.id);
        let bytes = obryth_core::markdown::encode(&note)?;
        std::fs::write(root.join(&relative), &bytes)?;
        let digest = obryth_core::vault::hash(bytes.as_bytes());
        let meta = std::fs::metadata(root.join(&relative))?;
        tx.execute(
            "INSERT INTO notes VALUES(?1,?2,?3,?4,?5,0,?6,?7,?8,0,?9)",
            rusqlite::params![
                note.id,
                relative,
                note.title,
                note.body,
                serde_json::to_string(&note.tags)?,
                note.updated_at,
                note.revision,
                serde_json::to_string(&note)?,
                digest
            ],
        )?;
        tx.execute(
            "INSERT INTO notes_fts VALUES(?1,?2,?3)",
            rusqlite::params![note.id, note.title, note.body],
        )?;
        tx.execute(
            "INSERT INTO file_state VALUES(?1,?2,?3,?4)",
            rusqlite::params![
                relative,
                meta.len(),
                format!("{:?}", meta.modified()?),
                digest
            ],
        )?;
    }
    tx.commit()?;
    let long = "Rust 知识检索与同步设计。\n"
        .repeat(4000)
        .chars()
        .take(50000)
        .collect::<String>();
    vault.save(NoteDraft {
        title: "50,000 character document".into(),
        body: long,
        ..Default::default()
    })?;
    let chat = vault.create_chat("200k history fixture", "fixture", "fixture")?;
    let tx = vault.db.unchecked_transaction()?;
    {
        let mut insert=tx.prepare("INSERT INTO history.chat_messages(chat_id,role,content,citations,created_at)VALUES(?1,?2,?3,'[]',?4)")?;
        let now = obryth_core::vault::now();
        for index in 0..messages {
            insert.execute(rusqlite::params![
                chat["id"].as_str(),
                if index % 2 == 0 { "user" } else { "assistant" },
                format!("History message {index}"),
                now
            ])?;
        }
    }
    tx.commit()?;
    let creation_ms = elapsed(start);
    drop(vault);
    let start = Instant::now();
    let vault = Vault::open(&root)?;
    let reopen_ms = elapsed(start);
    let mut searches = vec![];
    let mut history = vec![];
    for _ in 0..100 {
        let start = Instant::now();
        let hits = vault.list(&NoteQuery {
            text: "WebDAV".into(),
            scope: KnowledgeScope {
                include_tags: vec!["dev".into()],
                exclude_tags: vec!["private".into()],
            },
            limit: 50,
            ..Default::default()
        })?;
        assert_eq!(hits.len(), count.min(50));
        searches.push(elapsed(start));
        let start = Instant::now();
        assert_eq!(
            vault
                .chat_messages(chat["id"].as_str().unwrap(), None, 50)?
                .len(),
            messages.min(50)
        );
        history.push(elapsed(start));
    }
    let report = json!({"notes":count+1,"historyMessages":messages,"longDocumentCharacters":50000,"fixtureSeedMs":creation_ms,"reopenMs":reopen_ms,"searchP50Ms":percentile(&mut searches,0.5),"searchP95Ms":percentile(&mut searches,0.95),"historyP50Ms":percentile(&mut history,0.5),"historyP95Ms":percentile(&mut history,0.95),"scope":"Rust backend on this Mac; bulk read fixture, OS file cache warm, network and GUI excluded"});
    std::fs::write(
        root.join("benchmark.json"),
        serde_json::to_vec_pretty(&report)?,
    )?;
    println!("{}", serde_json::to_string_pretty(&report)?);
    Ok(())
}
