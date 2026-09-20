//! Explicitly opted-in physical acceptance test. Never part of the renderer API.
use super::*;

#[tokio::test]
#[ignore = "writes Vega firmware; requires explicit legacy-asset approval and disconnected charges"]
async fn acceptance_vega_official_legacy_302() {
    assert_eq!(
        std::env::var("CATS_VEGA_FLASH_APPROVAL").as_deref(),
        Ok("official-3.0.2-charges-disconnected"),
        "Explicit approval and physical safety confirmation are required."
    );
    let requested_port = std::env::var("CATS_VEGA_PORT").expect("Set the identified Vega port");
    let ports: Vec<_> = SerialManager::list()
        .unwrap()
        .into_iter()
        .filter(hardware::vega_port)
        .collect();
    assert_eq!(ports.len(), 1, "Connect exactly one Vega");
    assert_eq!(ports[0].path, requested_port);

    // This exact historical asset is the user-approved exception. Production
    // release selection remains strict; neither local files nor arbitrary URLs
    // are exposed to the application. Its bytes were inspected independently.
    let release: assets::Release = assets::client(false)
        .unwrap()
        .get("https://api.github.com/repos/catsystems/cats-embedded/releases/tags/v3.0.2")
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(!release.draft && !release.prerelease);
    assert_eq!(
        release.html_url,
        "https://github.com/catsystems/cats-embedded/releases/tag/v3.0.2"
    );
    let source = release
        .assets
        .iter()
        .find(|asset| asset.name == "flight_computer.bin")
        .unwrap();
    assert_eq!(source.size, 234_776);
    assert_eq!(
        source.browser_download_url,
        "https://github.com/catsystems/cats-embedded/releases/download/v3.0.2/flight_computer.bin"
    );
    let asset = Asset {
        id: source.id,
        target: Target::Vega,
        version: "3.0.2".into(),
        name: source.name.clone(),
        size: source.size,
        release_url: release.html_url.clone(),
        notes: "Explicitly approved one-off legacy release acceptance test.".into(),
        url: source.browser_download_url.clone(),
        digest: Some(
            "sha256:9edbaf02d7bc24ca85a0047e8ae0888b4b177693cbc05dcc0686d1b86cf5329a".into(),
        ),
    };
    let directory = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../tmp")
        .join(format!("vega-firmware-acceptance-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&directory).unwrap();
    println!("Acceptance evidence: {}", directory.display());
    let events = Arc::new(EventBus::default());
    let serial = Arc::new(SerialManager::new(events.clone()));
    serial.set_log_directory(directory.join("logs"));
    serial.connect(requested_port).await.unwrap();
    let before = crate::profile::read_snapshot(&serial).await.unwrap();
    std::fs::write(
        directory.join("before.json"),
        serde_json::to_vec_pretty(&before).unwrap(),
    )
    .unwrap();
    println!("Before: {}", before["board"]);
    let manager = Arc::new(FirmwareManager::new(events, serial.clone()));
    manager.set_cache(directory.clone());
    let (devices, telemetry) = manager.discover().await.unwrap();
    let device = devices
        .iter()
        .find(|device| device.target == Target::Vega)
        .unwrap();
    let request = StartRequest {
        device_id: device.id.clone(),
        asset_id: asset.id,
        no_unsaved_changes: true,
        safety_confirmed: true,
        reinstall_confirmed: std::env::var("CATS_VEGA_REINSTALL_APPROVAL").as_deref() == Ok("1"),
        unknown_version_confirmed: false,
    };
    {
        let mut state = manager.snapshot.lock().unwrap();
        state.devices = devices;
        state.available = vec![asset];
        state.telemetry_version = telemetry;
    }
    manager.start(request).unwrap();
    let mut revision = u64::MAX;
    let result = loop {
        let state = manager.current();
        if state.revision != revision {
            println!(
                "{}: {} {}",
                state.stage,
                state.message,
                state
                    .error
                    .as_ref()
                    .map(|error| error.message.as_str())
                    .unwrap_or("")
            );
            revision = state.revision;
        }
        if !state.busy {
            break state;
        }
        sleep(Duration::from_millis(250)).await;
    };
    std::fs::write(
        directory.join("result.json"),
        serde_json::to_vec_pretty(&result).unwrap(),
    )
    .unwrap();
    assert_eq!(
        result.stage, "succeeded",
        "Update did not reach a verified running version; inspect result.json before recovery."
    );
    let after = crate::profile::read_snapshot(&serial).await.unwrap();
    std::fs::write(
        directory.join("after.json"),
        serde_json::to_vec_pretty(&after).unwrap(),
    )
    .unwrap();
    println!("After: {}", after["board"]);
    println!(
        "Configuration retained: {}",
        before["values"] == after["values"]
    );
    assert_eq!(after["board"]["firmwareVersion"], "3.0.2");
    assert_eq!(before["values"], after["values"], "Configuration changed");
    serial.disconnect().await;
}
