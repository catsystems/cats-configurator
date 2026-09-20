use std::{
    collections::HashMap,
    env,
    fs::{self, File, OpenOptions},
    path::PathBuf,
    sync::{
        Arc, Mutex as StdMutex, OnceLock,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    },
    time::Duration,
};

use serde::Serialize;
use serde_json::{Value, json};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    sync::{Mutex, mpsc, oneshot},
    task::JoinHandle,
    time::{Instant, timeout},
};
use tokio_serial::{SerialPortBuilderExt, SerialPortType, SerialStream};

use crate::{
    error::HostError,
    events::EventBus,
    protocol::{normalize_command, parse_prompt_command},
};

const BAUD_RATE: u32 = 115_200;
const DEFAULT_TIMEOUT: Duration = Duration::from_millis(2_500);
const SETTLE_TIME: Duration = Duration::from_millis(75);
const TELEMETRY_VERSION_REFRESH_DELAY: Duration = Duration::from_secs(5);

static FAKE_SERIAL_STARTED_AT: OnceLock<std::time::Instant> = OnceLock::new();

#[derive(Default)]
struct SerialTranscript {
    path: StdMutex<Option<PathBuf>>,
    file: StdMutex<Option<File>>,
}

impl SerialTranscript {
    fn set_directory(&self, directory: PathBuf) {
        *self.path.lock().unwrap() = Some(directory.join("vega-communication.log"));
    }

    fn start(&self, port_path: &str) {
        self.stop("Connection replaced");
        let Some(path) = self.path.lock().unwrap().clone() else {
            return;
        };
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let Ok(file) = OpenOptions::new().create(true).append(true).open(path) else {
            return;
        };
        *self.file.lock().unwrap() = Some(file);
        self.write("SESSION", &format!("Connecting to {port_path}"));
    }

    fn write(&self, direction: &str, message: &str) {
        let message = message.replace(['\r', '\n'], "\\n");
        if let Some(file) = self.file.lock().unwrap().as_mut() {
            let _ = std::io::Write::write_fmt(
                file,
                format_args!(
                    "{} {direction} {message}\n",
                    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
                ),
            );
        }
    }

    fn stop(&self, message: &str) {
        self.write("SESSION", message);
        self.file.lock().unwrap().take();
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SerialPortSummary {
    pub path: String,
    pub vendor_id: Option<String>,
    pub product_id: Option<String>,
    pub serial_number: Option<String>,
    pub location_id: Option<String>,
    pub manufacturer: Option<String>,
    pub friendly_name: Option<String>,
}

#[derive(Clone, Copy)]
pub struct CommandOptions {
    pub timeout: Duration,
    pub retries: usize,
    pub wait_for_prompt: bool,
    pub reset_timeout_on_output: bool,
    pub stream_output: bool,
}

impl Default for CommandOptions {
    fn default() -> Self {
        Self {
            timeout: DEFAULT_TIMEOUT,
            retries: 1,
            wait_for_prompt: false,
            reset_timeout_on_output: false,
            stream_output: false,
        }
    }
}

// The queued request owns this count, not the caller waiting for its reply.
// Cancelling a caller must neither leak the count nor unlock a running command.
struct PendingCommand(Arc<AtomicUsize>);
impl PendingCommand {
    fn new(counter: Arc<AtomicUsize>) -> Self {
        counter.fetch_add(1, Ordering::SeqCst);
        Self(counter)
    }
}
impl Drop for PendingCommand {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::SeqCst);
    }
}

enum Request {
    Execute {
        command: String,
        options: CommandOptions,
        reply: oneshot::Sender<Result<Vec<String>, HostError>>,
        pending: PendingCommand,
    },
}

struct Session {
    port_path: String,
    requests: mpsc::Sender<Request>,
    task: JoinHandle<()>,
}

pub struct SerialManager {
    events: Arc<EventBus>,
    transcript: Arc<SerialTranscript>,
    session: Mutex<Option<Session>>,
    pub transaction: Mutex<()>,
    pending: Arc<AtomicUsize>,
    pub firmware_active: Arc<AtomicBool>,
}

impl SerialManager {
    pub fn new(events: Arc<EventBus>) -> Self {
        Self {
            events,
            transcript: Arc::new(SerialTranscript::default()),
            session: Mutex::new(None),
            transaction: Mutex::new(()),
            pending: Arc::new(AtomicUsize::new(0)),
            firmware_active: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn set_log_directory(&self, directory: PathBuf) {
        self.transcript.set_directory(directory);
    }

    pub fn list() -> Result<Vec<SerialPortSummary>, HostError> {
        if env::var("CATS_FAKE_SERIAL").as_deref() == Ok("1") {
            let appear_after = env::var("CATS_FAKE_SERIAL_APPEAR_AFTER_MS")
                .ok()
                .and_then(|value| value.parse::<u64>().ok())
                .unwrap_or_default();
            if FAKE_SERIAL_STARTED_AT
                .get_or_init(std::time::Instant::now)
                .elapsed()
                < Duration::from_millis(appear_after)
            {
                return Ok(Vec::new());
            }
            let count = env::var("CATS_FAKE_VEGA_COUNT")
                .ok()
                .and_then(|value| value.parse::<usize>().ok())
                .unwrap_or(1);
            return Ok((0..count)
                .map(|index| SerialPortSummary {
                    path: if count == 1 {
                        "CATS-FAKE".into()
                    } else {
                        format!("CATS-FAKE-{}", index + 1)
                    },
                    vendor_id: Some("CAFE".into()),
                    product_id: Some("4003".into()),
                    serial_number: Some(format!("CATS-FAKE-{}", index + 1)),
                    location_id: Some(format!("fake-{}", index + 1)),
                    manufacturer: Some("CATS Systems".into()),
                    friendly_name: Some("CATS Vega".into()),
                })
                .collect());
        }

        let ports = tokio_serial::available_ports()
            .map_err(|error| HostError::new("serial_list_failed", error.to_string()))?;
        Ok(ports
            .into_iter()
            // macOS exposes callout and dial-in names for the same endpoint.
            // Use callout devices so one GS is not treated as two candidates.
            .filter(|port| serial_path_for_platform(std::env::consts::OS, &port.port_name))
            .map(|port| {
                let (vendor_id, product_id, serial_number, manufacturer, product) =
                    match port.port_type {
                        SerialPortType::UsbPort(info) => (
                            Some(format!("{:04X}", info.vid)),
                            Some(format!("{:04X}", info.pid)),
                            info.serial_number,
                            info.manufacturer,
                            info.product,
                        ),
                        _ => (None, None, None, None, None),
                    };
                SerialPortSummary {
                    path: port.port_name,
                    vendor_id,
                    product_id,
                    serial_number,
                    location_id: None,
                    manufacturer,
                    friendly_name: product,
                }
            })
            .collect())
    }

    pub async fn connect(&self, port_path: String) -> Result<bool, HostError> {
        let _transaction = self.transaction.lock().await;
        self.ensure_available()?;
        self.connect_for_firmware(port_path).await
    }

    pub fn ensure_available(&self) -> Result<(), HostError> {
        if self.firmware_active.load(Ordering::SeqCst) {
            return Err(HostError::new(
                "firmware_busy",
                "A firmware operation owns the device connection.",
            ));
        }
        Ok(())
    }

    pub fn reserve_firmware(&self) -> Result<(), HostError> {
        let _transaction = self.transaction.try_lock().map_err(|_| {
            HostError::new(
                "serial_busy",
                "Wait for the current board operation to finish.",
            )
        })?;
        if self.pending.load(Ordering::SeqCst) > 0
            || self.firmware_active.swap(true, Ordering::SeqCst)
        {
            return Err(HostError::new(
                "firmware_busy",
                "A device operation is already active.",
            ));
        }
        Ok(())
    }

    pub async fn connected_path(&self) -> Option<String> {
        self.session
            .lock()
            .await
            .as_ref()
            .filter(|s| !s.requests.is_closed())
            .map(|s| s.port_path.clone())
    }

    pub async fn connect_for_firmware(&self, port_path: String) -> Result<bool, HostError> {
        if port_path.is_empty() || port_path.len() > 512 || port_path.contains(['\r', '\n']) {
            return Err(HostError::new(
                "invalid_serial_path",
                "Serial port path is invalid.",
            ));
        }

        let mut session = self.session.lock().await;
        if session
            .as_ref()
            .is_some_and(|current| !current.requests.is_closed())
        {
            return Err(HostError::new(
                "serial_busy",
                "A serial connection is already in progress.",
            ));
        }
        if let Some(stale) = session.take() {
            stale.task.abort();
        }
        self.transcript.start(&port_path);

        let (requests, receiver) = mpsc::channel(32);
        let events = Arc::clone(&self.events);
        let task = if port_path.starts_with("CATS-FAKE")
            && (cfg!(test) || env::var("CATS_FAKE_SERIAL").as_deref() == Ok("1"))
        {
            tokio::spawn(run_fake(receiver, events, Arc::clone(&self.transcript)))
        } else {
            let mut port = match tokio_serial::new(&port_path, BAUD_RATE).open_native_async() {
                Ok(port) => port,
                Err(error) => {
                    self.transcript.write("ERROR", &error.to_string());
                    self.transcript.stop("Connection failed");
                    return Err(HostError::new("serial_open_failed", error.to_string()));
                }
            };
            self.transcript.write("SESSION", "Port opened");
            self.transcript.write("TX", "<wake>");
            port.write_all(b"\n")
                .await
                .map_err(|error| HostError::new("serial_write_failed", error.to_string()))?;
            port.flush()
                .await
                .map_err(|error| HostError::new("serial_write_failed", error.to_string()))?;
            tokio::spawn(run_real(
                port,
                receiver,
                events,
                Arc::clone(&self.transcript),
                Arc::clone(&self.firmware_active),
            ))
        };
        *session = Some(Session {
            port_path,
            requests,
            task,
        });
        drop(session);

        self.events.send("serial:connected", Value::Null);
        let version = match self
            .execute_for_firmware(
                "version".into(),
                CommandOptions {
                    timeout: Duration::from_secs(5),
                    retries: 0,
                    ..Default::default()
                },
            )
            .await
        {
            Ok(output) => output,
            Err(error) => {
                let message = if error.code == "board_timeout" {
                    "CATS Vega did not respond within five seconds.".to_string()
                } else {
                    error.message.clone()
                };
                self.events.send("serial:error", json!(message));
                self.disconnect_for_firmware().await;
                return Err(error);
            }
        };
        self.events.send(
            "board:static-data",
            json!({ "key": "version", "value": version }),
        );
        if !version
            .iter()
            .any(|line| line.to_lowercase().contains("board: cats"))
        {
            let error = HostError::new(
                "not_cats_board",
                "The selected serial device is not a CATS flight computer.",
            );
            self.events.send("serial:error", json!(error.message));
            self.disconnect_for_firmware().await;
            return Err(error);
        }
        self.events.send("board:active", json!(true));
        if !has_telemetry_version(&version) && !self.firmware_active.load(Ordering::SeqCst) {
            let requests = {
                let session = self.session.lock().await;
                session.as_ref().map(|session| session.requests.clone())
            };
            let events = Arc::clone(&self.events);
            let firmware_active = Arc::clone(&self.firmware_active);
            let pending = Arc::clone(&self.pending);
            tokio::spawn(async move {
                tokio::time::sleep(TELEMETRY_VERSION_REFRESH_DELAY).await;
                let pending = PendingCommand::new(pending);
                if firmware_active.load(Ordering::SeqCst) {
                    return;
                }
                let Some(requests) = requests.filter(|requests| !requests.is_closed()) else {
                    return;
                };
                let (reply, response) = oneshot::channel();
                if requests
                    .send(Request::Execute {
                        command: "version".into(),
                        options: CommandOptions {
                            retries: 0,
                            ..Default::default()
                        },
                        reply,
                        pending,
                    })
                    .await
                    .is_ok()
                {
                    if let Ok(Ok(output)) = response.await {
                        publish_version(&events, output);
                    }
                }
            });
        }
        Ok(true)
    }

    pub async fn disconnect(&self) -> bool {
        let _transaction = self.transaction.lock().await;
        if self.ensure_available().is_err() {
            return false;
        }
        self.disconnect_for_firmware().await
    }

    pub async fn disconnect_for_firmware(&self) -> bool {
        if let Some(session) = self.session.lock().await.take() {
            session.task.abort();
            let _ = session.task.await;
        }
        self.transcript.stop("Port closed");
        self.events.send("board:active", json!(false));
        self.events.send("serial:disconnected", Value::Null);
        true
    }

    pub async fn execute(
        &self,
        command: String,
        options: CommandOptions,
        poll: bool,
    ) -> Result<Option<Vec<String>>, HostError> {
        if poll && self.pending.load(Ordering::SeqCst) > 0 {
            return Ok(None);
        }
        let _transaction = self.transaction.lock().await;
        self.execute_unlocked(command, options).await.map(Some)
    }

    pub async fn execute_unlocked(
        &self,
        command: String,
        options: CommandOptions,
    ) -> Result<Vec<String>, HostError> {
        self.ensure_available()?;
        self.execute_for_firmware(command, options).await
    }

    pub async fn execute_for_firmware(
        &self,
        command: String,
        options: CommandOptions,
    ) -> Result<Vec<String>, HostError> {
        if command.trim().is_empty() || command.len() > 1024 || command.contains(['\r', '\n']) {
            return Err(HostError::new(
                "invalid_board_command",
                "Board command must be a non-empty single line.",
            ));
        }
        let requests = {
            let session = self.session.lock().await;
            session
                .as_ref()
                .filter(|current| !current.requests.is_closed())
                .map(|current| current.requests.clone())
                .ok_or_else(|| {
                    HostError::new("serial_disconnected", "Serial port is not connected.")
                })?
        };
        let (reply, response) = oneshot::channel();
        let send_result = requests
            .send(Request::Execute {
                command,
                options,
                reply,
                pending: PendingCommand::new(Arc::clone(&self.pending)),
            })
            .await;
        if send_result.is_err() {
            return Err(HostError::new(
                "serial_disconnected",
                "Serial port is not connected.",
            ));
        }
        let result = response
            .await
            .map_err(|_| HostError::new("serial_disconnected", "Board connection closed."));
        result?
    }
}

fn serial_path_for_platform(platform: &str, path: &str) -> bool {
    platform != "macos" || !path.starts_with("/dev/tty.")
}

async fn run_real(
    port: SerialStream,
    mut requests: mpsc::Receiver<Request>,
    events: Arc<EventBus>,
    transcript: Arc<SerialTranscript>,
    firmware_active: Arc<AtomicBool>,
) {
    let mut reader = BufReader::new(port);
    loop {
        let mut unsolicited = Vec::new();
        tokio::select! {
            request = requests.recv() => {
                let Some(Request::Execute { command, options, reply, pending }) = request else {
                    break;
                };
                let result = execute_with_retry(&mut reader, &events, &transcript, &command, options).await;
                let connection_error = result.as_ref().err().filter(|error| {
                    matches!(error.code, "serial_read_failed" | "serial_write_failed")
                }).cloned();
                // Capture ownership before replying: the caller may finish the
                // firmware operation and release its lock as soon as it wakes.
                let firmware_owned = firmware_active.load(Ordering::SeqCst);
                drop(pending);
                let _ = reply.send(result);
                if let Some(error) = connection_error {
                    transcript.write("ERROR", &error.message);
                    transcript.stop("Port closed");
                    publish_transport_disconnected(&events, Some(&command), &error.message, firmware_owned);
                    break;
                }
            }
            read = reader.read_until(b'\n', &mut unsolicited) => {
                match read {
                    Ok(0) => tokio::time::sleep(Duration::from_millis(10)).await,
                    Ok(_) => {
                        let line = String::from_utf8_lossy(&unsolicited);
                        transcript.write("RX", line.trim_end_matches(['\r', '\n']));
                        if line.contains("CATS is now ready") && !firmware_active.load(Ordering::SeqCst) {
                            match execute_with_retry(
                                &mut reader,
                                &events,
                                &transcript,
                                "version",
                                CommandOptions {
                                    timeout: Duration::from_secs(5),
                                    retries: 0,
                                    ..Default::default()
                                },
                            ).await {
                                Ok(output) => {
                                    publish_version(&events, output);
                                    events.send("board:active", json!(true));
                                }
                                Err(error) => events.send("serial:error", json!(error.message)),
                            }
                        }
                    }
                    Err(error) => {
                        transcript.write("ERROR", &error.to_string());
                        transcript.stop("Port closed");
                        publish_transport_disconnected(
                            &events, None, &error.to_string(), firmware_active.load(Ordering::SeqCst),
                        );
                        break;
                    }
                }
            }
        }
    }
}

fn has_telemetry_version(output: &[String]) -> bool {
    output.iter().any(|line| {
        line.strip_prefix("Telemetry Code version:")
            .is_some_and(|value| !value.trim().is_empty())
    })
}

fn publish_version(events: &EventBus, output: Vec<String>) {
    events.send(
        "board:static-data",
        json!({ "key": "version", "value": output }),
    );
}

fn publish_disconnected(events: &EventBus, message: Option<&str>) {
    if let Some(message) = message {
        events.send("serial:error", json!(message));
    }
    events.send("board:active", json!(false));
    events.send("serial:disconnected", Value::Null);
}

fn publish_transport_disconnected(
    events: &EventBus,
    command: Option<&str>,
    message: &str,
    firmware_owned: bool,
) {
    // Firmware operations report failures through their own stage/result and
    // expect USB removal during bootloader entry. Keep transport state events,
    // but do not also send an unrelated serial-error toast (including idle reads).
    // Ordinary reboot commands likewise intentionally drop their connection.
    let reboot = command.is_some_and(|command| normalize_command(command) == "reboot");
    let message = (!firmware_owned && !reboot).then_some(message);
    publish_disconnected(events, message);
}

async fn execute_with_retry(
    reader: &mut BufReader<SerialStream>,
    events: &EventBus,
    transcript: &SerialTranscript,
    command: &str,
    options: CommandOptions,
) -> Result<Vec<String>, HostError> {
    let mut last_error = HostError::new("board_timeout", "Board command timed out.");
    for _ in 0..=options.retries {
        match execute_attempt(reader, events, transcript, command, options).await {
            Ok(output) => {
                if let Some(protocol_error) = output.iter().find(|line| {
                    let line = line.trim().to_lowercase();
                    line.starts_with("error") || line.starts_with("unknown command")
                }) {
                    return Err(HostError::new("board_protocol_error", protocol_error));
                }
                return Ok(output);
            }
            Err(error) => last_error = error,
        }
    }
    Err(last_error)
}

async fn execute_attempt(
    reader: &mut BufReader<SerialStream>,
    events: &EventBus,
    transcript: &SerialTranscript,
    command: &str,
    options: CommandOptions,
) -> Result<Vec<String>, HostError> {
    transcript.write("TX", command);
    reader
        .get_mut()
        .write_all(format!("{command}\n").as_bytes())
        .await
        .map_err(|error| HostError::new("serial_write_failed", error.to_string()))?;
    reader
        .get_mut()
        .flush()
        .await
        .map_err(|error| HostError::new("serial_write_failed", error.to_string()))?;

    let mut output = Vec::new();
    let mut acknowledged = false;
    let mut deadline = Instant::now() + options.timeout;
    loop {
        let now = Instant::now();
        if now >= deadline {
            return Err(HostError::new(
                "board_timeout",
                format!("Board command timed out: {command}"),
            ));
        }
        let remaining = deadline - now;
        let wait = if acknowledged && !options.wait_for_prompt && !output.is_empty() {
            remaining.min(SETTLE_TIME)
        } else {
            remaining
        };
        let mut bytes = Vec::new();
        match timeout(wait, reader.read_until(b'\n', &mut bytes)).await {
            Ok(Ok(0)) => {
                tokio::time::sleep(Duration::from_millis(10)).await;
                continue;
            }
            Ok(Err(error)) => {
                return Err(HostError::new("serial_read_failed", error.to_string()));
            }
            Err(_) if acknowledged && !options.wait_for_prompt && !output.is_empty() => {
                return Ok(output);
            }
            Err(_) => {
                return Err(HostError::new(
                    "board_timeout",
                    format!("Board command timed out: {command}"),
                ));
            }
            Ok(Ok(_)) => {}
        }
        let line = String::from_utf8_lossy(&bytes)
            .trim_end_matches(['\r', '\n'])
            .to_string();
        transcript.write("RX", &line);
        if let Some(prompt_command) = parse_prompt_command(&line) {
            if !prompt_command.is_empty()
                && normalize_command(&prompt_command) == normalize_command(command)
            {
                acknowledged = true;
                output.clear();
            } else if prompt_command.is_empty() && acknowledged {
                return Ok(output);
            }
            continue;
        }
        if !acknowledged && normalize_command(&line) == normalize_command(command) {
            acknowledged = true;
            output.clear();
            continue;
        }
        if acknowledged {
            if options.stream_output {
                events.send("serial:data", json!(line));
            }
            output.push(line);
            if options.wait_for_prompt
                && (output.last().is_some_and(|line| {
                    let line = line.trim().to_lowercase();
                    line == "simulation successful." || line.starts_with("unknown command")
                }))
            {
                return Ok(output);
            }
            if options.reset_timeout_on_output {
                deadline = Instant::now() + options.timeout;
            }
        }
    }
}

async fn run_fake(
    mut requests: mpsc::Receiver<Request>,
    events: Arc<EventBus>,
    transcript: Arc<SerialTranscript>,
) {
    let mut board = FakeBoard::default();
    while let Some(Request::Execute {
        command,
        options,
        reply,
        pending,
    }) = requests.recv().await
    {
        transcript.write("TX", &command);
        let output = board.output(&command);
        for line in &output {
            transcript.write("RX", line);
        }
        if options.stream_output {
            for line in &output {
                events.send("serial:data", json!(line));
            }
        }
        drop(pending);
        let _ = reply.send(Ok(output));
    }
}

#[derive(Default)]
struct FakeBoard {
    values: HashMap<String, String>,
}

impl FakeBoard {
    fn value(&mut self, key: &str) -> Option<String> {
        let initial = fake_config(key)?.0;
        Some(
            self.values
                .entry(key.to_string())
                .or_insert_with(|| initial.to_string())
                .clone(),
        )
    }

    fn config_lines(&mut self, key: &str) -> Option<Vec<String>> {
        let value = self.value(key)?;
        let (_, metadata) = fake_config(key)?;
        Some(vec![format!("{key} = {value}"), metadata.to_string()])
    }

    fn output(&mut self, command: &str) -> Vec<String> {
        let normalized = normalize_command(command);
        if normalized == "get" {
            return crate::profile::board_keys()
                .into_iter()
                .flat_map(|key| {
                    let mut lines = self.config_lines(&key).unwrap_or_default();
                    lines.push(String::new());
                    lines
                })
                .collect();
        }
        if let Some(key) = normalized.strip_prefix("get ") {
            return self
                .config_lines(key)
                .unwrap_or_else(|| vec!["ERROR IN get: INVALID NAME".into()]);
        }
        if let Some(assignment) = command.trim().strip_prefix("set ") {
            if let Some((key, value)) = assignment.split_once('=') {
                let key = key.trim().to_lowercase();
                if fake_config(&key).is_some() {
                    let value = value.trim().to_string();
                    self.values.insert(key.clone(), value.clone());
                    return vec![format!("{key} set to {value}")];
                }
            }
            return vec!["ERROR IN set: INVALID NAME".into()];
        }
        match normalized.as_str() {
            "version" => vec!["Board: CATS Vega".into(), "Firmware: test".into()],
            "status" => vec![
                "CATS test device".into(),
                "State: READY".into(),
                "Nominal".into(),
                "h: 0 m, v: 0 m/s, a: 0 m/s^2".into(),
            ],
            "rec_info" => vec!["Flash usage: 1024 / 1048576 bytes".into()],
            value if value == "sim" || value.starts_with("sim ") => vec![
                "[100]: height: 1.000000, velocity: 2.000000, offset: 0.100000".into(),
                "Simulation Successful.".into(),
            ],
            "save" => vec!["Successfully written to flash".into()],
            "defaults" => {
                self.values.clear();
                vec!["Reset to default values".into()]
            }
            "dump" => {
                let mut output = vec!["#Configuration dump".into()];
                output.extend(
                    self.values
                        .iter()
                        .map(|(key, value)| format!("set {key} = {value}")),
                );
                output.push("#End of configuration dump".into());
                output
            }
            other => vec![format!("test> {other}")],
        }
    }
}

fn fake_config(key: &str) -> Option<(&'static str, &'static str)> {
    match key {
        "main_altitude" => Some(("200", "Allowed range: 10 - 65535")),
        "acc_threshold" => Some(("35", "Allowed range: 30 - 80")),
        "servo1_init_pos" | "servo2_init_pos" => Some(("0", "Allowed range: 0 - 1000")),
        "tele_enable" => Some(("ON", "Allowed values: OFF, ON")),
        "tele_adaptive_power" | "test_mode" => Some(("OFF", "Allowed values: OFF, ON")),
        "tele_link_phrase" | "tele_test_phrase" => Some(("cats-test", "String length: 4 - 16")),
        "tele_power_level" => Some(("20", "Allowed range: 16 - 30")),
        "rec_speed" => Some(("100Hz", "Allowed values: OFF, 10 Hz, 50 Hz, 100 Hz")),
        "rec_elements" => Some(("4294967295", "Allowed range: 0 - 4294967295")),
        key if key.starts_with("ev_") => Some((
            if key == "ev_liftoff" { "7,2" } else { "0,0" },
            "Array length: 16",
        )),
        key if key.starts_with("timer") && key.ends_with("_duration") => Some((
            if key.starts_with("timer1_") {
                "1000"
            } else {
                "0"
            },
            "Allowed range: 0 - 1200000",
        )),
        key if key.starts_with("timer") && key.ends_with("_start") => Some((
            "LIFTOFF",
            "Allowed values: CALIBRATE, READY, LIFTOFF, BURNOUT, APOGEE",
        )),
        key if key.starts_with("timer") && key.ends_with("_trigger") => Some((
            "APOGEE",
            "Allowed values: CALIBRATE, READY, LIFTOFF, BURNOUT, APOGEE",
        )),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn firmware_disconnects_skip_duplicate_errors_but_keep_connection_state_events() {
        for (command, firmware_owned, report_error) in [
            (Some("reboot"), false, false),
            (Some(" Reboot "), false, false),
            (Some("reboot now"), false, true),
            (Some("status"), false, true),
            (Some("bl"), false, true),
            (None, false, true),
            (Some("bl"), true, false),
            (Some("version"), true, false),
            (Some("status"), true, false),
            (None, true, false),
        ] {
            let captured = Arc::new(StdMutex::new(Vec::<Value>::new()));
            let received = Arc::clone(&captured);
            let events = EventBus::default();
            events
                .initialize(tauri::ipc::Channel::new(move |body| {
                    let tauri::ipc::InvokeResponseBody::Json(body) = body else {
                        panic!("Expected a JSON event");
                    };
                    received
                        .lock()
                        .unwrap()
                        .push(serde_json::from_str(&body).unwrap());
                    Ok(())
                }))
                .unwrap();
            let message = "The I/O operation has been aborted. (os error 995)";
            publish_transport_disconnected(&events, command, message, firmware_owned);
            let mut expected = Vec::new();
            if report_error {
                expected.push(json!({ "channel": "serial:error", "payload": message }));
            }
            expected.extend([
                json!({ "channel": "board:active", "payload": false }),
                json!({ "channel": "serial:disconnected", "payload": null }),
            ]);
            assert_eq!(
                *captured.lock().unwrap(),
                expected,
                "command={command:?}, firmware_owned={firmware_owned}"
            );
        }
    }

    #[tokio::test]
    async fn cancelled_caller_does_not_leak_or_prematurely_release_the_device_lock() {
        let serial = Arc::new(SerialManager::new(Arc::new(EventBus::default())));
        let (requests, mut receiver) = mpsc::channel(1);
        let (started, waiting) = oneshot::channel();
        let (release, finish) = oneshot::channel();
        let task = tokio::spawn(async move {
            let request = receiver.recv().await.unwrap();
            started.send(()).unwrap();
            finish.await.unwrap();
            drop(request);
        });
        *serial.session.lock().await = Some(Session {
            port_path: "test-only".into(),
            requests,
            task,
        });
        let caller_serial = serial.clone();
        let caller = tokio::spawn(async move {
            caller_serial
                .execute_for_firmware("version".into(), CommandOptions::default())
                .await
        });
        waiting.await.unwrap();
        caller.abort();
        assert!(caller.await.unwrap_err().is_cancelled());
        assert_eq!(serial.pending.load(Ordering::SeqCst), 1);
        assert!(serial.reserve_firmware().is_err());
        release.send(()).unwrap();
        tokio::time::timeout(Duration::from_secs(1), async {
            while serial.pending.load(Ordering::SeqCst) != 0 {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        serial.reserve_firmware().unwrap();
        serial.firmware_active.store(false, Ordering::SeqCst);
        serial.disconnect().await;
    }

    #[test]
    fn macos_enumerates_one_callout_path_per_usb_serial_endpoint() {
        let paths = ["/dev/cu.usbmodem123", "/dev/tty.usbmodem123"];
        assert_eq!(
            paths
                .into_iter()
                .filter(|p| serial_path_for_platform("macos", p))
                .collect::<Vec<_>>(),
            ["/dev/cu.usbmodem123"]
        );
        assert!(serial_path_for_platform("linux", "/dev/ttyACM0"));
        assert!(serial_path_for_platform("windows", "COM4"));
    }

    #[tokio::test]
    async fn fake_serial_identifies_and_streams_status() {
        let events = Arc::new(EventBus::default());
        let serial = SerialManager::new(events);
        serial.connect("CATS-FAKE".into()).await.unwrap();
        let status = serial
            .execute("status".into(), CommandOptions::default(), false)
            .await
            .unwrap()
            .unwrap();
        assert!(status.iter().any(|line| line == "State: READY"));
        serial.disconnect().await;
    }

    #[tokio::test]
    async fn fake_serial_supports_the_complete_profile_configuration_set() {
        let events = Arc::new(EventBus::default());
        let serial = SerialManager::new(events);
        let log_directory =
            env::temp_dir().join(format!("cats-configurator-{}", uuid::Uuid::new_v4()));
        serial.set_log_directory(log_directory.clone());
        serial.connect("CATS-FAKE".into()).await.unwrap();

        let configurations = crate::profile::read_configurations(&serial).await.unwrap();
        assert_eq!(configurations["configs"].as_array().unwrap().len(), 31);
        assert!(
            configurations["unsupportedKeys"]
                .as_array()
                .unwrap()
                .is_empty()
        );

        serial
            .execute(
                "set main_altitude = 321".into(),
                CommandOptions::default(),
                false,
            )
            .await
            .unwrap();
        let output = serial
            .execute("get main_altitude".into(), CommandOptions::default(), false)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            crate::protocol::parse_config_response(&output).unwrap()["value"].as_f64(),
            Some(321.0)
        );

        serial.disconnect().await;
        let transcript = fs::read_to_string(log_directory.join("vega-communication.log")).unwrap();
        assert!(transcript.contains("SESSION Connecting to CATS-FAKE"));
        assert!(transcript.contains("TX get"));
        assert!(transcript.contains("RX main_altitude = 200"));
        fs::remove_dir_all(log_directory).unwrap();
    }

    #[test]
    fn telemetry_refresh_only_runs_when_the_version_is_missing() {
        assert!(!has_telemetry_version(&["Board: CATS Vega".into()]));
        assert!(!has_telemetry_version(&[
            "Telemetry Code version:   ".into()
        ]));
        assert!(has_telemetry_version(&[
            "Telemetry Code version: 1.2.3".into()
        ]));
    }

    #[tokio::test]
    #[ignore = "requires a connected Vega and CATS_VEGA_PORT"]
    async fn hardware_smoke_is_read_only() {
        let port = env::var("CATS_VEGA_PORT").expect("set CATS_VEGA_PORT");
        let events = Arc::new(EventBus::default());
        let serial = SerialManager::new(events);
        serial.connect(port).await.unwrap();
        let status = serial
            .execute("status".into(), CommandOptions::default(), false)
            .await
            .unwrap()
            .unwrap();
        assert!(status.iter().any(|line| line.contains("State:")));
        serial.disconnect().await;
    }

    #[tokio::test]
    #[ignore = "requires a connected Vega and CATS_VEGA_PORT"]
    async fn hardware_connect_disconnect_cycles_are_reliable() {
        let port = env::var("CATS_VEGA_PORT").expect("set CATS_VEGA_PORT");
        let events = Arc::new(EventBus::default());
        let serial = SerialManager::new(events);

        for cycle in 1..=50 {
            serial.connect(port.clone()).await.unwrap_or_else(|error| {
                panic!("connection cycle {cycle} failed: {}", error.message)
            });
            assert!(serial.disconnect().await, "disconnect cycle {cycle} failed");
        }
    }

    #[tokio::test]
    #[ignore = "requires a connected Vega and CATS_VEGA_PORT"]
    async fn hardware_simulation_completes_or_reports_unavailable() {
        let port = env::var("CATS_VEGA_PORT").expect("set CATS_VEGA_PORT");
        let events = Arc::new(EventBus::default());
        let serial = SerialManager::new(events);
        serial.connect(port).await.unwrap();

        let result = serial
            .execute(
                "sim".into(),
                CommandOptions {
                    timeout: Duration::from_secs(5 * 60),
                    retries: 0,
                    wait_for_prompt: true,
                    reset_timeout_on_output: true,
                    stream_output: false,
                },
                false,
            )
            .await;

        match result {
            Ok(Some(output)) => assert!(
                output.iter().any(|line| line == "Simulation Successful."),
                "simulation ended without its success marker"
            ),
            Err(error)
                if error.code == "board_protocol_error"
                    && error.message.to_lowercase().starts_with("unknown command") =>
            {
                eprintln!("simulation is unavailable in this Vega firmware");
            }
            Ok(None) => panic!("simulation command was unexpectedly skipped"),
            Err(error) => panic!("simulation failed: {}", error.message),
        }
        serial.disconnect().await;
    }
}
