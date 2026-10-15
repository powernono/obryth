//! Activity is a read model of immutable revisions, never a second event log.
use crate::{types::*, Vault};
use anyhow::{bail, Context, Result};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use chrono::{DateTime, Datelike, Duration, NaiveDate, Utc};
use chrono_tz::Tz;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, HashMap};

struct Calendar {
    from: NaiveDate,
    to: NaiveDate,
    zone: Tz,
}
impl Calendar {
    fn new(query: &ActivityQuery) -> Result<Self> {
        let from = NaiveDate::parse_from_str(&query.from, "%Y-%m-%d")?;
        let to = NaiveDate::parse_from_str(&query.to, "%Y-%m-%d")?;
        if to <= from || (to - from).num_days() > 370 {
            bail!("activity range must contain 1–370 days");
        }
        Ok(Self {
            from,
            to,
            zone: query
                .time_zone
                .parse()
                .context("invalid activity time zone")?,
        })
    }
    fn contains(&self, day: NaiveDate) -> bool {
        day >= self.from && day < self.to
    }
}

#[derive(Clone)]
struct SavedRow {
    id: String,
    note_id: String,
    instant: DateTime<Utc>,
    day: NaiveDate,
    count: usize,
}
impl SavedRow {
    fn key(&self) -> (DateTime<Utc>, &str) {
        (self.instant, &self.id)
    }
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Cursor {
    range: ActivityQuery,
    note_id: Option<String>,
    timestamp: String,
    id: String,
}

fn page(
    mut rows: Vec<SavedRow>,
    query: &ActivityPageQuery,
) -> Result<(Vec<SavedRow>, Option<String>)> {
    rows.sort_by(|a, b| b.key().cmp(&a.key()));
    if let Some(cursor) = &query.cursor {
        let cursor: Cursor = serde_json::from_slice(
            &URL_SAFE_NO_PAD
                .decode(cursor)
                .context("invalid activity cursor")?,
        )?;
        if serde_json::to_value(&cursor.range)? != serde_json::to_value(&query.range)?
            || cursor.note_id != query.note_id
        {
            bail!("activity cursor belongs to a different query");
        }
        let instant = DateTime::parse_from_rfc3339(&cursor.timestamp)?.with_timezone(&Utc);
        rows.retain(|row| row.key() < (instant, cursor.id.as_str()));
    }
    let limit = query.limit.clamp(1, 100);
    let has_more = rows.len() > limit;
    rows.truncate(limit);
    let next = if has_more {
        let last = rows.last().context("missing activity page")?;
        Some(URL_SAFE_NO_PAD.encode(serde_json::to_vec(&Cursor {
            range: query.range.clone(),
            note_id: query.note_id.clone(),
            timestamp: last.instant.to_rfc3339(),
            id: last.id.clone(),
        })?))
    } else {
        None
    };
    Ok((rows, next))
}

impl Vault {
    fn activity_rows(
        &self,
        query: &ActivityQuery,
        all_years: bool,
        note_id: Option<&str>,
    ) -> Result<Vec<SavedRow>> {
        let calendar = Calendar::new(query)?;
        // The padded UTC bounds allow all offsets and fractional timestamp formats.
        // Exact filtering and day boundaries use the requested IANA zone below.
        let lower = if all_years {
            String::new()
        } else {
            (calendar.from - Duration::days(2)).to_string()
        };
        let upper = if all_years {
            "9999-12-31".into()
        } else {
            (calendar.to + Duration::days(2)).to_string()
        };
        let mut statement = self.db.prepare(
            "SELECT id,note_id,timestamp FROM revisions
             WHERE timestamp>=?1 AND timestamp<?2 AND json_type(payload,'$.note')='object'
             AND (?3 IS NULL OR coalesce(json_extract(payload,'$.note.kind'),'document')=?3)
             AND (?4 IS NULL OR note_id=?4)",
        )?;
        let records = statement.query_map(params![lower, upper, query.kind, note_id], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
            ))
        })?;
        let mut rows = Vec::new();
        for record in records {
            let (id, note_id, timestamp) = record?;
            let instant = DateTime::parse_from_rfc3339(&timestamp)?.with_timezone(&Utc);
            let day = instant.with_timezone(&calendar.zone).date_naive();
            if all_years || calendar.contains(day) {
                rows.push(SavedRow {
                    id,
                    note_id,
                    instant,
                    day,
                    count: 1,
                });
            }
        }
        Ok(rows)
    }

    pub fn activity(&self, query: &ActivityQuery) -> Result<ActivitySummary> {
        let calendar = Calendar::new(query)?;
        let mut years = BTreeSet::new();
        let mut days: BTreeMap<NaiveDate, (usize, BTreeSet<String>)> = BTreeMap::new();
        // Only identifiers and timestamps cross SQLite here; no historical bodies.
        for row in self.activity_rows(query, true, None)? {
            years.insert(row.day.year());
            if calendar.contains(row.day) {
                let bucket = days.entry(row.day).or_default();
                bucket.0 += 1;
                bucket.1.insert(row.note_id);
            }
        }
        let days: Vec<_> = days
            .into_iter()
            .map(|(day, (saves, notes))| ActivityDay {
                date: day.to_string(),
                saves,
                notes: notes.len(),
            })
            .collect();
        Ok(ActivitySummary {
            total_saves: days.iter().map(|day| day.saves).sum(),
            active_days: days.len(),
            days,
            years: years.into_iter().rev().collect(),
            history_incomplete: false,
        })
    }

    /// Fetch only the snapshots displayed on this page, in a single query.
    fn activity_snapshots(&self, rows: &[SavedRow]) -> Result<HashMap<String, (Note, bool)>> {
        let ids = serde_json::to_string(&rows.iter().map(|r| &r.id).collect::<Vec<_>>())?;
        let mut statement = self.db.prepare(
            "SELECT r.id,json_extract(r.payload,'$.note'),coalesce(n.deleted,1)
             FROM revisions r LEFT JOIN notes n ON n.id=r.note_id
             WHERE r.id IN (SELECT value FROM json_each(?1))",
        )?;
        let records = statement.query_map([ids], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, bool>(2)?,
            ))
        })?;
        let mut snapshots = HashMap::new();
        for record in records {
            let (id, note, deleted) = record?;
            snapshots.insert(id, (serde_json::from_str(&note)?, deleted));
        }
        Ok(snapshots)
    }

    pub fn activity_feed(&self, query: &ActivityPageQuery) -> Result<ActivityFeed> {
        let mut groups: BTreeMap<(NaiveDate, String), SavedRow> = BTreeMap::new();
        for row in self.activity_rows(&query.range, false, None)? {
            let group = groups
                .entry((row.day, row.note_id.clone()))
                .or_insert_with(|| SavedRow {
                    count: 0,
                    ..row.clone()
                });
            let count = group.count + 1;
            if row.key() > group.key() {
                *group = row;
            }
            group.count = count;
        }
        let (rows, next_cursor) = page(groups.into_values().collect(), query)?;
        let mut snapshots = self.activity_snapshots(&rows)?;
        let items = rows
            .into_iter()
            .map(|row| {
                let (note, deleted) = snapshots
                    .remove(&row.id)
                    .context("activity snapshot missing")?;
                Ok(ActivityCard {
                    day: row.day.to_string(),
                    note_id: row.note_id,
                    note,
                    save_count: row.count,
                    last_saved_at: row.instant.to_rfc3339(),
                    revision_id: row.id,
                    deleted,
                })
            })
            .collect::<Result<_>>()?;
        Ok(ActivityFeed { items, next_cursor })
    }

    pub fn activity_versions(&self, query: &ActivityPageQuery) -> Result<ActivityVersions> {
        let note_id = query
            .note_id
            .as_deref()
            .context("missing activity noteId")?;
        let (rows, next_cursor) = page(
            self.activity_rows(&query.range, false, Some(note_id))?,
            query,
        )?;
        let mut snapshots = self.activity_snapshots(&rows)?;
        let items = rows
            .into_iter()
            .map(|row| {
                let (note, _) = snapshots
                    .remove(&row.id)
                    .context("activity snapshot missing")?;
                Ok(ActivityVersion {
                    id: row.id,
                    timestamp: row.instant.to_rfc3339(),
                    note,
                })
            })
            .collect::<Result<_>>()?;
        Ok(ActivityVersions { items, next_cursor })
    }
}
