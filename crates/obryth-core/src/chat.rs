use crate::{vault::now, Vault};
use anyhow::{bail, Result};
use rusqlite::params;
use serde_json::{json, Value};
impl Vault {
    pub fn create_chat(&self, title: &str, provider: &str, model: &str) -> Result<Value> {
        let id = uuid::Uuid::new_v4().to_string();
        let date = now();
        self.db.execute(
            "INSERT INTO history.chats VALUES(?1,?2,?3,?4,?5,?5)",
            params![id, title, provider, model, date],
        )?;
        Ok(
            json!({"id":id,"title":title,"providerId":provider,"model":model,"createdAt":date,"updatedAt":date}),
        )
    }
    pub fn list_chats(&self, offset: usize, limit: usize) -> Result<Vec<Value>> {
        let mut statement=self.db.prepare("SELECT id,title,provider,model,created_at,updated_at FROM history.chats ORDER BY updated_at DESC,id LIMIT ?1 OFFSET ?2")?;
        let rows=statement.query_map(params![limit.clamp(1,100),offset],|row|Ok(json!({"id":row.get::<_,String>(0)?,"title":row.get::<_,String>(1)?,"providerId":row.get::<_,String>(2)?,"model":row.get::<_,String>(3)?,"createdAt":row.get::<_,String>(4)?,"updatedAt":row.get::<_,String>(5)?})))?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }
    pub fn chat_messages(&self, id: &str, before: Option<i64>, limit: usize) -> Result<Vec<Value>> {
        let mut statement=self.db.prepare("SELECT seq,role,content,citations,created_at FROM history.chat_messages WHERE chat_id=?1 AND (?2 IS NULL OR seq<?2) ORDER BY seq DESC LIMIT ?3")?;
        let mut rows=statement.query_map(params![id,before,limit.clamp(1,100)],|row|Ok(json!({"seq":row.get::<_,i64>(0)?,"role":row.get::<_,String>(1)?,"text":row.get::<_,String>(2)?,"citations":serde_json::from_str::<Value>(&row.get::<_,String>(3)?).unwrap_or(json!([])),"createdAt":row.get::<_,String>(4)?})))?.collect::<Result<Vec<_>,_>>()?;
        rows.reverse();
        Ok(rows)
    }
    pub fn append_chat_message(
        &self,
        id: &str,
        role: &str,
        content: &str,
        citations: &Value,
    ) -> Result<()> {
        if !matches!(role, "user" | "assistant") {
            bail!("invalid message role");
        }
        let tx = self.db.unchecked_transaction()?;
        let date = now();
        tx.execute("INSERT INTO history.chat_messages(chat_id,role,content,citations,created_at) VALUES(?1,?2,?3,?4,?5)",params![id,role,content,serde_json::to_string(citations)?,date])?;
        tx.execute(
            "UPDATE history.chats SET updated_at=?2 WHERE id=?1",
            params![id, date],
        )?;
        tx.commit()?;
        Ok(())
    }
}
