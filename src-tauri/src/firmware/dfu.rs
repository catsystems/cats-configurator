//! Vega's STM32F411 ROM DFU protocol (ST AN3156). No option-byte writes,
//! read-unprotect, mass erase, or generic renderer-controlled USB requests.
use super::assets;
use crate::error::HostError;
use nusb::{
    DeviceInfo, Interface,
    transfer::{ControlIn, ControlOut, ControlType, Recipient, TransferError},
};
use std::{future::Future, time::Duration};
use tokio::time::{Instant, sleep};

const BASE: u32 = 0x0800_0000;
const IO_TIMEOUT: Duration = Duration::from_secs(5);
const OP_TIMEOUT: Duration = Duration::from_secs(60);
const DNLOAD: u8 = 1;
const UPLOAD: u8 = 2;
const GETSTATUS: u8 = 3;
const CLRSTATUS: u8 = 4;
const ABORT: u8 = 6;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Dfu {
    pub serial: String,
}

fn is_dfu(device: &DeviceInfo) -> bool {
    device.vendor_id() == 0x0483 && device.product_id() == 0xdf11
}
pub async fn list() -> Result<Vec<Dfu>, HostError> {
    nusb::list_devices()
        .await
        .map_err(access_error)?
        .filter(is_dfu)
        .map(|device| {
            device
                .serial_number()
                .filter(|s| !s.is_empty())
                .map(|serial| Dfu {
                    serial: serial.into(),
                })
                .ok_or_else(|| error("STM32 DFU device has no usable USB serial number."))
        })
        .collect()
}
fn error(message: impl Into<String>) -> HostError {
    HostError::new("dfu_protocol", message)
}
fn access_error(cause: impl std::fmt::Display) -> HostError {
    let help = if cfg!(target_os = "linux") {
        "Install the supplied CATS udev rules, reload udev rules, and reconnect Vega. Your user needs read/write access to STM32 DFU 0483:DF11; do not run Configurator as root."
    } else if cfg!(target_os = "macos") {
        "Close other USB/DFU tools and allow the USB accessory in macOS Privacy & Security if prompted. No STM32 driver is required on macOS."
    } else {
        "Install or repair the STM32 Bootloader WinUSB driver for 0483:DF11. Do not replace the Vega serial or ST-LINK driver. CubeProgrammer itself is not required."
    };
    HostError::new(
        "dfu_access",
        format!("Cannot access STM32 USB DFU: {cause}. {help}"),
    )
}
fn transfer_error(cause: TransferError) -> HostError {
    HostError::new(
        if cause == TransferError::Disconnected {
            "dfu_disconnected"
        } else {
            "dfu_transfer"
        },
        format!(
            "USB DFU transfer failed: {cause}. Keep Vega in DFU and retry; no unverified image will be started."
        ),
    )
}

#[derive(Clone, Debug)]
struct Layout {
    sectors: Vec<(u32, u32)>,
    end: u32,
}
fn layout(text: &str) -> Result<Layout, HostError> {
    let parts: Vec<_> = text.trim().split('/').map(str::trim).collect();
    if parts.len() != 3 || parts[0] != "@Internal Flash" || parts[1] != "0x08000000" {
        return Err(error("Unsupported DFU application memory map."));
    }
    let mut groups = Vec::new();
    for group in parts[2].split(',') {
        let (count, size) = group
            .trim()
            .split_once('*')
            .ok_or_else(|| error("Malformed DFU sector map."))?;
        let size = size
            .strip_suffix("Kg")
            .ok_or_else(|| error("DFU flash must support read, erase, and write."))?;
        groups.push((
            count
                .parse::<u32>()
                .map_err(|_| error("Invalid sector count."))?,
            size.parse::<u32>()
                .map_err(|_| error("Invalid sector size."))?,
        ));
    }
    if groups != [(4, 16), (1, 64), (1, 128)] && groups != [(4, 16), (1, 64), (3, 128)] {
        return Err(error(
            "DFU flash layout does not match STM32F411 (256/512 KiB).",
        ));
    }
    let mut sectors = Vec::new();
    let mut address = BASE;
    for (count, size) in groups {
        for _ in 0..count {
            sectors.push((address, size * 1024));
            address += size * 1024;
        }
    }
    Ok(Layout {
        sectors,
        end: address,
    })
}
fn transfer_size(bytes: &[u8]) -> Result<usize, HostError> {
    if bytes.len() != 9 || bytes[0] != 9 || bytes[1] != 0x21 || bytes[2] & 3 != 3 {
        return Err(error(
            "DFU descriptor must support download and upload verification.",
        ));
    }
    let size = u16::from_le_bytes([bytes[5], bytes[6]]) as usize;
    let version = u16::from_le_bytes([bytes[7], bytes[8]]);
    if !(64..=2048).contains(&size) || size % 4 != 0 || version != 0x011a {
        return Err(error(
            "Unsupported STM32 DfuSe transfer size or protocol version.",
        ));
    }
    Ok(size)
}

// A byte-level transport seam lets tests exercise the actual erase/write/readback
// state machine, including short transfers, errors, and verification failures.
trait Transport: Send + Sync {
    fn input(
        &self,
        request: u8,
        block: u16,
        length: u16,
    ) -> impl Future<Output = Result<Vec<u8>, HostError>> + Send;
    fn output(
        &self,
        request: u8,
        block: u16,
        data: &[u8],
    ) -> impl Future<Output = Result<(), HostError>> + Send;
}
struct Usb(Interface);
impl Transport for Usb {
    async fn input(&self, request: u8, block: u16, length: u16) -> Result<Vec<u8>, HostError> {
        self.0
            .control_in(
                ControlIn {
                    control_type: ControlType::Class,
                    recipient: Recipient::Interface,
                    request,
                    value: block,
                    index: self.0.interface_number().into(),
                    length,
                },
                IO_TIMEOUT,
            )
            .await
            .map_err(transfer_error)
    }
    async fn output(&self, request: u8, block: u16, data: &[u8]) -> Result<(), HostError> {
        self.0
            .control_out(
                ControlOut {
                    control_type: ControlType::Class,
                    recipient: Recipient::Interface,
                    request,
                    value: block,
                    index: self.0.interface_number().into(),
                    data,
                },
                IO_TIMEOUT,
            )
            .await
            .map_err(transfer_error)
    }
}
#[derive(Debug)]
struct Status {
    code: u8,
    state: u8,
    poll: Duration,
}
fn status(bytes: &[u8]) -> Result<Status, HostError> {
    if bytes.len() != 6 {
        return Err(error("Short DFU status response."));
    }
    let millis = u32::from_le_bytes([bytes[1], bytes[2], bytes[3], 0]);
    if millis > 30_000 || bytes[4] > 10 {
        return Err(error("Invalid DFU status or polling interval."));
    }
    Ok(Status {
        code: bytes[0],
        state: bytes[4],
        poll: Duration::from_millis(millis.max(1).into()),
    })
}
struct Session<T> {
    io: T,
    layout: Layout,
    transfer: usize,
}
impl<T: Transport> Session<T> {
    async fn status(&self) -> Result<Status, HostError> {
        status(&self.io.input(GETSTATUS, 0, 6).await?)
    }
    async fn complete(&self) -> Result<(), HostError> {
        let deadline = Instant::now() + OP_TIMEOUT;
        loop {
            let status = self.status().await?;
            if status.code != 0 {
                return Err(error(format!(
                    "DFU error {} in state {}. No reset was requested.",
                    status.code, status.state
                )));
            }
            match status.state {
                5 => return Ok(()),
                3 | 4 if Instant::now() + status.poll <= deadline => sleep(status.poll).await,
                _ => {
                    return Err(error(format!(
                        "Unexpected or timed-out DFU download state {}.",
                        status.state
                    )));
                }
            }
        }
    }
    async fn idle(&self) -> Result<(), HostError> {
        let deadline = Instant::now() + OP_TIMEOUT;
        let mut recovery_requests = 0;
        loop {
            let status = self.status().await?;
            match (status.code, status.state) {
                (0, 2) => return Ok(()),
                (_, 10) => {
                    recovery_requests += 1;
                    self.io.output(CLRSTATUS, 0, &[]).await?;
                }
                (0, 5 | 9) => {
                    recovery_requests += 1;
                    self.io.output(ABORT, 0, &[]).await?;
                }
                (0, 3 | 4) => {
                    sleep(status.poll).await;
                }
                _ => {
                    return Err(error(format!(
                        "DFU cannot enter idle from state {} (error {}).",
                        status.state, status.code
                    )));
                }
            }
            if Instant::now() >= deadline || recovery_requests > 3 {
                return Err(error(
                    "DFU did not return to idle; leave the device connected.",
                ));
            }
        }
    }
    async fn download(&self, block: u16, bytes: &[u8]) -> Result<(), HostError> {
        self.io.output(DNLOAD, block, bytes).await?;
        self.complete().await
    }
    async fn address(&self, address: u32) -> Result<(), HostError> {
        let mut command = vec![0x21];
        command.extend(address.to_le_bytes());
        self.download(0, &command).await
    }
    async fn read(&self, address: u32, length: usize) -> Result<Vec<u8>, HostError> {
        self.idle().await?;
        self.address(address).await?;
        self.idle().await?;
        let bytes = self.io.input(UPLOAD, 2, length as u16).await?;
        if bytes.len() != length {
            return Err(error("Short DFU readback; verification is incomplete."));
        }
        Ok(bytes)
    }
    fn check_image(&self, bytes: &[u8]) -> Result<(), HostError> {
        assets::validate_vega(bytes)?;
        if bytes.len() % 2 != 0 || bytes.len() as u32 > self.layout.end - BASE {
            return Err(error(
                "Firmware size is not aligned or exceeds this Vega's flash capacity.",
            ));
        }
        Ok(())
    }
    async fn verify(
        &self,
        bytes: &[u8],
        progress: &(impl Fn(&str, u8) + Sync),
    ) -> Result<(), HostError> {
        self.check_image(bytes)?;
        progress("verifying", 0);
        for (index, expected) in bytes.chunks(self.transfer).enumerate() {
            let address = BASE + (index * self.transfer) as u32;
            if self.read(address, expected.len()).await? != expected {
                return Err(HostError::new(
                    "firmware_verification",
                    format!(
                        "Vega readback differs at 0x{address:08x}. The image was not started; retry in DFU."
                    ),
                ));
            }
            progress(
                "verifying",
                ((index * self.transfer + expected.len()) * 100 / bytes.len()) as u8,
            );
        }
        self.idle().await
    }
    async fn program(
        &self,
        bytes: &[u8],
        progress: &(impl Fn(&str, u8) + Sync),
    ) -> Result<(), HostError> {
        self.check_image(bytes)?;
        // Confirm upload access before erasing, including the image's upper
        // boundary. The F411 ROM does not expose the factory size register via
        // DFU, so capacity comes from the validated bootloader memory map.
        self.read(BASE, 8).await?;
        self.read(BASE + bytes.len() as u32 - 2, 2).await?;
        self.idle().await?;
        let sectors: Vec<_> = self
            .layout
            .sectors
            .iter()
            .filter(|(address, _)| *address < BASE + bytes.len() as u32)
            .collect();
        progress("erasing", 0);
        for (index, (address, _)) in sectors.iter().enumerate() {
            let mut command = vec![0x41];
            command.extend(address.to_le_bytes());
            self.download(0, &command).await?;
            progress("erasing", ((index + 1) * 100 / sectors.len()) as u8);
        }
        progress("programming", 0);
        for (index, chunk) in bytes.chunks(self.transfer).enumerate() {
            // Set an explicit address for every block, including a short final
            // block; never rely on a bootloader's transfer-stride interpretation.
            self.address(BASE + (index * self.transfer) as u32).await?;
            self.download(2, chunk).await?;
            progress(
                "programming",
                ((index * self.transfer + chunk.len()) * 100 / bytes.len()) as u8,
            );
        }
        Ok(())
    }
    async fn leave(&self) -> Result<(), HostError> {
        self.idle().await?;
        self.address(BASE).await?;
        self.io.output(DNLOAD, 0, &[]).await?;
        match self.status().await {
            Ok(Status {
                code: 0,
                state: 6..=8,
                ..
            }) => Ok(()),
            Err(error) if error.code == "dfu_disconnected" => Ok(()),
            Err(error) => Err(error),
            Ok(state) => Err(error(format!(
                "DFU did not acknowledge application start: {state:?}"
            ))),
        }
    }
    async fn flash(
        &self,
        bytes: &[u8],
        progress: impl Fn(&str, u8) + Send + Sync,
    ) -> Result<(), HostError> {
        self.program(bytes, &progress).await?;
        self.verify(bytes, &progress).await?;
        progress("reconnecting", 100);
        self.leave().await
    }
}

async fn open(expected: &Dfu) -> Result<Session<Usb>, HostError> {
    let devices: Vec<_> = nusb::list_devices()
        .await
        .map_err(access_error)?
        .filter(is_dfu)
        .filter(|device| device.serial_number() == Some(expected.serial.as_str()))
        .collect();
    if devices.len() != 1 {
        return Err(error("The selected DFU device is missing or ambiguous."));
    }
    let device = devices[0].open().await.map_err(access_error)?;
    // macOS does not necessarily configure a device with no bound class driver.
    // The STM32 ROM exposes exactly one configuration, with value 1.
    #[cfg(target_os = "macos")]
    if device.active_configuration().is_err() {
        device.set_configuration(1).await.map_err(access_error)?;
    }
    let config = device.active_configuration().map_err(access_error)?;
    let functional: Vec<_> = config
        .descriptors()
        .filter(|d| d.descriptor_type() == 0x21)
        .collect();
    if functional.len() != 1 {
        return Err(error("Missing or ambiguous DFU functional descriptor."));
    }
    let transfer = transfer_size(&functional[0])?;
    let mut selected = Vec::new();
    for alt in config
        .interface_alt_settings()
        .filter(|alt| (alt.class(), alt.subclass(), alt.protocol()) == (0xfe, 1, 2))
    {
        let Some(index) = alt.string_index() else {
            continue;
        };
        let name = device
            .get_string_descriptor(index, 0x0409, IO_TIMEOUT)
            .await
            .map_err(access_error)?;
        if name.trim().starts_with("@Internal Flash") {
            selected.push((
                alt.interface_number(),
                alt.alternate_setting(),
                layout(&name)?,
            ));
        }
    }
    if selected.len() != 1 {
        return Err(error(
            "A unique STM32F411 internal-flash interface was not found.",
        ));
    }
    let (interface, alternate, layout) = selected.remove(0);
    let interface = device
        .claim_interface(interface)
        .await
        .map_err(access_error)?;
    interface
        .set_alt_setting(alternate)
        .await
        .map_err(access_error)?;
    let session = Session {
        io: Usb(interface),
        layout,
        transfer,
    };
    session.idle().await?;
    Ok(session)
}
pub async fn flash(
    device: &Dfu,
    bytes: &[u8],
    progress: impl Fn(&str, u8) + Send + Sync,
) -> Result<(), HostError> {
    open(device).await?.flash(bytes, progress).await
}

#[cfg(test)]
mod tests;
