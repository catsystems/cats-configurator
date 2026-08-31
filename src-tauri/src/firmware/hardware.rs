use std::{
    path::{Path, PathBuf},
    time::Duration,
};
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt},
    time::{Instant, sleep, timeout},
};
use tokio_serial::{ClearBuffer, SerialPort, SerialPortBuilderExt};

use super::assets::{gs_version, hash};
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

pub async fn file_versions() -> Result<Vec<String>, HostError> {
    Ok(super::volumes::mounted()
        .await?
        .iter()
        .filter_map(|volume| {
            small_file(&volume.root.join("version.txt")).and_then(|text| gs_version(&text))
        })
        .collect())
}

pub async fn read_gs(path: &str) -> Result<Option<String>, HostError> {
    let mut port = tokio_serial::new(path, 115_200)
        .open_native_async()
        .map_err(|e| {
            HostError::new(
                "gs_serial",
                format!("Cannot open Ground Station console: {e}"),
            )
        })?;
    // Drop RTS first to avoid the ESP32 CDC bootloader line-state sequence.
    // Let the 10 Hz console task observe a closed interface, then discard old
    // input before requesting a fresh banner. CDC activation requires DTR + RTS.
    port.write_request_to_send(false)
        .map_err(|e| HostError::new("gs_serial", e.to_string()))?;
    port.write_data_terminal_ready(false)
        .map_err(|e| HostError::new("gs_serial", e.to_string()))?;
    sleep(Duration::from_millis(250)).await;
    port.clear(ClearBuffer::Input)
        .map_err(|e| HostError::new("gs_serial", e.to_string()))?;
    port.write_data_terminal_ready(true)
        .map_err(|e| HostError::new("gs_serial", e.to_string()))?;
    port.write_request_to_send(true)
        .map_err(|e| HostError::new("gs_serial", e.to_string()))?;
    read_gs_version(&mut port, Duration::from_secs(12)).await
}

async fn read_gs_version(
    port: &mut (impl AsyncRead + Unpin),
    duration: Duration,
) -> Result<Option<String>, HostError> {
    let end = Instant::now() + duration;
    let mut pending = Vec::new();
    let mut chunk = [0; 512];
    while Instant::now() < end {
        match timeout(
            end.saturating_duration_since(Instant::now()),
            port.read(&mut chunk),
        )
        .await
        {
            Ok(Ok(0)) => sleep(Duration::from_millis(25)).await,
            Ok(Ok(count)) => {
                pending.extend_from_slice(&chunk[..count]);
                while let Some(index) = pending.iter().position(|b| *b == b'\n') {
                    let line: Vec<_> = pending.drain(..=index).collect();
                    if let Some(version) = gs_version(&String::from_utf8_lossy(&line)) {
                        return Ok(Some(version));
                    }
                }
                if pending.len() > 4096 {
                    pending.clear();
                }
            }
            Ok(Err(e)) => return Err(HostError::new("gs_serial", e.to_string())),
            Err(_) => break,
        }
    }
    Ok(None)
}

pub async fn enter_gs(path: &str) -> Result<(), HostError> {
    let mut port = tokio_serial::new(path, 1200)
        .open_native_async()
        .map_err(|e| HostError::new("gs_bootloader", e.to_string()))?;
    // The pinned ESP32 CDC implementation resets on the 1200-baud line-coding/DTR transition.
    port.write_data_terminal_ready(true)
        .map_err(|e| HostError::new("gs_bootloader", e.to_string()))?;
    sleep(Duration::from_millis(100)).await;
    port.write_data_terminal_ready(false)
        .map_err(|e| HostError::new("gs_bootloader", e.to_string()))?;
    drop(port);
    Ok(())
}

pub async fn copy_uf2(drive: &RecoveryDrive, bytes: &[u8]) -> Result<(), HostError> {
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
    let mut output = options.open(destination).await.map_err(copy_error)?;
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
    write_and_flush(&mut output, bytes).await?;
    output.sync_all().await.map_err(copy_error)?;
    drop(output);
    Ok(())
}
async fn write_and_flush(
    output: &mut (impl AsyncWrite + Unpin),
    bytes: &[u8],
) -> Result<(), HostError> {
    output.write_all(bytes).await.map_err(copy_error)?;
    output.flush().await.map_err(copy_error)
}
fn copy_error(e: std::io::Error) -> HostError {
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
    use std::{
        io,
        pin::Pin,
        task::{Context, Poll},
    };

    struct CopySink {
        bytes: Vec<u8>,
        fail_write: bool,
        fail_flush: bool,
        flushed: bool,
    }
    impl AsyncWrite for CopySink {
        fn poll_write(
            mut self: Pin<&mut Self>,
            _: &mut Context<'_>,
            bytes: &[u8],
        ) -> Poll<io::Result<usize>> {
            if self.fail_write && !self.bytes.is_empty() {
                return Poll::Ready(Err(io::Error::other("device disconnected")));
            }
            let count = bytes.len().min(19); // Exercise short successful writes too.
            self.bytes.extend_from_slice(&bytes[..count]);
            Poll::Ready(Ok(count))
        }
        fn poll_flush(mut self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<io::Result<()>> {
            self.flushed = true;
            Poll::Ready(if self.fail_flush {
                Err(io::Error::other("flush failed"))
            } else {
                Ok(())
            })
        }
        fn poll_shutdown(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
            self.poll_flush(cx)
        }
    }
    #[tokio::test]
    async fn uf2_copy_propagates_partial_write_and_flush_failures() {
        let bytes = vec![0xa5; 512];
        for (fail_write, fail_flush) in [(false, false), (true, false), (false, true)] {
            let mut sink = CopySink {
                bytes: Vec::new(),
                fail_write,
                fail_flush,
                flushed: false,
            };
            let result = write_and_flush(&mut sink, &bytes).await;
            if fail_write || fail_flush {
                assert_eq!(result.unwrap_err().code, "gs_copy");
            } else {
                result.unwrap();
            }
            assert_eq!(sink.flushed, !fail_write);
            if !fail_write {
                assert_eq!(sink.bytes, bytes);
            }
        }
    }

    #[tokio::test]
    async fn gs_banner_can_be_delayed_and_split_across_reads() {
        let (mut reader, mut writer) = tokio::io::duplex(512);
        tokio::spawn(async move {
            writer
                .write_all(b"TinyUF2 version=9.0.0\nlegacy console\n")
                .await
                .unwrap();
            sleep(Duration::from_millis(20)).await;
            writer
                .write_all(b"CATS-FW target=ground-station ver")
                .await
                .unwrap();
            sleep(Duration::from_millis(20)).await;
            writer.write_all(b"sion=1.2.3\r\n").await.unwrap();
        });
        assert_eq!(
            read_gs_version(&mut reader, Duration::from_secs(1))
                .await
                .unwrap()
                .as_deref(),
            Some("1.2.3")
        );
    }

    #[tokio::test]
    async fn legacy_or_malformed_console_does_not_establish_a_version() {
        let (mut reader, mut writer) = tokio::io::duplex(512);
        writer
            .write_all(b"CATS-FW target=ground-station version=unknown\nFirmware 1.2.3\n")
            .await
            .unwrap();
        assert!(
            read_gs_version(&mut reader, Duration::from_millis(30))
                .await
                .unwrap()
                .is_none()
        );
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
        assert!(gs_version("TinyUF2 Bootloader 0.35.0").is_none());
    }
}
