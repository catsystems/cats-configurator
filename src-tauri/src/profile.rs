use std::collections::{HashMap, HashSet};

use chrono::Utc;
use serde_json::{Map, Value, json};

use crate::{
    error::HostError,
    protocol::{parse_config_response, parse_config_responses},
    serial::{CommandOptions, SerialManager},
};

pub const CONFIG_KEYS: [&str; 10] = [
    "main_altitude",
    "acc_threshold",
    "servo1_init_pos",
    "servo2_init_pos",
    "tele_enable",
    "tele_link_phrase",
    "tele_power_level",
    "tele_adaptive_power",
    "test_mode",
    "tele_test_phrase",
];
pub const EVENT_KEYS: [&str; 7] = [
    "ev_liftoff",
    "ev_burnout",
    "ev_apogee",
    "ev_main_deployment",
    "ev_touchdown",
    "ev_custom1",
    "ev_custom2",
];
pub const TIMER_KEYS: [&str; 4] = ["timer1", "timer2", "timer3", "timer4"];
pub const TIMER_FIELDS: [&str; 3] = ["start", "duration", "trigger"];
pub const LOG_KEYS: [&str; 2] = ["rec_speed", "rec_elements"];
pub const PROFILE_FORMAT: &str = "cats-configurator-profile";
pub const PROFILE_SCHEMA_VERSION: i64 = 1;

pub fn board_keys() -> Vec<String> {
    CONFIG_KEYS
        .iter()
        .chain(EVENT_KEYS.iter())
        .map(|key| (*key).to_string())
        .chain(TIMER_KEYS.iter().flat_map(|timer| {
            TIMER_FIELDS
                .iter()
                .map(move |field| format!("{timer}_{field}"))
        }))
        .chain(LOG_KEYS.iter().map(|key| (*key).to_string()))
        .collect()
}

fn profile_keys() -> Vec<String> {
    board_keys()
        .into_iter()
        .filter(|key| !LOG_KEYS.contains(&key.as_str()))
        .collect()
}

pub fn parse_board_identity(lines: &[String]) -> Value {
    let value_after = |label: &str| {
        lines
            .iter()
            .find_map(|line| line.strip_prefix(label))
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string)
    };
    json!({
        "model": value_after("Board:"),
        "firmwareVersion": value_after("Code version:").or_else(|| value_after("Firmware:")),
        "telemetryFirmwareVersion": value_after("Telemetry Code version:")
    })
}

pub async fn read_snapshot(serial: &SerialManager) -> Result<Value, HostError> {
    let _transaction = serial.transaction.lock().await;
    let version = serial
        .execute_unlocked("version".into(), CommandOptions::default())
        .await?;
    let (configurations, unsupported) = collect_configurations(serial).await?;
    let values = configurations
        .into_iter()
        .filter_map(|config| {
            let key = config["key"].as_str()?.to_string();
            Some((key, config["value"].clone()))
        })
        .collect::<Map<String, Value>>();
    Ok(json!({
        "board": parse_board_identity(&version),
        "values": values,
        "unsupportedKeys": unsupported
    }))
}

async fn collect_configurations(
    serial: &SerialManager,
) -> Result<(Vec<Value>, Vec<String>), HostError> {
    let mut configurations = HashMap::new();
    if let Ok(output) = serial
        .execute_unlocked("get".into(), CommandOptions::default())
        .await
    {
        if let Ok(configs) = parse_config_responses(&output) {
            for config in configs {
                if let Some(key) = config["key"].as_str() {
                    if !config["type"].is_null() {
                        configurations.insert(key.to_string(), config);
                    }
                }
            }
        }
    }
    let mut unsupported = Vec::new();
    for key in board_keys() {
        if configurations.contains_key(&key) {
            continue;
        }
        match serial
            .execute_unlocked(format!("get {key}"), CommandOptions::default())
            .await
            .and_then(|output| parse_config_response(&output))
        {
            Ok(config) => {
                configurations.insert(key, config);
            }
            Err(error)
                if error.code == "board_protocol_error"
                    && error.message.to_lowercase().contains("invalid name") =>
            {
                unsupported.push(key);
            }
            Err(error) => return Err(error),
        }
    }
    let configs = board_keys()
        .into_iter()
        .filter_map(|key| configurations.remove(&key))
        .collect();
    Ok((configs, unsupported))
}

pub async fn read_configurations(serial: &SerialManager) -> Result<Value, HostError> {
    let _transaction = serial.transaction.lock().await;
    let (configs, unsupported_keys) = collect_configurations(serial).await?;
    Ok(json!({
        "configs": configs,
        "unsupportedKeys": unsupported_keys
    }))
}

pub fn create_profile(snapshot: &Value, app_version: &str) -> Result<Value, HostError> {
    let values = snapshot["values"].as_object().ok_or_else(|| {
        HostError::new(
            "invalid_snapshot",
            "Board snapshot values must be an object.",
        )
    })?;
    let section = |keys: &[&str]| {
        keys.iter()
            .filter_map(|key| {
                values
                    .get(*key)
                    .map(|value| ((*key).to_string(), value.clone()))
            })
            .collect::<Map<_, _>>()
    };
    let timers = TIMER_KEYS
        .iter()
        .map(|timer| {
            let fields = TIMER_FIELDS
                .iter()
                .filter_map(|field| {
                    values
                        .get(&format!("{timer}_{field}"))
                        .map(|value| ((*field).to_string(), value.clone()))
                })
                .collect::<Map<_, _>>();
            ((*timer).to_string(), Value::Object(fields))
        })
        .collect::<Map<_, _>>();
    Ok(json!({
        "format": PROFILE_FORMAT,
        "schemaVersion": PROFILE_SCHEMA_VERSION,
        "createdAt": Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        "source": {
            "boardModel": snapshot["board"]["model"].clone(),
            "firmwareVersion": snapshot["board"]["firmwareVersion"].clone(),
            "telemetryFirmwareVersion": snapshot["board"]["telemetryFirmwareVersion"].clone(),
            "configuratorVersion": app_version
        },
        "configuration": section(&CONFIG_KEYS),
        "events": section(&EVENT_KEYS),
        "timers": timers,
        "logging": {}
    }))
}

fn validate_profile_value(value: &Value, key: &str) -> Result<(), HostError> {
    let valid = match value {
        Value::String(value) => value.len() <= 512 && !value.contains(['\r', '\n']),
        Value::Number(value) => value.as_f64().is_some_and(f64::is_finite),
        Value::Bool(_) => true,
        _ => false,
    };
    if valid {
        Ok(())
    } else {
        Err(HostError::new(
            "invalid_profile",
            format!("Profile value {key} must be a finite scalar on one line."),
        ))
    }
}

pub fn flatten_profile(profile: &Value) -> Result<Vec<(String, Value)>, HostError> {
    let mut entries = Vec::new();
    for section in ["configuration", "events"] {
        let values = profile[section].as_object().ok_or_else(|| {
            HostError::new(
                "invalid_profile",
                format!("Profile {section} must be an object."),
            )
        })?;
        for (key, value) in values {
            validate_profile_value(value, key)?;
            entries.push((key.clone(), value.clone()));
        }
    }
    let timers = profile["timers"]
        .as_object()
        .ok_or_else(|| HostError::new("invalid_profile", "Profile timers must be an object."))?;
    for (timer, fields) in timers {
        let fields = fields.as_object().ok_or_else(|| {
            HostError::new(
                "invalid_profile",
                format!("Profile timer {timer} must be an object."),
            )
        })?;
        for (field, value) in fields {
            let key = format!("{timer}_{field}");
            validate_profile_value(value, &key)?;
            entries.push((key, value.clone()));
        }
    }
    Ok(entries)
}

pub fn validate_profile(profile: &Value) -> Result<(), HostError> {
    let object = profile.as_object().ok_or_else(|| {
        HostError::new(
            "invalid_profile",
            "Configuration profile must be an object.",
        )
    })?;
    if object.get("format").and_then(Value::as_str) != Some(PROFILE_FORMAT) {
        return Err(HostError::new(
            "invalid_profile",
            "This file is not a CATS Configurator profile.",
        ));
    }
    if object
        .get("schemaVersion")
        .and_then(Value::as_i64)
        .is_none_or(|version| version < 1)
    {
        return Err(HostError::new(
            "invalid_profile",
            "Profile schemaVersion must be a positive integer.",
        ));
    }
    if !object.get("createdAt").is_some_and(Value::is_string) {
        return Err(HostError::new(
            "invalid_profile",
            "Profile createdAt must be a string.",
        ));
    }
    let source = object
        .get("source")
        .and_then(Value::as_object)
        .ok_or_else(|| HostError::new("invalid_profile", "Profile source must be an object."))?;
    for key in [
        "boardModel",
        "firmwareVersion",
        "telemetryFirmwareVersion",
        "configuratorVersion",
    ] {
        if source
            .get(key)
            .is_none_or(|value| !(value.is_null() || value.is_string()))
        {
            return Err(HostError::new(
                "invalid_profile",
                format!("Profile source {key} must be a string or null."),
            ));
        }
    }
    if !object.get("logging").is_some_and(Value::is_object) {
        return Err(HostError::new(
            "invalid_profile",
            "Profile logging must be an object.",
        ));
    }
    let entries = flatten_profile(profile)?;
    let mut seen = HashSet::new();
    for (key, _) in entries {
        if !seen.insert(key.clone()) {
            return Err(HostError::new(
                "invalid_profile",
                format!("Profile contains duplicate field {key}."),
            ));
        }
    }
    Ok(())
}

fn values_match(left: &Value, right: &Value) -> bool {
    if left.is_number() || right.is_number() {
        let number = |value: &Value| {
            value
                .as_f64()
                .or_else(|| value.as_str().and_then(|value| value.trim().parse().ok()))
        };
        return number(left) == number(right);
    }
    if left.is_boolean() || right.is_boolean() {
        let normalize = |value: &Value| {
            value.as_bool().unwrap_or_else(|| {
                value
                    .as_str()
                    .is_some_and(|value| value.eq_ignore_ascii_case("ON"))
            })
        };
        return normalize(left) == normalize(right);
    }
    left.as_str().unwrap_or_default().trim() == right.as_str().unwrap_or_default().trim()
}

fn section_for_key(key: &str) -> &'static str {
    if CONFIG_KEYS.contains(&key) {
        "Configuration"
    } else if EVENT_KEYS.contains(&key) {
        "Events"
    } else if TIMER_KEYS
        .iter()
        .any(|timer| key.starts_with(&format!("{timer}_")))
    {
        "Timers"
    } else {
        "Unknown"
    }
}

fn title_case(value: &str) -> String {
    value
        .split('_')
        .map(|word| {
            let mut chars = word.chars();
            chars
                .next()
                .map(|first| first.to_uppercase().collect::<String>() + chars.as_str())
                .unwrap_or_default()
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn label_for_key(key: &str) -> String {
    match key {
        "main_altitude" => "Main Altitude".into(),
        "acc_threshold" => "Liftoff Detection Acceleration".into(),
        "servo1_init_pos" => "Initial Position Servo 1".into(),
        "servo2_init_pos" => "Initial Position Servo 2".into(),
        "tele_enable" => "Enable Telemetry".into(),
        "tele_link_phrase" => "Link Phrase".into(),
        "tele_power_level" => "Telemetry Power Level".into(),
        "tele_adaptive_power" => "Adaptive Power Level".into(),
        "test_mode" => "Enable Testing Mode".into(),
        "tele_test_phrase" => "Testing Phrase".into(),
        _ if key.starts_with("ev_") => format!("{} Actions", title_case(&key[3..])),
        _ if key.starts_with("timer") => {
            let (timer, field) = key.split_once('_').unwrap_or((key, ""));
            format!(
                "Timer {} {}",
                timer.trim_start_matches("timer"),
                title_case(field)
            )
        }
        _ => title_case(key),
    }
}

pub fn compare_profile(profile: &Value, snapshot: &Value) -> Result<Value, HostError> {
    validate_profile(profile)?;
    let board_values = snapshot["values"].as_object().ok_or_else(|| {
        HostError::new(
            "invalid_snapshot",
            "Board snapshot values must be an object.",
        )
    })?;
    let unsupported = snapshot["unsupportedKeys"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .collect::<HashSet<_>>();
    let profile_values = flatten_profile(profile)?
        .into_iter()
        .collect::<HashMap<_, _>>();
    let known = profile_keys().into_iter().collect::<HashSet<_>>();
    let mut keys = profile_keys();
    for key in profile_values.keys() {
        if !keys.contains(key) {
            keys.push(key.clone());
        }
    }
    let rows = keys
        .iter()
        .map(|key| {
            let profile_value = profile_values.get(key);
            let board_value = board_values.get(key);
            let has_board = board_value.is_some() && !unsupported.contains(key.as_str());
            let status = if !known.contains(key) || !has_board {
                "unsupported"
            } else if profile_value.is_none() {
                "missing"
            } else if values_match(profile_value.unwrap(), board_value.unwrap()) {
                "same"
            } else {
                "changed"
            };
            json!({
                "key": key,
                "section": section_for_key(key),
                "label": label_for_key(key),
                "boardValue": if has_board { board_value.cloned().unwrap_or(Value::Null) } else { Value::Null },
                "profileValue": profile_value.cloned().unwrap_or(Value::Null),
                "status": status
            })
        })
        .collect::<Vec<_>>();

    let mut warnings = Vec::new();
    let mut blocked = false;
    let schema = profile["schemaVersion"].as_i64().unwrap_or_default();
    if schema != PROFILE_SCHEMA_VERSION {
        blocked = true;
        warnings.push(json!({ "severity": "error", "message": format!("Profile schema {schema} is not supported by this Configurator (schema {PROFILE_SCHEMA_VERSION}).") }));
    }
    let profile_model = profile["source"]["boardModel"].as_str();
    let board_model = snapshot["board"]["model"].as_str();
    if let (Some(profile_model), Some(board_model)) = (profile_model, board_model) {
        if !profile_model.is_empty() && !board_model.is_empty() && profile_model != board_model {
            blocked = true;
            warnings.push(json!({ "severity": "error", "message": format!("Profile board {profile_model} does not match connected board {board_model}.") }));
        }
    }
    let profile_firmware = profile["source"]["firmwareVersion"].as_str();
    let board_firmware = snapshot["board"]["firmwareVersion"].as_str();
    if let (Some(profile_firmware), Some(board_firmware)) = (profile_firmware, board_firmware) {
        if !profile_firmware.is_empty()
            && !board_firmware.is_empty()
            && profile_firmware != board_firmware
        {
            warnings.push(json!({ "severity": "warning", "message": format!("Profile firmware {profile_firmware} differs from connected firmware {board_firmware}. Review the diff before applying.") }));
        }
    }
    let unsupported_count = rows
        .iter()
        .filter(|row| row["status"] == "unsupported")
        .count();
    let missing_count = rows.iter().filter(|row| row["status"] == "missing").count();
    if unsupported_count > 0 {
        warnings.push(json!({ "severity": "warning", "message": format!("{unsupported_count} profile field{} unsupported and will not be applied.", if unsupported_count == 1 { " is" } else { "s are" }) }));
    }
    if missing_count > 0 {
        warnings.push(json!({ "severity": "warning", "message": format!("{missing_count} board field{} missing from the profile and will remain unchanged.", if missing_count == 1 { " is" } else { "s are" }) }));
    }
    let changed_count = rows.iter().filter(|row| row["status"] == "changed").count();
    Ok(json!({
        "rows": rows,
        "compatibility": {
            "blocked": blocked,
            "canApply": !blocked,
            "warnings": warnings,
            "changedCount": changed_count
        }
    }))
}

pub fn changed_entries(comparison: &Value) -> Vec<(String, Value)> {
    comparison["rows"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|row| row["status"] == "changed")
        .filter_map(|row| {
            Some((
                row["key"].as_str()?.to_string(),
                row["profileValue"].clone(),
            ))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::*;
    use crate::{events::EventBus, preflight, serial::SerialManager};

    fn snapshot() -> Value {
        let values = board_keys()
            .into_iter()
            .enumerate()
            .map(|(index, key)| (key, json!(index)))
            .collect::<Map<_, _>>();
        json!({
            "board": { "model": "CATS Vega", "firmwareVersion": "3.1.0", "telemetryFirmwareVersion": "1.2.0" },
            "values": values,
            "unsupportedKeys": []
        })
    }

    #[test]
    fn profile_round_trip_and_comparison_match_v1_shape() {
        let board = snapshot();
        let mut profile = create_profile(&board, "2.0.0").unwrap();
        validate_profile(&profile).unwrap();
        assert_eq!(
            compare_profile(&profile, &board).unwrap()["compatibility"]["changedCount"],
            0
        );
        profile["configuration"]["main_altitude"] = json!(999);
        let comparison = compare_profile(&profile, &board).unwrap();
        assert_eq!(comparison["compatibility"]["changedCount"], 1);
        assert_eq!(changed_entries(&comparison)[0].0, "main_altitude");
    }

    #[test]
    fn rejects_duplicate_and_multiline_fields() {
        let board = snapshot();
        let mut profile = create_profile(&board, "2.0.0").unwrap();
        profile["events"]["main_altitude"] = json!(20);
        assert!(
            validate_profile(&profile)
                .unwrap_err()
                .message
                .contains("duplicate")
        );
        profile["events"]
            .as_object_mut()
            .unwrap()
            .remove("main_altitude");
        profile["configuration"]["main_altitude"] = json!("200\nsave");
        assert!(validate_profile(&profile).is_err());
    }

    #[test]
    fn comparison_matches_v1_numeric_and_empty_identity_semantics() {
        let board = snapshot();
        let mut profile = create_profile(&board, "2.0.0").unwrap();
        profile["configuration"]["main_altitude"] = json!("0");
        assert_eq!(
            compare_profile(&profile, &board).unwrap()["rows"]
                .as_array()
                .unwrap()
                .iter()
                .find(|row| row["key"] == "main_altitude")
                .unwrap()["status"],
            "same"
        );

        profile["source"]["boardModel"] = json!("");
        profile["source"]["firmwareVersion"] = json!("");
        let comparison = compare_profile(&profile, &board).unwrap();
        assert_eq!(comparison["compatibility"]["blocked"], false);
        assert!(
            comparison["compatibility"]["warnings"]
                .as_array()
                .unwrap()
                .iter()
                .all(|warning| !warning["message"]
                    .as_str()
                    .unwrap()
                    .contains("differs from connected firmware"))
        );
    }

    #[tokio::test]
    #[ignore = "requires a connected Vega and CATS_VEGA_PORT"]
    async fn hardware_profile_and_preflight_are_read_only() {
        let port = std::env::var("CATS_VEGA_PORT").expect("set CATS_VEGA_PORT");
        let runs = std::env::var("CATS_BENCHMARK_RUNS")
            .ok()
            .and_then(|value| value.parse::<usize>().ok())
            .unwrap_or(1)
            .max(1);
        let serial = SerialManager::new(Arc::new(EventBus::default()));
        serial.connect(port).await.unwrap();
        let mut snapshot = Value::Null;
        for run in 1..=runs {
            let started_at = std::time::Instant::now();
            snapshot = read_snapshot(&serial).await.unwrap();
            eprintln!(
                "Profile snapshot run {run}: {:.1} ms.",
                started_at.elapsed().as_secs_f64() * 1000.0
            );
        }
        let profile = create_profile(&snapshot, "2.0.0").unwrap();
        let comparison = compare_profile(&profile, &snapshot).unwrap();
        assert_eq!(comparison["compatibility"]["changedCount"], 0);
        let report = preflight::build_report(&snapshot).unwrap();
        assert!(matches!(
            report["status"].as_str(),
            Some("READY" | "WARNING")
        ));
        assert_eq!(report["checks"].as_array().unwrap().len(), 6);
        serial.disconnect().await;
    }
}
