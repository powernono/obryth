use crate::service;
use anyhow::Result;
use obryth_core::KnowledgeScope;
use serde_json::{json, Value};
use std::{
    io::{BufRead, Write},
    path::Path,
};

pub async fn run(root: &Path, scope: KnowledgeScope) -> Result<()> {
    let tools = json!([
        {"name":"search_notes","description":"Search notes within this server's configured knowledge scope","inputSchema":{"type":"object","properties":{"query":{"type":"string"}},"required":["query"]}},
        {"name":"read_note","description":"Read a scoped note and its revision","inputSchema":{"type":"object","properties":{"id":{"type":"string"}},"required":["id"]}},
        {"name":"get_backlinks","description":"Get scoped backlinks to a note","inputSchema":{"type":"object","properties":{"id":{"type":"string"}},"required":["id"]}},
        {"name":"propose_note_patch","description":"Create a pending note edit for human review","inputSchema":{"type":"object","properties":{"noteId":{"type":"string"},"baseRevision":{"type":"string"},"body":{"type":"string"}},"required":["noteId","baseRevision","body"]}}
    ]);
    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout();
    for line in stdin.lock().lines() {
        let message: Value = serde_json::from_str(&line?)?;
        let Some(id) = message.get("id").cloned() else {
            continue;
        };
        let method = message["method"].as_str().unwrap_or("");
        let result: Result<Value> = match method {
            "initialize" => Ok(
                json!({"protocolVersion":"2024-11-05","capabilities":{"tools":{"listChanged":false}},"serverInfo":{"name":"obryth","version":"0.1.0"}}),
            ),
            "ping" => Ok(json!({})),
            "tools/list" => Ok(json!({"tools":tools})),
            "tools/call" => {
                let name = message["params"]["name"].as_str().unwrap_or("");
                let mut args = message["params"]["arguments"].clone();
                if !args.is_object() {
                    args = json!({});
                }
                args["scope"] = serde_json::to_value(&scope)?;
                let data: Result<Value> = async {
                    match name {
                        "search_notes" => {
                            args["text"] = args["query"].clone();
                            service::call(root, "knowledge.search", args).await
                        }
                        "read_note" => service::call(root, "knowledge.read", args).await,
                        "get_backlinks" => {
                            service::call(root, "knowledge.read", args.clone()).await?;
                            let all = service::call(root, "notes.backlinks", args).await?;
                            Ok(json!(all
                                .as_array()
                                .into_iter()
                                .flatten()
                                .filter(|hit| serde_json::from_value::<obryth_core::Note>(
                                    hit["note"].clone()
                                )
                                .is_ok_and(|n| scope.allows(&n)))
                                .cloned()
                                .collect::<Vec<_>>()))
                        }
                        "propose_note_patch" => {
                            service::call(
                                root,
                                "knowledge.read",
                                json!({"id":args["noteId"],"scope":scope}),
                            )
                            .await?;
                            service::call(root, "knowledge.propose", args).await
                        }
                        _ => Err(anyhow::anyhow!("unknown tool")),
                    }
                }
                .await;
                Ok(match data {
                    Ok(value) => {
                        json!({"content":[{"type":"text","text":serde_json::to_string(&value)?}]})
                    }
                    Err(error) => {
                        json!({"isError":true,"content":[{"type":"text","text":error.to_string()}]})
                    }
                })
            }
            _ => Err(anyhow::anyhow!("method not found")),
        };
        let response = match result {
            Ok(result) => json!({"jsonrpc":"2.0","id":id,"result":result}),
            Err(error) => {
                json!({"jsonrpc":"2.0","id":id,"error":{"code":-32601,"message":error.to_string()}})
            }
        };
        writeln!(stdout, "{response}")?;
        stdout.flush()?;
    }
    Ok(())
}
