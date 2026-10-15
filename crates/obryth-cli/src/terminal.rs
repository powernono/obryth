use anyhow::{Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use crossterm::{
    event::{self, Event, KeyCode, KeyEventKind, KeyModifiers},
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use serde_json::json;
use std::{io::Write, path::Path, time::Duration};
struct Restore;
impl Drop for Restore {
    fn drop(&mut self) {
        let _ = disable_raw_mode();
        let _ = execute!(std::io::stdout(), LeaveAlternateScreen);
    }
}
/// Ctrl+\ detaches without ending the remote PTY. Input is never retried automatically.
pub async fn attach(root: &Path, id: &str) -> Result<()> {
    enable_raw_mode()?;
    execute!(std::io::stdout(), EnterAlternateScreen)?;
    let _restore = Restore;
    let mut seq = 0;
    let snapshot = crate::service::call(root, "agent.terminal.snapshot", json!({"id":id})).await?;
    if let Some(data) = snapshot["dataB64"].as_str() {
        std::io::stdout().write_all(&STANDARD.decode(data)?)?;
        seq = snapshot["seq"].as_i64().unwrap_or(0);
    }
    let output_root = root.to_path_buf();
    let output_id = id.to_owned();
    let mut output = tokio::spawn(async move {
        let mut seq = seq;
        loop {
            let page = crate::service::call(
                &output_root,
                "agent.terminal.output",
                json!({"id":output_id,"afterSeq":seq,"waitMs":1000}),
            )
            .await?;
            if page["resyncRequired"] == true {
                let snapshot = crate::service::call(
                    &output_root,
                    "agent.terminal.snapshot",
                    json!({"id":output_id}),
                )
                .await?;
                let data = snapshot["dataB64"]
                    .as_str()
                    .context("terminal snapshot unavailable")?;
                std::io::stdout().write_all(&STANDARD.decode(data)?)?;
                seq = snapshot["seq"].as_i64().unwrap_or(0);
                continue;
            }
            for event in page["events"].as_array().into_iter().flatten() {
                if event["type"] == "output" {
                    std::io::stdout().write_all(
                        &STANDARD.decode(
                            event["dataB64"]
                                .as_str()
                                .context("invalid terminal output")?,
                        )?,
                    )?;
                }
            }
            std::io::stdout().flush()?;
            seq = page["nextSeq"].as_i64().unwrap_or(seq);
            if page["exited"] == true {
                break;
            }
        }
        Ok::<(), anyhow::Error>(())
    });
    let mut tick = tokio::time::interval(Duration::from_millis(15));
    let mut previous = (0, 0);
    let result=async{loop{tokio::select!{result=&mut output=>return result?,_=tick.tick()=>{
  let(cols,rows)=crossterm::terminal::size()?;if(cols,rows)!=previous{previous=(cols,rows);crate::service::call(root,"agent.terminal.resize",json!({"id":id,"size":{"cols":cols.clamp(20,500),"rows":rows.clamp(5,300)}})).await?;}
  if !event::poll(Duration::ZERO)?{continue;}let bytes=match event::read()?{Event::Key(key)if key.kind!=KeyEventKind::Release=>{if key.code==KeyCode::Char('\\')&&key.modifiers.contains(KeyModifiers::CONTROL){return Ok(());}key_bytes(key.code,key.modifiers)},Event::Paste(text)=>text.into_bytes(),_=>vec![]};for chunk in bytes.chunks(8192){crate::service::call(root,"agent.terminal.input",json!({"id":id,"dataB64":STANDARD.encode(chunk)})).await?;}
 }}}}.await;
    output.abort();
    result
}
fn key_bytes(code: KeyCode, modifiers: KeyModifiers) -> Vec<u8> {
    let bytes = match code {
        KeyCode::Char(c) if modifiers.contains(KeyModifiers::CONTROL) && c.is_ascii() => {
            vec![(c.to_ascii_uppercase() as u8) & 0x1f]
        }
        KeyCode::Char(c) => c.to_string().into_bytes(),
        KeyCode::Enter => vec![b'\r'],
        KeyCode::Backspace => vec![127],
        KeyCode::Tab => vec![b'\t'],
        KeyCode::Esc => vec![27],
        KeyCode::Up => b"\x1b[A".to_vec(),
        KeyCode::Down => b"\x1b[B".to_vec(),
        KeyCode::Right => b"\x1b[C".to_vec(),
        KeyCode::Left => b"\x1b[D".to_vec(),
        KeyCode::Home => b"\x1b[H".to_vec(),
        KeyCode::End => b"\x1b[F".to_vec(),
        KeyCode::Delete => b"\x1b[3~".to_vec(),
        KeyCode::PageUp => b"\x1b[5~".to_vec(),
        KeyCode::PageDown => b"\x1b[6~".to_vec(),
        _ => vec![],
    };
    if modifiers.contains(KeyModifiers::ALT) {
        [vec![27], bytes].concat()
    } else {
        bytes
    }
}
