use std::{
    io::{Read, Write},
    net::TcpListener,
    thread,
    time::Duration,
};

use serde_json::json;
use tauri::{
    Manager,
    test::{mock_builder, mock_context, noop_assets},
};

#[cfg(windows)]
use super::app_install_update;
use super::{AppState, app_check_update};

fn update_server(
    version: &str,
    tampered: bool,
    requests: usize,
) -> (String, thread::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let endpoint = format!("http://{}/latest.json", listener.local_addr().unwrap());
    let manifest = json!({
        "version": version,
        "url": format!("http://{}/update", listener.local_addr().unwrap()),
        "signature": include_str!("../../tests/fixtures/app-update.txt.sig").trim()
    })
    .to_string();
    let server = thread::spawn(move || {
        for _ in 0..requests {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut request = [0; 4096];
            let size = stream.read(&mut request).unwrap();
            let request = String::from_utf8_lossy(&request[..size]);
            let body: &[u8] = if request.starts_with("GET /latest.json ") {
                manifest.as_bytes()
            } else if tampered {
                b"Tampered package"
            } else {
                include_bytes!("../../tests/fixtures/app-update.txt")
            };
            write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len()).unwrap();
            stream.write_all(body).unwrap();
        }
    });
    (endpoint, server)
}

fn test_app(endpoint: String) -> tauri::App<tauri::test::MockRuntime> {
    let config: serde_json::Value =
        serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
    let mut context = mock_context(noop_assets());
    context.package_info_mut().version = config["version"].as_str().unwrap().parse().unwrap();
    context.config_mut().plugins.0.insert(
        "updater".into(),
        json!({
            "pubkey": config["plugins"]["updater"]["pubkey"],
            "endpoints": [endpoint],
            // The test server is loopback-only. Production endpoints remain HTTPS.
            "dangerousInsecureTransportProtocol": true
        }),
    );
    mock_builder()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(AppState::default())
        .build(context)
        .unwrap()
}

#[tokio::test]
async fn newer_release_downloads_only_when_requested_and_verifies_signature() {
    let (endpoint, server) = update_server("9.0.0", false, 2);
    let app = test_app(endpoint);
    let summary = app_check_update(app.handle().clone(), app.state())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(summary["version"], "9.0.0");
    let state = app.state::<AppState>();
    let pending = state.app_update.lock().await;
    let bytes = pending
        .as_ref()
        .unwrap()
        .download(|_, _| {}, || {})
        .await
        .unwrap();
    assert_eq!(bytes, include_bytes!("../../tests/fixtures/app-update.txt"));
    server.join().unwrap();
}

#[tokio::test]
async fn current_release_returns_no_update() {
    let config: serde_json::Value =
        serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
    let (endpoint, server) = update_server(config["version"].as_str().unwrap(), false, 1);
    let app = test_app(endpoint);
    assert!(
        app_check_update(app.handle().clone(), app.state())
            .await
            .unwrap()
            .is_none()
    );
    assert!(app.state::<AppState>().app_update.lock().await.is_none());
    server.join().unwrap();
}

#[tokio::test]
async fn tampered_download_is_rejected() {
    let (endpoint, server) = update_server("9.0.0", true, 2);
    let app = test_app(endpoint);
    app_check_update(app.handle().clone(), app.state())
        .await
        .unwrap();
    let state = app.state::<AppState>();
    let pending = state.app_update.lock().await;
    assert!(
        pending
            .as_ref()
            .unwrap()
            .download(|_, _| {}, || {})
            .await
            .is_err()
    );
    server.join().unwrap();
}

#[cfg(windows)]
#[tokio::test]
async fn installation_disconnects_device_and_preserves_firmware_exclusivity() {
    use std::sync::atomic::Ordering;
    let (endpoint, server) = update_server("9.0.0", true, 2);
    let app = test_app(endpoint);
    app_check_update(app.handle().clone(), app.state())
        .await
        .unwrap();
    let state = app.state::<AppState>();
    let captured = std::sync::Arc::new(std::sync::Mutex::new(Vec::<serde_json::Value>::new()));
    let received = captured.clone();
    state
        .events
        .initialize(tauri::ipc::Channel::new(move |body| {
            let tauri::ipc::InvokeResponseBody::Json(body) = body else {
                panic!("Expected a JSON update event");
            };
            received
                .lock()
                .unwrap()
                .push(serde_json::from_str(&body).unwrap());
            Ok(())
        }))
        .unwrap();
    state
        .serial
        .connect("CATS-FAKE-APP-UPDATE".into())
        .await
        .unwrap();
    state.serial.reserve_firmware().unwrap();
    let error = app_install_update(app.handle().clone(), app.state())
        .await
        .unwrap_err();
    assert_eq!(error.code, "firmware_busy");
    assert!(state.firmware.busy());
    assert!(state.serial.connected_path().await.is_some());
    state.serial.firmware_active.store(false, Ordering::SeqCst);

    let transaction = state.serial.transaction.lock().await;
    let installation = app_install_update(app.handle().clone(), app.state());
    tokio::pin!(installation);
    assert!(
        tokio::time::timeout(Duration::from_millis(20), &mut installation)
            .await
            .is_err()
    );
    assert!(state.serial.connected_path().await.is_some());
    assert!(!state.firmware.busy());
    drop(transaction);
    let error = installation.await.unwrap_err();
    assert_eq!(error.code, "app_update_install");
    assert!(state.serial.connected_path().await.is_none());
    assert!(!state.firmware.busy());
    let progress: Vec<_> = captured
        .lock()
        .unwrap()
        .iter()
        .filter(|event| event["channel"] == "app:update-progress")
        .map(|event| event["payload"].clone())
        .collect();
    assert_eq!(
        progress.first().unwrap(),
        &json!({ "stage": "downloading", "progress": null })
    );
    assert!(progress.contains(&json!({ "stage": "downloading", "progress": 100 })));
    assert_eq!(
        progress.last().unwrap(),
        &json!({ "stage": "installing", "progress": 100 })
    );
    server.join().unwrap();
}
