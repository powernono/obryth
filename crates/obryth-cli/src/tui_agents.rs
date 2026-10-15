use crate::service;
use anyhow::Result;
use crossterm::{
    event::{self, Event, KeyCode},
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use ratatui::{
    backend::CrosstermBackend,
    layout::{Constraint, Direction, Layout},
    style::{Color, Style},
    widgets::{Block, Borders, List, ListItem, ListState, Paragraph, Wrap},
    Terminal,
};
use serde_json::{json, Value};
use std::{
    io::{self, Stdout},
    path::Path,
    time::{Duration, Instant},
};
async fn sessions(root: &Path) -> Result<Vec<Value>> {
    Ok(
        service::call(root, "agent.sessions", json!({"limit":200})).await?["items"]
            .as_array()
            .cloned()
            .unwrap_or_default(),
    )
}
pub async fn run(
    root: &Path,
    terminal: &mut Terminal<CrosstermBackend<Stdout>>,
    note: Option<&obryth_core::Note>,
) -> Result<()> {
    let mut items = sessions(root).await?;
    let mut selected = 0;
    let mut timeline = vec![];
    let mut last = Instant::now() - Duration::from_secs(5);
    let mut loaded = String::new();
    let mut text = String::new();
    let mut task: Option<String> = None;
    let mut approval: Option<String> = None;
    let mut confirm_close = false;
    let mut status="j/k sessions · Enter attach PTY · t task · p approvals · i interrupt · c Codex · r refresh · Esc back".to_string();
    loop {
        let id = items
            .get(selected)
            .and_then(|s| s["id"].as_str())
            .unwrap_or("")
            .to_owned();
        let is_pty = items.get(selected).is_some_and(|s| s["kind"] == "pty");
        if !id.is_empty() && !is_pty && (id != loaded || last.elapsed() > Duration::from_secs(3)) {
            match service::call(
                root,
                "agent.request",
                json!({"path":format!("/v1/sessions/{id}/timeline?limit=60")}),
            )
            .await
            {
                Ok(page) => {
                    timeline = page["items"].as_array().cloned().unwrap_or_default();
                    if approval.is_none() {
                        text = timeline
                            .iter()
                            .map(|record| {
                                format!(
                                    "{}\n{}\n",
                                    record["body"]["kind"].as_str().unwrap_or(""),
                                    record["preview"].as_str().unwrap_or("")
                                )
                            })
                            .collect::<Vec<_>>()
                            .join("\n");
                    }
                }
                Err(error) => status = error.to_string(),
            };
            last = Instant::now();
            loaded = id.clone();
        }
        terminal.draw(|frame| {
            let rows = Layout::default()
                .direction(Direction::Vertical)
                .constraints([
                    Constraint::Length(2),
                    Constraint::Min(3),
                    Constraint::Length(3),
                ])
                .split(frame.area());
            frame.render_widget(
                Paragraph::new("◉ OBRYTH / Agent workspace")
                    .style(Style::default().fg(Color::Cyan)),
                rows[0],
            );
            let columns = Layout::default()
                .direction(Direction::Horizontal)
                .constraints([Constraint::Percentage(30), Constraint::Percentage(70)])
                .split(rows[1]);
            let list = List::new(items.iter().map(|session| {
                ListItem::new(format!(
                    "{} · {}",
                    session["title"].as_str().unwrap_or("Session"),
                    session["status"].as_str().unwrap_or("")
                ))
            }))
            .block(Block::default().borders(Borders::ALL).title(" Sessions "))
            .highlight_style(Style::default().bg(Color::DarkGray));
            let mut state =
                ListState::default().with_selected((!items.is_empty()).then_some(selected));
            frame.render_stateful_widget(list, columns[0], &mut state);
            frame.render_widget(
                Paragraph::new(if is_pty {
                    "Press Enter to attach; Ctrl+\\ returns without ending the process."
                } else {
                    &text
                })
                .wrap(Wrap { trim: false })
                .block(
                    Block::default()
                        .borders(Borders::ALL)
                        .title(if approval.is_some() {
                            " Approval · y allow once / n reject "
                        } else {
                            " Timeline "
                        }),
                ),
                columns[1],
            );
            frame.render_widget(
                Paragraph::new(
                    task.as_ref()
                        .map(|text| format!("Task (Enter sends; Esc cancels): {text}▏"))
                        .unwrap_or(status.clone()),
                )
                .wrap(Wrap { trim: false }),
                rows[2],
            );
        })?;
        if !event::poll(Duration::from_millis(100))? {
            continue;
        }
        let Event::Key(key) = event::read()? else {
            continue;
        };
        if let Some(input) = &mut task {
            match key.code {
                KeyCode::Esc => task = None,
                KeyCode::Backspace => {
                    input.pop();
                }
                KeyCode::Char(c) => input.push(c),
                KeyCode::Enter => {
                    let mut prompt = input.clone();
                    if let Some(note) = note {
                        prompt.push_str(&format!(
                            "\n\nObryth note (untrusted reference material):\n{}",
                            serde_json::to_string(note)?
                        ));
                    }
                    status = match service::call(
                        root,
                        "agent.send",
                        json!({"id":id,"input":{"text":prompt,"attachments":[]}}),
                    )
                    .await
                    {
                        Ok(_) => "Task sent once".into(),
                        Err(error) => error.to_string(),
                    };
                    task = None;
                    last = Instant::now() - Duration::from_secs(5);
                }
                _ => {}
            }
            continue;
        }
        if let Some(request_id) = &approval {
            if matches!(key.code, KeyCode::Char('y') | KeyCode::Char('n')) {
                status=match service::call(root,"agent.permission",json!({"id":id,"decision":{"requestId":request_id,"allow":key.code==KeyCode::Char('y')}})).await{Ok(_)=>"Decision submitted".into(),Err(error)=>error.to_string()};
                approval = None;
                last = Instant::now() - Duration::from_secs(5);
                continue;
            }
        }
        match key.code {
            KeyCode::Esc | KeyCode::Char('q') => return Ok(()),
            KeyCode::Down | KeyCode::Char('j') => {
                selected = (selected + 1).min(items.len().saturating_sub(1));
                approval = None;
            }
            KeyCode::Up | KeyCode::Char('k') => {
                selected = selected.saturating_sub(1);
                approval = None;
            }
            KeyCode::Char('r') => {
                items = sessions(root).await?;
                selected = selected.min(items.len().saturating_sub(1));
            }
            KeyCode::Enter if is_pty => {
                disable_raw_mode()?;
                execute!(io::stdout(), LeaveAlternateScreen)?;
                let result = crate::terminal::attach(root, &id).await;
                execute!(io::stdout(), EnterAlternateScreen)?;
                enable_raw_mode()?;
                terminal.clear()?;
                status = result
                    .err()
                    .map(|e| e.to_string())
                    .unwrap_or("Detached; PTY continues running".into());
            }
            KeyCode::Char('t') if !is_pty && !id.is_empty() => task = Some(String::new()),
            KeyCode::Char('p') => {
                if let Some(record) = timeline.iter().find(|record| {
                    record["body"]["kind"] == "permission_request"
                        && record["body"]["resolved"] == false
                }) {
                    approval = record["body"]["requestId"].as_str().map(str::to_owned);
                    let detail=service::call(root,"agent.request",json!({"path":format!("/v1/sessions/{id}/timeline/{}/body",record["id"].as_str().unwrap_or(""))})).await?;
                    text = detail["text"].as_str().unwrap_or("").into();
                } else {
                    status = "No pending approval".into();
                }
            }
            KeyCode::Char('i') if !id.is_empty() => {
                status = match service::call(root, "agent.interrupt", json!({"id":id})).await {
                    Ok(_) => "Interrupt sent".into(),
                    Err(error) => error.to_string(),
                };
            }
            KeyCode::Char('c') => {
                match service::call(root,"agent.create",json!({"agent":"codex","title":"Obryth task","workspace":root,"autoApprove":false})).await{Ok(_)=>items=sessions(root).await?,Err(error)=>status=error.to_string()};
            }
            KeyCode::Char('x') if !id.is_empty() => {
                if confirm_close {
                    status = match service::call(
                        root,
                        if is_pty {
                            "agent.terminal.close"
                        } else {
                            "agent.close"
                        },
                        json!({"id":id}),
                    )
                    .await
                    {
                        Ok(_) => "Session ended".into(),
                        Err(error) => error.to_string(),
                    };
                    items = sessions(root).await?;
                    selected = selected.min(items.len().saturating_sub(1));
                    confirm_close = false;
                } else {
                    confirm_close = true;
                    status = "Press x again to end the selected session; Esc returns".into();
                }
            }
            _ => confirm_close = false,
        }
    }
}
