use std::{
    io::{self, Write},
    path::{Path, PathBuf},
    time::Duration,
};

use super::assets::hash;
use crate::{error::HostError, serial::SerialPortSummary};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RecoveryDrive {
    pub root: PathBuf,
    pub identity: String,
}

pub fn gs_port(port: &SerialPortSummary) -> bool {
    port.vendor_id.as_deref() == Some("239A") && port.product_id.as_deref() == Some("80AB")
}
pub fn vega_port(port: &SerialPortSummary) -> bool {
    port.vendor_id.as_deref() == Some("CAFE") && port.product_id.as_deref() == Some("4003")
}
pub fn same_port(a: &SerialPortSummary, b: &SerialPortSummary) -> bool {
    a.vendor_id == b.vendor_id
        && a.product_id == b.product_id
        && match (&a.serial_number, &b.serial_number) {
            (Some(a), Some(b)) if !a.is_empty() && !b.is_empty() => a == b,
            _ => a.path == b.path,
        }
}

pub fn small_file(path: &Path) -> Option<String> {
    let info = std::fs::symlink_metadata(path).ok()?;
    if !info.is_file() || info.file_type().is_symlink() || info.len() > 4096 {
        return None;
    }
    std::fs::read_to_string(path).ok()
}

pub fn recovery_info(text: &str) -> bool {
    // These are the WROOM/WROVER identities in the pinned TinyUF2 bootloaders
    // shipped by cats-embedded. An unrelated ESP32-S2 board is not a GS target.
    let mut board_ids = text
        .lines()
        .filter_map(|line| line.trim().strip_prefix("Board-ID:").map(str::trim));
    text.lines()
        .any(|line| line.trim().starts_with("TinyUF2 Bootloader"))
        && matches!(
            board_ids.next(),
            Some("ESP32S2-Saola1M-v1.2" | "ESP32S2-Saola1R-v1.2")
        )
        && board_ids.next().is_none()
}

pub async fn recovery_drives() -> Result<Vec<RecoveryDrive>, HostError> {
    Ok(super::volumes::mounted()
        .await?
        .into_iter()
        .filter_map(|volume| {
            let text = small_file(&volume.root.join("INFO_UF2.TXT"))?;
            recovery_info(&text).then(|| RecoveryDrive {
                root: volume.root,
                identity: format!("{}:{}", volume.identity, hash(text.as_bytes())),
            })
        })
        .collect())
}

pub async fn read_gs_file() -> Result<Option<String>, HostError> {
    let count = crate::serial::SerialManager::list()?
        .iter()
        .filter(|port| gs_port(port))
        .count();
    let versions: Vec<_> = super::telemetry::drives()
        .await?
        .into_iter()
        .map(|drive| drive.versions.ground_station)
        .collect();
    select_gs_version(versions, count)
}

fn select_gs_version(
    mut versions: Vec<String>,
    gs_count: usize,
) -> Result<Option<String>, HostError> {
    if gs_count > 1 || versions.len() > 1 {
        return Err(HostError::new(
            "firmware_ambiguous",
            "Connect only the intended Ground Station and its USB drive to check version.json.",
        ));
    }
    Ok(if gs_count == 1 { versions.pop() } else { None })
}

fn bootloader_error(cause: impl std::fmt::Display) -> HostError {
    HostError::new(
        "gs_bootloader",
        format!(
            "Cannot access Ground Station runtime DFU: {cause}. Open Settings → Update Firmware → Ground Station on the device to enter TinyUF2, then check devices again. The 1200-baud reset enters ESP32 ROM mode and is not used."
        ),
    )
}

pub async fn enter_gs(port: &SerialPortSummary) -> Result<(), HostError> {
    use nusb::transfer::{ControlOut, ControlType, Recipient, TransferError};
    let serial = port
        .serial_number
        .as_deref()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| bootloader_error("USB serial identity is missing"))?;
    let matches: Vec<_> = nusb::list_devices()
        .await
        .map_err(bootloader_error)?
        .filter(|d| {
            d.vendor_id() == 0x239a && d.product_id() == 0x80ab && d.serial_number() == Some(serial)
        })
        .collect();
    if matches.len() != 1 {
        return Err(bootloader_error("USB identity is missing or ambiguous"));
    }
    let device = matches[0].open().await.map_err(gs_usb_error)?;
    let config = device.active_configuration().map_err(bootloader_error)?;
    let interfaces: Vec<_> = config
        .interface_alt_settings()
        .filter(|alt| (alt.class(), alt.subclass(), alt.protocol()) == (0xfe, 1, 1))
        .map(|alt| alt.interface_number())
        .collect();
    if interfaces.len() != 1 {
        return Err(bootloader_error("no unique runtime DFU interface"));
    }
    let interface = device
        .claim_interface(interfaces[0])
        .await
        .map_err(gs_usb_error)?;
    let result = interface
        .control_out(
            ControlOut {
                control_type: ControlType::Class,
                recipient: Recipient::Interface,
                request: 0, // DFU_DETACH invokes the GS 0x11F2 TinyUF2 reset hint.
                value: 700,
                index: interfaces[0].into(),
                data: &[],
            },
            Duration::from_secs(5),
        )
        .await;
    match result {
        Ok(()) | Err(TransferError::Disconnected) => {}
        Err(e) => return Err(bootloader_error(e)),
    }
    // A detach is only a transition request. The caller still requires one new
    // pinned TinyUF2 drive before copying and fresh version.json afterwards.
    Ok(())
}

fn gs_usb_error(error: nusb::Error) -> HostError {
    if cfg!(target_os = "linux") && error.kind() == nusb::ErrorKind::PermissionDenied {
        return HostError::new(
            "gs_usb_permission_denied",
            "Linux denied access to the Ground Station update interface. Enable CATS USB access, reconnect the Ground Station, and check devices again.",
        );
    }
    bootloader_error(error)
}

pub async fn copy_uf2(drive: &RecoveryDrive, bytes: Vec<u8>) -> Result<(), HostError> {
    if !recovery_drives().await?.contains(drive) {
        return Err(HostError::new(
            "gs_drive_changed",
            "The selected recovery drive is no longer present.",
        ));
    }
    let destination = drive.root.join("NEW.UF2");
    if std::fs::symlink_metadata(&destination)
        .is_ok_and(|m| !m.is_file() || m.file_type().is_symlink())
    {
        return Err(HostError::new("gs_copy", "Unsafe recovery destination."));
    }
    let mut options = tokio::fs::OpenOptions::new();
    options.write(true).create(true);
    #[cfg(unix)]
    options.custom_flags(libc::O_NOFOLLOW);
    #[cfg(windows)]
    options.custom_flags(0x0020_0000); // FILE_FLAG_OPEN_REPARSE_POINT
    let output = options.open(destination).await.map_err(copy_error)?;
    let metadata = output.metadata().await.map_err(copy_error)?;
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return Err(HostError::new(
                "gs_copy",
                "Recovery destination is a reparse point.",
            ));
        }
    }
    if !metadata.is_file() || !recovery_drives().await?.contains(drive) {
        return Err(HostError::new(
            "gs_drive_changed",
            "Recovery volume changed before writing.",
        ));
    }
    output.set_len(0).await.map_err(copy_error)?;
    // Tokio can report a buffered write before the OS completes it. Use an
    // unbuffered file on a blocking worker to keep write errors separate from sync.
    let mut output = output.into_std().await;
    tokio::task::spawn_blocking(move || write_and_sync(&mut output, &bytes, |file| file.sync_all()))
        .await
        .map_err(copy_error)?
}

fn write_and_sync<W: Write>(
    output: &mut W,
    bytes: &[u8],
    sync: impl FnOnce(&mut W) -> io::Result<()>,
) -> Result<(), HostError> {
    output.write_all(bytes).map_err(|error| {
        HostError::new(
            "gs_copy",
            format!(
                "Writing NEW.UF2 failed: {error}. Keep the device connected and retry in TinyUF2."
            ),
        )
    })?;
    uf2_finalization(sync(output))
}

#[cfg(windows)]
const UF2_DISCONNECT_ERRORS: &[i32] = &[433, 1167];
#[cfg(target_os = "linux")]
const UF2_DISCONNECT_ERRORS: &[i32] = &[libc::EIO, libc::ENODEV];
#[cfg(target_os = "macos")]
const UF2_DISCONNECT_ERRORS: &[i32] = &[libc::ENXIO];
#[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
const UF2_DISCONNECT_ERRORS: &[i32] = &[];

fn uf2_finalization(result: io::Result<()>) -> Result<(), HostError> {
    match result {
        Ok(()) => Ok(()),
        // TinyUF2 may remove the drive before the host finishes syncing.
        // The caller still requires the drive to disappear and the restarted
        // device to report the selected version.
        Err(error)
            if error
                .raw_os_error()
                .is_some_and(|code| UF2_DISCONNECT_ERRORS.contains(&code)) =>
        {
            Ok(())
        }
        Err(error) => Err(copy_error(error)),
    }
}
fn copy_error(e: impl std::fmt::Display) -> HostError {
    HostError::new(
        "gs_copy",
        format!(
            "UF2 copy/flush did not complete: {e}. Keep the device connected and retry in TinyUF2."
        ),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_json_requires_one_ground_station_and_one_metadata_volume() {
        assert_eq!(
            select_gs_version(vec!["1.3.0".into()], 1)
                .unwrap()
                .as_deref(),
            Some("1.3.0")
        );
        assert!(
            select_gs_version(vec!["1.3.0".into()], 0)
                .unwrap()
                .is_none()
        );
        assert!(select_gs_version(vec![], 1).unwrap().is_none());
        assert!(select_gs_version(vec!["1.3.0".into()], 2).is_err());
        assert!(select_gs_version(vec!["1.3.0".into(), "1.2.0".into()], 1).is_err());
    }

    #[tokio::test]
    #[ignore = "read-only Ground Station version.json check; requires connected GS USB drive"]
    async fn gs_version_json_read_only() {
        for attempt in 1..=3 {
            let version = read_gs_file().await.unwrap();
            assert!(version.is_some(), "Mount the Ground Station USB drive");
            println!("GS version.json check {attempt}: {version:?}");
        }
    }

    struct CopySink {
        bytes: Vec<u8>,
        fail_write: bool,
        fail_sync: bool,
        synced: bool,
        error_code: Option<i32>,
    }

    impl CopySink {
        fn error(&self, message: &str) -> io::Error {
            self.error_code
                .map(io::Error::from_raw_os_error)
                .unwrap_or_else(|| io::Error::other(message))
        }

        fn sync(&mut self) -> io::Result<()> {
            self.synced = true;
            if self.fail_sync {
                return Err(self.error("sync failed"));
            }
            Ok(())
        }
    }

    impl Write for CopySink {
        fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
            if self.fail_write && !self.bytes.is_empty() {
                return Err(self.error("device disconnected"));
            }
            let count = bytes.len().min(19); // Exercise short successful writes too.
            self.bytes.extend_from_slice(&bytes[..count]);
            Ok(count)
        }

        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }

    #[test]
    fn uf2_copy_propagates_partial_write_and_sync_failures() {
        let bytes = vec![0xa5; 512];
        for (fail_write, fail_sync) in [(false, false), (true, false), (false, true)] {
            let mut sink = CopySink {
                bytes: Vec::new(),
                fail_write,
                fail_sync,
                synced: false,
                error_code: None,
            };
            let result = write_and_sync(&mut sink, &bytes, CopySink::sync);
            if fail_write || fail_sync {
                assert_eq!(result.unwrap_err().code, "gs_copy");
            } else {
                result.unwrap();
            }
            assert_eq!(sink.synced, !fail_write);
            if !fail_write {
                assert_eq!(sink.bytes, bytes);
            }
        }
    }

    #[test]
    fn uf2_disconnect_during_partial_write_is_always_a_copy_failure() {
        for code in [5, 6, 19, 433, 1167] {
            let mut sink = CopySink {
                bytes: Vec::new(),
                fail_write: true,
                fail_sync: false,
                synced: false,
                error_code: Some(code),
            };
            let error = write_and_sync(&mut sink, &[0xa5; 512], CopySink::sync).unwrap_err();
            assert_eq!(error.code, "gs_copy");
            assert_eq!(sink.bytes.len(), 19);
            assert!(!sink.synced);
        }
    }

    #[test]
    fn uf2_disconnect_after_full_write_can_proceed_to_verification() {
        let bytes = [0xa5; 512];
        for code in [5, 6, 19, 433, 1167] {
            let mut sink = CopySink {
                bytes: Vec::new(),
                fail_write: false,
                fail_sync: true,
                synced: false,
                error_code: Some(code),
            };
            let result = write_and_sync(&mut sink, &bytes, CopySink::sync);
            assert_eq!(sink.bytes, bytes);
            assert!(sink.synced);
            if (cfg!(windows) && matches!(code, 433 | 1167))
                || (cfg!(target_os = "linux") && matches!(code, 5 | 19))
                || (cfg!(target_os = "macos") && code == 6)
            {
                result.unwrap();
            } else {
                assert_eq!(result.unwrap_err().code, "gs_copy");
            }
        }
    }

    #[test]
    fn uf2_sync_only_allows_platform_device_disappearance_errors() {
        uf2_finalization(Ok(())).unwrap();
        for code in [5, 6, 19, 28, 112, 433, 995, 1167] {
            let result = uf2_finalization(Err(io::Error::from_raw_os_error(code)));
            if (cfg!(windows) && matches!(code, 433 | 1167))
                || (cfg!(target_os = "linux") && matches!(code, 5 | 19))
                || (cfg!(target_os = "macos") && code == 6)
            {
                result.unwrap();
            } else {
                assert_eq!(result.unwrap_err().code, "gs_copy");
            }
        }
    }

    #[test]
    fn bootloader_info_is_not_firmware_metadata() {
        assert!(recovery_info(
            "TinyUF2 Bootloader 0.35.0\nBoard-ID: ESP32S2-Saola1M-v1.2\n"
        ));
        assert!(recovery_info(
            "TinyUF2 Bootloader 0.35.0\r\nBoard-ID: ESP32S2-Saola1R-v1.2\r\n"
        ));
        assert!(!recovery_info("UF2 Bootloader\nBoard-ID: RP2040"));
        assert!(!recovery_info(
            "TinyUF2 Bootloader\nBoard-ID: ESP32S2-Feather"
        ));
        assert!(!recovery_info(
            "TinyUF2 Bootloader\nBoard-ID: ESP32S2-Saola1M-v1.2\nBoard-ID: other"
        ));
        assert!(!recovery_info(
            "TinyUF2 Bootloader\nBoard-ID: ESP32S2-Saola1M-v1.2-extra"
        ));
    }
}
