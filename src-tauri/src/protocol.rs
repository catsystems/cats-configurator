use std::collections::HashSet;

use regex::Regex;
use serde_json::{Number, Value, json};

use crate::error::HostError;

pub fn normalize_command(command: &str) -> String {
    let whitespace = Regex::new(r"\s+").expect("valid whitespace expression");
    let assignment = Regex::new(r"\s*=\s*").expect("valid assignment expression");
    whitespace
        .replace_all(&assignment.replace_all(command.trim(), "="), " ")
        .to_lowercase()
}

pub fn parse_prompt_command(data: &str) -> Option<String> {
    if !data.contains("^._.^") {
        return None;
    }
    Some(
        data.rsplit_once('>')
            .map(|(_, command)| command.trim())
            .unwrap_or("")
            .to_string(),
    )
}

pub fn parse_data(key: &str, lines: &[String]) -> Value {
    json!({ "key": key, "value": lines })
}

fn parse_range(line: &str) -> Vec<Value> {
    let expression =
        Regex::new(r"^(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)$").expect("valid range expression");
    let value = line
        .split_once(':')
        .map(|(_, value)| value.trim())
        .unwrap_or("");
    let Some(captures) = expression.captures(value) else {
        return Vec::new();
    };
    captures
        .iter()
        .skip(1)
        .flatten()
        .filter_map(|capture| capture.as_str().parse::<f64>().ok())
        .filter_map(Number::from_f64)
        .map(Value::Number)
        .collect()
}

fn action(index: i64, value: i64) -> Option<Value> {
    let item = match index {
        1 => json!({ "name": "Delay", "args": [0, 16000], "type": "NUMBER", "unit": "ms" }),
        2 => {
            json!({ "name": "Pyro 1", "args": [{"text":"OFF","value":0},{"text":"ON","value":1}], "type": "SELECT", "unit": null })
        }
        3 => {
            json!({ "name": "Pyro 2", "args": [{"text":"OFF","value":0},{"text":"ON","value":1}], "type": "SELECT", "unit": null })
        }
        4 => {
            json!({ "name": "IO 1", "args": [{"text":"OFF","value":0},{"text":"ON","value":1}], "type": "SELECT", "unit": null })
        }
        5 => json!({ "name": "Servo 1", "args": [0, 1000], "type": "NUMBER", "unit": "‰" }),
        6 => json!({ "name": "Servo 2", "args": [0, 1000], "type": "NUMBER", "unit": "‰" }),
        7 => {
            json!({ "name": "Recorder", "args": [{"text":"OFF","value":0},{"text":"PRE","value":1},{"text":"LOG","value":2}], "type": "SELECT", "unit": null })
        }
        _ => return None,
    };
    let mut item = item;
    item["index"] = json!(index);
    item["value"] = json!(value);
    Some(item)
}

pub fn parse_config_response(lines: &[String]) -> Result<Value, HostError> {
    let value_line = lines
        .iter()
        .find(|line| line.contains(" = "))
        .ok_or_else(|| {
            HostError::new(
                "invalid_board_response",
                "Board did not return a configuration value.",
            )
        })?;
    let (key, raw_value) = value_line.split_once(" = ").ok_or_else(|| {
        HostError::new(
            "invalid_board_response",
            "Board returned an invalid configuration value.",
        )
    })?;
    let mut result = json!({ "key": key, "value": raw_value });

    if let Some(line) = lines.iter().find(|line| line.contains("Allowed values:")) {
        let values = line
            .split_once(':')
            .map(|(_, value)| value)
            .unwrap_or("")
            .split(',')
            .map(|value| Value::String(value.trim().to_string()))
            .collect::<Vec<_>>();
        result["type"] = json!("SELECT");
        result["allowedValues"] = Value::Array(values);
    } else if let Some(line) = lines.iter().find(|line| line.contains("Allowed range:")) {
        let value = raw_value.parse::<f64>().ok().and_then(Number::from_f64);
        result["type"] = json!("NUMBER");
        result["value"] = value.map(Value::Number).unwrap_or(Value::Null);
        result["allowedRange"] = Value::Array(parse_range(line));
    } else if let Some(line) = lines.iter().find(|line| line.contains("String length:")) {
        result["type"] = json!("STRING");
        result["allowedRange"] = Value::Array(parse_range(line));
    } else if let Some(line) = lines.iter().find(|line| line.contains("Array length:")) {
        let array_length = line
            .split_once(':')
            .and_then(|(_, value)| value.trim().parse::<usize>().ok())
            .unwrap_or(0);
        let values = raw_value
            .split(',')
            .filter_map(|value| value.parse::<i64>().ok())
            .take(array_length)
            .collect::<Vec<_>>();
        let mut normalized_values: Vec<i64> = Vec::new();
        let mut actions = Vec::new();
        for pair in values.chunks_exact(2) {
            if pair[0] == 0 {
                continue;
            }
            if let Some(item) = action(pair[0], pair[1]) {
                normalized_values.extend(pair);
                actions.push(item);
            }
        }
        result["type"] = json!("EVENT");
        result["arrayLength"] = json!(array_length);
        result["values"] = json!(normalized_values);
        result["actions"] = Value::Array(actions);
    }

    Ok(result)
}

pub fn parse_config_responses(lines: &[String]) -> Result<Vec<Value>, HostError> {
    let key_expression = Regex::new(r"^[a-z0-9_]+\s+=\s+").expect("valid key expression");
    let mut responses: Vec<Vec<String>> = Vec::new();
    let mut current = Vec::new();
    for line in lines {
        if key_expression.is_match(line) {
            if !current.is_empty() {
                responses.push(std::mem::take(&mut current));
            }
            current.push(line.clone());
        } else if !current.is_empty() && !line.trim().is_empty() {
            current.push(line.clone());
        }
    }
    if !current.is_empty() {
        responses.push(current);
    }

    let configs = responses
        .iter()
        .map(|response| parse_config_response(response))
        .collect::<Result<Vec<_>, _>>()?;
    let mut keys = HashSet::new();
    for config in &configs {
        let key = config["key"].as_str().unwrap_or_default();
        if !keys.insert(key.to_string()) {
            return Err(HostError::new(
                "duplicate_board_value",
                format!("Board returned duplicate configuration value: {key}."),
            ));
        }
    }
    Ok(configs)
}

pub fn validate_key(key: &str) -> Result<(), HostError> {
    if key.is_empty()
        || key.len() > 128
        || !key.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
    {
        return Err(HostError::new(
            "invalid_board_key",
            "Board key contains unsupported characters.",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_prompt_and_normalizes_commands() {
        assert_eq!(
            parse_prompt_command("^._.^:/> get main_altitude"),
            Some("get main_altitude".into())
        );
        assert_eq!(parse_prompt_command("^._.^:/>"), Some(String::new()));
        assert_eq!(parse_prompt_command("ordinary line"), None);
        assert_eq!(normalize_command(" SET key =  4 "), "set key=4");
    }

    #[test]
    fn parses_number_and_event_configurations() {
        let number = parse_config_response(&[
            "main_altitude = 200".into(),
            "Allowed range: 10 - 65535".into(),
        ])
        .unwrap();
        assert_eq!(number["type"], "NUMBER");
        assert_eq!(number["value"], 200.0);

        let event = parse_config_response(&[
            "ev_liftoff = 1,500,7,2,0,0".into(),
            "Array length: 16".into(),
        ])
        .unwrap();
        assert_eq!(event["actions"].as_array().unwrap().len(), 2);
        assert_eq!(event["values"], json!([1, 500, 7, 2]));
    }
}
