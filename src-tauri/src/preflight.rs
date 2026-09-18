use std::collections::{HashMap, HashSet};

use chrono::Utc;
use serde_json::{Value, json};

use crate::error::HostError;

const TIMER_KEYS: [&str; 4] = ["timer1", "timer2", "timer3", "timer4"];
const KNOWN_RECORDING_MASK: i64 = 16 | 32 | 64 | 128 | 256 | 512 | 1024 | 2048 | 4096 | 8192;

#[derive(Clone)]
struct EventDef {
    key: &'static str,
    state: &'static str,
    label: &'static str,
    order: f64,
}

#[derive(Clone)]
struct Action {
    index: i64,
    value: i64,
    summary: String,
}

fn events() -> Vec<EventDef> {
    vec![
        EventDef {
            key: "ev_liftoff",
            state: "LIFTOFF",
            label: "Liftoff",
            order: 2.0,
        },
        EventDef {
            key: "ev_burnout",
            state: "MAX_V",
            label: "Burnout / Max V",
            order: 3.0,
        },
        EventDef {
            key: "ev_apogee",
            state: "APOGEE",
            label: "Apogee",
            order: 4.0,
        },
        EventDef {
            key: "ev_main_deployment",
            state: "MAIN_DEPLOYMENT",
            label: "Main Deployment",
            order: 5.0,
        },
        EventDef {
            key: "ev_touchdown",
            state: "TOUCHDOWN",
            label: "Touchdown",
            order: 6.0,
        },
        EventDef {
            key: "ev_custom1",
            state: "CUSTOM_1",
            label: "Custom 1",
            order: 7.0,
        },
        EventDef {
            key: "ev_custom2",
            state: "CUSTOM_2",
            label: "Custom 2",
            order: 8.0,
        },
    ]
}

fn state_order(state: &str) -> Option<i64> {
    match state {
        "CALIBRATE" => Some(0),
        "READY" => Some(1),
        "LIFTOFF" | "MOVING" => Some(2),
        "BURNOUT" | "MAX_V" => Some(3),
        "APOGEE" => Some(4),
        "MAIN_DEPLOYMENT" => Some(5),
        "TOUCHDOWN" => Some(6),
        "CUSTOM_1" => Some(7),
        "CUSTOM_2" => Some(8),
        _ => None,
    }
}

fn normalize_state(value: Option<&Value>) -> String {
    value
        .and_then(|value| {
            value
                .as_str()
                .map(ToString::to_string)
                .or_else(|| Some(value.to_string()))
        })
        .unwrap_or_default()
        .trim_matches('"')
        .trim()
        .to_uppercase()
        .replace(' ', "_")
}

fn number(value: Option<&Value>) -> Option<f64> {
    value
        .and_then(|value| {
            value
                .as_f64()
                .or_else(|| value.as_str().and_then(|value| value.parse::<f64>().ok()))
        })
        .filter(|value| value.is_finite())
}

fn parse_actions(value: Option<&Value>) -> Vec<Action> {
    let raw = value
        .map(|value| {
            value
                .as_str()
                .map(ToString::to_string)
                .unwrap_or_else(|| value.to_string())
        })
        .unwrap_or_default();
    let values = raw
        .split(',')
        .map(|value| value.trim_matches('"').trim().parse::<i64>().ok())
        .collect::<Vec<_>>();
    let mut actions = Vec::new();
    for pair in values.chunks_exact(2) {
        let (Some(index), Some(value)) = (pair[0], pair[1]) else {
            continue;
        };
        let (name, display) = match index {
            1 => ("Delay", format!("{value} ms")),
            2 => (
                "Pyro 1",
                if value == 0 {
                    "OFF".into()
                } else if value == 1 {
                    "ON".into()
                } else {
                    value.to_string()
                },
            ),
            3 => (
                "Pyro 2",
                if value == 0 {
                    "OFF".into()
                } else if value == 1 {
                    "ON".into()
                } else {
                    value.to_string()
                },
            ),
            4 => (
                "IO 1",
                if value == 0 {
                    "OFF".into()
                } else if value == 1 {
                    "ON".into()
                } else {
                    value.to_string()
                },
            ),
            5 => ("Servo 1", format!("{value} ‰")),
            6 => ("Servo 2", format!("{value} ‰")),
            7 => (
                "Recorder",
                match value {
                    0 => "OFF".into(),
                    1 => "PRE".into(),
                    2 => "LOG".into(),
                    _ => value.to_string(),
                },
            ),
            _ => continue,
        };
        actions.push(Action {
            index,
            value,
            summary: format!("{name}: {display}"),
        });
    }
    actions
}

fn check(
    id: &str,
    category: &str,
    status: &str,
    title: String,
    detail: String,
    related_keys: Vec<String>,
    review: Option<Value>,
) -> Value {
    json!({
        "id": id,
        "category": category,
        "status": status,
        "title": title,
        "detail": detail,
        "relatedKeys": related_keys,
        "review": review
    })
}

fn deployment_actions(actions: &[Action]) -> Vec<&Action> {
    actions
        .iter()
        .filter(|action| {
            [2, 3, 5, 6].contains(&action.index) && (action.index >= 5 || action.value == 1)
        })
        .collect()
}

fn graph_has_cycle(edges: &[(String, String)]) -> bool {
    fn visit(
        node: &str,
        graph: &HashMap<String, Vec<String>>,
        visiting: &mut HashSet<String>,
        visited: &mut HashSet<String>,
    ) -> bool {
        if visiting.contains(node) {
            return true;
        }
        if visited.contains(node) {
            return false;
        }
        visiting.insert(node.to_string());
        if graph
            .get(node)
            .into_iter()
            .flatten()
            .any(|next| visit(next, graph, visiting, visited))
        {
            return true;
        }
        visiting.remove(node);
        visited.insert(node.to_string());
        false
    }
    let mut graph: HashMap<String, Vec<String>> = HashMap::new();
    for (from, to) in edges {
        graph.entry(from.clone()).or_default().push(to.clone());
    }
    let mut visiting = HashSet::new();
    let mut visited = HashSet::new();
    graph
        .keys()
        .any(|node| visit(node, &graph, &mut visiting, &mut visited))
}

pub fn timeline(values: &serde_json::Map<String, Value>) -> Vec<Value> {
    let liftoff_threshold = number(values.get("acc_threshold"));
    let main_altitude = number(values.get("main_altitude"));
    let mut items = events()
        .into_iter()
        .map(|event| {
            let settings = match event.key {
                "ev_liftoff" => liftoff_threshold.map(|value| vec![format!("Liftoff detection: {value} m/s²")]).unwrap_or_default(),
                "ev_main_deployment" => main_altitude.map(|value| vec![format!("Deployment altitude: {value} m")]).unwrap_or_default(),
                _ => Vec::new(),
            };
            json!({
                "id": event.key,
                "kind": "event",
                "order": event.order,
                "title": event.label,
                "trigger": event.state,
                "detail": format!("Flight event: {}", event.state),
                "settings": settings,
                "actions": parse_actions(values.get(event.key)).into_iter().map(|action| action.summary).collect::<Vec<_>>()
            })
        })
        .collect::<Vec<_>>();
    for (index, timer) in TIMER_KEYS.iter().enumerate() {
        let duration = number(values.get(&format!("{timer}_duration")));
        if duration.is_none_or(|duration| duration <= 0.0) {
            continue;
        }
        let duration = duration.unwrap();
        let start = normalize_state(values.get(&format!("{timer}_start")));
        let trigger = normalize_state(values.get(&format!("{timer}_trigger")));
        items.push(json!({
            "id": timer,
            "kind": "timer",
            "order": state_order(&start).unwrap_or(9) as f64 + 0.1 + index as f64 / 100.0,
            "title": format!("Timer {}", index + 1),
            "trigger": trigger,
            "detail": format!("{start} + {duration} ms → {trigger}"),
            "settings": [],
            "actions": [format!("Trigger event: {trigger}")]
        }));
    }
    items.sort_by(|left, right| {
        left["order"]
            .as_f64()
            .partial_cmp(&right["order"].as_f64())
            .unwrap()
    });
    items
}

pub fn build_report(snapshot: &Value) -> Result<Value, HostError> {
    let values = snapshot["values"].as_object().ok_or_else(|| {
        HostError::new("invalid_snapshot", "Preflight requires a board snapshot.")
    })?;
    let event_defs = events();
    let actions = event_defs
        .iter()
        .map(|event| (event.key, parse_actions(values.get(event.key))))
        .collect::<HashMap<_, _>>();
    let mut checks = Vec::new();

    let testing = normalize_state(values.get("test_mode")) == "ON";
    checks.push(check(
        "testing-mode",
        "Board mode",
        if testing { "warning" } else { "ready" },
        if testing {
            "Testing mode is enabled"
        } else {
            "Testing mode is off"
        }
        .into(),
        if testing {
            "Disable testing mode before preparing the vehicle for flight."
        } else {
            "The board is using normal flight behavior."
        }
        .into(),
        vec!["test_mode".into()],
        Some(json!({ "label": "Open Configuration", "route": "/config" })),
    ));

    let threshold = number(values.get("acc_threshold"));
    let threshold_warning = threshold.is_none_or(|value| value > 50.0);
    checks.push(check(
        "liftoff-threshold",
        "Flight detection",
        if threshold_warning {
            "warning"
        } else {
            "ready"
        },
        match threshold {
            None => "Liftoff threshold is unavailable".into(),
            Some(_) if threshold_warning => "Liftoff threshold is high".into(),
            Some(_) => "Liftoff threshold is within the usual range".into(),
        },
        match threshold {
            None => "The board did not provide a liftoff detection acceleration.".into(),
            Some(value) if threshold_warning => format!(
                "Liftoff detection acceleration is {value} m/s²; review values above 50 m/s²."
            ),
            Some(value) => format!("Liftoff detection acceleration is {value} m/s²."),
        },
        vec!["acc_threshold".into()],
        Some(json!({ "label": "Open Configuration", "route": "/config" })),
    ));

    let recording_elements = number(values.get("rec_elements")).map(|value| value as i64);
    let recording_disabled = normalize_state(values.get("rec_speed")) == "OFF"
        || recording_elements.is_none()
        || (recording_elements.unwrap_or_default() & KNOWN_RECORDING_MASK) == 0;
    let logging_events = event_defs
        .iter()
        .filter(|event| {
            actions[event.key]
                .iter()
                .any(|action| action.index == 7 && action.value == 2)
        })
        .collect::<Vec<_>>();
    let touchdown_off = actions["ev_touchdown"]
        .iter()
        .any(|action| action.index == 7 && action.value == 0);
    let mut recording_issues = Vec::new();
    if recording_disabled {
        recording_issues.push("Recording speed or recorded elements are disabled.");
    }
    if logging_events.is_empty() {
        recording_issues.push("No event starts the recorder in LOG mode.");
    } else if !touchdown_off {
        recording_issues.push("No Recorder: OFF action is configured at touchdown.");
    }
    let recording_warning = !recording_issues.is_empty();
    let recording_title = if recording_disabled {
        "Flight recording is disabled"
    } else if logging_events.is_empty() {
        "Flight recording start is not configured"
    } else if !touchdown_off {
        "Flight recording stop is not configured"
    } else {
        "Flight recording starts and stops"
    };
    let recording_detail = if recording_warning {
        recording_issues.join(" ")
    } else {
        format!(
            "Recording starts at {} and stops at Touchdown.",
            logging_events
                .iter()
                .map(|event| event.label)
                .collect::<Vec<_>>()
                .join(", ")
        )
    };
    let mut recording_keys = vec!["rec_speed".into(), "rec_elements".into()];
    recording_keys.extend(logging_events.iter().map(|event| event.key.into()));
    recording_keys.push("ev_touchdown".into());
    checks.push(check(
        "recording",
        "Recording",
        if recording_warning {
            "warning"
        } else {
            "ready"
        },
        recording_title.into(),
        recording_detail,
        recording_keys,
        if recording_disabled {
            None
        } else {
            Some(json!({ "label": "Review Events", "route": "/events" }))
        },
    ));

    let apogee_deployment = deployment_actions(&actions["ev_apogee"]);
    let main_deployment = deployment_actions(&actions["ev_main_deployment"]);
    let early = event_defs
        .iter()
        .filter(|event| ["ev_liftoff", "ev_burnout"].contains(&event.key))
        .filter(|event| !deployment_actions(&actions[event.key]).is_empty())
        .map(|event| event.label)
        .collect::<Vec<_>>();
    let main_altitude = number(values.get("main_altitude"));
    let mut deployment_issues = Vec::new();
    if apogee_deployment.is_empty() {
        deployment_issues.push("No deployment output is scheduled at apogee.".into());
    }
    if main_deployment.is_empty() {
        deployment_issues.push("No deployment output is scheduled at main deployment.".into());
    }
    if !early.is_empty() {
        deployment_issues.push(format!(
            "Deployment output is scheduled too early at {}.",
            early.into_iter().collect::<Vec<_>>().join(", ")
        ));
    }
    if main_altitude.is_none_or(|value| value <= 0.0) {
        deployment_issues.push("Main deployment altitude is not a positive value.".into());
    }
    let deployment_warning = !deployment_issues.is_empty();
    checks.push(check(
        "deployment-plan",
        "Deployment",
        if deployment_warning {
            "warning"
        } else {
            "ready"
        },
        if deployment_warning {
            "Deployment plan is inconsistent"
        } else {
            "Apogee and main deployment outputs are configured"
        }
        .into(),
        if deployment_warning {
            deployment_issues.join(" ")
        } else {
            format!(
                "Apogee and main deployment use configured outputs; main altitude is {} m.",
                main_altitude.unwrap()
            )
        },
        [
            "main_altitude",
            "ev_liftoff",
            "ev_burnout",
            "ev_apogee",
            "ev_main_deployment",
        ]
        .into_iter()
        .map(Into::into)
        .collect(),
        Some(json!({ "label": "Review Events", "route": "/events" })),
    ));

    let mut edges = Vec::new();
    let mut timer_issues = Vec::new();
    let mut ordering_issues = Vec::new();
    let mut active_timers = Vec::new();
    for (index, timer) in TIMER_KEYS.iter().enumerate() {
        let start = normalize_state(values.get(&format!("{timer}_start")));
        let duration = number(values.get(&format!("{timer}_duration")));
        let trigger = normalize_state(values.get(&format!("{timer}_trigger")));
        if duration == Some(0.0) {
            continue;
        }
        active_timers.push(*timer);
        if duration.is_none_or(|value| value < 0.0) {
            timer_issues.push(format!("Timer {} has an invalid duration.", index + 1));
            continue;
        }
        if state_order(&start).is_none() || state_order(&trigger).is_none() {
            timer_issues.push(format!("Timer {} uses an unknown event.", index + 1));
            continue;
        }
        if start == trigger {
            timer_issues.push(format!(
                "Timer {} starts and triggers on {start}.",
                index + 1
            ));
        }
        edges.push((start.clone(), trigger.clone()));
        let start_order = state_order(&start).unwrap();
        let trigger_order = state_order(&trigger).unwrap();
        if start_order >= 2 && trigger_order <= 6 && trigger_order <= start_order {
            ordering_issues.push(format!(
                "Timer {} starts at {start} but triggers {trigger}.",
                index + 1
            ));
        }
    }
    if graph_has_cycle(&edges) {
        timer_issues.push("Active timer triggers form a cycle.".into());
    }
    let timer_keys = active_timers
        .iter()
        .flat_map(|timer| {
            [
                format!("{timer}_start"),
                format!("{timer}_duration"),
                format!("{timer}_trigger"),
            ]
        })
        .collect();
    checks.push(check(
        "timer-chains",
        "Timers",
        if timer_issues.is_empty() {
            "ready"
        } else {
            "warning"
        },
        if timer_issues.is_empty() {
            "Timer chains are valid"
        } else {
            "Timer chain is invalid"
        }
        .into(),
        if !timer_issues.is_empty() {
            timer_issues.join(" ")
        } else if active_timers.is_empty() {
            "No timers are active.".into()
        } else {
            format!(
                "{} active timer{} form an acyclic chain.",
                active_timers.len(),
                if active_timers.len() == 1 { "" } else { "s" }
            )
        },
        timer_keys,
        Some(json!({ "label": "Review Timers", "route": "/events?section=timers" })),
    ));
    let order_keys = active_timers
        .iter()
        .flat_map(|timer| [format!("{timer}_start"), format!("{timer}_trigger")])
        .collect();
    checks.push(check(
        "event-order",
        "Event sequence",
        if ordering_issues.is_empty() {
            "ready"
        } else {
            "warning"
        },
        if ordering_issues.is_empty() {
            "Event order is physically possible"
        } else {
            "An event is triggered out of flight order"
        }
        .into(),
        if ordering_issues.is_empty() {
            "Active timers do not trigger an earlier core flight state.".into()
        } else {
            ordering_issues.join(" ")
        },
        order_keys,
        Some(json!({ "label": "Review Timers", "route": "/events?section=timers" })),
    ));

    let warning_count = checks
        .iter()
        .filter(|check| check["status"] == "warning")
        .count();
    let ready_count = checks.len() - warning_count;
    Ok(json!({
        "status": if warning_count > 0 { "WARNING" } else { "READY" },
        "generatedAt": Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        "board": snapshot["board"].clone(),
        "summary": { "warningCount": warning_count, "readyCount": ready_count },
        "checks": checks,
        "timeline": timeline(values)
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Map;

    fn safe_snapshot() -> Value {
        let mut values = Map::new();
        for (key, value) in [
            ("main_altitude", json!(200)),
            ("acc_threshold", json!(35)),
            ("test_mode", json!("OFF")),
            ("rec_speed", json!("100 Hz")),
            ("rec_elements", json!(65504)),
            ("ev_liftoff", json!("7,2")),
            ("ev_burnout", json!("0,0")),
            ("ev_apogee", json!("2,1")),
            ("ev_main_deployment", json!("3,1")),
            ("ev_touchdown", json!("7,0")),
            ("ev_custom1", json!("0,0")),
            ("ev_custom2", json!("0,0")),
        ] {
            values.insert(key.into(), value);
        }
        for timer in TIMER_KEYS {
            values.insert(format!("{timer}_start"), json!("CALIBRATE"));
            values.insert(format!("{timer}_duration"), json!(0));
            values.insert(format!("{timer}_trigger"), json!("CALIBRATE"));
        }
        json!({ "board": { "model": "CATS Vega" }, "values": values })
    }

    #[test]
    fn safe_configuration_is_ready() {
        let report = build_report(&safe_snapshot()).unwrap();
        assert_eq!(report["status"], "READY");
        assert_eq!(report["summary"]["warningCount"], 0);
        assert_eq!(report["timeline"].as_array().unwrap().len(), 7);
    }

    #[test]
    fn detects_testing_recording_and_timer_problems() {
        let mut snapshot = safe_snapshot();
        snapshot["values"]["test_mode"] = json!("ON");
        snapshot["values"]["rec_speed"] = json!("OFF");
        snapshot["values"]["timer1_start"] = json!("APOGEE");
        snapshot["values"]["timer1_duration"] = json!(1000);
        snapshot["values"]["timer1_trigger"] = json!("LIFTOFF");
        let report = build_report(&snapshot).unwrap();
        assert_eq!(report["status"], "WARNING");
        assert!(
            report["checks"]
                .as_array()
                .unwrap()
                .iter()
                .any(|check| check["id"] == "event-order" && check["status"] == "warning")
        );
    }

    #[test]
    fn matches_v1_warning_scenarios() {
        let mut snapshot = safe_snapshot();
        snapshot["values"]["ev_touchdown"] = json!("0,0");
        let report = build_report(&snapshot).unwrap();
        let recording = report["checks"]
            .as_array()
            .unwrap()
            .iter()
            .find(|check| check["id"] == "recording")
            .unwrap();
        assert_eq!(
            recording["title"],
            "Flight recording stop is not configured"
        );

        snapshot = safe_snapshot();
        snapshot["values"]["rec_elements"] = json!(98304);
        let report = build_report(&snapshot).unwrap();
        let recording = report["checks"]
            .as_array()
            .unwrap()
            .iter()
            .find(|check| check["id"] == "recording")
            .unwrap();
        assert_eq!(recording["title"], "Flight recording is disabled");

        snapshot = safe_snapshot();
        snapshot["values"]["acc_threshold"] = json!(51);
        let report = build_report(&snapshot).unwrap();
        assert!(report["checks"].as_array().unwrap().iter().any(|check| {
            check["id"] == "liftoff-threshold" && check["title"] == "Liftoff threshold is high"
        }));

        snapshot = safe_snapshot();
        snapshot["values"]["timer1_start"] = json!("CUSTOM_1");
        snapshot["values"]["timer1_duration"] = json!(1000);
        snapshot["values"]["timer1_trigger"] = json!("CUSTOM_2");
        snapshot["values"]["timer2_start"] = json!("CUSTOM_2");
        snapshot["values"]["timer2_duration"] = json!(1000);
        snapshot["values"]["timer2_trigger"] = json!("CUSTOM_1");
        let report = build_report(&snapshot).unwrap();
        assert!(report["checks"].as_array().unwrap().iter().any(|check| {
            check["id"] == "timer-chains"
                && check["detail"] == "Active timer triggers form a cycle."
        }));
    }

    #[test]
    fn malformed_action_pairs_do_not_shift_later_actions() {
        let actions = parse_actions(Some(&json!("invalid,1,7,2")));
        assert_eq!(actions.len(), 1);
        assert_eq!(actions[0].summary, "Recorder: LOG");
    }
}
