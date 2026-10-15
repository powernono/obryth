use obryth_core::{NoteDraft, Vault};
use serde_json::json;
#[test]
fn deleting_the_search_index_keeps_chat_history_and_provider_configuration() {
    let directory = tempfile::tempdir().unwrap();
    let vault = Vault::open(directory.path()).unwrap();
    vault
        .save(NoteDraft {
            title: "Persistent note".into(),
            ..Default::default()
        })
        .unwrap();
    let chat = vault
        .create_chat("Persistent chat", "provider", "model")
        .unwrap();
    let id = chat["id"].as_str().unwrap();
    vault
        .append_chat_message(id, "user", "A question", &json!([]))
        .unwrap();
    vault
        .append_chat_message(id, "assistant", "An answer", &json!([]))
        .unwrap();
    vault
        .set_setting(
            "providers",
            &json!([{"id":"provider","secretRef":"reference-only"}]),
        )
        .unwrap();
    drop(vault);
    std::fs::remove_file(directory.path().join(".obryth/index.sqlite")).unwrap();
    let restored = Vault::open(directory.path()).unwrap();
    assert_eq!(restored.chat_messages(id, None, 50).unwrap().len(), 2);
    assert_eq!(
        restored.setting("providers").unwrap().unwrap()[0]["secretRef"],
        "reference-only"
    );
}
#[test]
fn chat_pagination_is_stable() {
    let directory = tempfile::tempdir().unwrap();
    let vault = Vault::open(directory.path()).unwrap();
    let chat = vault.create_chat("History", "p", "m").unwrap();
    let id = chat["id"].as_str().unwrap();
    for n in 0..120 {
        vault
            .append_chat_message(id, "user", &format!("Message {n}"), &json!([]))
            .unwrap();
    }
    let page = vault.chat_messages(id, None, 50).unwrap();
    assert_eq!(page.len(), 50);
    let previous = vault
        .chat_messages(id, page[0]["seq"].as_i64(), 50)
        .unwrap();
    assert_eq!(previous.len(), 50);
    assert!(previous.last().unwrap()["seq"].as_i64().unwrap() < page[0]["seq"].as_i64().unwrap());
}
#[test]
fn plugin_install_copies_only_a_valid_bundle_and_enforces_network_permissions() {
    let directory = tempfile::tempdir().unwrap();
    let vault = Vault::open(directory.path().join("vault")).unwrap();
    let source = directory.path().join("plugin");
    std::fs::create_dir(&source).unwrap();
    std::fs::write(source.join("manifest.json"),r#"{"id":"test.plugin","apiVersion":1,"entry":"entry.js","permissions":["commands"],"platforms":["desktop"],"name":"Test","version":"1.0"}"#).unwrap();
    std::fs::write(
        source.join("entry.js"),
        "globalThis.ObrythPlugin={activate(){}};",
    )
    .unwrap();
    vault.install_plugin(&source).unwrap();
    assert_eq!(vault.plugins().unwrap().len(), 1);
    assert!(vault
        .plugin_fetch("test.plugin", "https://example.com")
        .unwrap_err()
        .to_string()
        .contains("permission"));
    std::fs::write(
        source.join("manifest.json"),
        r#"{"id":"../escape","apiVersion":1,"entry":"entry.js","permissions":[]}"#,
    )
    .unwrap();
    assert!(vault.install_plugin(&source).is_err());
    assert!(vault.remove_plugin("../escape").is_err());
    vault.remove_plugin("test.plugin").unwrap();
    assert!(vault.plugins().unwrap().is_empty());
}
