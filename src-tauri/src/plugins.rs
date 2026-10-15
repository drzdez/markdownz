//! Optional document format plugins: downloaded on request from the plugin
//! index of the release, checked against the updater key, kept in the app data
//! directory and served to the viewer through the `mdzplugin` protocol, which
//! checks the signature again on every load.

use std::path::PathBuf;

use base64::Engine;
use minisign_verify::{PublicKey, Signature};
use tauri::http::{header, Request, Response, StatusCode};
use tauri::{AppHandle, Manager, Runtime};

const MAX_PLUGIN_BYTES: usize = 64 << 20;
const MAX_INDEX_BYTES: usize = 1 << 20;

/// Plugin ids are short lower-case names; they become file names.
fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 40 && id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

/// Name of the plugin file in the release, also recorded in its signature.
fn asset_name(id: &str) -> String {
    format!("markdownz-plugin-{id}.js")
}

fn plugins_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join("plugins"))
}

/// The updater public key from tauri.conf.json: plugins are signed with the same key as updates.
fn public_key<R: Runtime>(app: &AppHandle<R>) -> Result<String, String> {
    app.config()
        .plugins
        .0
        .get("updater")
        .and_then(|u| u.get("pubkey"))
        .and_then(|k| k.as_str())
        .map(str::to_owned)
        .ok_or_else(|| "no public key to check plugins with".into())
}

fn decode_base64(text: &str) -> Result<String, String> {
    let bytes = base64::engine::general_purpose::STANDARD.decode(text.trim()).map_err(|e| format!("invalid signature encoding: {e}"))?;
    String::from_utf8(bytes).map_err(|_| "invalid signature encoding".into())
}

/// Checks `data` against a signature made by `tauri signer sign` (base64 of the minisign .sig).
/// The signed trusted comment names the file, so one signed plugin cannot pose as another.
pub fn verify(data: &[u8], signature: &str, public_key: &str, file_name: &str) -> Result<(), String> {
    let key = PublicKey::decode(&decode_base64(public_key)?).map_err(|e| format!("invalid public key: {e}"))?;
    let signature = Signature::decode(&decode_base64(signature)?).map_err(|e| format!("invalid signature: {e}"))?;
    key.verify(data, &signature, true).map_err(|_| "the signature does not match: the plugin is damaged or not from the Markdownz release".to_string())?;
    let expected = format!("file:{file_name}");
    if signature.trusted_comment().split('\t').any(|field| field == expected) {
        Ok(())
    } else {
        Err(format!("the signature belongs to another file, not {file_name}"))
    }
}

/// Only https, or a local server for testing plugins before a release.
fn check_url(url: &str) -> Result<(), String> {
    if url.starts_with("https://") || url.starts_with("http://127.0.0.1:") || url.starts_with("http://localhost:") {
        Ok(())
    } else {
        Err(format!("plugins are downloaded over https only, not from {url}"))
    }
}

async fn download(url: &str, limit: usize) -> Result<Vec<u8>, String> {
    check_url(url)?;
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    let client = reqwest::Client::builder()
        .user_agent(concat!("Markdownz/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;
    let response = client.get(url).send().await.map_err(|e| format!("cannot download {url}: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("cannot download {url}: {}", response.status()));
    }
    if response.content_length().is_some_and(|n| n as usize > limit) {
        return Err(format!("{url} is too large"));
    }
    let bytes = response.bytes().await.map_err(|e| format!("cannot download {url}: {e}"))?;
    if bytes.len() > limit {
        return Err(format!("{url} is too large"));
    }
    Ok(bytes.to_vec())
}

/// The plugin index (plugins.json) as text.
#[tauri::command]
pub async fn plugin_index(url: String) -> Result<String, String> {
    String::from_utf8(download(&url, MAX_INDEX_BYTES).await?).map_err(|_| "the plugin index is not text".into())
}

/// Downloads a plugin, checks its signature and stores it with its manifest (the index entry).
#[tauri::command]
pub async fn plugin_install<R: Runtime>(app: AppHandle<R>, manifest: serde_json::Value) -> Result<(), String> {
    let field = |name: &str| manifest.get(name).and_then(|v| v.as_str()).map(str::to_owned).ok_or(format!("the plugin entry has no {name}"));
    let id = field("id")?;
    if !valid_id(&id) {
        return Err(format!("invalid plugin id {id:?}"));
    }
    let signature = field("signature")?;
    let data = download(&field("url")?, MAX_PLUGIN_BYTES).await?;
    verify(&data, &signature, &public_key(&app)?, &asset_name(&id))?;

    let dir = plugins_dir(&app)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let write = |name: String, bytes: &[u8]| -> Result<(), String> {
        let tmp = dir.join(format!("{name}.tmp"));
        std::fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
        std::fs::rename(&tmp, dir.join(name)).map_err(|e| e.to_string())
    };
    write(format!("{id}.js.sig"), signature.as_bytes())?;
    write(format!("{id}.js"), &data)?;
    write(format!("{id}.json"), manifest.to_string().as_bytes())
}

#[tauri::command]
pub fn plugin_remove<R: Runtime>(app: AppHandle<R>, id: String) -> Result<(), String> {
    if !valid_id(&id) {
        return Err(format!("invalid plugin id {id:?}"));
    }
    let dir = plugins_dir(&app)?;
    for name in [format!("{id}.json"), format!("{id}.js"), format!("{id}.js.sig")] {
        match std::fs::remove_file(dir.join(name)) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => return Err(e.to_string()),
            _ => {}
        }
    }
    Ok(())
}

/// Manifests of the installed plugins.
#[tauri::command]
pub fn plugin_list<R: Runtime>(app: AppHandle<R>) -> Result<Vec<serde_json::Value>, String> {
    let dir = plugins_dir(&app)?;
    let Ok(entries) = std::fs::read_dir(&dir) else { return Ok(Vec::new()) };
    let mut list = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().is_some_and(|e| e == "json") && path.with_extension("js").is_file() {
            if let Some(manifest) = std::fs::read_to_string(&path).ok().and_then(|text| serde_json::from_str(&text).ok()) {
                list.push(manifest);
            }
        }
    }
    Ok(list)
}

/// The installed plugin file, if its signature is still valid.
fn read_verified<R: Runtime>(app: &AppHandle<R>, id: &str) -> Result<Vec<u8>, String> {
    let dir = plugins_dir(app)?;
    let data = std::fs::read(dir.join(format!("{id}.js"))).map_err(|e| e.to_string())?;
    let signature = std::fs::read_to_string(dir.join(format!("{id}.js.sig"))).map_err(|e| e.to_string())?;
    verify(&data, &signature, &public_key(app)?, &asset_name(id))?;
    Ok(data)
}

/// Why an installed plugin cannot be loaded (the module import only reports a failure).
#[tauri::command]
pub fn plugin_check<R: Runtime>(app: AppHandle<R>, id: String) -> Result<(), String> {
    if !valid_id(&id) {
        return Err(format!("invalid plugin id {id:?}"));
    }
    read_verified(&app, &id).map(|_| ())
}

/// Plugin ids from `Plugins=` in an install.ini (written by the MSI from its Plugins page).
fn plugins_in_ini(text: &str) -> Vec<String> {
    text.lines()
        .filter_map(|line| line.trim().strip_prefix("Plugins="))
        .flat_map(|value| value.split([' ', ',']))
        .filter(|id| valid_id(id))
        .map(str::to_owned)
        .collect()
}

/// Plugins chosen in the installer (install.ini next to the program); empty when there is none.
#[tauri::command]
pub fn installer_plugins() -> Vec<String> {
    std::env::current_exe()
        .ok()
        .and_then(|exe| std::fs::read_to_string(exe.with_file_name("install.ini")).ok())
        .map(|text| plugins_in_ini(&text))
        .unwrap_or_default()
}

/// `mdzplugin://localhost/<id>.js`: the installed plugin, only while its signature is valid.
pub fn serve<R: Runtime>(app: &AppHandle<R>, request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    let reply = |status: StatusCode, body: Vec<u8>| {
        Response::builder()
            .status(status)
            .header(header::CONTENT_TYPE, if status == StatusCode::OK { "text/javascript" } else { "text/plain" })
            // Module scripts are fetched with CORS from the page's origin.
            .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
            .header(header::CACHE_CONTROL, "no-store")
            .body(body)
            .unwrap_or_default()
    };
    let id = request.uri().path().trim_start_matches('/').strip_suffix(".js").unwrap_or_default().to_owned();
    if !valid_id(&id) {
        return reply(StatusCode::NOT_FOUND, b"no such plugin".to_vec());
    }
    match read_verified(app, &id) {
        Ok(data) => reply(StatusCode::OK, data),
        Err(e) => reply(StatusCode::FORBIDDEN, e.into_bytes()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_are_plain_names() {
        assert!(valid_id("dxf"));
        assert!(valid_id("model-3d"));
        assert!(!valid_id(""));
        assert!(!valid_id("../x"));
        assert!(!valid_id("A"));
    }

    #[test]
    fn reads_the_plugins_chosen_in_the_installer() {
        assert_eq!(plugins_in_ini("[Markdownz]
Plugins=dxf model 
"), ["dxf", "model"]);
        assert!(plugins_in_ini("[Markdownz]
Plugins=
").is_empty());
        assert_eq!(plugins_in_ini("Plugins=../evil tiff"), ["tiff"]);
    }

    #[test]
    fn only_https_or_local_test_servers() {
        assert!(check_url("https://github.com/x").is_ok());
        assert!(check_url("http://127.0.0.1:8765/plugins.json").is_ok());
        assert!(check_url("http://example.com/x").is_err());
        assert!(check_url("file:///c:/x").is_err());
    }

    // A throwaway key pair made for this test only (its private key was not kept).
    const TEST_KEY: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEFEQkEzMTM3MTY1NjdDNEQKUldSTmZGWVdOekc2cmRGR3dZWE9Fa1VlQmpmOXUxV1lTQS9UWDJVSVNxK054ZVhvaWZuUVBTT3AK";
    const TEST_SIGNATURE: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVSTmZGWVdOekc2cmZ6Tmd1RkYrMlkveFVQNDJrUXpYRWZpM0xvMnNPU3hRcTFSTWtuZUVqeTVLNkNyUVVYalQyU2RMSWtLOUZ6QnZ1cWFveTJGZkFhSENPaVZRZ3JhNEFzPQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzkyMDc3MzM5CWZpbGU6bWFya2Rvd256LXBsdWdpbi10ZXN0LmpzCkR1a244bW9QRk9leE0wVkxhblFabTJzeUhNZklRQi83ZEV6VWdsWjFpS2ZkdUt1ZzFzbEc1eEI1dHByMUdtS0ZDR0xGQkNrMVRINTRwZVhiaVV0U0J3PT0K";
    const TEST_PLUGIN: &[u8] = b"export const api = 1;
";

    #[test]
    fn accepts_the_signed_plugin() {
        assert_eq!(verify(TEST_PLUGIN, TEST_SIGNATURE, TEST_KEY, &asset_name("test")), Ok(()));
    }

    #[test]
    fn rejects_changed_plugins_and_other_names() {
        assert!(verify(b"export const api = 2;
", TEST_SIGNATURE, TEST_KEY, &asset_name("test")).is_err());
        assert!(verify(TEST_PLUGIN, TEST_SIGNATURE, TEST_KEY, &asset_name("dxf")).is_err());
    }

    #[test]
    fn rejects_garbage_signatures() {
        assert!(verify(b"x", "not base64!", "also not", "markdownz-plugin-x.js").is_err());
    }
}
