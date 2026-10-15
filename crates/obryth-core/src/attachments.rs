use crate::{
    types::AttachmentRef,
    vault::{atomic_write, hash},
    Vault,
};
use anyhow::{bail, Context, Result};
use std::{collections::BTreeMap, fs, path::Path};
pub fn validate(reference: &AttachmentRef) -> Result<()> {
    let path = Path::new(&reference.path);
    if !reference.path.starts_with("attachments/")
        || path
            .components()
            .any(|c| !matches!(c, std::path::Component::Normal(_)))
        || reference.digest.len() != 64
        || !reference.digest.chars().all(|c| c.is_ascii_hexdigit())
    {
        bail!("invalid attachment reference");
    }
    Ok(())
}
impl Vault {
    pub fn import_attachment(&self, path: &Path) -> Result<AttachmentRef> {
        let bytes = fs::read(path)?;
        if bytes.len() > 64 * 1024 * 1024 {
            bail!("attachment exceeds 64 MiB");
        }
        let digest = hash(&bytes);
        let extension = path
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("bin")
            .chars()
            .filter(|c| c.is_ascii_alphanumeric())
            .take(12)
            .collect::<String>()
            .to_lowercase();
        let reference = AttachmentRef {
            path: format!("attachments/{digest}.{extension}"),
            digest,
        };
        self.materialize_attachment(&reference, &bytes)?;
        Ok(reference)
    }
    pub(crate) fn attachment_refs(&self, body: &str) -> Result<Vec<AttachmentRef>> {
        let pattern = regex::Regex::new(r#"\]\((?:\.\./)?(attachments/[^\s)\]<>"']+)"#)
            .expect("valid attachment pattern");
        let mut references = BTreeMap::new();
        for capture in pattern.captures_iter(body) {
            let path = percent_encoding::percent_decode_str(&capture[1])
                .decode_utf8()?
                .to_string();
            let bytes = fs::read(self.safe_path(&path)?)
                .with_context(|| format!("missing attachment: {path}"))?;
            let reference = AttachmentRef {
                path: path.clone(),
                digest: hash(&bytes),
            };
            validate(&reference)?;
            atomic_write(
                &self
                    .root
                    .join(format!(".obryth/objects/{}", reference.digest)),
                &bytes,
            )?;
            references.insert(path, reference);
        }
        Ok(references.into_values().collect())
    }
    pub(crate) fn attachment_bytes(&self, reference: &AttachmentRef) -> Result<Vec<u8>> {
        validate(reference)?;
        let cached = self
            .root
            .join(format!(".obryth/objects/{}", reference.digest));
        let bytes = if cached.exists() {
            fs::read(cached)?
        } else {
            fs::read(self.safe_path(&reference.path)?)?
        };
        if hash(&bytes) != reference.digest {
            bail!("attachment content changed: {}", reference.path);
        }
        Ok(bytes)
    }
    pub(crate) fn materialize_attachment(
        &self,
        reference: &AttachmentRef,
        bytes: &[u8],
    ) -> Result<()> {
        validate(reference)?;
        if hash(bytes) != reference.digest {
            bail!("attachment authentication digest mismatch");
        }
        let path = self.safe_path(&reference.path)?;
        if path.exists() && hash(&fs::read(&path)?) != reference.digest {
            bail!(
                "attachment path has different local content: {}",
                reference.path
            );
        }
        atomic_write(
            &self
                .root
                .join(format!(".obryth/objects/{}", reference.digest)),
            bytes,
        )?;
        atomic_write(&path, bytes)
    }
}
