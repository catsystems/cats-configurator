//! Only real mounted FAT USB volumes may be firmware destinations. In
//! particular, a stale /media or /Volumes directory is not a recovery drive.
use crate::error::HostError;
use std::path::PathBuf;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Volume {
    pub root: PathBuf,
    pub identity: String,
}

pub async fn mounted() -> Result<Vec<Volume>, HostError> {
    #[cfg(target_os = "macos")]
    {
        macos().await
    }
    #[cfg(not(target_os = "macos"))]
    {
        tokio::task::spawn_blocking(platform_volumes)
            .await
            .map_err(|e| error(e.to_string()))?
    }
}
fn error(message: impl Into<String>) -> HostError {
    HostError::new("firmware_volumes", message)
}

#[cfg(windows)]
fn platform_volumes() -> Result<Vec<Volume>, HostError> {
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn SetThreadErrorMode(mode: u32, previous: *mut u32) -> i32;
        fn GetDriveTypeW(root: *const u16) -> u32;
        fn GetVolumeInformationW(
            root: *const u16,
            name: *mut u16,
            name_len: u32,
            serial: *mut u32,
            max_component: *mut u32,
            flags: *mut u32,
            filesystem: *mut u16,
            filesystem_len: u32,
        ) -> i32;
    }
    // Empty removable-media readers must not show a Windows modal error dialog.
    // This worker has no early returns between setting and restoring its mode.
    let mut previous_mode = 0;
    let changed_mode = unsafe { SetThreadErrorMode(1, &mut previous_mode) != 0 };
    let mut result = Vec::new();
    for letter in 'A'..='Z' {
        let root = PathBuf::from(format!("{letter}:\\"));
        let wide: Vec<u16> = root.as_os_str().encode_wide().chain(Some(0)).collect();
        let mut serial = 0;
        let mut filesystem = [0u16; 32];
        // The API writes only to the supplied, correctly sized local buffers.
        let valid = unsafe {
            GetDriveTypeW(wide.as_ptr()) == 2
                && GetVolumeInformationW(
                    wide.as_ptr(),
                    std::ptr::null_mut(),
                    0,
                    &mut serial,
                    std::ptr::null_mut(),
                    std::ptr::null_mut(),
                    filesystem.as_mut_ptr(),
                    filesystem.len() as u32,
                ) != 0
        };
        let end = filesystem
            .iter()
            .position(|c| *c == 0)
            .unwrap_or(filesystem.len());
        if valid && String::from_utf16_lossy(&filesystem[..end]).starts_with("FAT") {
            result.push(Volume {
                identity: format!("{letter}:{serial:08x}"),
                root,
            });
        }
    }
    if changed_mode {
        unsafe { SetThreadErrorMode(previous_mode, std::ptr::null_mut()) };
    }
    Ok(result)
}

#[cfg(any(target_os = "linux", test))]
fn unescape_mount(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    let mut result = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'\\' {
            let escape = bytes.get(i + 1..i + 4)?;
            if !escape.iter().all(|b| (b'0'..=b'7').contains(b)) {
                return None;
            }
            let value = (escape[0] - b'0') as u16 * 64
                + (escape[1] - b'0') as u16 * 8
                + (escape[2] - b'0') as u16;
            if value == 0 || value > 255 {
                return None;
            }
            result.push(value as u8);
            i += 4;
        } else {
            result.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(result).ok()
}

#[cfg(any(target_os = "linux", test))]
fn linux_mount(line: &str) -> Option<(Volume, String)> {
    let (mount, filesystem) = line.split_once(" - ")?;
    let m: Vec<_> = mount.split_whitespace().collect();
    let f: Vec<_> = filesystem.split_whitespace().collect();
    if m.len() < 6
        || f.len() < 3
        || f[0] != "vfat"
        || m[3] != "/"
        || !m[5].split(',').any(|o| o == "rw")
        || !f[2].split(',').any(|o| o == "rw")
        || !f[1].starts_with("/dev/")
    {
        return None;
    }
    let (major, minor) = m[2].split_once(':')?;
    major.parse::<u32>().ok()?;
    minor.parse::<u32>().ok()?;
    m[0].parse::<u32>().ok()?;
    let decoded = unescape_mount(m[4])?;
    if !decoded.starts_with('/') || decoded == "/" {
        return None;
    }
    let root = PathBuf::from(decoded);
    Some((
        Volume {
            root,
            identity: format!("{}:{}", m[0], m[2]),
        },
        m[2].into(),
    ))
}

#[cfg(target_os = "linux")]
fn platform_volumes() -> Result<Vec<Volume>, HostError> {
    let mounts =
        std::fs::read_to_string("/proc/self/mountinfo").map_err(|e| error(e.to_string()))?;
    let mut result = Vec::new();
    for (mut volume, number) in mounts.lines().filter_map(linux_mount) {
        let Ok(device) = std::fs::canonicalize(format!("/sys/dev/block/{number}")) else {
            continue;
        };
        let Some(usb) = device
            .ancestors()
            .find(|path| path.join("idVendor").is_file() && path.join("idProduct").is_file())
        else {
            continue;
        };
        if std::fs::symlink_metadata(&volume.root)
            .is_ok_and(|m| m.is_dir() && !m.file_type().is_symlink())
        {
            volume.identity.push_str(&format!(":{}", usb.display()));
            result.push(volume);
        }
    }
    Ok(result)
}

#[cfg(any(target_os = "macos", test))]
fn mac_volume(root: PathBuf, bytes: &[u8]) -> Option<Volume> {
    let value = plist::Value::from_reader_xml(bytes).ok()?;
    let info = value.as_dictionary()?;
    let string = |key: &str| info.get(key)?.as_string();
    let writable = info
        .get("Writable")
        .and_then(plist::Value::as_boolean)
        .or_else(|| {
            info.get("ReadOnlyVolume")
                .and_then(plist::Value::as_boolean)
                .map(|b| !b)
        });
    if string("BusProtocol")? != "USB"
        || string("FilesystemType")? != "msdos"
        || writable != Some(true)
        || info
            .get("ReadOnlyVolume")
            .and_then(plist::Value::as_boolean)
            == Some(true)
        || std::path::Path::new(string("MountPoint")?) != root
    {
        return None;
    }
    Some(Volume {
        identity: format!(
            "{}:{}",
            string("DeviceIdentifier")?,
            string("VolumeUUID").unwrap_or("")
        ),
        root,
    })
}

#[cfg(target_os = "macos")]
async fn macos() -> Result<Vec<Volume>, HostError> {
    use std::time::Duration;
    // macOS automounts removable media directly under /Volumes. diskutil is a
    // fixed, read-only system query; renderer input never becomes an argument.
    let mut entries = tokio::fs::read_dir("/Volumes")
        .await
        .map_err(|e| error(e.to_string()))?;
    let mut result = Vec::new();
    while let Some(entry) = entries
        .next_entry()
        .await
        .map_err(|e| error(e.to_string()))?
    {
        if !entry
            .file_type()
            .await
            .is_ok_and(|t| t.is_dir() && !t.is_symlink())
        {
            continue;
        }
        let output = tokio::time::timeout(
            Duration::from_secs(5),
            tokio::process::Command::new("/usr/sbin/diskutil")
                .args(["info", "-plist"])
                .arg(entry.path())
                .kill_on_drop(true)
                .output(),
        )
        .await
        .map_err(|_| error("macOS disk discovery timed out. Close disk utilities and retry."))?
        .map_err(|e| error(e.to_string()))?;
        if output.status.success() && output.stdout.len() <= 128 * 1024 {
            if let Some(volume) = mac_volume(entry.path(), &output.stdout) {
                result.push(volume);
            }
        }
    }
    Ok(result)
}

#[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
fn platform_volumes() -> Result<Vec<Volume>, HostError> {
    Ok(Vec::new())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn linux_only_accepts_writable_fat_mount_roots_and_decodes_spaces() {
        let good = "123 40 8:17 / /media/user/CATS\\040GS rw,nosuid - vfat /dev/sdb1 rw";
        let (volume, number) = linux_mount(good).unwrap();
        assert_eq!(volume.root, PathBuf::from("/media/user/CATS GS"));
        assert_eq!(number, "8:17");
        for bad in [
            good.replace("vfat", "ext4"),
            good.replace("rw,nosuid", "ro,nosuid"),
            good.replace("/ /media", "/folder /media"),
            good.replace("/dev/sdb1", "tmpfs"),
            good.replace("\\040", "\\999"),
        ] {
            assert!(linux_mount(&bad).is_none());
        }
        assert_ne!(
            linux_mount(good).unwrap().0.identity,
            linux_mount(&good.replacen("123", "124", 1))
                .unwrap()
                .0
                .identity
        );
    }
    #[test]
    fn macos_rejects_regular_folders_internal_and_read_only_disks() {
        let xml = r#"<?xml version="1.0"?><plist version="1.0"><dict><key>BusProtocol</key><string>USB</string><key>FilesystemType</key><string>msdos</string><key>Writable</key><true/><key>MountPoint</key><string>/Volumes/CATS</string><key>DeviceIdentifier</key><string>disk3s1</string></dict></plist>"#;
        let root = PathBuf::from("/Volumes/CATS");
        assert!(mac_volume(root.clone(), xml.as_bytes()).is_some());
        for invalid in [
            xml.replace("USB", "PCI-Express"),
            xml.replace("msdos", "apfs"),
            xml.replace("<true/>", "<false/>"),
            xml.replace("</dict>", "<key>ReadOnlyVolume</key><true/></dict>"),
        ] {
            assert!(mac_volume(root.clone(), invalid.as_bytes()).is_none());
        }
        assert!(mac_volume(root.join("folder"), xml.as_bytes()).is_none());
    }
}
