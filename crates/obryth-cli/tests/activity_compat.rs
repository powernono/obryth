use axum::{routing::post, Json, Router};
use obryth_cli::service::{call, Connection};
use obryth_core::{vault::private_write, NoteDraft, Vault};
use serde_json::{json, Value};

#[tokio::test]
async fn activity_reads_work_with_an_older_detached_service() {
    let directory = tempfile::tempdir().unwrap();
    let vault = Vault::open(directory.path()).unwrap();
    let note = vault
        .save(NoteDraft {
            title: "Existing history".into(),
            body: "Preserved".into(),
            ..Default::default()
        })
        .unwrap();
    let day = &note.updated_at[..10];
    let year: i32 = day[..4].parse().unwrap();
    let range = json!({"from":format!("{year}-01-01"),"to":format!("{}-01-01",year+1),"timeZone":"UTC","kind":null});
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let connection = Connection {
        protocol_version: 1,
        pid: std::process::id(),
        url: format!("http://{}", listener.local_addr().unwrap()),
        token: "a".repeat(64),
    };
    private_write(
        &directory.path().join(".obryth/connection.json"),
        &serde_json::to_vec(&connection).unwrap(),
    )
    .unwrap();
    let server = tokio::spawn(async move {
        axum::serve(listener, Router::new().route("/rpc", post(|Json(request): Json<Value>| async move {
            Json(if request["method"]=="vault.info" { json!({"result":{"protocolVersion":1}}) } else { json!({"error":{"message":format!("unknown method: {}",request["method"].as_str().unwrap())}}) })
        }))).await.unwrap();
    });
    let summary = call(directory.path(), "notes.activity", range.clone())
        .await
        .unwrap();
    assert_eq!(summary["totalSaves"], 1);
    let page = json!({"range":range,"limit":20,"cursor":null,"noteId":note.id});
    let feed = call(directory.path(), "notes.activityFeed", page.clone())
        .await
        .unwrap();
    assert_eq!(feed["items"][0]["note"]["body"], "Preserved");
    let versions = call(directory.path(), "notes.activityVersions", page)
        .await
        .unwrap();
    assert_eq!(versions["items"][0]["id"], note.revision);
    assert!(call(directory.path(), "unknown.write", json!({}))
        .await
        .is_err());
    assert_eq!(vault.history(&note.id).unwrap().len(), 1);
    server.abort();
}
