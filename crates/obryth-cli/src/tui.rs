use crate::service;
use anyhow::Result;
use crossterm::{
    event::{self, Event, KeyCode, KeyModifiers},
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use obryth_core::{Note, NoteDraft, SearchHit};
use ratatui::{
    backend::CrosstermBackend,
    layout::{Constraint, Direction, Layout},
    style::{Color, Modifier, Style},
    text::Line,
    widgets::{Block, Borders, List, ListItem, ListState, Paragraph, Wrap},
    Terminal,
};
use serde_json::json;
use std::{io, path::Path, time::Duration};

struct Restore;
impl Drop for Restore {
    fn drop(&mut self) {
        let _ = disable_raw_mode();
        let _ = execute!(io::stdout(), LeaveAlternateScreen);
    }
}
pub async fn run(root: &Path) -> Result<()> {
    service::ensure(root).await?;
    enable_raw_mode()?;
    execute!(io::stdout(), EnterAlternateScreen)?;
    let _restore = Restore;
    let mut terminal = Terminal::new(CrosstermBackend::new(io::stdout()))?;
    let mut notes: Vec<SearchHit> =
        serde_json::from_value(service::call(root, "notes.list", json!({"limit":200})).await?)?;
    let mut selected = 0usize;
    let mut editing: Option<Note> = None;
    let mut search: Option<String> = None;
    let mut cursor = 0;
    let mut scroll = 0u16;
    let mut preview_only = false;
    let mut status =
        "j/k navigate · / search · n new · e edit · v external editor · a agents · q quit"
            .to_string();
    loop {
        terminal.draw(|frame|{
            let rows=Layout::default().direction(Direction::Vertical).constraints([Constraint::Length(2),Constraint::Min(3),Constraint::Length(2)]).split(frame.area());
            frame.render_widget(Paragraph::new(Line::from("◉ OBRYTH  /  terminal knowledge workspace")).style(Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD)),rows[0]);
            let columns=Layout::default().constraints(if frame.area().width<75{if editing.is_some()||preview_only{vec![Constraint::Length(0),Constraint::Percentage(100)]}else{vec![Constraint::Percentage(100),Constraint::Length(0)]}}else{vec![Constraint::Percentage(32),Constraint::Percentage(68)]}).direction(Direction::Horizontal).split(rows[1]);
            let list=List::new(notes.iter().map(|hit|ListItem::new(format!("{} {}",if hit.note.pinned{"★"}else{"·"},hit.note.title))).collect::<Vec<_>>()).block(Block::default().borders(Borders::ALL).title(format!(" Notes [{}] ",notes.len()))).highlight_style(Style::default().bg(Color::DarkGray).fg(Color::Cyan));
            let mut state=ListState::default().with_selected((!notes.is_empty()).then_some(selected));frame.render_stateful_widget(list,columns[0],&mut state);
            let note=editing.as_ref().or_else(||notes.get(selected).map(|hit|&hit.note));
            let body=note.map(|note|format!("# {}\n{}\n\n{}",note.title,note.tags.iter().map(|tag|format!("#{tag}")).collect::<Vec<_>>().join(" "),if editing.is_some(){format!("{}▏{}",&note.body[..cursor],&note.body[cursor..])}else{note.body.clone()})).unwrap_or_else(||"Press n to capture your first thought.\n\nYour notes are ordinary Markdown files.".into());
            frame.render_widget(Paragraph::new(body).block(Block::default().borders(Borders::ALL).title(if editing.is_some(){" EDIT · Ctrl+S save · Esc cancel "}else{" Markdown "})).wrap(Wrap{trim:false}).scroll((scroll,0)),columns[1]);
            let footer=search.as_ref().map(|s|format!("Search: {s}▏")).unwrap_or(status.clone());frame.render_widget(Paragraph::new(footer).style(Style::default().fg(Color::DarkGray)),rows[2]);
        })?;
        if !event::poll(Duration::from_millis(100))? {
            continue;
        }
        let Event::Key(key) = event::read()? else {
            continue;
        };
        if let Some(query) = &mut search {
            match key.code {
                KeyCode::Esc => search = None,
                KeyCode::Enter => {
                    let query = query.clone();
                    let params = if let Some(tag) = query.strip_prefix('#') {
                        json!({"scope":{"includeTags":[tag]},"limit":200})
                    } else {
                        json!({"text":query,"limit":200})
                    };
                    match service::call(root, "notes.list", params).await {
                        Ok(result) => {
                            notes = serde_json::from_value(result)?;
                            selected = 0;
                        }
                        Err(error) => status = error.to_string(),
                    };
                    search = None;
                }
                KeyCode::Backspace => {
                    query.pop();
                }
                KeyCode::Char(c) => query.push(c),
                _ => {}
            }
            continue;
        }
        if let Some(draft) = &mut editing {
            match key.code {
                KeyCode::Esc => {
                    editing = None;
                    status = "Draft kept; press e to recover".into();
                }
                KeyCode::Char('s') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                    let input = NoteDraft {
                        id: Some(draft.id.clone()),
                        title: draft.title.clone(),
                        body: draft.body.clone(),
                        tags: draft.tags.clone(),
                        kind: draft.kind.clone(),
                        pinned: draft.pinned,
                        base_revision: Some(draft.revision.clone()),
                        source: draft.source.clone(),
                    };
                    match service::call(root, "notes.save", serde_json::to_value(input)?).await {
                        Ok(_) => {
                            let _ = std::fs::remove_file(
                                root.join(format!(".obryth/drafts/{}.json", draft.id)),
                            );
                            editing = None;
                            notes = serde_json::from_value(
                                service::call(root, "notes.list", json!({"limit":200})).await?,
                            )?;
                            status = "Saved".into();
                        }
                        Err(error) => status = error.to_string(),
                    }
                }
                KeyCode::Left => {
                    cursor = draft.body[..cursor]
                        .char_indices()
                        .last()
                        .map(|(i, _)| i)
                        .unwrap_or(0);
                }
                KeyCode::Right => {
                    cursor = draft.body[cursor..]
                        .char_indices()
                        .nth(1)
                        .map(|(i, _)| cursor + i)
                        .unwrap_or(draft.body.len());
                }
                KeyCode::Home => {
                    cursor = draft.body[..cursor].rfind('\n').map(|i| i + 1).unwrap_or(0)
                }
                KeyCode::End => {
                    cursor = draft.body[cursor..]
                        .find('\n')
                        .map(|i| cursor + i)
                        .unwrap_or(draft.body.len())
                }
                KeyCode::Backspace if cursor > 0 => {
                    let before = draft.body[..cursor]
                        .char_indices()
                        .last()
                        .map(|(i, _)| i)
                        .unwrap_or(0);
                    draft.body.replace_range(before..cursor, "");
                    cursor = before;
                }
                KeyCode::Enter => {
                    draft.body.insert(cursor, '\n');
                    cursor += 1;
                }
                KeyCode::Char(c) if !key.modifiers.contains(KeyModifiers::CONTROL) => {
                    draft.body.insert(cursor, c);
                    cursor += c.len_utf8();
                }
                _ => {}
            }
            if let Some(note) = &editing {
                obryth_core::vault::private_write(
                    &root.join(format!(".obryth/drafts/{}.json", note.id)),
                    &serde_json::to_vec(note)?,
                )?;
            }
            continue;
        }
        match key.code {
            KeyCode::Char('q') => break,
            KeyCode::Esc if preview_only => preview_only = false,
            KeyCode::Esc => break,
            KeyCode::Enter => preview_only = !preview_only,
            KeyCode::PageDown => scroll = scroll.saturating_add(12),
            KeyCode::PageUp => scroll = scroll.saturating_sub(12),
            KeyCode::Char('j') | KeyCode::Down => {
                selected = (selected + 1).min(notes.len().saturating_sub(1))
            }
            KeyCode::Char('k') | KeyCode::Up => selected = selected.saturating_sub(1),
            KeyCode::Char('/') => search = Some(String::new()),
            KeyCode::Char('n') => {
                let note = service::call(
                    root,
                    "notes.save",
                    json!({"title":"Quick note","body":"","kind":"memo","tags":[]}),
                )
                .await?;
                notes = serde_json::from_value(
                    service::call(root, "notes.list", json!({"limit":200})).await?,
                )?;
                selected = notes
                    .iter()
                    .position(|hit| hit.note.id == note["id"].as_str().unwrap_or_default())
                    .unwrap_or(0);
                editing = Some(serde_json::from_value(note)?);
                cursor = 0;
            }
            KeyCode::Char('e') => {
                editing = notes.get(selected).map(|n| n.note.clone());
                if let Some(note) = &editing {
                    let path = root.join(format!(".obryth/drafts/{}.json", note.id));
                    if let Ok(bytes) = std::fs::read(path) {
                        editing = Some(serde_json::from_slice(&bytes)?);
                    }
                }
                cursor = editing.as_ref().map(|n| n.body.len()).unwrap_or(0);
            }
            KeyCode::Char('v') => {
                if let Some(note) = notes.get(selected) {
                    let editor = std::env::var("VISUAL")
                        .or_else(|_| std::env::var("EDITOR"))
                        .unwrap_or_else(|_| "vi".into());
                    let parts = shell_words::split(&editor)?;
                    if parts.is_empty() {
                        status = "EDITOR is empty".into();
                        continue;
                    }
                    let path =
                        service::call(root, "notes.path", json!({"id":note.note.id})).await?;
                    disable_raw_mode()?;
                    execute!(io::stdout(), LeaveAlternateScreen)?;
                    let result = std::process::Command::new(&parts[0])
                        .args(&parts[1..])
                        .arg(path.as_str().unwrap())
                        .status();
                    execute!(io::stdout(), EnterAlternateScreen)?;
                    enable_raw_mode()?;
                    terminal.clear()?;
                    status = match result {
                        Ok(status) => format!("Editor {status}"),
                        Err(error) => error.to_string(),
                    };
                    service::call(root, "notes.refresh", json!({})).await?;
                    notes = serde_json::from_value(
                        service::call(root, "notes.list", json!({"limit":200})).await?,
                    )?;
                }
            }
            KeyCode::Char('b') => {
                if let Some(note) = notes.get(selected) {
                    notes = serde_json::from_value(
                        service::call(root, "notes.backlinks", json!({"id":note.note.id})).await?,
                    )?;
                    selected = 0;
                    status = "Backlinks · r restores all notes".into();
                }
            }
            KeyCode::Char('a') => {
                status = match crate::tui_agents::run(
                    root,
                    &mut terminal,
                    notes.get(selected).map(|n| &n.note),
                )
                .await
                {
                    Ok(()) => "Returned to notes".into(),
                    Err(error) => error.to_string(),
                };
                terminal.clear()?;
            }
            KeyCode::Char('r') => {
                notes = serde_json::from_value(
                    service::call(root, "notes.list", json!({"limit":200})).await?,
                )?;
                selected = selected.min(notes.len().saturating_sub(1));
            }
            _ => {}
        }
    }
    Ok(())
}
