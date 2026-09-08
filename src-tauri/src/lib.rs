mod error;
mod events;
mod firmware;
mod flight_log;
mod handoff;
mod preflight;
mod profile;
mod protocol;
mod serial;

use std::{sync::Arc, time::Duration};

use error::HostError;
use events::{EventBus, HostEvent};
use flight_log::FlightLogManager;
use handoff::HandoffManager;
use protocol::{parse_config_response, parse_config_responses, parse_data, validate_key};
use serde::Deserialize;
use serde_json::{Value, json};
use serial::{CommandOptions, SerialManager, SerialPortSummary};
use tauri::{Manager, State, ipc::Channel};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_opener::OpenerExt;

struct AppState {
    events: Arc<EventBus>,
    flight_logs: Arc<FlightLogManager>,
    handoff: Arc<HandoffManager>,
    serial: Arc<SerialManager>,
    firmware: Arc<firmware::FirmwareManager>,
}

impl Default for AppState {
    fn default() -> Self {
        let events = Arc::new(EventBus::default());
        let serial = Arc::new(SerialManager::new(Arc::clone(&events)));
        Self {
            flight_logs: Arc::new(FlightLogManager::default()),
            handoff: Arc::new(HandoffManager::default()),
            firmware: Arc::new(firmware::FirmwareManager::new(
                Arc::clone(&events),
                Arc::clone(&serial),
            )),
            serial,
            events,
        }
    }
}

#[derive(Clone, Deserialize)]
struct ConfigEntry {
    key: String,
    value: Value,
}

#[tauri::command]
fn initialize_host(
    events: Channel<HostEvent>,
    state: State<'_, AppState>,
) -> Result<(), HostError> {
    state.events.initialize(events)
}

#[tauri::command]
fn app_open_external(app: tauri::AppHandle, url: String) -> Result<(), HostError> {
    let parsed = url::Url::parse(&url)
        .map_err(|_| HostError::new("invalid_url", "The external URL is invalid."))?;
    let safe_origin = parsed.scheme() == "https"
        && parsed.port().is_none()
        && parsed.username().is_empty()
        && parsed.password().is_none();
    let allowed = safe_origin
        && match parsed.host_str() {
            Some("flights.catsystems.io") => parsed.scheme() == "https",
            Some("github.com") => {
                parsed
                    .path_segments()
                    .and_then(|mut segments| segments.next())
                    == Some("catsystems")
            }
            _ => false,
        };
    if !allowed {
        return Err(HostError::new(
            "external_url_denied",
            "The external URL is not approved by Configurator.",
        ));
    }
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|error| HostError::new("open_external_failed", error.to_string()))
}

#[tauri::command]
fn serial_list() -> Result<Vec<SerialPortSummary>, HostError> {
    SerialManager::list()
}

#[tauri::command]
async fn serial_connect(
    app: tauri::AppHandle,
    port_path: String,
    state: State<'_, AppState>,
) -> Result<bool, HostError> {
    let connected = state.serial.connect(port_path.clone()).await?;
    let _ = app
        .notification()
        .builder()
        .title(format!("Connected to: {port_path}"))
        .show();
    Ok(connected)
}

#[tauri::command]
async fn serial_disconnect(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<bool, HostError> {
    let disconnected = state.serial.disconnect().await;
    let _ = app
        .notification()
        .builder()
        .title("Port is disconnected.")
        .show();
    Ok(disconnected)
}

#[tauri::command]
async fn serial_send(command: String, state: State<'_, AppState>) -> Result<bool, HostError> {
    let normalized = protocol::normalize_command(&command);
    let simulation = normalized == "sim" || normalized.starts_with("sim ");
    let result = state
        .serial
        .execute(
            command,
            CommandOptions {
                timeout: if simulation {
                    Duration::from_secs(5 * 60)
                } else {
                    Duration::from_secs(5)
                },
                retries: 0,
                wait_for_prompt: simulation,
                reset_timeout_on_output: simulation,
                stream_output: simulation,
            },
            false,
        )
        .await;
    let output = match result {
        Err(error)
            if normalized == "reboot"
                && matches!(
                    error.code,
                    "serial_disconnected" | "serial_read_failed" | "serial_write_failed"
                ) =>
        {
            Vec::new()
        }
        Err(error)
            if simulation
                && error.code == "board_protocol_error"
                && error.message.to_lowercase().starts_with("unknown command") =>
        {
            return Err(HostError::new(
                "simulation_unavailable",
                "Simulation is unavailable in this Vega firmware. The sim command is included only in CATS development builds.",
            ));
        }
        Err(error) => return Err(error),
        Ok(output) => output.unwrap_or_default(),
    };
    if !simulation {
        for line in output {
            state.events.send("serial:data", json!(line));
        }
    }
    Ok(true)
}

async fn execute_board(state: &AppState, command: String, poll: bool) -> Result<Value, HostError> {
    let output = state
        .serial
        .execute(command.clone(), CommandOptions::default(), poll)
        .await?;
    let Some(output) = output else {
        return Ok(Value::Null);
    };
    process_board_output(state, &command, output)
}

fn process_board_output(
    state: &AppState,
    command: &str,
    output: Vec<String>,
) -> Result<Value, HostError> {
    if command == "version" || command == "status" || command == "rec_info" {
        let parsed = parse_data(command, &output);
        state.events.send("board:static-data", parsed.clone());
        return Ok(parsed);
    }
    if command.starts_with("get ") {
        let parsed = parse_config_response(&output)?;
        state.events.send("board:config-data", parsed.clone());
        return Ok(parsed);
    }
    if command == "get" {
        let parsed = parse_config_responses(&output)?;
        let value = Value::Array(parsed);
        state.events.send("board:config-data", value.clone());
        return Ok(value);
    }
    Ok(json!(output))
}

#[tauri::command]
async fn board_get_configs(state: State<'_, AppState>) -> Result<Value, HostError> {
    let result = profile::read_configurations(&state.serial).await?;
    state
        .events
        .send("board:config-data", result["configs"].clone());
    Ok(result)
}

#[tauri::command]
async fn board_get_config(key: String, state: State<'_, AppState>) -> Result<Value, HostError> {
    validate_key(&key)?;
    execute_board(&state, format!("get {key}"), false).await
}

fn board_value(value: &Value) -> Result<String, HostError> {
    match value {
        Value::String(value)
            if !value.is_empty() && value.len() <= 512 && !value.contains(['\r', '\n', '#']) =>
        {
            Ok(value.clone())
        }
        Value::Number(value) => Ok(value.to_string()),
        Value::Bool(value) => Ok(if *value { "ON" } else { "OFF" }.into()),
        _ => Err(HostError::new(
            "invalid_board_value",
            "Board value must be a finite number, boolean, or safe single-line string.",
        )),
    }
}

#[tauri::command]
async fn board_set_config(
    key: String,
    value: Value,
    state: State<'_, AppState>,
) -> Result<bool, HostError> {
    validate_key(&key)?;
    let value = board_value(&value)?;
    execute_board(&state, format!("set {key} = {value}"), false).await?;
    Ok(true)
}

fn values_match(expected: &Value, actual: &Value) -> bool {
    match expected {
        Value::Number(expected) => expected.as_f64() == actual.as_f64(),
        Value::Bool(expected) => actual
            .as_str()
            .is_some_and(|value| value.eq_ignore_ascii_case(if *expected { "ON" } else { "OFF" })),
        Value::String(expected) => actual
            .as_str()
            .is_some_and(|actual| actual.trim() == expected.trim()),
        _ => false,
    }
}

#[tauri::command]
async fn board_apply_config(
    entries: Vec<ConfigEntry>,
    state: State<'_, AppState>,
) -> Result<Value, HostError> {
    apply_config_entries(entries, &state).await
}

async fn apply_config_entries(
    entries: Vec<ConfigEntry>,
    state: &AppState,
) -> Result<Value, HostError> {
    if entries.is_empty() || entries.len() > 128 {
        return Err(HostError::new(
            "invalid_transaction",
            "Board transaction must contain 1 to 128 values.",
        ));
    }
    let mut seen = std::collections::HashSet::new();
    for entry in &entries {
        validate_key(&entry.key)?;
        board_value(&entry.value)?;
        if !seen.insert(entry.key.clone()) {
            return Err(HostError::new(
                "duplicate_transaction_key",
                format!("Configuration transaction repeats {}.", entry.key),
            ));
        }
    }

    let _transaction = state.serial.transaction.lock().await;
    let mut results = entries
        .iter()
        .map(|entry| {
            json!({
                "key": entry.key,
                "expected": entry.value,
                "actual": null,
                "status": "pending",
                "message": null
            })
        })
        .collect::<Vec<_>>();

    for (index, entry) in entries.iter().enumerate() {
        let value = board_value(&entry.value)?;
        match state
            .serial
            .execute_unlocked(
                format!("set {} = {value}", entry.key),
                CommandOptions::default(),
            )
            .await
        {
            Ok(output)
                if output
                    .iter()
                    .any(|line| line.to_lowercase().contains(" set to ")) =>
            {
                results[index]["status"] = json!("written");
            }
            Ok(_) => {
                results[index]["status"] = json!("failed");
                results[index]["message"] = json!("Board did not acknowledge the new value.");
                return Ok(json!({ "ok": false, "saved": false, "results": results }));
            }
            Err(error) => {
                results[index]["status"] = json!("failed");
                results[index]["message"] = json!(error.message);
                return Ok(json!({ "ok": false, "saved": false, "results": results }));
            }
        }
    }

    let save = state
        .serial
        .execute_unlocked("save".into(), CommandOptions::default())
        .await;
    let saved = save.as_ref().is_ok_and(|output| {
        output
            .iter()
            .any(|line| line.to_lowercase().contains("written to flash"))
    });
    if !saved {
        let message = save
            .err()
            .map(|error| error.message)
            .unwrap_or_else(|| "Board did not confirm the flash save.".into());
        for result in &mut results {
            if result["status"] == "written" {
                result["status"] = json!("failed");
                result["message"] = json!(message);
            }
        }
        return Ok(json!({ "ok": false, "saved": false, "results": results }));
    }

    for (index, entry) in entries.iter().enumerate() {
        match state
            .serial
            .execute_unlocked(format!("get {}", entry.key), CommandOptions::default())
            .await
            .and_then(|output| parse_config_response(&output))
        {
            Ok(config) => {
                state.events.send("board:config-data", config.clone());
                results[index]["actual"] = config["value"].clone();
                if values_match(&entry.value, &config["value"]) {
                    results[index]["status"] = json!("verified");
                } else {
                    results[index]["status"] = json!("mismatch");
                    results[index]["message"] = json!("Read-back value does not match.");
                }
            }
            Err(error) => {
                results[index]["status"] = json!("failed");
                results[index]["message"] = json!(error.message);
            }
        }
    }
    let ok = results.iter().all(|result| result["status"] == "verified");
    let report = json!({ "ok": ok, "saved": true, "results": results });
    if ok {
        state.events.send("board:config-saved", report.clone());
    }
    Ok(report)
}

#[tauri::command]
async fn board_get_events(key: String, state: State<'_, AppState>) -> Result<Value, HostError> {
    board_get_config(key, state).await
}

#[tauri::command]
async fn board_get_timers(key: String, state: State<'_, AppState>) -> Result<Value, HostError> {
    validate_key(&key)?;
    let _transaction = state.serial.transaction.lock().await;
    let mut configs = Vec::new();
    for field in ["start", "duration", "trigger"] {
        let output = state
            .serial
            .execute_unlocked(format!("get {key}_{field}"), CommandOptions::default())
            .await?;
        let config = parse_config_response(&output)?;
        state.events.send("board:config-data", config.clone());
        configs.push(config);
    }
    Ok(Value::Array(configs))
}

#[tauri::command]
async fn board_get_info(state: State<'_, AppState>) -> Result<Value, HostError> {
    execute_board(&state, "status".into(), true).await
}

#[tauri::command]
async fn board_get_log_info(state: State<'_, AppState>) -> Result<Value, HostError> {
    execute_board(&state, "rec_info".into(), false).await
}

#[tauri::command]
async fn board_reset(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<Value, HostError> {
    let _transaction = state.serial.transaction.lock().await;
    let defaults = state
        .serial
        .execute_unlocked("defaults".into(), CommandOptions::default())
        .await?;
    if !defaults
        .iter()
        .any(|line| line.to_lowercase().contains("reset to default values"))
    {
        return Err(HostError::new(
            "defaults_not_confirmed",
            "Board did not confirm the default configuration.",
        ));
    }
    let save = state
        .serial
        .execute_unlocked("save".into(), CommandOptions::default())
        .await?;
    if !save
        .iter()
        .any(|line| line.to_lowercase().contains("written to flash"))
    {
        return Err(HostError::new(
            "save_not_confirmed",
            "Board did not confirm the flash save.",
        ));
    }
    let report = json!({ "ok": true, "saved": true });
    state.events.send("board:config-saved", report.clone());
    let _ = app
        .notification()
        .builder()
        .title("Config reset to default")
        .show();
    Ok(report)
}

#[tauri::command]
async fn board_save(state: State<'_, AppState>) -> Result<Value, HostError> {
    execute_board(&state, "save".into(), false).await
}

fn merge_profile_result(profile: Value, mut comparison: Value) -> Value {
    comparison
        .as_object_mut()
        .expect("profile comparison is an object")
        .insert("profile".into(), profile);
    comparison
}

async fn selected_path(
    app: &tauri::AppHandle,
    title: &str,
    filter_name: &str,
    extension: &str,
    save_name: Option<String>,
) -> Result<Option<std::path::PathBuf>, HostError> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let mut builder = app
        .dialog()
        .file()
        .set_title(title)
        .add_filter(filter_name, &[extension]);
    if let Some(name) = save_name {
        builder = builder.set_file_name(name);
        builder.save_file(move |path| {
            let _ = sender.send(path);
        });
    } else {
        builder.pick_file(move |path| {
            let _ = sender.send(path);
        });
    }
    let path = receiver
        .await
        .map_err(|_| HostError::new("dialog_failed", "The file dialog closed unexpectedly."))?;
    path.map(|path| {
        path.into_path()
            .map_err(|error| HostError::new("invalid_path", error.to_string()))
    })
    .transpose()
}

async fn selected_folder(
    app: &tauri::AppHandle,
    title: &str,
) -> Result<Option<std::path::PathBuf>, HostError> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_title(title)
        .pick_folder(move |path| {
            let _ = sender.send(path);
        });
    let path = receiver
        .await
        .map_err(|_| HostError::new("dialog_failed", "The folder dialog closed unexpectedly."))?;
    path.map(|path| {
        path.into_path()
            .map_err(|error| HostError::new("invalid_path", error.to_string()))
    })
    .transpose()
}

#[tauri::command]
async fn profile_current(state: State<'_, AppState>) -> Result<Value, HostError> {
    let snapshot = profile::read_snapshot(&state.serial).await?;
    let profile = profile::create_profile(&snapshot, env!("CARGO_PKG_VERSION"))?;
    let comparison = profile::compare_profile(&profile, &snapshot)?;
    Ok(merge_profile_result(profile, comparison))
}

#[tauri::command]
async fn profile_export(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<Value, HostError> {
    let date = chrono::Utc::now().format("%Y-%m-%d");
    let Some(path) = selected_path(
        &app,
        "Export CATS configuration profile",
        "CATS configuration profile",
        "json",
        Some(format!("cats-vega-profile-{date}.json")),
    )
    .await?
    else {
        return Ok(json!({ "canceled": true }));
    };
    let snapshot = profile::read_snapshot(&state.serial).await?;
    let profile = profile::create_profile(&snapshot, env!("CARGO_PKG_VERSION"))?;
    let contents = serde_json::to_string_pretty(&profile)
        .map_err(|error| HostError::new("profile_encode_failed", error.to_string()))?;
    std::fs::write(path, format!("{contents}\n"))
        .map_err(|error| HostError::new("profile_write_failed", error.to_string()))?;
    Ok(json!({ "canceled": false, "profile": profile }))
}

#[tauri::command]
async fn profile_open(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<Value, HostError> {
    let Some(path) = selected_path(
        &app,
        "Open CATS configuration profile",
        "CATS configuration profile",
        "json",
        None,
    )
    .await?
    else {
        return Ok(json!({ "canceled": true }));
    };
    let metadata = std::fs::metadata(&path)
        .map_err(|error| HostError::new("profile_read_failed", error.to_string()))?;
    if metadata.len() > 1024 * 1024 {
        return Err(HostError::new(
            "profile_too_large",
            "Configuration profile is larger than 1 MB.",
        ));
    }
    let contents = std::fs::read_to_string(path)
        .map_err(|error| HostError::new("profile_read_failed", error.to_string()))?;
    let profile: Value = serde_json::from_str(&contents).map_err(|_| {
        HostError::new(
            "invalid_profile_json",
            "Configuration profile is not valid JSON.",
        )
    })?;
    profile::validate_profile(&profile)?;
    let snapshot = profile::read_snapshot(&state.serial).await?;
    let comparison = profile::compare_profile(&profile, &snapshot)?;
    let mut result = merge_profile_result(profile, comparison);
    result["canceled"] = json!(false);
    Ok(result)
}

#[tauri::command]
async fn profile_apply(profile: Value, state: State<'_, AppState>) -> Result<Value, HostError> {
    profile::validate_profile(&profile)?;
    let before = profile::read_snapshot(&state.serial).await?;
    let comparison = profile::compare_profile(&profile, &before)?;
    if comparison["compatibility"]["blocked"] == true {
        let message = comparison["compatibility"]["warnings"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|warning| warning["severity"] == "error")
            .filter_map(|warning| warning["message"].as_str())
            .collect::<Vec<_>>()
            .join(" ");
        return Err(HostError::new("profile_blocked", message));
    }
    let changed = profile::changed_entries(&comparison);
    let transaction = if changed.is_empty() {
        json!({ "ok": true, "saved": false, "results": [] })
    } else {
        apply_config_entries(
            changed
                .iter()
                .map(|(key, value)| ConfigEntry {
                    key: key.clone(),
                    value: value.clone(),
                })
                .collect(),
            &state,
        )
        .await?
    };
    let transaction_results = transaction["results"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|result| Some((result["key"].as_str()?.to_string(), result.clone())))
        .collect::<std::collections::HashMap<_, _>>();
    let results = comparison["rows"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|row| {
            let key = row["key"].as_str().unwrap_or_default();
            match row["status"].as_str().unwrap_or_default() {
                "same" => json!({ "key": key, "status": "unchanged" }),
                "changed" => transaction_results
                    .get(key)
                    .cloned()
                    .unwrap_or_else(|| json!({ "key": key, "status": "pending" })),
                status => json!({ "key": key, "status": status }),
            }
        })
        .collect::<Vec<_>>();
    let refreshed = if transaction["ok"] == true && !changed.is_empty() {
        profile::compare_profile(&profile, &profile::read_snapshot(&state.serial).await?)?
    } else {
        comparison
    };
    let mut result = refreshed;
    result["ok"] = transaction["ok"].clone();
    result["saved"] = transaction["saved"].clone();
    result["results"] = Value::Array(results);
    Ok(result)
}

#[tauri::command]
async fn preflight_run(state: State<'_, AppState>) -> Result<Value, HostError> {
    preflight::build_report(&profile::read_snapshot(&state.serial).await?)
}

#[tauri::command]
async fn flight_log_load(
    file_path: String,
    state: State<'_, AppState>,
) -> Result<Value, HostError> {
    if file_path.is_empty() || file_path.len() > 4096 {
        return Err(HostError::new(
            "invalid_path",
            "Flight-log path is invalid.",
        ));
    }
    state.handoff.cancel(&state.events).await;
    state
        .flight_logs
        .load_path(std::path::PathBuf::from(file_path), "local")
        .await
}

#[tauri::command]
async fn flight_log_choose_local(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<Value, HostError> {
    let Some(path) = selected_path(
        &app,
        "Open a Vega flight log",
        "CATS flight log",
        "cfl",
        None,
    )
    .await?
    else {
        return Ok(Value::Null);
    };
    state.handoff.cancel(&state.events).await;
    state.flight_logs.load_path(path, "local").await
}

#[tauri::command]
async fn flight_log_current(state: State<'_, AppState>) -> Result<Value, HostError> {
    Ok(state.flight_logs.current().await.unwrap_or(Value::Null))
}

#[tauri::command]
async fn flight_log_discover_onboard(state: State<'_, AppState>) -> Result<Value, HostError> {
    let result = state.flight_logs.discover().await;
    state
        .events
        .send("flight-log:onboard-changed", result.clone());
    Ok(result)
}

#[tauri::command]
async fn flight_log_choose_onboard(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<Value, HostError> {
    let Some(folder) = selected_folder(&app, "Choose the mounted CATS drive").await? else {
        return Ok(json!({ "status": "cancelled", "logs": [] }));
    };
    let result = state.flight_logs.select_volume(folder).await?;
    state
        .events
        .send("flight-log:onboard-changed", result.clone());
    Ok(result)
}

#[tauri::command]
async fn flight_log_refresh_onboard(state: State<'_, AppState>) -> Result<Value, HostError> {
    let result = state.flight_logs.refresh().await;
    state
        .events
        .send("flight-log:onboard-changed", result.clone());
    Ok(result)
}

#[tauri::command]
async fn flight_log_clear_onboard(state: State<'_, AppState>) -> Result<Value, HostError> {
    let result = state.flight_logs.clear().await;
    state
        .events
        .send("flight-log:onboard-changed", result.clone());
    Ok(result)
}

#[tauri::command]
async fn flight_log_open_onboard(
    log_id: String,
    state: State<'_, AppState>,
) -> Result<Value, HostError> {
    state.handoff.cancel(&state.events).await;
    state.flight_logs.open_onboard(&log_id).await
}

fn confirm_removal(output: &[String], path: &str, allow_missing: bool) -> Result<(), HostError> {
    let text = output.join("\n");
    if text.to_lowercase().contains("removal of file") && text.to_lowercase().contains("failed") {
        return Err(HostError::new(
            "remove_failed",
            format!("The Vega could not remove {path}."),
        ));
    }
    if text.to_lowercase().contains("cannot remove") && text.to_lowercase().contains("not a file") {
        return if allow_missing {
            Ok(())
        } else {
            Err(HostError::new(
                "remove_missing",
                format!("{path} is no longer present on the Vega."),
            ))
        };
    }
    if !text.to_lowercase().contains(" removed!") {
        return Err(HostError::new(
            "remove_unconfirmed",
            format!("The Vega did not confirm removal of {path}."),
        ));
    }
    Ok(())
}

async fn remove_board_flight_log(state: &AppState, name: &str) -> Result<Value, HostError> {
    let lower = name.to_lowercase();
    let alias = lower
        .strip_prefix("fl")
        .and_then(|value| value.strip_suffix(".cfl"))
        .and_then(|value| value.parse::<u16>().ok())
        .filter(|value| *value <= 255)
        .ok_or_else(|| {
            HostError::new(
                "invalid_log_name",
                "The selected onboard file is not a Vega flight log.",
            )
        })?;
    let _transaction = state.serial.transaction.lock().await;
    let listing = state
        .serial
        .execute_unlocked("ls /flights".into(), CommandOptions::default())
        .await?;
    let expression = regex::Regex::new(r"flight_(\d{5})").expect("valid flight name expression");
    let mut matches = listing
        .iter()
        .flat_map(|line| expression.captures_iter(line))
        .filter_map(|capture| capture.get(1).map(|value| value.as_str().to_string()))
        .filter(|value| {
            value
                .parse::<u32>()
                .is_ok_and(|value| value & 0xff == u32::from(alias))
        })
        .collect::<Vec<_>>();
    matches.sort();
    matches.dedup();
    if matches.is_empty() {
        return Ok(
            json!({ "ok": true, "alreadyMissing": true, "flightPath": null, "statsPath": null, "configPath": null, "statsName": format!("st{alias:03}.txt") }),
        );
    }
    if matches.len() > 1 {
        return Err(HostError::new(
            "ambiguous_log",
            format!(
                "The mounted name {name} matches more than one Vega flight. Reboot the Vega and try again."
            ),
        ));
    }
    let number = &matches[0];
    let flight_path = format!("/flights/flight_{number}");
    let stats_path = format!("/stats/stats_{number}.txt");
    let config_path = format!("/configs/flight_{number}.cfg");
    let stats = state
        .serial
        .execute_unlocked(format!("rm {stats_path}"), CommandOptions::default())
        .await?;
    confirm_removal(&stats, &stats_path, true)?;
    let config = state
        .serial
        .execute_unlocked(format!("rm {config_path}"), CommandOptions::default())
        .await?;
    confirm_removal(&config, &config_path, true)?;
    let flight = state
        .serial
        .execute_unlocked(format!("rm {flight_path}"), CommandOptions::default())
        .await?;
    confirm_removal(&flight, &flight_path, false)?;
    Ok(
        json!({ "ok": true, "flightPath": flight_path, "statsPath": stats_path, "configPath": config_path, "statsName": format!("st{alias:03}.txt") }),
    )
}

#[tauri::command]
async fn flight_log_remove_onboard(
    log_id: String,
    state: State<'_, AppState>,
) -> Result<Value, HostError> {
    let name = state.flight_logs.onboard_name(&log_id).await?;
    let removal = remove_board_flight_log(&state, &name).await?;
    let mut result = state.flight_logs.hide_onboard(&log_id).await?;
    result["removal"] = removal;
    state
        .events
        .send("flight-log:onboard-changed", result.clone());
    Ok(result)
}

#[tauri::command]
async fn flight_log_export_csv(
    app: tauri::AppHandle,
    session_id: String,
    state: State<'_, AppState>,
) -> Result<Value, HostError> {
    let session = state.flight_logs.session(&session_id).await?;
    let Some(folder) = selected_folder(&app, "Export flight-log CSV files").await? else {
        return Ok(Value::Null);
    };
    let stem = std::path::Path::new(&session.name)
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy();
    let output = state
        .flight_logs
        .assert_destination(&folder.join(flight_log::export_name(&stem, "export")))
        .await?;
    std::fs::create_dir(&output)
        .map_err(|error| HostError::new("export_failed", error.to_string()))?;
    for section in [
        "imu",
        "baro",
        "flightInfo",
        "orientationInfo",
        "filteredDataInfo",
        "gnssInfo",
        "flightStates",
        "eventInfo",
        "voltageInfo",
    ] {
        let csv = flight_log::to_csv(&session.flight_log[section])?;
        std::fs::write(output.join(format!("{section}.csv")), csv)
            .map_err(|error| HostError::new("export_failed", error.to_string()))?;
    }
    Ok(json!(output.to_string_lossy()))
}

#[tauri::command]
async fn flight_log_export_html(
    app: tauri::AppHandle,
    session_id: String,
    use_imperial_units: bool,
    state: State<'_, AppState>,
) -> Result<Value, HostError> {
    let session = state.flight_logs.session(&session_id).await?;
    let Some(folder) = selected_folder(&app, "Export flight-log plots").await? else {
        return Ok(Value::Null);
    };
    let stem = std::path::Path::new(&session.name)
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy();
    let output = state
        .flight_logs
        .assert_destination(
            &folder.join(format!("{}.html", flight_log::export_name(&stem, "plots"))),
        )
        .await?;
    std::fs::write(
        &output,
        flight_log::standalone_html(&session.flight_log, use_imperial_units)?,
    )
    .map_err(|error| HostError::new("export_failed", error.to_string()))?;
    Ok(json!(output.to_string_lossy()))
}

#[tauri::command]
async fn flight_log_save_original(
    app: tauri::AppHandle,
    session_id: String,
    state: State<'_, AppState>,
) -> Result<Value, HostError> {
    let session = state.flight_logs.session(&session_id).await?;
    let Some(path) = selected_path(
        &app,
        "Save flight log",
        "CATS flight log",
        "cfl",
        Some(session.name.clone()),
    )
    .await?
    else {
        return Ok(Value::Null);
    };
    let path = state.flight_logs.assert_destination(&path).await?;
    std::fs::write(&path, session.bytes)
        .map_err(|error| HostError::new("save_failed", error.to_string()))?;
    Ok(json!(path.to_string_lossy()))
}

#[tauri::command]
async fn flight_log_open_in_flights(
    app: tauri::AppHandle,
    session_id: String,
    state: State<'_, AppState>,
) -> Result<Value, HostError> {
    let session = state.flight_logs.session(&session_id).await?;
    state
        .handoff
        .start(app, session, Arc::clone(&state.events))
        .await
}

#[tauri::command]
async fn flight_log_cancel_handoff(state: State<'_, AppState>) -> Result<bool, HostError> {
    Ok(state.handoff.cancel(&state.events).await)
}

#[tauri::command]
fn firmware_current(state: State<'_, AppState>) -> firmware::Snapshot {
    state.firmware.current()
}
#[tauri::command]
fn firmware_check(state: State<'_, AppState>) -> Result<firmware::Snapshot, HostError> {
    state.firmware.check()
}
#[tauri::command]
fn firmware_start(
    request: firmware::StartRequest,
    state: State<'_, AppState>,
) -> Result<firmware::Snapshot, HostError> {
    state.firmware.start(request)
}
#[tauri::command]
fn firmware_retry(state: State<'_, AppState>) -> Result<firmware::Snapshot, HostError> {
    state.firmware.retry()
}
#[tauri::command]
fn firmware_cancel(state: State<'_, AppState>) -> Result<firmware::Snapshot, HostError> {
    state.firmware.cancel()
}

fn command_allowed_during_firmware(command: &str) -> bool {
    matches!(
        command,
        "initialize_host" | "firmware_current" | "firmware_cancel"
    )
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::default())
        .setup(|app| {
            let directory = app.path().app_log_dir()?;
            app.state::<AppState>().serial.set_log_directory(directory);
            app.state::<AppState>().firmware.set_cache(app.path().app_cache_dir()?);
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.state::<AppState>().firmware.busy() {
                    api.prevent_close();
                    window.state::<AppState>().events.send("app:alert", json!("A firmware operation is active. Cancel preparation or wait for the device operation to finish before closing."));
                }
            }
        })
        .invoke_handler(|invoke| {
            if invoke.message.webview().state::<AppState>().firmware.busy()
                && !command_allowed_during_firmware(invoke.message.command()) {
                invoke.resolver.reject(HostError::new("firmware_busy", "A firmware operation is active. Wait until it finishes."));
                return true;
            }
            let handler: fn(tauri::ipc::Invoke<tauri::Wry>) -> bool = tauri::generate_handler![
            firmware_current,
            firmware_check,
            firmware_start,
            firmware_retry,
            firmware_cancel,
            initialize_host,
            app_open_external,
            serial_list,
            serial_connect,
            serial_disconnect,
            serial_send,
            board_get_configs,
            board_get_config,
            board_set_config,
            board_apply_config,
            board_get_events,
            board_get_timers,
            board_get_info,
            board_get_log_info,
            board_reset,
            board_save,
            profile_current,
            profile_export,
            profile_open,
            profile_apply,
            preflight_run,
            flight_log_load,
            flight_log_choose_local,
            flight_log_current,
            flight_log_export_csv,
            flight_log_export_html,
            flight_log_discover_onboard,
            flight_log_choose_onboard,
            flight_log_refresh_onboard,
            flight_log_clear_onboard,
            flight_log_open_onboard,
            flight_log_remove_onboard,
            flight_log_save_original,
            flight_log_open_in_flights,
            flight_log_cancel_handoff,
        ];
            handler(invoke)
        })
        .build(tauri::generate_context!())
        .expect("error while building CATS Configurator")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                if app.state::<AppState>().firmware.busy() { api.prevent_exit(); }
            }
        });
}

#[cfg(test)]
mod tests {
    #[test]
    fn firmware_lock_excludes_all_conflicting_host_commands() {
        for command in [
            "serial_connect",
            "serial_disconnect",
            "serial_send",
            "board_save",
            "profile_apply",
            "flight_log_remove_onboard",
            "firmware_start",
            "firmware_check",
            "firmware_retry",
        ] {
            assert!(!super::command_allowed_during_firmware(command));
        }
        for command in ["firmware_current", "firmware_cancel", "initialize_host"] {
            assert!(super::command_allowed_during_firmware(command));
        }
    }
    #[test]
    fn application_version_matches_installer() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        assert_eq!(config["version"].as_str(), Some(env!("CARGO_PKG_VERSION")));
    }
}
