pub mod assets;
mod dfu;
mod hardware;
mod telemetry;
mod volumes;

#[cfg(test)]
mod acceptance;

use semver::Version;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};
use tokio::{
    io::AsyncWriteExt,
    sync::Notify,
    time::{Instant, sleep},
};
use uuid::Uuid;

use crate::{
    error::HostError,
    events::EventBus,
    serial::{CommandOptions, SerialManager, SerialPortSummary},
};
use assets::{Asset, Target};
use dfu::Dfu;
use hardware::RecoveryDrive;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Device {
    pub id: String,
    pub target: Target,
    pub label: String,
    pub mode: String,
    pub version: Option<String>,
    pub version_source: String,
    pub notice: Option<String>,
    #[serde(skip)]
    port: Option<SerialPortSummary>,
    #[serde(skip)]
    drive: Option<RecoveryDrive>,
    #[serde(skip)]
    telemetry_drive: Option<telemetry::Drive>,
    pub telemetry_versions: Option<[Option<String>; 2]>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub revision: u64,
    pub busy: bool,
    pub cancellable: bool,
    pub stage: String,
    pub progress: Option<u8>,
    pub message: String,
    pub error: Option<HostError>,
    pub failed_stage: Option<String>,
    pub can_retry: bool,
    pub retry_connection_only: bool,
    pub devices: Vec<Device>,
    pub available: Vec<Asset>,
    pub telemetry_version: Option<String>,
    pub platform_supported: bool,
    pub hardware_test: bool,
}
impl Default for Snapshot {
    fn default() -> Self {
        Self {
            revision: 0,
            busy: false,
            cancellable: false,
            stage: "idle".into(),
            progress: None,
            message: "Check for connected devices and official firmware releases.".into(),
            error: None,
            failed_stage: None,
            can_retry: false,
            retry_connection_only: false,
            devices: Vec::new(),
            available: Vec::new(),
            telemetry_version: None,
            platform_supported: platform_enabled(),
            hardware_test: cfg!(feature = "firmware-hardware-test"),
        }
    }
}

fn platform_enabled() -> bool {
    cfg!(windows)
        || cfg!(all(
            feature = "firmware-hardware-test",
            any(target_os = "macos", target_os = "linux")
        ))
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StartRequest {
    pub device_id: String,
    pub asset_id: u64,
    pub no_unsaved_changes: bool,
    pub safety_confirmed: bool,
    pub reinstall_confirmed: bool,
    pub unknown_version_confirmed: bool,
}

#[derive(Clone)]
struct Job {
    device: Device,
    asset: Asset,
    request: StartRequest,
    dfu: Option<Dfu>,
    awaiting_reconnect: bool,
    before_ports: Vec<SerialPortSummary>,
}

pub struct FirmwareManager {
    events: Arc<EventBus>,
    serial: Arc<SerialManager>,
    snapshot: Mutex<Snapshot>,
    job: Mutex<Option<Job>>,
    cache: Mutex<Option<PathBuf>>,
    cache_hashes: Mutex<HashMap<u64, String>>,
    cancelled: AtomicBool,
    cancel_notify: Notify,
}

impl FirmwareManager {
    pub fn new(events: Arc<EventBus>, serial: Arc<SerialManager>) -> Self {
        Self {
            events,
            serial,
            snapshot: Mutex::new(Snapshot::default()),
            job: Mutex::new(None),
            cache: Mutex::new(None),
            cache_hashes: Mutex::new(HashMap::new()),
            cancelled: AtomicBool::new(false),
            cancel_notify: Notify::new(),
        }
    }
    pub fn set_cache(&self, directory: PathBuf) {
        *self.cache.lock().unwrap() = Some(directory.join("firmware"));
    }
    pub fn current(&self) -> Snapshot {
        self.snapshot.lock().unwrap().clone()
    }
    pub fn busy(&self) -> bool {
        self.serial.firmware_active.load(Ordering::SeqCst)
    }
    fn emit(&self) {
        self.snapshot.lock().unwrap().revision += 1;
        self.events.send(
            "firmware:state",
            serde_json::to_value(self.current()).unwrap(),
        );
    }
    fn stage(&self, stage: &str, message: &str, cancellable: bool) {
        {
            let mut state = self.snapshot.lock().unwrap();
            state.stage = stage.into();
            state.message = message.into();
            state.cancellable = cancellable;
            state.progress = None;
        }
        self.emit();
    }
    fn begin(&self) -> Result<(), HostError> {
        self.serial.reserve_firmware()?;
        self.cancelled.store(false, Ordering::SeqCst);
        {
            let mut state = self.snapshot.lock().unwrap();
            state.busy = true;
            state.error = None;
            state.failed_stage = None;
            state.can_retry = false;
            state.retry_connection_only = false;
        }
        Ok(())
    }
    fn finish(&self, result: Result<(), HostError>) {
        {
            let mut state = self.snapshot.lock().unwrap();
            state.busy = false;
            state.cancellable = false;
            state.progress = None;
            match result {
                Ok(()) => {
                    if state.stage != "prepared" {
                        state.stage = "succeeded".into();
                    }
                }
                Err(error) if error.code == "firmware_cancelled" => {
                    state.stage = "cancelled".into();
                    state.message =
                        "Cancelled before the device transition or file copy. No firmware was written.".into();
                }
                Err(error) => {
                    if error.code == "firmware_verification" {
                        state.stage = "verifying".into();
                    }
                    state.failed_stage = Some(state.stage.clone());
                    state.message = recovery_message(&state.stage).into();
                    state.stage = "failed".into();
                    state.error = Some(error);
                    let job = self.job.lock().unwrap();
                    state.can_retry = job.is_some();
                    state.retry_connection_only =
                        job.as_ref().is_some_and(|job| job.awaiting_reconnect);
                }
            }
        }
        self.serial.firmware_active.store(false, Ordering::SeqCst);
        self.emit();
    }
    fn check_cancelled(&self) -> Result<(), HostError> {
        if self.cancelled.load(Ordering::SeqCst) {
            Err(HostError::new(
                "firmware_cancelled",
                "Firmware operation cancelled.",
            ))
        } else {
            Ok(())
        }
    }
    async fn cancellation(&self) -> HostError {
        // Register before checking the flag so an accepted cancellation cannot
        // be lost between spawning the job and polling its cancellation branch.
        loop {
            let notified = self.cancel_notify.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();
            if let Err(error) = self.check_cancelled() {
                return error;
            }
            notified.await;
        }
    }
    pub fn cancel(&self) -> Result<Snapshot, HostError> {
        let state = self.snapshot.lock().unwrap();
        if !state.busy || !state.cancellable {
            return Err(HostError::new(
                "firmware_not_cancellable",
                "A device transition or write cannot be interrupted.",
            ));
        }
        self.cancelled.store(true, Ordering::SeqCst);
        self.cancel_notify.notify_waiters();
        Ok(state.clone())
    }

    pub fn check(self: &Arc<Self>) -> Result<Snapshot, HostError> {
        self.begin()?;
        *self.job.lock().unwrap() = None;
        self.stage(
            "checking",
            "Detecting devices and checking official stable releases…",
            true,
        );
        let manager = Arc::clone(self);
        tauri::async_runtime::spawn(async move {
            let result = tokio::select! {
                result=manager.refresh() => result,
                error=manager.cancellation() => Err(error),
            };
            manager.finish(result);
        });
        Ok(self.current())
    }
    async fn refresh(&self) -> Result<(), HostError> {
        self.check_cancelled()?;
        let (devices, available) = tokio::join!(self.discover(), assets::releases());
        let (devices, telemetry) = devices?;
        {
            let mut state = self.snapshot.lock().unwrap();
            state.devices = devices;
            state.telemetry_version = telemetry;
        }
        let available = available?;
        {
            let mut state = self.snapshot.lock().unwrap();
            state.available = available;
            state.message="Release check complete. Components without a versioned official asset are unavailable.".into();
        }
        Ok(())
    }

    async fn discover(&self) -> Result<(Vec<Device>, Option<String>), HostError> {
        let ports = SerialManager::list()?;
        let connected = self.serial.connected_path().await;
        let mut devices = Vec::new();
        let mut telemetry = None;
        for port in ports
            .into_iter()
            .filter(|p| hardware::vega_port(p) || hardware::gs_port(p))
        {
            self.check_cancelled()?;
            let target = if hardware::vega_port(&port) {
                Target::Vega
            } else {
                Target::GroundStation
            };
            let mut device = Device {
                id: Uuid::new_v4().to_string(),
                target,
                label: format!(
                    "{} ({})",
                    if target == Target::Vega {
                        "Vega"
                    } else {
                        "Ground Station"
                    },
                    port.path
                ),
                mode: "application".into(),
                version: None,
                version_source: "unknown".into(),
                notice: None,
                port: Some(port.clone()),
                drive: None,
                telemetry_drive: None,
                telemetry_versions: None,
            };
            if target == Target::Vega && connected.as_deref() == Some(&port.path) {
                match self.vega_versions().await {
                    Ok((version, tele)) => {
                        device.version = version;
                        telemetry = tele;
                        device.version_source = "serial".into();
                    }
                    Err(error) => device.notice = Some(error.message),
                }
            } else if target == Target::GroundStation {
                match hardware::read_gs_file().await {
                    Ok(Some(version)) => {
                        device.version = Some(version);
                        device.version_source = "version-json".into();
                    }
                    Ok(None) => {
                        device.notice =
                            Some("Mount the Ground Station USB drive to read version.json.".into())
                    }
                    Err(error) => device.notice = Some(error.message),
                }
            }
            devices.push(device);
        }
        for drive in hardware::recovery_drives().await? {
            devices.push(Device {
                id: Uuid::new_v4().to_string(),
                target: Target::GroundStation,
                label: format!("Ground Station recovery ({})", drive.root.display()),
                mode: "recovery".into(),
                version: None,
                version_source: "unknown".into(),
                notice: Some("TinyUF2 recovery: installed application version is unknown.".into()),
                port: None,
                drive: Some(drive),
                telemetry_drive: None,
                telemetry_versions: None,
            });
        }
        for drive in telemetry::drives().await? {
            devices.push(Device {
                id: Uuid::new_v4().to_string(),
                target: Target::Telemetry,
                label: format!("GS radio firmware destination ({})", drive.volume.root.display()),
                mode: "storage".into(),
                version: None,
                version_source: "file-unverified".into(),
                notice: Some("Confirm this is your Ground Station drive. Radio versions are cached in version.json; final installation is confirmed on the Ground Station.".into()),
                port: None,
                drive: None,
                telemetry_versions: Some([drive.versions.telemetry_1.clone(), drive.versions.telemetry_2.clone()]),
                telemetry_drive: Some(drive),
            });
        }
        Ok((devices, telemetry))
    }

    async fn vega_versions(&self) -> Result<(Option<String>, Option<String>), HostError> {
        let lines = self
            .serial
            .execute_for_firmware("version".into(), CommandOptions::default())
            .await?;
        if !lines.iter().any(|line| line.trim() == "Board: CATS Vega") {
            return Err(HostError::new(
                "not_vega",
                "The connected device did not identify itself as CATS Vega.",
            ));
        }
        Ok((
            reported_version(&lines, "Code version:"),
            reported_version(&lines, "Telemetry Code version:"),
        ))
    }

    pub fn start(self: &Arc<Self>, request: StartRequest) -> Result<Snapshot, HostError> {
        if !platform_enabled() {
            return Err(HostError::new(
                "firmware_platform",
                "Firmware flashing on this platform is awaiting hardware acceptance. Windows is the initial target.",
            ));
        }
        let state = self.current();
        let device = state
            .devices
            .iter()
            .find(|d| d.id == request.device_id)
            .cloned()
            .ok_or_else(|| {
                HostError::new(
                    "firmware_device",
                    "Check devices again and select a detected device.",
                )
            })?;
        let asset = state
            .available
            .iter()
            .find(|a| a.id == request.asset_id && a.target == device.target)
            .cloned()
            .ok_or_else(|| {
                HostError::new(
                    "firmware_asset",
                    "Select an available official asset for this device.",
                )
            })?;
        validate_confirmations(&request, device.target)?;
        self.begin()?;
        *self.job.lock().unwrap() = Some(Job {
            device,
            asset,
            request,
            dfu: None,
            awaiting_reconnect: false,
            before_ports: Vec::new(),
        });
        self.spawn_update();
        Ok(self.current())
    }
    pub fn retry(self: &Arc<Self>) -> Result<Snapshot, HostError> {
        if !self.current().can_retry || self.job.lock().unwrap().is_none() {
            return Err(HostError::new(
                "firmware_retry",
                "No failed firmware operation is available to retry.",
            ));
        }
        self.begin()?;
        self.spawn_update();
        Ok(self.current())
    }
    fn spawn_update(self: &Arc<Self>) {
        if self
            .job
            .lock()
            .unwrap()
            .as_ref()
            .unwrap()
            .awaiting_reconnect
        {
            self.stage(
                "reconnecting",
                "Retrying the running-version check; firmware will not be rewritten.",
                false,
            );
        } else {
            self.stage(
                "preparing",
                "Checking device safety and preparing the validated firmware…",
                true,
            );
        }
        let manager = Arc::clone(self);
        tauri::async_runtime::spawn(async move {
            let mut job = manager.job.lock().unwrap().clone().unwrap();
            if job.awaiting_reconnect {
                // A verified write must not be repeated just because startup
                // reporting was late or the USB connection temporarily failed.
                let result = manager.reconnect(&mut job).await;
                *manager.job.lock().unwrap() = Some(job);
                manager.finish(result);
                return;
            }
            let prepared = tokio::select! {
                result=manager.prepare(&mut job)=>result,
                error=manager.cancellation()=>Err(error),
            };
            let result = match prepared {
                Ok(bytes) => match manager.check_cancelled() {
                    Ok(()) => manager.update_device(&mut job, bytes).await,
                    Err(error) => Err(error),
                },
                Err(error) => Err(error),
            };
            *manager.job.lock().unwrap() = Some(job);
            manager.finish(result);
        });
    }

    async fn prepare(&self, job: &mut Job) -> Result<Vec<u8>, HostError> {
        self.check_cancelled()?;
        validate_confirmations(&job.request, job.device.target)?;
        if job.device.target == Target::Telemetry {
            let drive = job.device.telemetry_drive.as_ref().ok_or_else(|| {
                HostError::new(
                    "telemetry_staging",
                    "Check devices and select the Ground Station drive.",
                )
            })?;
            telemetry::check_drive(drive).await?;
            telemetry_version_policy(&drive.versions, &job.asset.version, &job.request)?;
            return self.download(&job.asset).await;
        }
        if job.dfu.is_none() && job.device.mode != "recovery" {
            let original = job.device.port.as_ref().ok_or_else(|| {
                HostError::new("firmware_device", "Application device identity is missing.")
            })?;
            let port = unique_port(original)?;
            let installed = if job.device.target == Target::Vega {
                if self.serial.connected_path().await.as_deref() != Some(&port.path) {
                    self.serial.connect_for_firmware(port.path.clone()).await?;
                }
                let (version, telemetry) = self.vega_versions().await?;
                self.snapshot.lock().unwrap().telemetry_version = telemetry;
                let status = self
                    .serial
                    .execute_for_firmware("status".into(), CommandOptions::default())
                    .await?;
                safe_vega_status(&status)?;
                version
            } else {
                hardware::read_gs_file().await?
            };
            job.device.version = installed;
            job.device.version_source = if job.device.version.is_some() {
                if job.device.target == Target::GroundStation {
                    "version-json"
                } else {
                    "serial"
                }
            } else {
                "unknown"
            }
            .into();
            job.device.port = Some(port);
            {
                let mut state = self.snapshot.lock().unwrap();
                if let Some(device) = state.devices.iter_mut().find(|d| d.id == job.device.id) {
                    *device = job.device.clone();
                }
            }
            self.emit();
            version_policy(
                job.device.version.as_deref(),
                &job.asset.version,
                &job.request,
            )?;
        } else if job.dfu.is_none() {
            // Retain the checked version established before a failed GS copy.
            // Entering recovery does not revoke that retry approval.
            let installed = job.device.version.as_deref().filter(|_| {
                matches!(
                    job.device.version_source.as_str(),
                    "serial" | "version-json"
                )
            });
            version_policy(installed, &job.asset.version, &job.request)?;
        }
        self.download(&job.asset).await
    }

    async fn download(&self, asset: &Asset) -> Result<Vec<u8>, HostError> {
        let root =
            self.cache.lock().unwrap().clone().ok_or_else(|| {
                HostError::new("firmware_cache", "Firmware cache is unavailable.")
            })?;
        tokio::fs::create_dir_all(&root)
            .await
            .map_err(cache_error)?;
        if std::fs::symlink_metadata(&root)
            .map_err(cache_error)?
            .file_type()
            .is_symlink()
        {
            return Err(cache_error("Firmware cache must not be a link."));
        }
        let path = root.join(format!("{}-{}", asset.id, asset.name));
        if let Ok(metadata) = std::fs::symlink_metadata(&path) {
            if !metadata.is_file() || metadata.file_type().is_symlink() {
                return Err(cache_error("Unsafe cache entry."));
            }
            if metadata.len() == asset.size {
                let bytes = tokio::fs::read(&path).await.map_err(cache_error)?;
                let known_digest = asset.digest.is_some()
                    || self
                        .cache_hashes
                        .lock()
                        .unwrap()
                        .get(&asset.id)
                        .is_some_and(|expected| *expected == assets::hash(&bytes));
                if known_digest && assets::validate(asset, &bytes).is_ok() {
                    return Ok(bytes);
                }
            }
            tokio::fs::remove_file(&path).await.map_err(cache_error)?;
        }
        self.stage(
            "downloading",
            "Downloading firmware from the official GitHub release…",
            true,
        );
        let mut response = assets::client(true)?
            .get(&asset.url)
            .send()
            .await
            .and_then(reqwest::Response::error_for_status)
            .map_err(|e| HostError::new("firmware_download", e.to_string()))?;
        if response
            .content_length()
            .is_some_and(|length| length != asset.size)
        {
            return Err(assets::error(
                "Download Content-Length differs from the release asset.",
            ));
        }
        let mut bytes = Vec::with_capacity(asset.size as usize);
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|e| HostError::new("firmware_download", e.to_string()))?
        {
            self.check_cancelled()?;
            if bytes.len() + chunk.len() > asset.size as usize {
                return Err(assets::error(
                    "Firmware download exceeds the expected size.",
                ));
            }
            bytes.extend_from_slice(&chunk);
            self.snapshot.lock().unwrap().progress =
                Some((bytes.len() as u64 * 100 / asset.size) as u8);
            self.emit();
        }
        self.stage(
            "validating",
            "Validating firmware structure and digest…",
            true,
        );
        assets::validate(asset, &bytes)?;
        self.cache_hashes
            .lock()
            .unwrap()
            .insert(asset.id, assets::hash(&bytes));
        let temporary = root.join(format!("{}.part", Uuid::new_v4()));
        let mut file = tokio::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .await
            .map_err(cache_error)?;
        file.write_all(&bytes).await.map_err(cache_error)?;
        file.flush().await.map_err(cache_error)?;
        file.sync_all().await.map_err(cache_error)?;
        drop(file);
        tokio::fs::rename(temporary, &path)
            .await
            .map_err(cache_error)?;
        Ok(bytes)
    }

    async fn update_device(&self, job: &mut Job, bytes: Vec<u8>) -> Result<(), HostError> {
        // No cancellable future or process termination is allowed beyond this boundary.
        {
            let mut state = self.snapshot.lock().unwrap();
            self.check_cancelled()?;
            state.stage = "awaiting-bootloader".into();
            state.message = "Entering recovery mode. Keep the device connected.".into();
            state.cancellable = false;
            state.progress = None;
        }
        self.emit();
        match job.device.target {
            Target::Vega => self.update_vega(job, &bytes).await,
            Target::GroundStation => self.update_gs(job, &bytes).await,
            Target::Telemetry => {
                self.stage("staging-telemetry", "Copying, flushing and reading back the telemetry image on the Ground Station drive…", false);
                let drive = job.device.telemetry_drive.as_ref().ok_or_else(|| {
                    HostError::new("telemetry_staging", "Ground Station drive is missing.")
                })?;
                telemetry::stage(drive, &job.asset, &bytes).await?;
                self.stage("prepared", &format!(
                    "{} is ready in telemetry_firmware. Safely eject the Ground Station drive, then open Settings → Update Firmware → Radio Receivers on the Ground Station and select this file. Both radios are updated there; check the result on its screen. Firmware has not been installed by Configurator.",
                    job.asset.name
                ), false);
                Ok(())
            }
        }
    }
    async fn update_vega(&self, job: &mut Job, bytes: &[u8]) -> Result<(), HostError> {
        let device = if let Some(previous) = &job.dfu {
            let matches: Vec<_> = dfu::list()
                .await?
                .into_iter()
                .filter(|d| d.serial == previous.serial)
                .collect();
            exactly_one(
                matches,
                "Reconnect the same Vega in DFU mode before retrying.",
            )?
        } else {
            let original = job.device.port.as_ref().unwrap();
            unique_port(original)?;
            // Recheck immediately before the transition, after any download delay.
            safe_vega_status(
                &self
                    .serial
                    .execute_for_firmware("status".into(), CommandOptions::default())
                    .await?,
            )?;
            let before = dfu::list().await?;
            let result = self
                .serial
                .execute_for_firmware(
                    "bl".into(),
                    CommandOptions {
                        timeout: Duration::from_secs(5),
                        retries: 0,
                        ..Default::default()
                    },
                )
                .await;
            self.serial.disconnect_for_firmware().await;
            if let Err(error) = result {
                if !matches!(
                    error.code,
                    "serial_disconnected"
                        | "serial_read_failed"
                        | "serial_write_failed"
                        | "board_timeout"
                ) {
                    return Err(error);
                }
            }
            let deadline = Instant::now() + Duration::from_secs(30);
            loop {
                let found: Vec<_> = dfu::list()
                    .await?
                    .into_iter()
                    .filter(|d| !before.iter().any(|b| b.serial == d.serial))
                    .collect();
                let application_present = SerialManager::list()?
                    .iter()
                    .any(|port| hardware::same_port(original, port));
                if !found.is_empty() && !application_present {
                    break exactly_one(
                        found,
                        "Multiple new DFU devices detected; no firmware was written.",
                    )?;
                }
                if Instant::now() >= deadline {
                    return Err(HostError::new(
                        "dfu_timeout",
                        "Vega did not appear as one new DFU device. No firmware was written.",
                    ));
                }
                sleep(Duration::from_millis(500)).await;
            }
        };
        job.dfu = Some(device.clone());
        self.stage(
            "opening-dfu",
            "Checking Vega's USB DFU interface and flash capacity…",
            false,
        );
        dfu::flash(&device, bytes, |stage, progress| {
            {
                let mut state = self.snapshot.lock().unwrap();
                if state.stage == stage && state.progress == Some(progress) {
                    return;
                }
                state.stage = stage.into();
                state.progress = Some(progress);
                state.message = match stage {
                    "erasing" => "Erasing Vega application sectors. Do not disconnect or reset it.",
                    "programming" => "Writing Vega firmware. Do not disconnect or reset it.",
                    "verifying" => "Reading back Vega firmware and verifying every byte…",
                    _ => "Image verification passed; starting the verified application…",
                }
                .into();
            }
            self.emit();
        })
        .await?;
        job.dfu = None;
        job.awaiting_reconnect = true;
        self.reconnect(job).await
    }

    async fn reconnect(&self, job: &mut Job) -> Result<(), HostError> {
        self.stage(
            "reconnecting",
            "Waiting for the device and checking its running firmware version…",
            false,
        );
        match job.device.target {
            Target::Vega => self.reconnect_vega(job).await,
            Target::GroundStation => self.reconnect_gs(job).await,
            Target::Telemetry => Err(HostError::new(
                "telemetry_on_device",
                "Confirm both radio update results on the Ground Station. Configurator only prepares the firmware file.",
            )),
        }
    }
    async fn reconnect_vega(&self, job: &mut Job) -> Result<(), HostError> {
        self.stage(
            "reconnecting",
            "Waiting for Vega and checking its running firmware version…",
            false,
        );
        let original = job.device.port.as_ref().unwrap();
        let deadline = Instant::now() + Duration::from_secs(40);
        loop {
            if let Ok(port) = unique_port(original) {
                if self.serial.connected_path().await.as_deref() == Some(&port.path)
                    || self.serial.connect_for_firmware(port.path).await.is_ok()
                {
                    match self.vega_versions().await {
                        Ok((Some(installed), telemetry)) => {
                            verify_running_version(Some(&installed), &job.asset.version)?;
                            self.snapshot.lock().unwrap().telemetry_version = telemetry;
                            self.complete_device(job, Some(installed));
                            return Ok(());
                        }
                        _ => {
                            self.serial.disconnect_for_firmware().await;
                        }
                    }
                }
            }
            if Instant::now() >= deadline {
                return Err(HostError::new(
                    "firmware_reconnect",
                    "The image was verified, but Vega did not reconnect. Reconnect USB and check its version; do not assume the write failed.",
                ));
            }
            sleep(Duration::from_millis(500)).await;
        }
    }

    async fn update_gs(&self, job: &mut Job, bytes: &[u8]) -> Result<(), HostError> {
        let before_ports: Vec<_> = SerialManager::list()?
            .into_iter()
            .filter(hardware::gs_port)
            .collect();
        job.before_ports = before_ports.clone();
        let drive = if let Some(expected) = &job.device.drive {
            let drives = hardware::recovery_drives().await?;
            if drives.len() != 1 || &drives[0] != expected {
                return Err(HostError::new(
                    "gs_drive_changed",
                    "Connect only the selected Ground Station recovery drive, then retry.",
                ));
            }
            expected.clone()
        } else {
            let port = unique_port(job.device.port.as_ref().unwrap())?;
            if before_ports.len() != 1 {
                return Err(HostError::new(
                    "firmware_ambiguous",
                    "Disconnect other Ground Stations before entering TinyUF2.",
                ));
            }
            let before = hardware::recovery_drives().await?;
            hardware::enter_gs(&port).await?;
            let deadline = Instant::now() + Duration::from_secs(30);
            loop {
                let found: Vec<_> = hardware::recovery_drives()
                    .await?
                    .into_iter()
                    .filter(|d| !before.contains(d))
                    .collect();
                let application_present = SerialManager::list()?
                    .iter()
                    .any(|candidate| hardware::same_port(&port, candidate));
                if !found.is_empty() && !application_present {
                    break exactly_one(
                        found,
                        "Multiple new TinyUF2 drives appeared; no firmware was copied.",
                    )?;
                }
                if Instant::now() >= deadline {
                    return Err(HostError::new(
                        "gs_bootloader_timeout",
                        "Ground Station did not enter TinyUF2. Enter Bootloader on the device and check devices again.",
                    ));
                }
                sleep(Duration::from_millis(300)).await;
            }
        };
        job.device.drive = Some(drive.clone());
        job.device.mode = "recovery".into();
        self.stage(
            "copying",
            "Copying and flushing NEW.UF2. Keep Ground Station connected.",
            false,
        );
        hardware::copy_uf2(&drive, bytes).await?;
        // Includes a Windows device-disappeared error at final flush/sync after
        // the full image was submitted. Neither case is success until verified.
        job.awaiting_reconnect = true;
        self.reconnect(job).await
    }

    async fn reconnect_gs(&self, job: &mut Job) -> Result<(), HostError> {
        self.stage(
            "reconnecting",
            "Waiting for Ground Station to restart and expose its refreshed version.json…",
            false,
        );
        let deadline = Instant::now() + Duration::from_secs(45);
        while let Some(drive) = job.device.drive.as_ref() {
            if !hardware::recovery_drives().await?.contains(drive) {
                break;
            }
            if Instant::now() >= deadline {
                return Err(HostError::new(
                    "gs_recovery_timeout",
                    "UF2 image was submitted but the recovery drive did not disconnect. Installation is not verified.",
                ));
            }
            sleep(Duration::from_millis(300)).await;
        }
        job.device.drive = None;
        job.device.mode = "application".into();
        // Give application startup its full allowance after the drive leaves.
        let deadline = Instant::now() + Duration::from_secs(45);
        loop {
            let ports: Vec<_> = SerialManager::list()?
                .into_iter()
                .filter(hardware::gs_port)
                .filter(|port| match &job.device.port {
                    Some(original) => hardware::same_port(original, port),
                    None => !job
                        .before_ports
                        .iter()
                        .any(|old| hardware::same_port(old, port)),
                })
                .collect();
            if !ports.is_empty() {
                let port = exactly_one(
                    ports,
                    "Multiple Ground Stations appeared after the update; installation is not verified.",
                )?;
                job.device.port = Some(port.clone());
                match hardware::read_gs_file().await {
                    Ok(Some(installed)) => {
                        verify_running_version(Some(&installed), &job.asset.version)?;
                        self.complete_device(job, Some(installed));
                        return Ok(());
                    }
                    Ok(None) => {}
                    Err(_) if Instant::now() < deadline => {}
                    Err(error) => return Err(error),
                }
            }
            if Instant::now() >= deadline {
                return Err(HostError::new(
                    "firmware_reconnect",
                    "Ground Station did not expose a refreshed version.json. Mount its USB drive and retry the connection check; installation is not verified.",
                ));
            }
            sleep(Duration::from_millis(500)).await;
        }
    }
    fn complete_device(&self, job: &mut Job, version: Option<String>) {
        job.device.version = version;
        job.device.version_source = if job.device.target == Target::GroundStation {
            "version-json"
        } else {
            "serial"
        }
        .into();
        job.device.notice = None;
        let mut state = self.snapshot.lock().unwrap();
        if let Some(device) = state.devices.iter_mut().find(|d| d.id == job.device.id) {
            *device = job.device.clone();
        }
        state.message = format!(
            "Firmware {} is running and verified by the device.",
            job.asset.version
        );
    }
}

fn cache_error(error: impl std::fmt::Display) -> HostError {
    HostError::new("firmware_cache", error.to_string())
}
fn unique_port(original: &SerialPortSummary) -> Result<SerialPortSummary, HostError> {
    exactly_one(
        SerialManager::list()?
            .into_iter()
            .filter(|p| hardware::same_port(original, p))
            .collect(),
        "The selected device is missing or its USB identity is ambiguous.",
    )
}
fn exactly_one<T>(mut values: Vec<T>, message: &str) -> Result<T, HostError> {
    if values.len() == 1 {
        Ok(values.remove(0))
    } else {
        Err(HostError::new("firmware_ambiguous", message))
    }
}
fn reported_version(lines: &[String], prefix: &str) -> Option<String> {
    lines.iter().find_map(|line| {
        line.trim()
            .strip_prefix(prefix)
            .and_then(|v| Version::parse(v.trim()).ok())
            .map(|v| v.to_string())
    })
}
fn safe_vega_status(lines: &[String]) -> Result<(), HostError> {
    let state = lines
        .iter()
        .find_map(|line| line.trim().strip_prefix("State:").map(str::trim));
    if state == Some("READY") {
        Ok(())
    } else {
        Err(HostError::new(
            "firmware_unsafe",
            "Vega must report READY before updating. Wait for calibration; never update during flight or simulation.",
        ))
    }
}
fn validate_confirmations(request: &StartRequest, _target: Target) -> Result<(), HostError> {
    if !request.no_unsaved_changes || !request.safety_confirmed {
        return Err(HostError::new(
            "firmware_confirmation",
            "Save/discard configurator changes and confirm that deployment charges are disconnected, or that Ground Station tracking/recording has stopped and its files are closed.",
        ));
    }
    Ok(())
}
fn telemetry_version_policy(
    versions: &telemetry::Versions,
    available: &str,
    request: &StartRequest,
) -> Result<(), HostError> {
    // File metadata cannot establish a verified running version. Require that
    // acknowledgement and confirmation of a reinstall reported by either radio.
    version_policy(None, available, request)?;
    for installed in [&versions.telemetry_1, &versions.telemetry_2] {
        version_policy(installed.as_deref(), available, request)?;
    }
    Ok(())
}
fn version_policy(
    installed: Option<&str>,
    available: &str,
    request: &StartRequest,
) -> Result<(), HostError> {
    let available = Version::parse(available)
        .map_err(|_| assets::error("Invalid release firmware version."))?;
    match installed.and_then(|v| Version::parse(v).ok()) {
        Some(version)
            if version.cmp_precedence(&available).is_eq() && !request.reinstall_confirmed =>
        {
            Err(HostError::new(
                "firmware_reinstall_confirmation",
                "Confirm reinstalling the same firmware version.",
            ))
        }
        None if !request.unknown_version_confirmed => Err(HostError::new(
            "firmware_unknown_confirmation",
            "Installed version is unknown. Confirm continuing without a verified installed version.",
        )),
        _ => Ok(()),
    }
}
fn verify_running_version(installed: Option<&str>, expected: &str) -> Result<(), HostError> {
    if installed == Some(expected) {
        Ok(())
    } else {
        Err(HostError::new(
            "firmware_version_mismatch",
            format!(
                "Expected running firmware {expected}; device reported {}. Installation is not verified.",
                installed.unwrap_or("no version")
            ),
        ))
    }
}
fn recovery_message(stage: &str) -> &'static str {
    match stage {
        "staging-telemetry" => {
            "Telemetry preparation failed. Keep the Ground Station drive connected and retry. Do not select a partial file on the device."
        }
        "opening-dfu" | "erasing" | "programming" | "verifying" => {
            "Keep Vega in DFU. Retry the validated firmware; do not reset an unverified image."
        }
        "copying" => {
            "Check the USB connection and TinyUF2 drive, then retry. Do not assume that an interrupted copy installed firmware."
        }
        "reconnecting" => {
            "The device did not confirm the expected running version. Check its USB connection and recovery mode. A connection-only retry does not rewrite firmware."
        }
        "awaiting-bootloader" => {
            "No target was selected safely. Disconnect other devices, enter the correct recovery mode, and check devices again."
        }
        _ => {
            "No firmware write was started. Resolve the reported problem and retry or check devices again."
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn hardware_test_installer_reports_its_platform_gate() {
        let state = Snapshot::default();
        assert_eq!(
            state.hardware_test,
            cfg!(feature = "firmware-hardware-test")
        );
        assert_eq!(
            state.platform_supported,
            cfg!(windows)
                || (state.hardware_test && cfg!(any(target_os = "macos", target_os = "linux")))
        );
    }
    fn request() -> StartRequest {
        StartRequest {
            device_id: "device".into(),
            asset_id: 1,
            no_unsaved_changes: true,
            safety_confirmed: true,
            reinstall_confirmed: false,
            unknown_version_confirmed: false,
        }
    }
    fn recovery_job() -> Job {
        Job {
            device: Device {
                id: "device".into(),
                target: Target::GroundStation,
                label: "Ground Station".into(),
                mode: "recovery".into(),
                version: Some("1.0.0".into()),
                version_source: "serial".into(),
                notice: None,
                port: None,
                drive: None,
                telemetry_drive: None,
                telemetry_versions: None,
            },
            asset: Asset {
                id: 1,
                target: Target::GroundStation,
                version: "1.1.0".into(),
                name: "ground_station-1.1.0.UF2".into(),
                size: 512,
                release_url: String::new(),
                notes: String::new(),
                url: "invalid-url".into(),
                digest: None,
            },
            request: request(),
            dfu: None,
            awaiting_reconnect: false,
            before_ports: Vec::new(),
        }
    }
    #[tokio::test]
    async fn recovery_retry_retains_checked_version_json_approval() {
        let events = Arc::new(EventBus::default());
        let manager = FirmwareManager::new(events.clone(), Arc::new(SerialManager::new(events)));
        let mut job = recovery_job();
        job.device.version_source = "version-json".into();
        // Reaches download without demanding unknown-version confirmation again.
        assert_eq!(
            manager.prepare(&mut job).await.unwrap_err().code,
            "firmware_cache"
        );
        job.device.version_source = "file-unverified".into();
        assert_eq!(
            manager.prepare(&mut job).await.unwrap_err().code,
            "firmware_unknown_confirmation"
        );
        job.device.version_source = "serial".into();
        job.device.version = Some("2.0.0".into());
        // A downgrade also reaches download using the retained checked version.
        assert_eq!(
            manager.prepare(&mut job).await.unwrap_err().code,
            "firmware_cache"
        );
    }
    #[tokio::test]
    async fn reconnect_retry_does_not_prepare_or_download_another_image() {
        let events = Arc::new(EventBus::default());
        let manager = Arc::new(FirmwareManager::new(
            events.clone(),
            Arc::new(SerialManager::new(events)),
        ));
        let mut job = recovery_job();
        job.awaiting_reconnect = true;
        // This target has no connection implementation. It fails immediately,
        // without opening hardware; preparing this job would reach a cache error.
        job.device.target = Target::Telemetry;
        *manager.job.lock().unwrap() = Some(job);
        manager.begin().unwrap();
        manager.spawn_update();
        tokio::time::timeout(Duration::from_secs(2), async {
            while manager.busy() {
                sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .unwrap();
        let state = manager.current();
        assert_eq!(state.error.unwrap().code, "telemetry_on_device");
        assert_eq!(state.failed_stage.as_deref(), Some("reconnecting"));
        assert!(state.can_retry && state.retry_connection_only);
        assert!(!state.cancellable);
    }
    #[tokio::test]
    async fn cancellation_before_the_worker_starts_is_not_lost() {
        let events = Arc::new(EventBus::default());
        let manager = FirmwareManager::new(events.clone(), Arc::new(SerialManager::new(events)));
        manager.begin().unwrap();
        manager.stage("checking", "check", true);
        manager.cancel().unwrap();
        let error = tokio::time::timeout(Duration::from_millis(200), manager.cancellation())
            .await
            .unwrap();
        assert_eq!(error.code, "firmware_cancelled");
        manager.finish(Err(error));
        assert_eq!(manager.current().stage, "cancelled");
        assert!(!manager.busy());
    }
    #[test]
    fn telemetry_checks_both_radios_and_requires_cached_version_acknowledgement() {
        let versions = telemetry::Versions {
            ground_station: "1.3.0".into(),
            telemetry_1: Some("1.1.0".into()),
            telemetry_2: Some("1.2.0".into()),
        };
        let mut req = request();
        assert_eq!(
            telemetry_version_policy(&versions, "1.2.0", &req)
                .unwrap_err()
                .code,
            "firmware_unknown_confirmation"
        );
        req.unknown_version_confirmed = true;
        assert_eq!(
            telemetry_version_policy(&versions, "1.2.0", &req)
                .unwrap_err()
                .code,
            "firmware_reinstall_confirmation"
        );
        req.reinstall_confirmed = true;
        telemetry_version_policy(&versions, "1.2.0", &req).unwrap();
        telemetry_version_policy(&versions, "1.1.0", &req).unwrap();
        req.reinstall_confirmed = false;
        telemetry_version_policy(&versions, "1.0.0", &req).unwrap();
    }

    #[test]
    fn versions_allow_downgrades_and_require_reinstall_and_unknown_confirmation() {
        let mut req = request();
        assert!(version_policy(Some("1.0.0"), "1.1.0", &req).is_ok());
        assert!(version_policy(Some("2.0.0"), "1.1.0", &req).is_ok());
        assert!(version_policy(Some("3.1.0"), "3.0.2", &req).is_ok());
        assert!(version_policy(Some("3.1.0+local"), "3.0.2", &req).is_ok());
        assert!(version_policy(Some("1.1.0"), "1.1.0", &req).is_err());
        assert_eq!(
            version_policy(Some("1.1.0+local"), "1.1.0", &req)
                .unwrap_err()
                .code,
            "firmware_reinstall_confirmation"
        );
        req.reinstall_confirmed = true;
        assert!(version_policy(Some("1.1.0"), "1.1.0", &req).is_ok());
        assert!(version_policy(Some("1.1.0+local"), "1.1.0", &req).is_ok());
        assert!(version_policy(None, "1.1.0", &req).is_err());
        req.unknown_version_confirmed = true;
        assert!(version_policy(None, "1.1.0", &req).is_ok());
    }
    #[test]
    fn safety_fails_closed_and_verification_requires_live_exact_version() {
        assert!(safe_vega_status(&["State: READY".into()]).is_ok());
        for state in ["CALIBRATING", "THRUSTING", "TOUCHDOWN", "INVALID", ""] {
            assert!(safe_vega_status(&[format!("State: {state}")]).is_err());
        }
        assert!(verify_running_version(None, "1.2.3").is_err());
        assert!(verify_running_version(Some("1.2.2"), "1.2.3").is_err());
        assert!(verify_running_version(Some("1.2.3"), "1.2.3").is_ok());
        let mut req = request();
        req.no_unsaved_changes = false;
        assert!(validate_confirmations(&req, Target::Vega).is_err());
        assert!(validate_confirmations(&request(), Target::Telemetry).is_ok());
    }
    #[test]
    fn ambiguity_never_picks_first_device() {
        assert!(exactly_one::<u8>(vec![], "missing").is_err());
        assert!(exactly_one(vec![1, 2], "ambiguous").is_err());
        assert_eq!(exactly_one(vec![1], "ok").unwrap(), 1);
    }
    #[tokio::test]
    async fn cache_requires_matching_digest_and_revalidates_binary_on_retry() {
        let events = Arc::new(EventBus::default());
        let manager = FirmwareManager::new(events.clone(), Arc::new(SerialManager::new(events)));
        let root = std::env::temp_dir().join(format!("cats-firmware-test-{}", Uuid::new_v4()));
        manager.set_cache(root.clone());
        let directory = root.join("firmware");
        std::fs::create_dir_all(&directory).unwrap();
        let mut bytes = vec![0; 256];
        bytes[..4].copy_from_slice(&0x2002_0000u32.to_le_bytes());
        bytes[4..8].copy_from_slice(&0x0800_0021u32.to_le_bytes());
        let mut asset = Asset {
            id: 1,
            target: Target::Vega,
            version: "1.2.3".into(),
            name: "flight_computer-1.2.3.bin".into(),
            size: 256,
            release_url: String::new(),
            notes: String::new(),
            // A rejected cache must fail locally, without any network request.
            url: "invalid-url".into(),
            digest: Some(format!("sha256:{}", assets::hash(&bytes))),
        };
        let path = directory.join(format!("{}-{}", asset.id, asset.name));
        std::fs::write(&path, &bytes).unwrap();
        let validated = manager.download(&asset).await.unwrap();
        assert_eq!(validated, bytes);
        let mut corrupt = bytes.clone();
        corrupt[100] ^= 1; // Still structurally valid, but no longer the official content.
        std::fs::write(&path, &corrupt).unwrap();
        assert_eq!(validated, bytes); // A cache mutation cannot change the bytes passed to USB.
        assert!(assets::validate(&asset, &validated).is_ok());
        assert!(manager.download(&asset).await.is_err());
        assert!(!path.exists());

        asset.digest = None;
        std::fs::write(&path, &bytes).unwrap();
        assert!(manager.download(&asset).await.is_err()); // No persisted trust without a GitHub digest.
        manager
            .cache_hashes
            .lock()
            .unwrap()
            .insert(asset.id, assets::hash(&bytes));
        std::fs::write(&path, &bytes).unwrap();
        assert_eq!(manager.download(&asset).await.unwrap(), bytes);
        corrupt[0] = 1; // Invalid stack vector must fail even with a matching session hash.
        manager
            .cache_hashes
            .lock()
            .unwrap()
            .insert(asset.id, assets::hash(&corrupt));
        std::fs::write(&path, &corrupt).unwrap();
        assert!(manager.download(&asset).await.is_err());
        assert!(!path.exists());
        std::fs::remove_dir(directory).unwrap();
        std::fs::remove_dir(root).unwrap();
    }

    #[tokio::test]
    async fn native_lock_blocks_commands_and_cancel_cannot_interrupt_a_write() {
        let events = Arc::new(EventBus::default());
        let serial = Arc::new(SerialManager::new(events.clone()));
        let manager = FirmwareManager::new(events, serial.clone());
        manager.begin().unwrap();
        assert!(manager.begin().is_err());
        assert!(serial.ensure_available().is_err());
        manager.stage("downloading", "download", true);
        assert!(manager.cancel().is_ok());
        assert!(manager.check_cancelled().is_err());
        manager.stage("copying", "copy", false);
        assert!(manager.cancel().is_err());
        manager.finish(Err(HostError::new("gs_copy", "failed")));
        assert!(!manager.busy());
        assert_eq!(manager.current().failed_stage.as_deref(), Some("copying"));
        assert!(serial.ensure_available().is_ok());
    }
}
