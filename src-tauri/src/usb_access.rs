use crate::error::HostError;
use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupStatus {
    installed: bool,
    can_authenticate: bool,
    terminal_command: String,
}

#[cfg(target_os = "linux")]
mod linux {
    use super::{HostError, SetupStatus};
    use std::{fs, path::Path, process::Command, sync::Mutex};

    const RULE_NAME: &str = "70-cats-devices.rules";
    const RULE: &str = include_str!("../resources/70-cats-devices.rules");
    const PKEXEC: &str = "/usr/bin/pkexec";
    static INSTALL: Mutex<()> = Mutex::new(());

    // Only the embedded rule is installed. The administrator command accepts no UI arguments.
    const SCRIPT: &str = concat!(
        "set -eu\n",
        "export PATH=/usr/sbin:/usr/bin:/sbin:/bin\n",
        "dir=/etc/udev/rules.d\n",
        "mkdir -p -- \"$dir\"\n",
        "temp=$(mktemp \"$dir/.cats-device-rules.XXXXXXXX\")\n",
        "trap 'rm -f -- \"$temp\"' EXIT\n",
        "cat > \"$temp\" <<'CATS_DEVICE_RULE'\n",
        include_str!("../resources/70-cats-devices.rules"),
        "CATS_DEVICE_RULE\n",
        "chmod 0644 \"$temp\"\n",
        "mv -fT -- \"$temp\" \"$dir/70-cats-devices.rules\"\n",
        "udevadm control --reload-rules\n",
    );

    fn installed() -> bool {
        ["/etc", "/run", "/usr/local/lib", "/usr/lib"]
            .into_iter()
            .map(|directory| Path::new(directory).join("udev/rules.d").join(RULE_NAME))
            .find(|path| fs::symlink_metadata(path).is_ok())
            .is_some_and(|path| fs::read_to_string(path).ok().as_deref() == Some(RULE))
    }

    pub fn status() -> SetupStatus {
        SetupStatus {
            installed: installed(),
            can_authenticate: Path::new(PKEXEC).is_file(),
            terminal_command: format!("sudo /bin/sh <<'CATS_USB_SETUP'\n{SCRIPT}CATS_USB_SETUP\n"),
        }
    }

    pub fn enable() -> Result<(), HostError> {
        let _guard = INSTALL.try_lock().map_err(|_| {
            HostError::new("usb_setup_busy", "USB access setup is already running.")
        })?;
        let output = Command::new(PKEXEC)
            .args(["--disable-internal-agent", "/bin/sh", "-c", SCRIPT])
            .env_remove("LD_LIBRARY_PATH")
            .env_remove("LD_PRELOAD")
            .output()
            .map_err(|_| auth_error())?;
        match output.status.code() {
            Some(0) if installed() => Ok(()),
            Some(126) => Err(HostError::new(
                "usb_setup_cancelled",
                "Administrator authentication was cancelled.",
            )),
            Some(127) => Err(auth_error()),
            _ => Err(HostError::new(
                "usb_setup_failed",
                format!(
                    "Linux could not finish USB setup. {}",
                    String::from_utf8_lossy(&output.stderr).trim()
                ),
            )),
        }
    }

    fn auth_error() -> HostError {
        HostError::new(
            "usb_setup_auth_unavailable",
            "Could not open an administrator prompt. Use the Terminal command below.",
        )
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use std::{io::Write, process::Stdio};

        #[test]
        fn terminal_setup_embeds_the_rule_and_is_valid_shell() {
            let command = status().terminal_command;
            assert!(command.contains(RULE));
            let mut syntax_check = Command::new("/bin/sh")
                .arg("-n")
                .stdin(Stdio::piped())
                .spawn()
                .unwrap();
            syntax_check
                .stdin
                .take()
                .unwrap()
                .write_all(SCRIPT.as_bytes())
                .unwrap();
            assert!(syntax_check.wait().unwrap().success());
        }
    }
}

#[tauri::command]
pub fn app_usb_access_status() -> Option<SetupStatus> {
    #[cfg(target_os = "linux")]
    return Some(linux::status());
    #[cfg(not(target_os = "linux"))]
    None
}

#[tauri::command]
pub async fn app_enable_usb_access() -> Result<(), HostError> {
    #[cfg(target_os = "linux")]
    return tauri::async_runtime::spawn_blocking(linux::enable)
        .await
        .map_err(|error| HostError::new("usb_setup_failed", error.to_string()))?;
    #[cfg(not(target_os = "linux"))]
    Err(HostError::new(
        "usb_setup_unavailable",
        "USB access setup is available on Linux.",
    ))
}
