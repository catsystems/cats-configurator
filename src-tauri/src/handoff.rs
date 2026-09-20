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

const ORIGIN: &str = "https://catsystems.io";

fn browser_url(port: u16, token: &str) -> String {
    let fragment = url::form_urlencoded::Serializer::new(String::new())
        .append_pair("cats-import", "v1")
        .append_pair("port", &port.to_string())
        .append_pair("token", token)
        .finish();
    format!("{ORIGIN}/flights/analyze#{fragment}")
}

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
        let url = browser_url(port, &token);
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
    use tokio::io::AsyncReadExt;

    const TEST_PATH: &str = "/v1/flight-log/test-token";
    const TEST_BYTES: &[u8] = b"flight-log\0\x01\xfe\xff";

    async fn request(
        method: &str,
        origin: &str,
        path: &str,
        consumed: &mut bool,
    ) -> (bool, Vec<u8>) {
        let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let address = listener.local_addr().unwrap();
        let session = FlightLogSession {
            id: Uuid::new_v4(),
            source: "local".into(),
            name: "flight.cfl".into(),
            bytes: TEST_BYTES.to_vec(),
            flight_log: json!({}),
        };
        let events = EventBus::default();
        let server = async {
            let (stream, _) = listener.accept().await.unwrap();
            handle_connection(stream, TEST_PATH, &session, consumed, &events, session.id)
                .await
                .unwrap()
        };
        let client = async {
            let mut stream = TcpStream::connect(address).await.unwrap();
            let preflight = if method == "OPTIONS" {
                "Access-Control-Request-Method: GET\r\nAccess-Control-Request-Private-Network: true\r\n"
            } else {
                ""
            };
            stream
                .write_all(
                    format!("{method} {path} HTTP/1.1\r\nHost: {address}\r\nOrigin: {origin}\r\n{preflight}\r\n")
                        .as_bytes(),
                )
                .await
                .unwrap();
            let mut response = Vec::new();
            stream.read_to_end(&mut response).await.unwrap();
            response
        };
        tokio::time::timeout(Duration::from_secs(5), async {
            tokio::join!(server, client)
        })
        .await
        .unwrap()
    }

    #[test]
    fn browser_url_opens_canonical_analyzer_with_private_fragment() {
        let token = "A".repeat(43);
        let url = url::Url::parse(&browser_url(49152, &token)).unwrap();
        assert_eq!(url.origin().ascii_serialization(), "https://catsystems.io");
        assert_eq!(url.path(), "/flights/analyze");
        assert_eq!(url.query(), None);
        let fragment = url::form_urlencoded::parse(url.fragment().unwrap().as_bytes())
            .into_owned()
            .collect::<Vec<_>>();
        assert_eq!(
            fragment,
            vec![
                ("cats-import".into(), "v1".into()),
                ("port".into(), "49152".into()),
                ("token".into(), token),
            ]
        );
    }

    #[tokio::test]
    async fn canonical_origin_can_preflight_and_receive_log_once() {
        let mut consumed = false;
        let (complete, response) =
            request("OPTIONS", "https://catsystems.io", TEST_PATH, &mut consumed).await;
        let headers = String::from_utf8(response).unwrap();
        assert!(headers.starts_with("HTTP/1.1 204 No Content\r\n"));
        assert!(headers.contains("access-control-allow-origin: https://catsystems.io\r\n"));
        assert!(headers.contains("access-control-allow-methods: GET, OPTIONS\r\n"));
        assert!(headers.contains("access-control-allow-private-network: true\r\n"));
        assert!(!complete);
        assert!(!consumed);

        let (complete, response) =
            request("GET", "https://catsystems.io", TEST_PATH, &mut consumed).await;
        let split = response
            .windows(4)
            .position(|bytes| bytes == b"\r\n\r\n")
            .unwrap();
        let headers = std::str::from_utf8(&response[..split]).unwrap();
        assert!(headers.starts_with("HTTP/1.1 200 OK\r\n"));
        assert!(headers.contains("access-control-allow-origin: https://catsystems.io\r\n"));
        assert!(headers.contains("content-type: application/octet-stream\r\n"));
        assert!(headers.contains("x-cats-log-name: flight.cfl\r\n"));
        assert_eq!(&response[split + 4..], TEST_BYTES);
        assert!(complete);
        assert!(consumed);

        let (complete, response) =
            request("GET", "https://catsystems.io", TEST_PATH, &mut consumed).await;
        assert!(response.starts_with(b"HTTP/1.1 410 Gone\r\n"));
        assert!(!complete);
    }

    #[tokio::test]
    async fn other_origins_cannot_preflight_or_consume_log() {
        let mut consumed = false;
        for origin in [
            "https://flights.catsystems.io",
            "http://catsystems.io",
            "https://catsystems.io:8443",
            "https://catsystems.io.evil.example",
            "https://catsystems.io/flights",
            "null",
            "",
        ] {
            for method in ["OPTIONS", "GET"] {
                let (complete, response) = request(method, origin, TEST_PATH, &mut consumed).await;
                let response = String::from_utf8(response).unwrap();
                assert!(
                    response.starts_with("HTTP/1.1 403 Forbidden\r\n"),
                    "{origin}"
                );
                assert!(!response.contains("access-control-allow-origin"));
                assert!(!complete);
                assert!(!consumed);
            }
        }
    }

    #[tokio::test]
    async fn wrong_token_does_not_consume_log() {
        let mut consumed = false;
        let (complete, response) = request(
            "GET",
            "https://catsystems.io",
            "/v1/flight-log/wrong-token",
            &mut consumed,
        )
        .await;
        assert!(response.starts_with(b"HTTP/1.1 404 Not Found\r\n"));
        assert!(!complete);
        assert!(!consumed);
    }

    #[test]
    fn filename_header_is_ascii_and_bounded() {
        let safe = safe_filename("bad/\"name\n🚀.cfl");
        assert!(safe.is_ascii());
        assert!(!safe.contains(['/', '"', '\n']));
        assert!(safe.len() <= 160);
    }
}
