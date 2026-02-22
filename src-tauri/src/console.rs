use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

use crate::http::{perform_screeps_request, shared_http_client, ScreepsRequest};

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ScreepsConsoleExecuteRequest {
    base_url: String,
    token: String,
    username: String,
    code: String,
    shard: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ScreepsConsoleExecuteResponse {
    ok: bool,
    feedback: Option<String>,
    error: Option<String>,
    used_variant: Option<String>,
    tried_variants: Vec<String>,
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

#[tauri::command]
pub async fn screeps_console_execute(
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
