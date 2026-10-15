pub mod activity;
pub mod attachments;
pub mod chat;
pub mod dispatch;
pub mod markdown;
pub mod plugins;
pub mod provider;
pub mod sync;
pub mod types;
pub mod vault;

pub use dispatch::dispatch;
pub use types::*;
pub use vault::Vault;

pub const PROTOCOL_VERSION: u32 = 1;
