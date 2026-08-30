use std::{sync::Arc, time::Duration};

use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use serde_json::{Value, json};
use tauri_plugin_opener::OpenerExt;
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    net::{TcpListener, TcpStream},
    sync::{Mutex, oneshot},
};
use uuid::Uuid;

use crate::{error::HostError, events::EventBus, flight_log::FlightLogSession};

const ORIGIN: &str = "https://flights.catsystems.io";

struct ActiveHandoff {
    cancel: oneshot::Sender<()>,
}

#[derive(Default)]
pub struct HandoffManager {
    active: Mutex<Option<ActiveHandoff>>,
}

fn publish(events: &EventBus, id: Uuid, status: &str, message: impl Into<String>) {
    events.send(
        "flight-log:handoff-state",
        json!({ "id": id, "status": status, "message": message.into() }),
    );
}

fn safe_filename(name: &str) -> String {
    name.chars()
        .map(|character| {
            if character.is_ascii()
                && !character.is_ascii_control()
                && !['\\', '/', '\r', '\n', '"'].contains(&character)
            {
                character
            } else {
                '_'
            }
        })
        .take(160)
        .collect()
}

async fn response(
    stream: &mut TcpStream,
    status: &str,
    headers: &[(&str, String)],
    body: &[u8],
) -> std::io::Result<()> {
    let mut message = format!("HTTP/1.1 {status}\r\ncache-control: no-store\r\n");
    for (key, value) in headers {
        message.push_str(&format!("{key}: {value}\r\n"));
    }
    message.push_str(&format!(
        "content-length: {}\r\nconnection: close\r\n\r\n",
        body.len()
    ));
    stream.write_all(message.as_bytes()).await?;
    stream.write_all(body).await?;
    stream.flush().await
}

async fn handle_connection(
    stream: TcpStream,
    expected_path: &str,
    session: &FlightLogSession,
    consumed: &mut bool,
    events: &EventBus,
    id: Uuid,
) -> Result<bool, HostError> {
    let mut reader = BufReader::new(stream);
    let mut request_line = String::new();
    tokio::time::timeout(Duration::from_secs(5), reader.read_line(&mut request_line))
        .await
        .map_err(|_| HostError::new("handoff_timeout", "Browser request timed out."))?
        .map_err(|error| HostError::new("handoff_read_failed", error.to_string()))?;
    let mut total = request_line.len();
    let mut origin = String::new();
    loop {
        let mut line = String::new();
        reader
            .read_line(&mut line)
            .await
            .map_err(|error| HostError::new("handoff_read_failed", error.to_string()))?;
        total += line.len();
        if total > 16 * 1024 {
            return Err(HostError::new(
                "handoff_request_too_large",
                "Browser request is too large.",
            ));
        }
        if line == "\r\n" || line == "\n" || line.is_empty() {
            break;
        }
        if let Some(value) = line
            .strip_prefix("Origin:")
            .or_else(|| line.strip_prefix("origin:"))
        {
            origin = value.trim().to_string();
        }
    }
    let mut request = request_line.split_whitespace();
    let method = request.next().unwrap_or_default();
    let path = request.next().unwrap_or_default();
    let stream = reader.get_mut();
    if origin != ORIGIN {
        response(stream, "403 Forbidden", &[], &[]).await.ok();
        return Ok(false);
    }
    let cors = [
        ("access-control-allow-origin", ORIGIN.to_string()),
        ("access-control-allow-methods", "GET, OPTIONS".into()),
        ("access-control-allow-private-network", "true".into()),
        ("access-control-expose-headers", "X-CATS-Log-Name".into()),
        (
            "vary",
            "Origin, Access-Control-Request-Private-Network".into(),
        ),
    ];
    if path != expected_path {
        response(stream, "404 Not Found", &cors, &[]).await.ok();
        return Ok(false);
    }
    if method == "OPTIONS" {
        response(stream, "204 No Content", &cors, &[]).await.ok();
        return Ok(false);
    }
    if method != "GET" {
        response(stream, "405 Method Not Allowed", &cors, &[])
            .await
            .ok();
        return Ok(false);
    }
    if *consumed {
        response(stream, "410 Gone", &cors, &[]).await.ok();
        return Ok(false);
    }
    *consumed = true;
    publish(
        events,
        id,
        "transferring",
        format!("Sending {} to CATS Flights...", session.name),
    );
    let mut headers = cors.to_vec();
    headers.push(("content-type", "application/octet-stream".into()));
    headers.push(("x-cats-log-name", safe_filename(&session.name)));
    response(stream, "200 OK", &headers, &session.bytes)
        .await
        .map_err(|error| HostError::new("handoff_write_failed", error.to_string()))?;
    publish(
        events,
        id,
        "complete",
        format!("{} opened in CATS Flights.", session.name),
    );
    Ok(true)
}

impl HandoffManager {
    pub async fn start(
        &self,
        app: tauri::AppHandle,
        session: FlightLogSession,
        events: Arc<EventBus>,
    ) -> Result<Value, HostError> {
        self.cancel(&events).await;
        let listener = TcpListener::bind(("127.0.0.1", 0))
            .await
            .map_err(|error| HostError::new("handoff_bind_failed", error.to_string()))?;
        let port = listener
            .local_addr()
            .map_err(|error| HostError::new("handoff_bind_failed", error.to_string()))?
            .port();
        let id = Uuid::new_v4();
        let mut secret = [0_u8; 32];
        getrandom::fill(&mut secret)
            .map_err(|error| HostError::new("handoff_random_failed", error.to_string()))?;
        let token = URL_SAFE_NO_PAD.encode(secret);
        let expected_path = format!("/v1/flight-log/{token}");
        let fragment = url::form_urlencoded::Serializer::new(String::new())
            .append_pair("cats-import", "v1")
            .append_pair("port", &port.to_string())
            .append_pair("token", &token)
            .finish();
        let url = format!("{ORIGIN}/analyze#{fragment}");
        let (cancel, mut cancelled) = oneshot::channel();
        *self.active.lock().await = Some(ActiveHandoff { cancel });
        let task_events = Arc::clone(&events);
        tokio::spawn(async move {
            let mut consumed = false;
            let timeout = tokio::time::sleep(Duration::from_secs(120));
            tokio::pin!(timeout);
            loop {
                tokio::select! {
                    _ = &mut cancelled => {
                        publish(&task_events, id, "cancelled", "Browser handoff cancelled.");
                        break;
                    }
                    _ = &mut timeout => {
                        publish(&task_events, id, "expired", "The browser handoff expired. Try Open in Flights again or save the log manually.");
                        break;
                    }
                    accepted = listener.accept() => {
                        let Ok((stream, _)) = accepted else {
                            publish(&task_events, id, "failed", "The private browser handoff stopped unexpectedly.");
                            break;
                        };
                        tokio::select! {
                            _ = &mut cancelled => {
                                publish(&task_events, id, "cancelled", "Browser handoff cancelled.");
                                break;
                            }
                            _ = &mut timeout => {
                                publish(&task_events, id, "expired", "The browser handoff expired. Try Open in Flights again or save the log manually.");
                                break;
                            }
                            handled = handle_connection(stream, &expected_path, &session, &mut consumed, &task_events, id) => {
                                match handled {
                                    Ok(true) => break,
                                    Ok(false) => {}
                                    Err(_) => {}
                                }
                            }
                        }
                    }
                }
            }
        });
        publish(
            &events,
            id,
            "waiting",
            "Waiting for CATS Flights to receive the log...",
        );
        if let Err(error) = app.opener().open_url(&url, None::<&str>) {
            self.cancel(&events).await;
            publish(
                &events,
                id,
                "failed",
                "CATS Flights could not be opened in the browser.",
            );
            return Err(HostError::new("open_external_failed", error.to_string()));
        }
        Ok(json!({ "id": id, "status": "waiting" }))
    }

    pub async fn cancel(&self, _events: &EventBus) -> bool {
        if let Some(active) = self.active.lock().await.take() {
            let _ = active.cancel.send(());
        }
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filename_header_is_ascii_and_bounded() {
        let safe = safe_filename("bad/\"name\n🚀.cfl");
        assert!(safe.is_ascii());
        assert!(!safe.contains(['/', '"', '\n']));
        assert!(safe.len() <= 160);
    }
}
