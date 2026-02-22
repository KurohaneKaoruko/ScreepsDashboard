use reqwest::{Client, Method};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ScreepsRequest {
    base_url: String,
    endpoint: String,
    method: Option<String>,
    token: Option<String>,
    username: Option<String>,
    query: Option<HashMap<String, Value>>,
    body: Option<Value>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ScreepsResponse {
    status: u16,
    ok: bool,
    data: Value,
    url: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScreepsBatchRequest {
    requests: Vec<ScreepsRequest>,
    max_concurrency: Option<usize>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ScreepsConsoleExecuteRequest {
    base_url: String,
    token: String,
    username: String,
    code: String,
    shard: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ScreepsConsoleExecuteResponse {
    ok: bool,
    feedback: Option<String>,
    error: Option<String>,
    used_variant: Option<String>,
    tried_variants: Vec<String>,
}

static HTTP_CLIENT: OnceLock<Result<Client, String>> = OnceLock::new();
static RESPONSE_CACHE: OnceLock<Mutex<HashMap<String, ResponseCacheEntry>>> = OnceLock::new();

const RESPONSE_CACHE_DEFAULT_TTL_MS: u64 = 1_800;
const RESPONSE_CACHE_TERRAIN_TTL_SECS: u64 = 900;
const RESPONSE_CACHE_MAX_ENTRIES: usize = 2_048;

#[derive(Debug, Clone)]
struct ResponseCacheEntry {
    response: ScreepsResponse,
    expires_at: Instant,
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

fn response_cache() -> &'static Mutex<HashMap<String, ResponseCacheEntry>> {
    RESPONSE_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn cache_ttl_for_endpoint(endpoint: &str) -> Duration {
    if endpoint.eq_ignore_ascii_case("/api/game/room-terrain") {
        Duration::from_secs(RESPONSE_CACHE_TERRAIN_TTL_SECS)
    } else {
        Duration::from_millis(RESPONSE_CACHE_DEFAULT_TTL_MS)
    }
}

fn shared_http_client() -> Result<&'static Client, String> {
    HTTP_CLIENT
        .get_or_init(|| {
            Client::builder()
                .connect_timeout(Duration::from_secs(8))
                .timeout(Duration::from_secs(20))
                .pool_idle_timeout(Duration::from_secs(90))
                .pool_max_idle_per_host(16)
                .user_agent("screeps-dashboard/0.1.0")
                .build()
                .map_err(|error| format!("failed to initialize http client: {}", error))
        })
        .as_ref()
        .map_err(|error| error.clone())
}

fn request_url(request: &ScreepsRequest) -> String {
    let base_url = normalize_base_url(&request.base_url);
    let endpoint = normalize_endpoint(&request.endpoint);
    format!("{}{}", base_url, endpoint)
}

fn error_response(request: &ScreepsRequest, error: String) -> ScreepsResponse {
    ScreepsResponse {
        status: 0,
        ok: false,
        data: json!({ "error": error }),
        url: request_url(request),
    }
}

fn serialize_query_value(value: &Value) -> Option<String> {
    match value {
        Value::Null => None,
        Value::String(text) => Some(text.clone()),
        Value::Number(number) => Some(number.to_string()),
        Value::Bool(boolean) => Some(boolean.to_string()),
        Value::Array(_) | Value::Object(_) => Some(value.to_string()),
    }
}

fn build_query_pairs(query: &HashMap<String, Value>) -> Vec<(String, String)> {
    let mut query_pairs: Vec<(String, String)> = Vec::with_capacity(query.len());
    for (key, value) in query {
        if let Some(serialized) = serialize_query_value(value) {
            query_pairs.push((key.clone(), serialized));
        }
    }
    query_pairs
        .sort_unstable_by(|left, right| left.0.cmp(&right.0).then_with(|| left.1.cmp(&right.1)));
    query_pairs
}

fn build_response_cache_key(
    request: &ScreepsRequest,
    base_url: &str,
    endpoint: &str,
    query_pairs: &[(String, String)],
) -> String {
    let query_part = serde_json::to_string(query_pairs).unwrap_or_else(|_| "[]".to_string());
    let token = request.token.as_deref().map(str::trim).unwrap_or("");
    let username = request.username.as_deref().map(str::trim).unwrap_or("");
    format!("GET|{}|{}|{}|{}|{}", base_url, endpoint, query_part, token, username)
}

fn try_read_cached_response(cache_key: &str) -> Option<ScreepsResponse> {
    let cache = response_cache();
    let mut guard = cache.lock().ok()?;
    let now = Instant::now();
    guard.retain(|_, entry| entry.expires_at > now);
    guard.get(cache_key).map(|entry| entry.response.clone())
}

fn write_cached_response(cache_key: String, response: &ScreepsResponse, ttl: Duration) {
    if !response.ok || ttl.is_zero() {
        return;
    }

    let cache = response_cache();
    let Ok(mut guard) = cache.lock() else {
        return;
    };

    let now = Instant::now();
    guard.retain(|_, entry| entry.expires_at > now);

    if guard.len() >= RESPONSE_CACHE_MAX_ENTRIES {
        if let Some(oldest_key) =
            guard.iter().min_by_key(|(_, entry)| entry.expires_at).map(|(key, _)| key.clone())
        {
            guard.remove(&oldest_key);
        }
    }

    guard.insert(
        cache_key,
        ResponseCacheEntry { response: response.clone(), expires_at: now + ttl },
    );
}

fn normalize_console_shard(shard_input: Option<&str>) -> Option<String> {
    let shard = shard_input?.trim().to_lowercase();
    if !shard.starts_with("shard") {
        return None;
    }
    let number_part = &shard[5..];
    if number_part.is_empty() || !number_part.chars().all(|ch| ch.is_ascii_digit()) {
        return None;
    }
    Some(shard)
}

fn value_as_non_empty_string(value: &Value) -> Option<String> {
    let Value::String(text) = value else {
        return None;
    };
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(trimmed.to_string())
}

fn value_as_f64(value: &Value) -> Option<f64> {
    match value {
        Value::Number(number) => number.as_f64(),
        Value::String(text) => text.trim().parse::<f64>().ok(),
        _ => None,
    }
}

fn is_opaque_token(value: &str) -> bool {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.chars().any(|ch| ch.is_whitespace()) {
        return false;
    }
    if !trimmed.chars().all(|ch| ch.is_ascii_hexdigit() || ch == '-') {
        return false;
    }
    let hex_count = trimmed.chars().filter(|ch| ch.is_ascii_hexdigit()).count();
    hex_count >= 16
}

fn sanitize_console_feedback(value: Option<String>) -> Option<String> {
    let text = value?;
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return None;
    }
    if trimmed == "1" || trimmed.eq_ignore_ascii_case("ok") {
        return None;
    }
    let lowered = trimmed.to_ascii_lowercase();
    if lowered.starts_with("ok ") && is_opaque_token(trimmed[3..].trim()) {
        return None;
    }
    if is_opaque_token(trimmed) {
        return None;
    }
    Some(trimmed.to_string())
}

fn extract_error_message(payload: &Value) -> Option<String> {
    let mut stack = vec![payload];
    while let Some(current) = stack.pop() {
        match current {
            Value::Array(items) => {
                for item in items {
                    stack.push(item);
                }
            }
            Value::Object(map) => {
                if let Some(error_text) = map
                    .get("error")
                    .and_then(value_as_non_empty_string)
                    .or_else(|| map.get("message").and_then(value_as_non_empty_string))
                    .or_else(|| map.get("text").and_then(value_as_non_empty_string))
                {
                    return Some(error_text);
                }

                for value in map.values() {
                    stack.push(value);
                }
            }
            _ => {}
        }
    }
    None
}

fn extract_payload_error(payload: &Value) -> Option<String> {
    let mut stack = vec![payload];
    while let Some(current) = stack.pop() {
        match current {
            Value::Array(items) => {
                for item in items {
                    stack.push(item);
                }
            }
            Value::Object(map) => {
                if let Some(explicit_error) = map
                    .get("error")
                    .and_then(value_as_non_empty_string)
                    .or_else(|| map.get("err").and_then(value_as_non_empty_string))
                    .or_else(|| map.get("errorMessage").and_then(value_as_non_empty_string))
                {
                    return Some(explicit_error);
                }

                if map.get("ok").and_then(value_as_f64) == Some(0.0) {
                    return map
                        .get("message")
                        .and_then(value_as_non_empty_string)
                        .or_else(|| map.get("text").and_then(value_as_non_empty_string))
                        .or_else(|| Some("Unknown error".to_string()));
                }

                for value in map.values() {
                    stack.push(value);
                }
            }
            _ => {}
        }
    }
    None
}

fn extract_console_feedback_from_value(payload: &Value, depth: usize) -> Option<String> {
    if depth > 6 {
        return None;
    }

    match payload {
        Value::String(_) => sanitize_console_feedback(value_as_non_empty_string(payload)),
        Value::Array(items) => {
            let joined = items
                .iter()
                .filter_map(value_as_non_empty_string)
                .collect::<Vec<String>>()
                .join("\n");
            let joined_feedback = sanitize_console_feedback(Some(joined));
            if joined_feedback.is_some() {
                return joined_feedback;
            }
            for item in items {
                if let Some(nested) = extract_console_feedback_from_value(item, depth + 1) {
                    return Some(nested);
                }
            }
            None
        }
        Value::Object(map) => {
            let direct = sanitize_console_feedback(
                map.get("result")
                    .and_then(value_as_non_empty_string)
                    .or_else(|| map.get("output").and_then(value_as_non_empty_string))
                    .or_else(|| map.get("stdout").and_then(value_as_non_empty_string))
                    .or_else(|| map.get("message").and_then(value_as_non_empty_string))
                    .or_else(|| map.get("text").and_then(value_as_non_empty_string))
                    .or_else(|| map.get("status").and_then(value_as_non_empty_string)),
            );
            if direct.is_some() {
                return direct;
            }

            for key in [
                "result", "results", "output", "stdout", "message", "text", "status", "messages",
                "error", "errors", "log", "logs", "lines", "data", "payload",
            ] {
                if let Some(value) = map.get(key) {
                    if let Some(nested) = extract_console_feedback_from_value(value, depth + 1) {
                        return Some(nested);
                    }
                }
            }
            None
        }
        _ => None,
    }
}

fn extract_console_feedback(payload: &Value) -> Option<String> {
    extract_console_feedback_from_value(payload, 0)
}

type ConsoleRequestCandidate = (String, Option<HashMap<String, Value>>, Value);

fn build_console_request_candidates(
    code: &str,
    shard: Option<&str>,
) -> Vec<ConsoleRequestCandidate> {
    let mut candidates: Vec<ConsoleRequestCandidate> = Vec::new();
    let shard_values: Vec<String> = if let Some(value) = shard {
        vec![value.to_string()]
    } else {
        vec!["shard0".to_string(), "shard1".to_string(), "shard2".to_string(), "shard3".to_string()]
    };

    for key in ["expression", "command"] {
        let mut base_body = serde_json::Map::new();
        base_body.insert(key.to_string(), Value::String(code.to_string()));
        let base_value = Value::Object(base_body.clone());
        candidates.push((key.to_string(), None, base_value.clone()));

        for shard_value in &shard_values {
            let variant_prefix = if shard.is_some() {
                format!("{}+{}", key, shard_value)
            } else {
                format!("{}+auto-{}", key, shard_value)
            };
            let mut body_with_shard = base_body.clone();
            body_with_shard.insert("shard".to_string(), Value::String(shard_value.to_string()));
            candidates.push((
                format!("{}:shard", variant_prefix),
                None,
                Value::Object(body_with_shard),
            ));

            let mut body_with_shard_name = base_body.clone();
            body_with_shard_name
                .insert("shardName".to_string(), Value::String(shard_value.to_string()));
            candidates.push((
                format!("{}:shardName", variant_prefix),
                None,
                Value::Object(body_with_shard_name),
            ));

            let mut query = HashMap::new();
            query.insert("shard".to_string(), Value::String(shard_value.to_string()));
            candidates.push((
                format!("{}:?shard", variant_prefix),
                Some(query),
                base_value.clone(),
            ));
        }
    }

    candidates
}

async fn perform_screeps_request(
    client: &Client,
    request: ScreepsRequest,
) -> Result<ScreepsResponse, String> {
    let base_url = normalize_base_url(&request.base_url);
    let endpoint = normalize_endpoint(&request.endpoint);
    let url = format!("{}{}", base_url, endpoint);

    let method_name = request.method.as_deref().unwrap_or("GET").to_uppercase();
    let method = Method::from_bytes(method_name.as_bytes())
        .map_err(|error| format!("invalid method {}: {}", method_name, error))?;
    let is_get_method = method == Method::GET;

    let query_pairs = request.query.as_ref().map(build_query_pairs).unwrap_or_default();
    let cache_key = if is_get_method {
        Some(build_response_cache_key(&request, &base_url, &endpoint, &query_pairs))
    } else {
        None
    };

    if let Some(cache_key_value) = cache_key.as_deref() {
        if let Some(cached_response) = try_read_cached_response(cache_key_value) {
            return Ok(cached_response);
        }
    }

    let mut req = client.request(method, &url).header("Accept", "application/json");

    if !query_pairs.is_empty() {
        req = req.query(&query_pairs);
    }

    if let Some(token) = request.token.as_deref().map(str::trim).filter(|value| !value.is_empty()) {
        req = req.header("X-Token", token);
    }

    if let Some(username) =
        request.username.as_deref().map(str::trim).filter(|value| !value.is_empty())
    {
        req = req.header("X-Username", username);
    }

    if !is_get_method {
        if let Some(body) = request.body.as_ref() {
            req = req.json(body);
        }
    }

    let response = req.send().await.map_err(|error| format!("request failed: {}", error))?;

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

    let response =
        ScreepsResponse { status, ok: (200..300).contains(&status), data, url: final_url };

    if let Some(cache_key_value) = cache_key {
        write_cached_response(cache_key_value, &response, cache_ttl_for_endpoint(&endpoint));
    }

    Ok(response)
}

#[tauri::command]
async fn screeps_request(request: ScreepsRequest) -> Result<ScreepsResponse, String> {
    let client = shared_http_client()?;
    perform_screeps_request(client, request).await
}

#[tauri::command]
async fn screeps_request_many(batch: ScreepsBatchRequest) -> Result<Vec<ScreepsResponse>, String> {
    let client = shared_http_client()?;
    if batch.requests.is_empty() {
        return Ok(Vec::new());
    }

    let max_concurrency = batch.max_concurrency.unwrap_or(8).clamp(1, 32);
    let total = batch.requests.len();
    let mut output: Vec<Option<ScreepsResponse>> = (0..total).map(|_| None).collect();
    let mut cursor = 0;

    while cursor < total {
        let end = usize::min(cursor + max_concurrency, total);
        let mut handles = Vec::with_capacity(end - cursor);

        for index in cursor..end {
            let request = batch.requests[index].clone();
            let request_for_error = request.clone();
            let task_client = client.clone();
            let handle = tauri::async_runtime::spawn(async move {
                let response = match perform_screeps_request(&task_client, request).await {
                    Ok(response) => response,
                    Err(error) => error_response(&request_for_error, error),
                };
                (index, response)
            });
            handles.push(handle);
        }

        for handle in handles {
            let (index, response) =
                handle.await.map_err(|error| format!("batch request task failed: {}", error))?;
            output[index] = Some(response);
        }

        cursor = end;
    }

    output
        .into_iter()
        .enumerate()
        .map(|(index, response)| {
            response.ok_or_else(|| format!("batch response missing at index {}", index))
        })
        .collect()
}

#[tauri::command]
async fn screeps_console_execute(
    request: ScreepsConsoleExecuteRequest,
) -> Result<ScreepsConsoleExecuteResponse, String> {
    let trimmed_code = request.code.trim();
    if trimmed_code.is_empty() {
        return Ok(ScreepsConsoleExecuteResponse {
            ok: false,
            feedback: None,
            error: Some("Console command cannot be empty.".to_string()),
            used_variant: None,
            tried_variants: Vec::new(),
        });
    }
    let client = shared_http_client()?;

    let shard = normalize_console_shard(request.shard.as_deref());
    let candidates = build_console_request_candidates(trimmed_code, shard.as_deref());
    let mut failures: Vec<String> = Vec::new();
    let mut tried_variants: Vec<String> = Vec::with_capacity(candidates.len());

    for (variant, query, body) in candidates {
        tried_variants.push(variant.clone());
        let raw_request = ScreepsRequest {
            base_url: request.base_url.clone(),
            endpoint: "/api/user/console".to_string(),
            method: Some("POST".to_string()),
            token: Some(request.token.clone()),
            username: Some(request.username.clone()),
            query,
            body: Some(body),
        };

        let response = match perform_screeps_request(client, raw_request).await {
            Ok(response) => response,
            Err(error) => {
                failures.push(error);
                continue;
            }
        };

        if !response.ok {
            let reason = extract_error_message(&response.data)
                .unwrap_or_else(|| format!("HTTP {}", response.status));
            failures.push(reason);
            continue;
        }

        if let Some(payload_error) = extract_payload_error(&response.data) {
            failures.push(payload_error);
            continue;
        }

        return Ok(ScreepsConsoleExecuteResponse {
            ok: true,
            feedback: extract_console_feedback(&response.data),
            error: None,
            used_variant: Some(variant),
            tried_variants,
        });
    }

    let reason = failures.into_iter().next().unwrap_or_else(|| "Unknown error".to_string());
    Ok(ScreepsConsoleExecuteResponse {
        ok: false,
        feedback: None,
        error: Some(format!("Failed to execute console command: {}", reason)),
        used_variant: None,
        tried_variants,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            screeps_request,
            screeps_request_many,
            screeps_console_execute
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
