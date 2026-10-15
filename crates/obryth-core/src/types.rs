use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: String,
    pub title: String,
    pub body: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default = "document")]
    pub kind: String,
    #[serde(default)]
    pub pinned: bool,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default)]
    pub revision: String,
    #[serde(default)]
    pub source: Option<String>,
    #[serde(default)]
    #[ts(type = "Record<string, unknown>")]
    pub extra: BTreeMap<String, serde_json::Value>,
}
fn document() -> String {
    "document".into()
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct NoteDraft {
    pub id: Option<String>,
    pub title: String,
    pub body: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default = "document")]
    pub kind: String,
    #[serde(default)]
    pub pinned: bool,
    pub base_revision: Option<String>,
    pub source: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeScope {
    #[serde(default)]
    pub include_tags: Vec<String>,
    #[serde(default)]
    pub exclude_tags: Vec<String>,
}
impl KnowledgeScope {
    pub fn allows(&self, note: &Note) -> bool {
        !self.exclude_tags.iter().any(|tag| note.tags.contains(tag))
            && (self.include_tags.is_empty()
                || self.include_tags.iter().any(|tag| note.tags.contains(tag)))
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct NoteQuery {
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub scope: KnowledgeScope,
    #[serde(default)]
    pub offset: usize,
    #[serde(default = "page_size")]
    pub limit: usize,
}
fn page_size() -> usize {
    50
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub note: Note,
    pub excerpt: String,
    pub line: usize,
}

/// Local calendar dates: from is inclusive, to is exclusive.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ActivityQuery {
    pub from: String,
    pub to: String,
    pub time_zone: String,
    pub kind: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ActivityPageQuery {
    pub range: ActivityQuery,
    pub cursor: Option<String>,
    #[serde(default = "activity_page_size")]
    pub limit: usize,
    pub note_id: Option<String>,
}
fn activity_page_size() -> usize {
    20
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ActivityDay {
    pub date: String,
    pub saves: usize,
    pub notes: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ActivitySummary {
    pub days: Vec<ActivityDay>,
    pub total_saves: usize,
    pub active_days: usize,
    pub years: Vec<i32>,
    pub history_incomplete: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ActivityCard {
    pub day: String,
    pub note_id: String,
    pub note: Note,
    pub save_count: usize,
    pub last_saved_at: String,
    pub revision_id: String,
    pub deleted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ActivityFeed {
    pub items: Vec<ActivityCard>,
    pub next_cursor: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ActivityVersion {
    pub id: String,
    pub timestamp: String,
    pub note: Note,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ActivityVersions {
    pub items: Vec<ActivityVersion>,
    pub next_cursor: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Revision {
    pub id: String,
    pub note_id: String,
    pub parents: Vec<String>,
    pub device: String,
    pub sequence: u64,
    pub note: Option<Note>,
    pub timestamp: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub attachments: Vec<AttachmentRef>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentRef {
    pub path: String,
    pub digest: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ProviderProfile {
    pub id: String,
    pub name: String,
    pub protocol: String,
    pub endpoint: String,
    #[serde(default)]
    pub models: Vec<String>,
    pub secret_ref: String,
    #[serde(default = "chat")]
    pub purpose: String,
}
fn chat() -> String {
    "chat".into()
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct SyncReport {
    pub uploaded: usize,
    pub downloaded: usize,
    pub conflicts: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct PaneSpec {
    pub id: String,
    pub kind: String,
    pub resource_id: Option<String>,
}
