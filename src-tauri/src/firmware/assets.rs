use std::collections::BTreeMap;
use std::time::Duration;

use semver::Version;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use url::Url;

use crate::error::HostError;

pub const GS_IMAGE_LIMIT: usize = 1408 * 1024;
pub const VEGA_IMAGE_LIMIT: usize = 512 * 1024;
const RELEASES: &str = "https://api.github.com/repos/catsystems/cats-embedded/releases";

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "kebab-case")]
pub enum Target {
    Vega,
    GroundStation,
    Telemetry,
}

impl Target {
    pub fn prefix(self) -> &'static str {
        match self {
            Self::Vega => "flight_computer-",
            Self::GroundStation => "ground_station-",
            Self::Telemetry => "telemetry-",
        }
    }
    pub fn extension(self) -> &'static str {
        if self == Self::GroundStation {
            ".UF2"
        } else {
            ".bin"
        }
    }
    pub fn limit(self) -> usize {
        if self == Self::GroundStation {
            GS_IMAGE_LIMIT * 2
        } else {
            VEGA_IMAGE_LIMIT
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
pub struct Release {
    pub draft: bool,
    pub prerelease: bool,
    pub html_url: String,
    pub body: Option<String>,
    pub assets: Vec<ReleaseAsset>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct ReleaseAsset {
    pub id: u64,
    pub name: String,
    pub size: u64,
    pub browser_download_url: String,
    pub digest: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Asset {
    pub id: u64,
    pub target: Target,
    pub version: String,
    pub name: String,
    pub size: u64,
    pub release_url: String,
    pub notes: String,
    #[serde(skip)]
    pub url: String,
    #[serde(skip)]
    pub digest: Option<String>,
}

pub fn error(message: impl Into<String>) -> HostError {
    HostError::new("firmware_validation", message)
}

fn safe_https(url: &Url) -> bool {
    url.scheme() == "https"
        && url.port().is_none()
        && url.username().is_empty()
        && url.password().is_none()
        && url.fragment().is_none()
}

pub fn allowed_download_url(url: &Url) -> bool {
    safe_https(url)
        && match url.host_str() {
            Some("github.com") => url
                .path()
                .starts_with("/catsystems/cats-embedded/releases/download/"),
            Some("release-assets.githubusercontent.com" | "objects.githubusercontent.com") => true,
            _ => false,
        }
}

fn official_asset_url(value: &str, name: &str) -> bool {
    Url::parse(value).is_ok_and(|url| {
        safe_https(&url)
            && url.host_str() == Some("github.com")
            && url.query().is_none()
            && url
                .path()
                .starts_with("/catsystems/cats-embedded/releases/download/")
            && url.path_segments().is_some_and(|parts| {
                let parts: Vec<_> = parts.collect();
                parts.len() == 6 && parts[5] == name && !parts[4].is_empty()
            })
    })
}

fn official_release_url(value: &str) -> bool {
    Url::parse(value).is_ok_and(|url| {
        safe_https(&url)
            && url.host_str() == Some("github.com")
            && url.query().is_none()
            && url
                .path()
                .starts_with("/catsystems/cats-embedded/releases/tag/")
    })
}

pub fn asset_version(target: Target, name: &str) -> Option<Version> {
    let raw = name
        .strip_prefix(target.prefix())?
        .strip_suffix(target.extension())?;
    let version = Version::parse(raw).ok()?;
    (version.pre.is_empty() && version.build.is_empty() && version.to_string() == raw)
        .then_some(version)
}

pub fn select_assets(releases: &[Release]) -> Vec<Asset> {
    let mut selected: BTreeMap<Target, (Version, Asset)> = BTreeMap::new();
    for release in releases
        .iter()
        .filter(|r| !r.draft && !r.prerelease && official_release_url(&r.html_url))
    {
        for source in &release.assets {
            for target in [Target::Vega, Target::GroundStation] {
                let Some(version) = asset_version(target, &source.name) else {
                    continue;
                };
                if source.size < 8
                    || source.size > target.limit() as u64
                    || !official_asset_url(&source.browser_download_url, &source.name)
                {
                    continue;
                }
                if selected
                    .get(&target)
                    .is_some_and(|(current, _)| current >= &version)
                {
                    continue;
                }
                selected.insert(
                    target,
                    (
                        version.clone(),
                        Asset {
                            id: source.id,
                            target,
                            version: version.to_string(),
                            name: source.name.clone(),
                            size: source.size,
                            release_url: release.html_url.clone(),
                            notes: release.body.clone().unwrap_or_default(),
                            url: source.browser_download_url.clone(),
                            digest: source.digest.clone(),
                        },
                    ),
                );
            }
        }
    }
    selected.into_values().map(|(_, asset)| asset).collect()
}

pub fn client(download: bool) -> Result<reqwest::Client, HostError> {
    reqwest::Client::builder()
        .user_agent("CATS-Configurator-firmware")
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(180))
        .redirect(reqwest::redirect::Policy::custom(move |attempt| {
            if download && attempt.previous().len() < 5 && allowed_download_url(attempt.url()) {
                attempt.follow()
            } else {
                attempt.error("Unapproved firmware redirect")
            }
        }))
        .build()
        .map_err(|e| HostError::new("firmware_network", e.to_string()))
}

pub async fn releases() -> Result<Vec<Asset>, HostError> {
    let client = client(false)?;
    let mut releases = Vec::new();
    // Bound both API requests and response memory; do not follow untrusted Link URLs.
    for page in 1..=10 {
        let mut response = client
            .get(format!("{RELEASES}?per_page=100&page={page}"))
            .header("Accept", "application/vnd.github+json")
            .send()
            .await
            .and_then(reqwest::Response::error_for_status)
            .map_err(|e| {
                HostError::new(
                    "firmware_network",
                    format!("Could not check official firmware releases: {e}"),
                )
            })?;
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|e| error(e.to_string()))? {
            if bytes.len() + chunk.len() > 8 * 1024 * 1024 {
                return Err(error("Release response is too large."));
            }
            bytes.extend_from_slice(&chunk);
        }
        let entries: Vec<Release> =
            serde_json::from_slice(&bytes).map_err(|e| error(e.to_string()))?;
        let done = entries.len() < 100;
        releases.extend(entries);
        if done {
            return Ok(select_assets(&releases));
        }
    }
    Err(error(
        "Release history exceeds the supported search limit; no firmware was selected.",
    ))
}

pub fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

pub fn validate(asset: &Asset, bytes: &[u8]) -> Result<(), HostError> {
    if bytes.len() as u64 != asset.size || bytes.len() > asset.target.limit() {
        return Err(error(
            "Firmware download size does not match the official asset.",
        ));
    }
    if let Some(digest) = &asset.digest {
        let expected = digest
            .strip_prefix("sha256:")
            .filter(|d| d.len() == 64 && d.bytes().all(|b| b.is_ascii_hexdigit()))
            .ok_or_else(|| error("Unsupported or malformed GitHub firmware digest."))?;
        if !hash(bytes).eq_ignore_ascii_case(expected) {
            return Err(error("Firmware SHA-256 digest does not match GitHub."));
        }
    }
    match asset.target {
        Target::Vega => validate_vega(bytes),
        Target::GroundStation => validate_uf2(bytes),
        Target::Telemetry => Err(error("Telemetry updating is not supported.")),
    }
}

fn word(bytes: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap())
}

pub fn validate_vega(bytes: &[u8]) -> Result<(), HostError> {
    if bytes.len() < 8 || bytes.len() > VEGA_IMAGE_LIMIT || bytes.len() % 2 != 0 {
        return Err(error("Invalid STM32F411 image size."));
    }
    let stack = word(bytes, 0);
    let reset = word(bytes, 4);
    if !(0x2000_0008..=0x2002_0000).contains(&stack)
        || stack % 8 != 0
        || reset & 1 == 0
        || (reset & !1) < 0x0800_0008
        || (reset & !1) >= 0x0800_0000 + bytes.len() as u32
    {
        return Err(error(
            "Image is not a valid STM32F411 application at 0x08000000.",
        ));
    }
    Ok(())
}

pub fn validate_uf2(bytes: &[u8]) -> Result<(), HostError> {
    if bytes.is_empty() || bytes.len() % 512 != 0 || bytes.len() > GS_IMAGE_LIMIT * 2 {
        return Err(error("Invalid Ground Station UF2 size."));
    }
    let count = bytes.len() / 512;
    let mut seen = vec![false; count];
    for block in bytes.chunks_exact(512) {
        if word(block, 0) != 0x0a32_4655
            || word(block, 4) != 0x9e5d_5157
            || word(block, 508) != 0x0ab1_6f30
            || word(block, 8) != 0x2000
            || word(block, 16) != 256
            || word(block, 24) as usize != count
            || word(block, 28) != 0xbfdd_4eee
        {
            return Err(error("Invalid ESP32-S2 UF2 block header."));
        }
        let index = word(block, 20) as usize;
        if index >= count || seen[index] || word(block, 12) as usize != index * 256 {
            return Err(error(
                "UF2 contains duplicate, missing, overlapping, or out-of-range application blocks.",
            ));
        }
        if index == 0 && block[32] != 0xe9 {
            return Err(error("UF2 does not contain an ESP application image."));
        }
        seen[index] = true;
    }
    Ok(())
}

pub fn gs_version(line: &str) -> Option<String> {
    let value = line
        .trim()
        .strip_prefix("CATS-FW target=ground-station version=")?;
    Version::parse(value).ok().map(|v| v.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    #[ignore = "read-only live GitHub release check; requires network"]
    async fn official_releases_live() {
        let selected = releases().await.unwrap();
        for asset in &selected {
            assert!(asset_version(asset.target, &asset.name).is_some());
            assert!(official_asset_url(&asset.url, &asset.name));
        }
        println!(
            "Eligible versioned official firmware assets: {}",
            selected.len()
        );
    }

    #[test]
    #[ignore = "validates a locally built GS artifact without flashing; requires CATS_TEST_GS_UF2"]
    fn built_ground_station_uf2_is_compatible() {
        let path = std::env::var("CATS_TEST_GS_UF2").unwrap();
        let bytes = std::fs::read(path).unwrap();
        validate_uf2(&bytes).unwrap();
        println!(
            "Validated generated GS UF2: {} bytes; SHA-256 {}",
            bytes.len(),
            hash(&bytes)
        );
    }

    pub fn bin() -> Vec<u8> {
        let mut bytes = vec![0; 256];
        bytes[..4].copy_from_slice(&0x2002_0000u32.to_le_bytes());
        bytes[4..8].copy_from_slice(&0x0800_0021u32.to_le_bytes());
        bytes
    }
    fn uf2() -> Vec<u8> {
        let mut bytes = vec![0; 1024];
        for (i, b) in bytes.chunks_exact_mut(512).enumerate() {
            for (offset, value) in [
                (0, 0x0a32_4655),
                (4, 0x9e5d_5157),
                (8, 0x2000),
                (12, i as u32 * 256),
                (16, 256),
                (20, i as u32),
                (24, 2),
                (28, 0xbfdd_4eee),
                (508, 0x0ab1_6f30),
            ] {
                b[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
            }
            b[32] = 0xe9;
        }
        bytes
    }
    #[test]
    fn firmware_vectors_are_bounded() {
        assert!(validate_vega(&bin()).is_ok());
        for (offset, value) in [
            (0, 0x2002_0008u32),
            (0, 0x2000_0001),
            (4, 0x0800_0020),
            (4, 0x0808_0001),
            (4, 0x0800_0001),
        ] {
            let mut b = bin();
            b[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
            assert!(validate_vega(&b).is_err());
        }
        assert!(validate_vega(&[0; 7]).is_err());
        assert!(validate_vega(&bin()[..255]).is_err());
    }
    #[test]
    fn uf2_rejects_wrong_family_duplicates_addresses_flags_and_truncation() {
        assert!(validate_uf2(&uf2()).is_ok());
        for offset in [0, 4, 8, 12, 16, 20, 24, 28, 508, 512 + 20] {
            let mut b = uf2();
            b[offset] ^= 1;
            assert!(validate_uf2(&b).is_err(), "offset {offset}");
        }
        assert!(validate_uf2(&uf2()[..513]).is_err());
        let b = uf2();
        let swapped = [&b[512..], &b[..512]].concat();
        assert!(validate_uf2(&swapped).is_ok());
    }
    #[test]
    fn native_names_and_serial_metadata_are_strict() {
        assert_eq!(
            asset_version(Target::GroundStation, "ground_station-1.2.3.UF2").unwrap(),
            Version::new(1, 2, 3)
        );
        for name in [
            "ground_station.UF2",
            "ground_station-1.2.3-rc.1.UF2",
            "ground_station-1.2.3.bin",
            "ground_station-01.2.3.UF2",
        ] {
            assert!(asset_version(Target::GroundStation, name).is_none());
        }
        assert_eq!(
            gs_version("CATS-FW target=ground-station version=1.2.3\r\n").as_deref(),
            Some("1.2.3")
        );
        assert!(gs_version("TinyUF2 version=1.2.3").is_none());
    }
    #[test]
    fn source_and_redirect_allowlist_is_exact() {
        for url in [
            "https://release-assets.githubusercontent.com/asset?token=x",
            "https://github.com/catsystems/cats-embedded/releases/download/v3/flight_computer-3.0.2.bin",
        ] {
            assert!(allowed_download_url(&Url::parse(url).unwrap()));
        }
        for url in [
            "http://github.com/catsystems/cats-embedded/releases/download/x/a",
            "https://github.com/other/repo/releases/download/x/a",
            "https://release-assets.githubusercontent.com.evil.test/a",
            "https://user@objects.githubusercontent.com/a",
            "https://objects.githubusercontent.com:444/a",
        ] {
            assert!(!allowed_download_url(&Url::parse(url).unwrap()));
        }
    }
    #[test]
    fn stable_selection_uses_component_version_and_digest_is_checked() {
        let make = |version: &str, draft, prerelease| Release {
            draft,
            prerelease,
            html_url: "https://github.com/catsystems/cats-embedded/releases/tag/2026.08".into(),
            body: None,
            assets: vec![ReleaseAsset {
                id: 1,
                name: format!("flight_computer-{version}.bin"),
                size: 256,
                browser_download_url: format!(
                    "https://github.com/catsystems/cats-embedded/releases/download/2026.08/flight_computer-{version}.bin"
                ),
                digest: Some(format!("sha256:{}", hash(&bin()))),
            }],
        };
        let selected = select_assets(&[
            make("3.9.0", false, false),
            make("3.10.0", false, false),
            make("4.0.0", false, true),
            make("5.0.0", true, false),
        ]);
        assert_eq!(selected.len(), 1);
        assert_eq!(selected[0].version, "3.10.0");
        assert!(validate(&selected[0], &bin()).is_ok());
        let mut corrupt = bin();
        corrupt[100] = 1;
        assert!(validate(&selected[0], &corrupt).is_err());
        let mut asset = selected[0].clone();
        asset.digest = Some("sha256:bad".into());
        assert!(validate(&asset, &bin()).is_err());
    }
}
