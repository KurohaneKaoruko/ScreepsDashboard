use reqwest::{Client, Method};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::time::Duration;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScreepsRequest {
    base_url: String,
    endpoint: String,
    method: Option<String>,
    token: Option<String>,
    query: Option<HashMap<String, String>>,
    body: Option<Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ScreepsResponse {
    status: u16,
    ok: bool,
    data: Value,
    url: String,
}

fn normalize_base_url(base_url: &str) -> String {
    let trimmed = base_url.trim().trim_end_matches('/');
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        trimmed.to_string()
    } else {
        format!("https://{}", trimmed)
    }
}

fn normalize_endpoint(endpoint: &str) -> String {
    if endpoint.starts_with('/') {
        endpoint.to_string()
    } else {
        format!("/{}", endpoint)
    }
}

#[tauri::command]
async fn screeps_request(request: ScreepsRequest) -> Result<ScreepsResponse, String> {
    let base_url = normalize_base_url(&request.base_url);
    let endpoint = normalize_endpoint(&request.endpoint);
    let url = format!("{}{}", base_url, endpoint);

    let method_name = request.method.unwrap_or_else(|| "GET".to_string()).to_uppercase();
    let method = Method::from_bytes(method_name.as_bytes())
        .map_err(|error| format!("invalid method {}: {}", method_name, error))?;

    let client = Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|error| format!("failed to initialize http client: {}", error))?;

    let mut req = client
        .request(method.clone(), &url)
        .header("Accept", "application/json");

    if let Some(query) = request.query {
        if !query.is_empty() {
            req = req.query(&query);
        }
    }

    if let Some(token) = request
        .token
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        req = req
            .header("X-Token", token)
            .header("X-Username", token)
            .header("Authorization", format!("Bearer {}", token));
    }

    if method != Method::GET {
        if let Some(body) = request.body {
            req = req.json(&body);
        }
    }

    let response = req
        .send()
        .await
        .map_err(|error| format!("request failed: {}", error))?;

    let status = response.status().as_u16();
    let final_url = response.url().to_string();

    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("failed to read response body: {}", error))?;

    let data = if bytes.is_empty() {
        json!({})
    } else {
        serde_json::from_slice::<Value>(&bytes).unwrap_or_else(|_| {
            let text = String::from_utf8_lossy(&bytes).to_string();
            json!({ "text": text })
        })
    };

    Ok(ScreepsResponse {
        status,
        ok: (200..300).contains(&status),
        data,
        url: final_url,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![screeps_request])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
