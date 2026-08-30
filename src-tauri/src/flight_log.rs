use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
};

use chrono::Local;
use serde_json::{Map, Value, json};
use tokio::sync::Mutex;
use uuid::Uuid;

use crate::error::HostError;

pub const MAX_FLIGHT_LOG_BYTES: u64 = 64 * 1024 * 1024;

#[derive(Clone)]
pub struct FlightLogSession {
    pub id: Uuid,
    pub source: String,
    pub name: String,
    pub bytes: Vec<u8>,
    pub flight_log: Value,
}

impl FlightLogSession {
    pub fn public(&self) -> Value {
        json!({
            "id": self.id,
            "source": self.source,
            "name": self.name,
            "size": self.bytes.len(),
            "flightLog": self.flight_log
        })
    }
}

#[derive(Clone)]
struct OnboardLog {
    id: Uuid,
    log_number: Option<u32>,
    name: String,
    path: PathBuf,
    size: u64,
}

impl OnboardLog {
    fn public(&self) -> Value {
        json!({
            "id": self.id,
            "logNumber": self.log_number,
            "name": self.name,
            "size": self.size
        })
    }
}

fn public_onboard(logs: &HashMap<Uuid, OnboardLog>) -> Vec<Value> {
    let mut logs = logs.values().collect::<Vec<_>>();
    logs.sort_by(|left, right| {
        right
            .log_number
            .cmp(&left.log_number)
            .then_with(|| right.name.cmp(&left.name))
    });
    logs.into_iter().map(OnboardLog::public).collect()
}

#[derive(Default)]
struct FlightLogState {
    volume_root: Option<PathBuf>,
    protected_roots: HashSet<PathBuf>,
    onboard: HashMap<Uuid, OnboardLog>,
    hidden_names: HashSet<String>,
    session: Option<FlightLogSession>,
}

#[derive(Default)]
pub struct FlightLogManager {
    state: Mutex<FlightLogState>,
}

fn read_u16(bytes: &[u8], at: usize) -> Option<u16> {
    Some(u16::from_le_bytes(bytes.get(at..at + 2)?.try_into().ok()?))
}

fn read_i16(bytes: &[u8], at: usize) -> Option<i16> {
    Some(i16::from_le_bytes(bytes.get(at..at + 2)?.try_into().ok()?))
}

fn read_u32(bytes: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_le_bytes(bytes.get(at..at + 4)?.try_into().ok()?))
}

fn read_f32(bytes: &[u8], at: usize) -> Option<f32> {
    Some(f32::from_le_bytes(bytes.get(at..at + 4)?.try_into().ok()?))
}

fn push(object: &mut Map<String, Value>, section: &str, record: Value) {
    object
        .get_mut(section)
        .and_then(Value::as_array_mut)
        .expect("flight-log section is an array")
        .push(record);
}

fn scale_section(log: &mut Value, section: &str, zero: f64, scales: &[(&str, f64)]) {
    let Some(records) = log[section].as_array_mut() else {
        return;
    };
    for record in records {
        if let Some(ts) = record["ts"].as_f64() {
            record["ts"] = json!((ts - zero) / 1000.0);
        }
        for (property, scale) in scales {
            if let Some(value) = record[*property].as_f64() {
                record[*property] = json!(value / scale);
            }
        }
    }
}

pub fn parse_flight_log(bytes: &[u8]) -> Value {
    let mut log = json!({
        "imu": [], "baro": [], "flightInfo": [], "orientationInfo": [],
        "filteredDataInfo": [], "gnssInfo": [], "flightStates": [],
        "eventInfo": [], "errorInfo": [], "voltageInfo": [],
        "byteCount": 0, "firstTs": -1, "lastTs": -1
    });
    let object = log.as_object_mut().unwrap();
    let Some(null) = bytes.iter().position(|byte| *byte == 0) else {
        object.insert("byteCount".into(), json!(bytes.len()));
        return log;
    };
    let mut index = null + 1;
    let mut first_ts: Option<u32> = None;
    let mut last_ts: Option<u32> = None;
    while index + 8 <= bytes.len() {
        let Some(ts) = read_u32(bytes, index) else {
            break;
        };
        let Some(record_type) = read_u32(bytes, index + 4) else {
            break;
        };
        index += 8;
        first_ts.get_or_insert(ts);
        let sensor_id = record_type & 0x0f;
        let kind = record_type & !0x0f;
        let record = match kind {
            0x10 => {
                let Some(values) = (0..6)
                    .map(|offset| read_i16(bytes, index + offset * 2))
                    .collect::<Option<Vec<_>>>()
                else {
                    break;
                };
                index += 12;
                (
                    "imu",
                    json!({ "ts": ts, "id": format!("IMU{sensor_id}"), "Ax": values[0], "Ay": values[1], "Az": values[2], "Gx": values[3], "Gy": values[4], "Gz": values[5] }),
                )
            }
            0x20 => {
                let (Some(pressure), Some(temperature)) =
                    (read_u32(bytes, index), read_u32(bytes, index + 4))
                else {
                    break;
                };
                index += 8;
                (
                    "baro",
                    json!({ "ts": ts, "id": format!("BARO{sensor_id}"), "T": temperature, "P": pressure }),
                )
            }
            0x40 => {
                let (Some(height), Some(velocity), Some(acceleration)) = (
                    read_f32(bytes, index),
                    read_f32(bytes, index + 4),
                    read_f32(bytes, index + 8),
                ) else {
                    break;
                };
                index += 12;
                (
                    "flightInfo",
                    json!({ "ts": ts, "height": height, "velocity": velocity, "acceleration": acceleration }),
                )
            }
            0x80 => {
                let Some(values) = (0..4)
                    .map(|offset| read_i16(bytes, index + offset * 2))
                    .collect::<Option<Vec<_>>>()
                else {
                    break;
                };
                index += 8;
                (
                    "orientationInfo",
                    json!({ "ts": ts, "q0_estimated": values[0], "q1_estimated": values[1], "q2_estimated": values[2], "q3_estimated": values[3] }),
                )
            }
            0x100 => {
                let (Some(altitude), Some(acceleration)) =
                    (read_f32(bytes, index), read_f32(bytes, index + 4))
                else {
                    break;
                };
                index += 8;
                (
                    "filteredDataInfo",
                    json!({ "ts": ts, "filteredAltitudeAGL": altitude, "filteredAcceleration": acceleration }),
                )
            }
            0x200 => {
                let Some(state) = read_u32(bytes, index) else {
                    break;
                };
                index += 4;
                ("flightStates", json!({ "ts": ts, "state": state }))
            }
            0x400 => {
                let (Some(event), Some(action), Some(argument)) = (
                    read_u32(bytes, index),
                    read_u16(bytes, index + 4),
                    read_u16(bytes, index + 6),
                ) else {
                    break;
                };
                index += 8;
                (
                    "eventInfo",
                    json!({ "ts": ts, "event": event, "action": action, "argument": argument }),
                )
            }
            0x800 => {
                let Some(error) = read_u32(bytes, index) else {
                    break;
                };
                index += 4;
                ("errorInfo", json!({ "ts": ts, "error": error }))
            }
            0x1000 => {
                let (Some(latitude), Some(longitude), Some(satellites)) = (
                    read_f32(bytes, index),
                    read_f32(bytes, index + 4),
                    bytes.get(index + 8).copied(),
                ) else {
                    break;
                };
                index += 9;
                (
                    "gnssInfo",
                    json!({ "ts": ts, "latitude": latitude, "longitude": longitude, "satellites": satellites }),
                )
            }
            0x2000 => {
                let Some(voltage) = read_u16(bytes, index) else {
                    break;
                };
                index += 2;
                ("voltageInfo", json!({ "ts": ts, "voltage": voltage }))
            }
            _ => break,
        };
        push(object, record.0, record.1);
        last_ts = Some(ts);
    }
    let first = first_ts.map(f64::from).unwrap_or(-1.0);
    let last = last_ts.map(f64::from).unwrap_or(-1.0);
    object.insert("byteCount".into(), json!(index));
    object.insert("firstTs".into(), json!(first));
    object.insert("lastTs".into(), json!(last));
    let zero = object["eventInfo"]
        .as_array()
        .into_iter()
        .flatten()
        .find(|event| event["event"] == 2)
        .and_then(|event| event["ts"].as_f64())
        .unwrap_or(first);
    object.insert("firstTs".into(), json!((first - zero) / 1000.0));
    object.insert("lastTs".into(), json!((last - zero) / 1000.0));
    scale_section(
        &mut log,
        "imu",
        zero,
        &[
            ("Gx", 14.28),
            ("Gy", 14.28),
            ("Gz", 14.28),
            ("Ax", 1024.0 / 9.81),
            ("Ay", 1024.0 / 9.81),
            ("Az", 1024.0 / 9.81),
        ],
    );
    scale_section(&mut log, "baro", zero, &[("T", 100.0)]);
    scale_section(
        &mut log,
        "orientationInfo",
        zero,
        &[
            ("q0_estimated", 1000.0),
            ("q1_estimated", 1000.0),
            ("q2_estimated", 1000.0),
            ("q3_estimated", 1000.0),
        ],
    );
    scale_section(&mut log, "voltageInfo", zero, &[("voltage", 1000.0)]);
    for section in [
        "flightInfo",
        "filteredDataInfo",
        "gnssInfo",
        "eventInfo",
        "flightStates",
        "errorInfo",
    ] {
        scale_section(&mut log, section, zero, &[]);
    }
    log
}

fn contained(root: &Path, candidate: &Path) -> bool {
    candidate.starts_with(root)
}

fn validate_volume(root: &Path) -> Result<PathBuf, HostError> {
    let requested = fs::symlink_metadata(root).map_err(|_| {
        HostError::new(
            "invalid_cats_volume",
            "Choose the root of the mounted CATS drive.",
        )
    })?;
    if requested.file_type().is_symlink() {
        return Err(HostError::new(
            "invalid_cats_volume",
            "Choose the root of the mounted CATS drive.",
        ));
    }
    let root = fs::canonicalize(root).map_err(|_| {
        HostError::new(
            "invalid_cats_volume",
            "Choose the root of the mounted CATS drive.",
        )
    })?;
    if !fs::symlink_metadata(&root)
        .is_ok_and(|metadata| metadata.is_dir() && !metadata.file_type().is_symlink())
    {
        return Err(HostError::new(
            "invalid_cats_volume",
            "Choose the root of the mounted CATS drive.",
        ));
    }
    let readme = root.join("readme.txt");
    let metadata = fs::symlink_metadata(&readme).map_err(|_| {
        HostError::new(
            "invalid_cats_volume",
            "Choose the root of the mounted CATS drive.",
        )
    })?;
    if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() > 16_384 {
        return Err(HostError::new(
            "invalid_cats_volume",
            "Choose the root of the mounted CATS drive.",
        ));
    }
    let introduction = fs::read_to_string(readme)
        .unwrap_or_default()
        .chars()
        .take(200)
        .collect::<String>();
    if !introduction.to_lowercase().contains("welcome to cats!") {
        return Err(HostError::new(
            "invalid_cats_volume",
            "Choose the root of the mounted CATS drive.",
        ));
    }
    Ok(root)
}

fn list_volume_logs(root: &Path, hidden: &HashSet<String>) -> Result<Vec<OnboardLog>, HostError> {
    let mut logs = Vec::new();
    for entry in fs::read_dir(root)
        .map_err(|error| HostError::new("volume_read_failed", error.to_string()))?
    {
        let Ok(entry) = entry else {
            continue;
        };
        let name = entry.file_name().to_string_lossy().into_owned();
        if hidden.contains(&name.to_lowercase()) || !name.to_lowercase().ends_with(".cfl") {
            continue;
        }
        let Ok(metadata) = fs::symlink_metadata(entry.path()) else {
            continue;
        };
        if !metadata.is_file()
            || metadata.file_type().is_symlink()
            || metadata.len() == 0
            || metadata.len() > MAX_FLIGHT_LOG_BYTES
        {
            continue;
        }
        let Ok(path) = fs::canonicalize(entry.path()) else {
            continue;
        };
        if !contained(root, &path) {
            continue;
        }
        let log_number = name
            .strip_prefix("fl")
            .or_else(|| name.strip_prefix("FL"))
            .and_then(|value| {
                value
                    .strip_suffix(".cfl")
                    .or_else(|| value.strip_suffix(".CFL"))
            })
            .and_then(|value| value.parse().ok());
        logs.push(OnboardLog {
            id: Uuid::new_v4(),
            log_number,
            name,
            path,
            size: metadata.len(),
        });
    }
    logs.sort_by(|left, right| {
        right
            .log_number
            .cmp(&left.log_number)
            .then_with(|| right.name.cmp(&left.name))
    });
    Ok(logs)
}

impl FlightLogManager {
    pub async fn current(&self) -> Option<Value> {
        self.state
            .lock()
            .await
            .session
            .as_ref()
            .map(FlightLogSession::public)
    }

    pub async fn session(&self, id: &str) -> Result<FlightLogSession, HostError> {
        let id = Uuid::parse_str(id)
            .map_err(|_| HostError::new("invalid_session", "Flight-log session ID is invalid."))?;
        self.state
            .lock()
            .await
            .session
            .as_ref()
            .filter(|session| session.id == id)
            .cloned()
            .ok_or_else(|| {
                HostError::new(
                    "stale_session",
                    "The selected flight-log session is no longer available.",
                )
            })
    }

    pub async fn load_path(&self, path: PathBuf, source: &str) -> Result<Value, HostError> {
        self.state.lock().await.session = None;
        let requested = fs::symlink_metadata(&path)
            .map_err(|error| HostError::new("flight_log_read_failed", error.to_string()))?;
        if requested.file_type().is_symlink() {
            return Err(HostError::new(
                "invalid_flight_log",
                "Flight-log path is not a regular file.",
            ));
        }
        let path = fs::canonicalize(path)
            .map_err(|error| HostError::new("flight_log_read_failed", error.to_string()))?;
        if path
            .extension()
            .and_then(|value| value.to_str())
            .is_none_or(|value| !value.eq_ignore_ascii_case("cfl"))
        {
            return Err(HostError::new(
                "invalid_flight_log",
                "File does not end with .cfl",
            ));
        }
        let metadata = fs::symlink_metadata(&path)
            .map_err(|error| HostError::new("flight_log_read_failed", error.to_string()))?;
        if !metadata.is_file() || metadata.file_type().is_symlink() {
            return Err(HostError::new(
                "invalid_flight_log",
                "Flight-log path is not a regular file.",
            ));
        }
        if metadata.len() == 0 {
            return Err(HostError::new("empty_flight_log", "File is empty"));
        }
        if metadata.len() > MAX_FLIGHT_LOG_BYTES {
            return Err(HostError::new(
                "flight_log_too_large",
                "Flight log exceeds the 64 MiB limit.",
            ));
        }
        let bytes = fs::read(&path)
            .map_err(|error| HostError::new("flight_log_read_failed", error.to_string()))?;
        if bytes.is_empty() || bytes.len() as u64 > MAX_FLIGHT_LOG_BYTES {
            return Err(HostError::new(
                "flight_log_changed",
                "Flight log changed while it was being loaded.",
            ));
        }
        let session = FlightLogSession {
            id: Uuid::new_v4(),
            source: source.into(),
            name: path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned(),
            flight_log: parse_flight_log(&bytes),
            bytes,
        };
        let public = session.public();
        self.state.lock().await.session = Some(session);
        Ok(public)
    }

    pub async fn select_volume(&self, root: PathBuf) -> Result<Value, HostError> {
        let root = validate_volume(&root)?;
        let mut state = self.state.lock().await;
        if state.volume_root.as_ref() != Some(&root) {
            state.hidden_names.clear();
        }
        state.protected_roots.insert(root.clone());
        let logs = list_volume_logs(&root, &state.hidden_names)?;
        state.volume_root = Some(root);
        state.onboard = logs.into_iter().map(|log| (log.id, log)).collect();
        Ok(json!({ "status": "ready", "logs": public_onboard(&state.onboard) }))
    }

    pub async fn discover(&self) -> Value {
        if let Ok(path) = std::env::var("CATS_FAKE_CATS_DRIVE") {
            return self
                .select_volume(PathBuf::from(path))
                .await
                .unwrap_or_else(|_| json!({ "status": "not-found", "logs": [] }));
        }
        let mut matches = Vec::new();
        #[cfg(target_os = "windows")]
        let candidates = ('A'..='Z')
            .map(|letter| PathBuf::from(format!("{letter}:\\")))
            .collect::<Vec<_>>();
        #[cfg(target_os = "macos")]
        let candidates = child_directories(Path::new("/Volumes"), 0);
        #[cfg(all(unix, not(target_os = "macos")))]
        let candidates = ["/media", "/run/media", "/mnt"]
            .into_iter()
            .flat_map(|root| child_directories(Path::new(root), 1))
            .collect::<Vec<_>>();
        for candidate in candidates {
            if let Ok(root) = validate_volume(&candidate) {
                matches.push(root);
            }
        }
        matches.sort();
        matches.dedup();
        if matches.len() == 1 {
            return self
                .select_volume(matches.remove(0))
                .await
                .unwrap_or_else(|_| json!({ "status": "unavailable", "logs": [] }));
        }
        let mut state = self.state.lock().await;
        state.volume_root = None;
        state.onboard.clear();
        state.hidden_names.clear();
        json!({ "status": if matches.len() > 1 { "multiple" } else { "not-found" }, "logs": [] })
    }

    pub async fn refresh(&self) -> Value {
        let root = self.state.lock().await.volume_root.clone();
        match root {
            Some(root) => self
                .select_volume(root)
                .await
                .unwrap_or_else(|_| json!({ "status": "unavailable", "logs": [] })),
            None => self.discover().await,
        }
    }

    pub async fn clear(&self) -> Value {
        let mut state = self.state.lock().await;
        state.volume_root = None;
        state.onboard.clear();
        state.hidden_names.clear();
        json!({ "status": "not-found", "logs": [] })
    }

    pub async fn open_onboard(&self, id: &str) -> Result<Value, HostError> {
        let id = Uuid::parse_str(id)
            .map_err(|_| HostError::new("invalid_log", "Onboard flight-log ID is invalid."))?;
        let (root, path) = {
            let state = self.state.lock().await;
            let log = state.onboard.get(&id).ok_or_else(|| {
                HostError::new(
                    "stale_log",
                    "This onboard flight log is no longer available.",
                )
            })?;
            (state.volume_root.clone().unwrap(), log.path.clone())
        };
        let real = fs::canonicalize(path)
            .map_err(|error| HostError::new("flight_log_read_failed", error.to_string()))?;
        if !contained(&root, &real) {
            return Err(HostError::new(
                "path_escape",
                "Rejected a flight log outside the selected CATS drive.",
            ));
        }
        self.load_path(real, "onboard").await
    }

    pub async fn onboard_name(&self, id: &str) -> Result<String, HostError> {
        let id = Uuid::parse_str(id)
            .map_err(|_| HostError::new("invalid_log", "Onboard flight-log ID is invalid."))?;
        self.state
            .lock()
            .await
            .onboard
            .get(&id)
            .map(|log| log.name.clone())
            .ok_or_else(|| {
                HostError::new(
                    "stale_log",
                    "This onboard flight log is no longer available.",
                )
            })
    }

    pub async fn hide_onboard(&self, id: &str) -> Result<Value, HostError> {
        let id = Uuid::parse_str(id)
            .map_err(|_| HostError::new("invalid_log", "Onboard flight-log ID is invalid."))?;
        let mut state = self.state.lock().await;
        let log = state.onboard.remove(&id).ok_or_else(|| {
            HostError::new(
                "stale_log",
                "This onboard flight log is no longer available.",
            )
        })?;
        state.hidden_names.insert(log.name.to_lowercase());
        Ok(json!({ "status": "ready", "logs": public_onboard(&state.onboard) }))
    }

    pub async fn assert_destination(&self, destination: &Path) -> Result<PathBuf, HostError> {
        let destination = if destination.is_absolute() {
            destination.to_path_buf()
        } else {
            std::env::current_dir().unwrap().join(destination)
        };
        let parent = fs::canonicalize(destination.parent().unwrap_or(Path::new(".")))
            .map_err(|error| HostError::new("invalid_destination", error.to_string()))?;
        let state = self.state.lock().await;
        if state
            .protected_roots
            .iter()
            .any(|root| contained(root, &parent))
        {
            return Err(HostError::new(
                "protected_destination",
                "Flight logs cannot be written to the mounted CATS drive.",
            ));
        }
        if let Ok(existing) = fs::canonicalize(&destination) {
            if state
                .protected_roots
                .iter()
                .any(|root| contained(root, &existing))
            {
                return Err(HostError::new(
                    "protected_destination",
                    "Flight logs cannot be written to the mounted CATS drive.",
                ));
            }
        }
        Ok(destination)
    }
}

#[cfg(not(target_os = "windows"))]
fn child_directories(root: &Path, depth: usize) -> Vec<PathBuf> {
    let Ok(entries) = fs::read_dir(root) else {
        return Vec::new();
    };
    let direct = entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            fs::symlink_metadata(entry.path())
                .ok()
                .filter(|metadata| metadata.is_dir() && !metadata.file_type().is_symlink())
                .map(|_| entry.path())
        })
        .collect::<Vec<_>>();
    if depth == 0 {
        return direct;
    }
    let mut all = direct.clone();
    for directory in direct {
        all.extend(child_directories(&directory, depth - 1));
    }
    all
}

fn collect_columns(value: &Value, prefix: &str, columns: &mut Vec<String>) {
    let Some(object) = value.as_object() else {
        return;
    };
    for (key, value) in object {
        let path = if prefix.is_empty() {
            key.clone()
        } else {
            format!("{prefix}.{key}")
        };
        if value.is_object() {
            collect_columns(value, &path, columns);
        } else if !columns.contains(&path) {
            columns.push(path);
        }
    }
}

fn path_value<'a>(value: &'a Value, path: &str) -> Option<&'a Value> {
    path.split('.')
        .try_fold(value, |current, key| current.get(key))
}

fn csv_field(value: Option<&Value>) -> String {
    let Some(value) = value else {
        return String::new();
    };
    if value.is_null() {
        return String::new();
    }
    let text = value
        .as_str()
        .map(ToString::to_string)
        .unwrap_or_else(|| value.to_string());
    if text.contains([',', '"', '\n', '\r']) {
        format!("\"{}\"", text.replace('"', "\"\""))
    } else {
        text
    }
}

pub fn to_csv(records: &Value) -> Result<String, HostError> {
    let records = records
        .as_array()
        .ok_or_else(|| HostError::new("invalid_csv", "CSV input must be an array."))?;
    if records.is_empty() {
        return Ok("No data recorded".into());
    }
    let mut columns = Vec::new();
    for record in records {
        collect_columns(record, "", &mut columns);
    }
    let mut rows = vec![columns.join(",")];
    for record in records {
        rows.push(
            columns
                .iter()
                .map(|column| csv_field(path_value(record, column)))
                .collect::<Vec<_>>()
                .join(","),
        );
    }
    Ok(rows.join("\n"))
}

pub fn export_name(name: &str, suffix: &str) -> String {
    format!("{name}_{suffix}_{}", Local::now().format("%m%d%Y_%H%M%S"))
}

pub fn standalone_html(flight_log: &Value, imperial: bool) -> Result<String, HostError> {
    let template = include_str!("../../templates/plots.html");
    let plotly = include_str!("../../node_modules/plotly.js-dist-min/plotly.min.js")
        .replace("</script", "<\\/script");
    let data = serde_json::to_string(flight_log)
        .map_err(|error| HostError::new("flight_log_encode_failed", error.to_string()))?
        .replace('<', "\\u003c")
        .replace('>', "\\u003e")
        .replace('\u{2028}', "\\u2028")
        .replace('\u{2029}', "\\u2029");
    Ok(template
        .replacen("/* PLOTLY_PLACEHOLDER */", &plotly, 1)
        .replacen("/* FLIGHTLOG_PLACEHOLDER */", &data, 1)
        .replacen(
            "/* USE_IMPERIAL_UNITS_PLACEHOLDER */",
            if imperial { "true" } else { "false" },
            1,
        ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_and_scales_a_flight_record() {
        let mut bytes = b"3.1.0\0".to_vec();
        bytes.extend_from_slice(&1000_u32.to_le_bytes());
        bytes.extend_from_slice(&0x40_u32.to_le_bytes());
        bytes.extend_from_slice(&1.5_f32.to_le_bytes());
        bytes.extend_from_slice(&2.5_f32.to_le_bytes());
        bytes.extend_from_slice(&3.5_f32.to_le_bytes());
        let log = parse_flight_log(&bytes);
        assert_eq!(log["flightInfo"][0]["height"], 1.5);
        assert_eq!(log["flightInfo"][0]["ts"], 0.0);
    }

    #[test]
    fn csv_and_inline_html_escape_untrusted_values() {
        let csv = to_csv(&json!([{ "ts": 1, "label": "A, \"quoted\"\nvalue" }])).unwrap();
        assert!(csv.contains("\"A, \"\"quoted\"\"\nvalue\""));
        let html = standalone_html(&json!({ "label": "</script>" }), true).unwrap();
        assert!(!html.contains("\"</script>\""));
        assert!(!html.contains("/* FLIGHTLOG_PLACEHOLDER */"));
        assert!(!html.contains("/* USE_IMPERIAL_UNITS_PLACEHOLDER */"));
    }

    #[test]
    fn onboard_logs_remain_newest_first_after_hash_map_storage() {
        let mut logs = HashMap::new();
        for (number, name) in [(2, "fl002.cfl"), (10, "fl010.cfl"), (1, "fl001.cfl")] {
            let id = Uuid::new_v4();
            logs.insert(
                id,
                OnboardLog {
                    id,
                    log_number: Some(number),
                    name: name.into(),
                    path: name.into(),
                    size: 1,
                },
            );
        }
        assert_eq!(
            public_onboard(&logs)
                .iter()
                .map(|log| log["name"].as_str().unwrap())
                .collect::<Vec<_>>(),
            ["fl010.cfl", "fl002.cfl", "fl001.cfl"]
        );
    }

    #[test]
    #[ignore = "requires CATS_VEGA_LOG_PATH pointing to a mounted Vega log"]
    fn hardware_mounted_log_parses_read_only() {
        let path = std::env::var("CATS_VEGA_LOG_PATH").expect("set CATS_VEGA_LOG_PATH");
        let bytes = fs::read(path).unwrap();
        let log = parse_flight_log(&bytes);
        let record_count = [
            "imu",
            "baro",
            "flightInfo",
            "orientationInfo",
            "filteredDataInfo",
            "gnssInfo",
            "flightStates",
            "eventInfo",
            "errorInfo",
            "voltageInfo",
        ]
        .into_iter()
        .map(|section| log[section].as_array().unwrap().len())
        .sum::<usize>();
        assert!(!bytes.is_empty());
        assert!(log["byteCount"].as_u64().unwrap_or_default() > 0);
        assert!(record_count > 0);
        eprintln!(
            "Parsed {} bytes into {} records ({:.3}s to {:.3}s).",
            log["byteCount"], record_count, log["firstTs"], log["lastTs"]
        );
    }
}
