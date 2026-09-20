//! Prepare the official radio image on the GS drive. The GS owns flashing:
//! safely eject USB, then select Radio Receivers on its Update Firmware screen.
use super::{assets, hardware, volumes};
use crate::error::HostError;
use semver::Version;
use serde::Deserialize;
use std::path::Path;
use tokio::io::AsyncWriteExt;

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct Versions {
    pub ground_station: String,
    pub telemetry_1: Option<String>,
    pub telemetry_2: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Drive {
    pub volume: volumes::Volume,
    pub versions: Versions,
}

pub fn versions(text: &str) -> Option<Versions> {
    let value: serde_json::Value = serde_json::from_str(text).ok()?;
    // Require the exact three component fields written by the GS, even when a
    // radio's startup version read failed and its value is null.
    for key in ["ground_station", "telemetry_1", "telemetry_2"] {
        value.get(key)?;
    }
    let mut result: Versions = serde_json::from_value(value).ok()?;
    Version::parse(&result.ground_station).ok()?;
    for radio in [&mut result.telemetry_1, &mut result.telemetry_2] {
        *radio = radio
            .as_deref()
            .and_then(|v| Version::parse(v).ok())
            .map(|v| v.to_string());
    }
    Some(result)
}

pub async fn drives() -> Result<Vec<Drive>, HostError> {
    Ok(volumes::mounted()
        .await?
        .into_iter()
        .filter_map(|volume| {
            let versions = versions(&hardware::small_file(&volume.root.join("version.json"))?)?;
            Some(Drive { volume, versions })
        })
        .collect())
}

pub async fn check_drive(drive: &Drive) -> Result<(), HostError> {
    if !drives().await?.contains(drive) {
        return Err(error(
            "The selected Ground Station drive or its version metadata changed. Reconnect USB and check devices again.",
        ));
    }
    Ok(())
}

fn error(message: impl Into<String>) -> HostError {
    HostError::new("telemetry_staging", message)
}

fn plain_path(path: &Path, directory: bool) -> Result<(), HostError> {
    let metadata = std::fs::symlink_metadata(path).map_err(|e| error(e.to_string()))?;
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return Err(error("Telemetry destination must not be a reparse point."));
        }
    }
    if metadata.file_type().is_symlink()
        || if directory {
            !metadata.is_dir()
        } else {
            !metadata.is_file()
        }
    {
        return Err(error("Unsafe telemetry destination."));
    }
    Ok(())
}

pub async fn stage(drive: &Drive, asset: &assets::Asset, bytes: &[u8]) -> Result<(), HostError> {
    check_drive(drive).await?;
    assets::validate(asset, bytes)?;
    if asset.target != assets::Target::Telemetry
        || assets::asset_version(assets::Target::Telemetry, &asset.name).is_none()
    {
        return Err(error("Select an official telemetry image."));
    }
    stage_file(&drive.volume.root, &asset.name, bytes).await?;
    check_drive(drive).await
}

async fn stage_file(root: &Path, name: &str, bytes: &[u8]) -> Result<(), HostError> {
    plain_path(root, true)?;
    let directory = root.join("telemetry_firmware");
    match tokio::fs::create_dir(&directory).await {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(e) => return Err(error(e.to_string())),
    }
    plain_path(&directory, true)?;
    let destination = directory.join(name);
    if std::fs::symlink_metadata(&destination).is_ok() {
        return verify_file(&destination, bytes).await;
    }
    // The GS ignores .part files. Never leave a partially copied selectable .bin.
    let temporary = directory.join(format!("{}.part", uuid::Uuid::new_v4()));
    let mut file = tokio::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .await
        .map_err(|e| error(e.to_string()))?;
    file.write_all(bytes)
        .await
        .map_err(|e| error(e.to_string()))?;
    file.flush().await.map_err(|e| error(e.to_string()))?;
    file.sync_all().await.map_err(|e| error(e.to_string()))?;
    drop(file);
    verify_file(&temporary, bytes).await?;
    plain_path(root, true)?;
    plain_path(&directory, true)?;
    if std::fs::symlink_metadata(&destination).is_ok() {
        return Err(error(
            "The telemetry destination appeared during copying. Check devices and retry.",
        ));
    }
    tokio::fs::rename(&temporary, &destination)
        .await
        .map_err(|e| error(e.to_string()))?;
    verify_file(&destination, bytes).await
}

async fn verify_file(path: &Path, bytes: &[u8]) -> Result<(), HostError> {
    plain_path(path, false)?;
    if std::fs::metadata(path)
        .map_err(|e| error(e.to_string()))?
        .len()
        != bytes.len() as u64
        || tokio::fs::read(path)
            .await
            .map_err(|e| error(e.to_string()))?
            != bytes
    {
        return Err(error(
            "Telemetry file differs from the validated image. An existing file was not overwritten; remove the conflicting file and retry.",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn current_gs_metadata_requires_component_fields_and_handles_unknown_radios() {
        let parsed =
            versions(r#"{"ground_station":"1.3.0","telemetry_1":"1.2.0","telemetry_2":null}"#)
                .unwrap();
        assert_eq!(parsed.telemetry_1.as_deref(), Some("1.2.0"));
        assert!(parsed.telemetry_2.is_none());
        for text in [
            r#"{"ground_station":"1.3.0"}"#,
            r#"{"ground_station":"unknown","telemetry_1":null,"telemetry_2":null}"#,
            "{}",
        ] {
            assert!(versions(text).is_none());
        }
    }

    #[tokio::test]
    async fn staging_preserves_other_files_and_conflicts_and_retries_identical_image() {
        let root =
            std::env::temp_dir().join(format!("cats-telemetry-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        std::fs::write(root.join("config.json"), b"keep settings").unwrap();
        let bytes = vec![42; 256];
        stage_file(&root, "telemetry-1.2.0.bin", &bytes)
            .await
            .unwrap();
        stage_file(&root, "telemetry-1.2.0.bin", &bytes)
            .await
            .unwrap();
        assert!(
            stage_file(&root, "telemetry-1.2.0.bin", &[24; 256])
                .await
                .is_err()
        );
        assert_eq!(
            std::fs::read(root.join("telemetry_firmware/telemetry-1.2.0.bin")).unwrap(),
            bytes
        );
        assert_eq!(
            std::fs::read(root.join("config.json")).unwrap(),
            b"keep settings"
        );
        assert_eq!(
            std::fs::read_dir(root.join("telemetry_firmware"))
                .unwrap()
                .count(),
            1
        );
        std::fs::remove_dir_all(root).unwrap();
    }
}
