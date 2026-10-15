use std::sync::{Arc, Mutex};

uniffi::setup_scaffolding!();

#[derive(Debug, thiserror::Error, uniffi::Error)]
pub enum MobileError {
    #[error("{message}")]
    Operation { message: String },
}
#[derive(uniffi::Object)]
pub struct MobileVault {
    vault: Mutex<obryth_core::Vault>,
    root: std::path::PathBuf,
}
#[uniffi::export]
impl MobileVault {
    #[uniffi::constructor]
    pub fn open(path: String) -> Result<Arc<Self>, MobileError> {
        let vault = obryth_core::Vault::open(path).map_err(|error| MobileError::Operation {
            message: error.to_string(),
        })?;
        let root = vault.root.clone();
        Ok(Arc::new(Self {
            vault: Mutex::new(vault),
            root,
        }))
    }
    pub fn call(&self, method: String, params: String) -> Result<String, MobileError> {
        let perform = || -> anyhow_alias::Result<String> {
            if method.starts_with("sync.")
                || matches!(
                    method.as_str(),
                    "knowledge.ask"
                        | "knowledge.index"
                        | "knowledge.semantic"
                        | "providers.models"
                        | "plugins.fetch"
                )
            {
                let vault = obryth_core::Vault::open(&self.root)?;
                return Ok(serde_json::to_string(&obryth_core::dispatch(
                    &vault,
                    &method,
                    serde_json::from_str(&params)?,
                )?)?);
            }
            let vault = self.vault.lock().map_err(|_| "vault lock poisoned")?;
            let input = serde_json::from_str(&params)?;
            let result = obryth_core::dispatch(&vault, &method, input)?;
            Ok(serde_json::to_string(&result)?)
        };
        perform().map_err(|error| MobileError::Operation {
            message: error.to_string(),
        })
    }
}
mod anyhow_alias {
    pub type Result<T> = std::result::Result<T, Box<dyn std::error::Error + Send + Sync>>;
}
