use crate::types::Note;
use anyhow::{bail, Context, Result};
use serde_json::Value;
use std::collections::BTreeMap;

pub fn encode(note: &Note) -> Result<String> {
    let mut metadata = note.extra.clone();
    let value = serde_json::to_value(note)?;
    for (key, value) in value.as_object().context("note metadata")? {
        if key != "body" && key != "extra" {
            metadata.insert(key.clone(), value.clone());
        }
    }
    Ok(format!(
        "---\n{}---\n{}",
        serde_yaml::to_string(&metadata)?,
        note.body
    ))
}

pub fn decode(text: &str) -> Result<Note> {
    let normalized = text.strip_prefix('\u{feff}').unwrap_or(text);
    let (first, rest) = normalized
        .split_once('\n')
        .context("missing YAML frontmatter")?;
    if first.trim_end_matches('\r') != "---" {
        bail!("missing YAML frontmatter");
    }
    let mut end = None;
    let mut offset = 0;
    for line in rest.split_inclusive('\n') {
        if line.trim_end_matches(['\r', '\n']) == "---" {
            end = Some((offset, offset + line.len()));
            break;
        }
        offset += line.len();
    }
    let (meta_end, body_start) = end.context("unclosed YAML frontmatter")?;
    let mut meta: BTreeMap<String, Value> = serde_yaml::from_str(&rest[..meta_end])?;
    let known = [
        "id",
        "title",
        "tags",
        "kind",
        "pinned",
        "createdAt",
        "updatedAt",
        "revision",
        "source",
    ];
    let extra = meta
        .iter()
        .filter(|(key, _)| !known.contains(&key.as_str()))
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect::<BTreeMap<_, _>>();
    meta.insert("body".into(), Value::String(rest[body_start..].into()));
    meta.insert("extra".into(), serde_json::to_value(extra)?);
    Ok(serde_json::from_value(serde_json::to_value(meta)?)?)
}

pub fn excerpt(body: &str, query: &str) -> (String, usize) {
    let lines: Vec<&str> = body.lines().collect();
    let index = lines
        .iter()
        .position(|line| line.to_lowercase().contains(&query.to_lowercase()))
        .unwrap_or(0);
    (
        lines.get(index).unwrap_or(&"").chars().take(240).collect(),
        index + 1,
    )
}
