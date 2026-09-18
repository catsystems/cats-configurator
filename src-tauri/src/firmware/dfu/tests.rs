use super::*;
use std::sync::Mutex;

const MAP: &str = "@Internal Flash  /0x08000000/04*016Kg,01*064Kg,03*128Kg";

#[derive(Clone, Copy, PartialEq, Eq)]
enum Fault {
    None,
    Erase,
    Write,
    Mismatch,
    ShortRead,
    ReadProtected,
    ShortStatus,
    Disconnect,
}
struct Model {
    memory: Vec<u8>,
    address: u32,
    state: u8,
    error: u8,
    fault: Fault,
    calls: Vec<(u8, u16, Vec<u8>)>,
    reads: Vec<(u32, usize)>,
    started: bool,
}
struct Fake(Mutex<Model>);
impl Transport for Fake {
    async fn input(&self, request: u8, block: u16, length: u16) -> Result<Vec<u8>, HostError> {
        let mut m = self.0.lock().unwrap();
        match request {
            GETSTATUS => {
                if m.fault == Fault::ShortStatus {
                    return Ok(vec![0; 5]);
                }
                let result = vec![m.error, 1, 0, 0, m.state, 0];
                if m.state == 4 {
                    m.state = 5;
                }
                Ok(result)
            }
            UPLOAD => {
                assert_eq!(block, 2);
                assert!(matches!(m.state, 2 | 9));
                if m.fault == Fault::ReadProtected {
                    return Err(error("Read protection prevents upload"));
                }
                let address = m.address;
                m.reads.push((address, length as usize));
                let start = (address - BASE) as usize;
                let mut bytes = m.memory[start..start + length as usize].to_vec();
                if m.fault == Fault::Mismatch {
                    bytes[0] ^= 1;
                }
                if m.fault == Fault::ShortRead
                    && m.calls.iter().any(|(r, b, _)| *r == DNLOAD && *b == 2)
                {
                    bytes.pop();
                }
                m.state = 9;
                Ok(bytes)
            }
            _ => panic!("Unexpected input request {request}"),
        }
    }
    async fn output(&self, request: u8, block: u16, data: &[u8]) -> Result<(), HostError> {
        let mut m = self.0.lock().unwrap();
        m.calls.push((request, block, data.to_vec()));
        match request {
            ABORT => {
                assert!(matches!(m.state, 5 | 9));
                m.state = 2;
            }
            CLRSTATUS => {
                assert_eq!(m.state, 10);
                m.error = 0;
                m.state = 2;
            }
            DNLOAD => {
                assert!(matches!(m.state, 2 | 5));
                if data.is_empty() {
                    assert_eq!(block, 0);
                    m.started = true;
                    m.state = 7;
                    return Ok(());
                }
                if block == 0 {
                    assert_eq!(data.len(), 5, "Mass erase is forbidden");
                    let address = u32::from_le_bytes(data[1..].try_into().unwrap());
                    match data[0] {
                        0x21 => m.address = address,
                        0x41 => {
                            if m.fault == Fault::Erase {
                                m.error = 4;
                                m.state = 10;
                                return Ok(());
                            }
                            let map = layout(MAP).unwrap();
                            let &(_, size) = map
                                .sectors
                                .iter()
                                .find(|(a, _)| *a == address)
                                .expect("Sector start");
                            let start = (address - BASE) as usize;
                            m.memory[start..start + size as usize].fill(0xff);
                        }
                        _ => panic!("Forbidden DfuSe command"),
                    }
                } else {
                    assert_eq!(block, 2);
                    if m.fault == Fault::Disconnect {
                        return Err(HostError::new("dfu_disconnected", "Unplugged"));
                    }
                    if m.fault == Fault::Write {
                        m.error = 3;
                        m.state = 10;
                        return Ok(());
                    }
                    let start = (m.address - BASE) as usize;
                    m.memory[start..start + data.len()].copy_from_slice(data);
                }
                m.state = 4;
            }
            _ => panic!("Unexpected output request {request}"),
        }
        Ok(())
    }
}
fn session(fault: Fault) -> Session<Fake> {
    Session {
        io: Fake(Mutex::new(Model {
            memory: vec![0xa5; 512 * 1024],
            address: BASE,
            state: 2,
            error: 0,
            fault,
            calls: vec![],
            reads: vec![],
            started: false,
        })),
        layout: layout(MAP).unwrap(),
        transfer: 2048,
    }
}
fn image(length: usize) -> Vec<u8> {
    let mut bytes: Vec<_> = (0..length).map(|n| (n % 251) as u8).collect();
    bytes[..4].copy_from_slice(&0x2002_0000u32.to_le_bytes());
    bytes[4..8].copy_from_slice(&(BASE + 0x21).to_le_bytes());
    bytes
}

#[test]
fn only_f411_readable_writable_flash_maps_are_accepted() {
    assert_eq!(layout(MAP).unwrap().end, BASE + 512 * 1024);
    assert_eq!(
        layout(&MAP.replace("03*128", "01*128")).unwrap().end,
        BASE + 256 * 1024
    );
    for text in [
        MAP.replace("08000000", "08004000"),
        MAP.replace("Kg", "Ka"),
        MAP.replace("03*128", "07*128"),
        MAP.replace("Internal Flash", "Option Bytes"),
        format!("{MAP}/other"),
    ] {
        assert!(layout(&text).is_err(), "{text}");
    }
}
#[test]
fn descriptors_and_status_must_be_complete_and_supported() {
    let descriptor = [9, 0x21, 0x0b, 0xff, 0, 0, 8, 0x1a, 1];
    assert_eq!(transfer_size(&descriptor).unwrap(), 2048);
    for (index, value) in [(0, 8), (1, 0x22), (2, 1), (6, 16), (7, 0x10)] {
        let mut invalid = descriptor;
        invalid[index] = value;
        assert!(transfer_size(&invalid).is_err());
    }
    assert!(transfer_size(&descriptor[..8]).is_err());
    assert!(status(&[0; 5]).is_err());
    assert!(status(&[0, 0, 0, 0, 11, 0]).is_err());
    assert!(status(&[0, 0xff, 0xff, 0xff, 4, 0]).is_err());
    assert_eq!(
        status(&[0, 0x34, 0x12, 0, 4, 0]).unwrap().poll,
        Duration::from_millis(0x1234)
    );
}
#[tokio::test]
async fn success_erases_only_occupied_sectors_and_verifies_short_final_block_before_start() {
    let s = session(Fault::None);
    let bytes = image(18 * 1024 + 24);
    s.flash(&bytes, |_, _| {}).await.unwrap();
    let m = s.io.0.lock().unwrap();
    assert!(m.started);
    assert_eq!(&m.memory[..bytes.len()], &bytes);
    assert!(m.memory[32 * 1024..].iter().all(|b| *b == 0xa5));
    let erased: Vec<_> = m
        .calls
        .iter()
        .filter(|(r, b, d)| *r == DNLOAD && *b == 0 && d.first() == Some(&0x41))
        .map(|(_, _, d)| u32::from_le_bytes(d[1..].try_into().unwrap()))
        .collect();
    assert_eq!(erased, [BASE, BASE + 16 * 1024]);
    assert_eq!(m.reads.last(), Some(&(BASE + 18 * 1024, 24)));
    assert_eq!(
        m.reads.iter().map(|(_, n)| n).sum::<usize>(),
        bytes.len() + 10
    );
    assert_eq!(m.calls.last(), Some(&(DNLOAD, 0, vec![])));
}
#[tokio::test]
async fn erase_write_disconnect_and_verification_failures_never_start_an_image() {
    for fault in [
        Fault::Erase,
        Fault::Write,
        Fault::Disconnect,
        Fault::Mismatch,
        Fault::ShortRead,
        Fault::ShortStatus,
    ] {
        let s = session(fault);
        assert!(s.flash(&image(4100), |_, _| {}).await.is_err());
        assert!(!s.io.0.lock().unwrap().started);
    }
}
#[tokio::test]
async fn retry_clears_previous_error_then_erases_rewrites_and_verifies() {
    let s = session(Fault::Write);
    let bytes = image(256);
    assert!(s.flash(&bytes, |_, _| {}).await.is_err());
    s.io.0.lock().unwrap().fault = Fault::None;
    s.flash(&bytes, |_, _| {}).await.unwrap();
    let m = s.io.0.lock().unwrap();
    assert!(m.started);
    assert!(m.calls.iter().any(|(r, _, _)| *r == CLRSTATUS));
    assert_eq!(m.reads.last(), Some(&(BASE, 256)));
}
#[tokio::test]
async fn invalid_or_oversized_images_cannot_issue_any_usb_request() {
    let mut s = session(Fault::None);
    s.layout = layout(&MAP.replace("03*128", "01*128")).unwrap();
    for bytes in [image(256 * 1024 + 2), image(257), vec![0; 256]] {
        assert!(s.flash(&bytes, |_, _| {}).await.is_err());
    }
    assert!(s.io.0.lock().unwrap().calls.is_empty());
}

#[tokio::test]
async fn read_protection_stops_before_erasing_or_writing() {
    let s = session(Fault::ReadProtected);
    assert!(s.flash(&image(256), |_, _| {}).await.is_err());
    let m = s.io.0.lock().unwrap();
    assert!(!m.started);
    assert!(
        !m.calls
            .iter()
            .any(|(r, b, data)| *r == DNLOAD && (*b == 2 || data.first() == Some(&0x41)))
    );
}

// Only for a connected Vega already running the explicitly approved 3.0.2
// image. This probe does not erase/write. It starts the application only after
// full readback matches that pinned official asset. Normal tests never run it.
#[tokio::test]
#[ignore = "requires an explicitly approved Vega already in DFU and pinned official image"]
async fn acceptance_native_dfu_readback_only() {
    assert_eq!(
        std::env::var("CATS_VEGA_FLASH_APPROVAL").as_deref(),
        Ok("official-3.0.2-charges-disconnected")
    );
    let bytes = std::fs::read(std::env::var("CATS_TEST_VEGA_IMAGE").unwrap()).unwrap();
    assert_eq!(
        assets::hash(&bytes),
        "9edbaf02d7bc24ca85a0047e8ae0888b4b177693cbc05dcc0686d1b86cf5329a"
    );
    let devices = list().await.unwrap();
    assert_eq!(devices.len(), 1);
    assert_eq!(
        devices[0].serial,
        std::env::var("CATS_TEST_DFU_SERIAL").unwrap()
    );
    let session = open(&devices[0]).await.unwrap();
    println!(
        "Native DFU: serial={}, capacity={} KiB, transfer={} bytes",
        devices[0].serial,
        (session.layout.end - BASE) / 1024,
        session.transfer
    );
    session.verify(&bytes, &|_, _| {}).await.unwrap();
    println!(
        "All {} bytes match the pinned official firmware; no erase/write performed.",
        bytes.len()
    );
    session.leave().await.unwrap();
}
