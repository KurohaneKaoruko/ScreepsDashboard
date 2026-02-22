use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};

use crate::{perform_screeps_request, shared_http_client, ScreepsRequest};

const DEFAULT_PER_CONVERSATION_LIMIT: usize = 200;
const DEFAULT_MAX_CONVERSATIONS: usize = 200;
const MAX_PER_CONVERSATION_LIMIT: usize = 1000;
const MAX_CONVERSATIONS_LIMIT: usize = 500;

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ScreepsMessagesFetchRequest {
    pub base_url: String,
    pub token: String,
    pub username: String,
    pub max_conversations: Option<usize>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ScreepsMessagesThreadRequest {
    pub base_url: String,
    pub token: String,
    pub username: String,
    pub peer_id: String,
    pub peer_username: Option<String>,
    pub peer_avatar_url: Option<String>,
    pub peer_has_badge: Option<bool>,
    pub limit: Option<usize>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ScreepsMessageParticipantDto {
    pub id: String,
    pub username: String,
    pub is_self: bool,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ScreepsConversationMessageDto {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subject: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    pub sender: ScreepsMessageParticipantDto,
    pub recipient: ScreepsMessageParticipantDto,
    pub direction: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unread: Option<bool>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ScreepsConversationDto {
    pub peer_id: String,
    pub peer_username: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub peer_avatar_url: Option<String>,
    pub peer_has_badge: bool,
    pub messages: Vec<ScreepsConversationMessageDto>,
}

#[derive(Debug, Deserialize)]
struct AuthMeResponse {
    ok: i64,
    #[serde(rename = "_id")]
    self_id: String,
    username: String,
}

#[derive(Debug, Deserialize)]
struct MessagesIndexUser {
    username: String,
    #[serde(rename = "avatarUrl")]
    avatar_url: Option<String>,
    #[serde(rename = "avatarURL")]
    avatar_url_legacy: Option<String>,
    avatar: Option<String>,
    badge: Option<Value>,
}

#[derive(Debug, Deserialize, Clone)]
struct RawMessage {
    #[serde(rename = "_id")]
    id: String,
    date: String,
    #[serde(rename = "type")]
    kind: String,
    text: String,
    unread: bool,
}

#[derive(Debug, Deserialize, Clone)]
struct MessagesIndexItem {
    #[serde(rename = "_id")]
    peer_id: String,
    message: RawMessage,
}

#[derive(Debug, Deserialize)]
struct MessagesIndexResponse {
    ok: i64,
    #[serde(default)]
    messages: Vec<MessagesIndexItem>,
    #[serde(default)]
    users: HashMap<String, MessagesIndexUser>,
}

#[derive(Debug, Deserialize)]
struct MessagesListResponse {
    ok: i64,
    #[serde(default)]
    messages: Vec<RawMessage>,
}

#[derive(Debug, Clone)]
struct ConversationHead {
    peer_id: String,
    peer_username: String,
    peer_avatar_url: Option<String>,
    peer_has_badge: bool,
    latest_at: String,
    latest_message: RawMessage,
}

fn trim_to_option(value: String) -> Option<String> {
    let text = value.trim();
    if text.is_empty() {
        None
    } else {
        Some(text.to_string())
    }
}

fn normalize_base_url_local(base_url: &str) -> String {
    let trimmed = base_url.trim().trim_end_matches('/');
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        trimmed.to_string()
    } else {
        format!("https://{}", trimmed)
    }
}

fn normalize_asset_url(base_url: &str, candidate: Option<&str>) -> Option<String> {
    let raw = candidate?.trim();
    if raw.is_empty() {
        return None;
    }
    if raw.starts_with("http://") || raw.starts_with("https://") {
        return Some(raw.to_string());
    }
    let base = normalize_base_url_local(base_url);
    if raw.starts_with('/') {
        return Some(format!("{}{}", base, raw));
    }
    Some(format!("{}/{}", base, raw.trim_start_matches('/')))
}

fn pick_user_avatar_url(base_url: &str, user: &MessagesIndexUser) -> Option<String> {
    normalize_asset_url(base_url, user.avatar_url.as_deref())
        .or_else(|| normalize_asset_url(base_url, user.avatar_url_legacy.as_deref()))
        .or_else(|| normalize_asset_url(base_url, user.avatar.as_deref()))
}

fn payload_error(payload: &Value) -> Option<String> {
    payload
        .get("error")
        .and_then(|value| value.as_str())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn compare_message_time_asc(
    left: &ScreepsConversationMessageDto,
    right: &ScreepsConversationMessageDto,
) -> Ordering {
    let left_time = left.created_at.as_deref().unwrap_or("");
    let right_time = right.created_at.as_deref().unwrap_or("");
    if left_time != right_time {
        return left_time.cmp(right_time);
    }
    left.id.cmp(&right.id)
}

fn to_conversation_message(
    raw: RawMessage,
    self_id: &str,
    self_username: &str,
    peer_id: &str,
    peer_username: &str,
) -> Option<ScreepsConversationMessageDto> {
    let message_id = raw.id.trim().to_string();
    if message_id.is_empty() {
        return None;
    }
    let outbound = raw.kind.trim().eq_ignore_ascii_case("out");
    let direction = if outbound { "outbound" } else { "inbound" }.to_string();
    let sender = if outbound {
        ScreepsMessageParticipantDto {
            id: self_id.to_string(),
            username: self_username.to_string(),
            is_self: true,
        }
    } else {
        ScreepsMessageParticipantDto {
            id: peer_id.to_string(),
            username: peer_username.to_string(),
            is_self: false,
        }
    };
    let recipient = if outbound {
        ScreepsMessageParticipantDto {
            id: peer_id.to_string(),
            username: peer_username.to_string(),
            is_self: false,
        }
    } else {
        ScreepsMessageParticipantDto {
            id: self_id.to_string(),
            username: self_username.to_string(),
            is_self: true,
        }
    };
    Some(ScreepsConversationMessageDto {
        id: message_id,
        created_at: trim_to_option(raw.date),
        subject: None,
        text: trim_to_option(raw.text),
        sender,
        recipient,
        direction,
        unread: Some(raw.unread),
    })
}

async fn fetch_auth_profile(request: &ScreepsMessagesFetchRequest) -> Result<AuthMeResponse, String> {
    let client = shared_http_client()?;
    let response = perform_screeps_request(
        client,
        ScreepsRequest {
            base_url: request.base_url.clone(),
            endpoint: "/api/auth/me".to_string(),
            method: Some("GET".to_string()),
            token: Some(request.token.clone()),
            username: None,
            query: None,
            body: None,
        },
    )
    .await?;

    if !response.ok {
        return Err(format!("auth profile request failed: HTTP {}", response.status));
    }
    if let Some(error) = payload_error(&response.data) {
        return Err(error);
    }

    let payload = serde_json::from_value::<AuthMeResponse>(response.data)
        .map_err(|error| format!("failed to parse /api/auth/me payload: {}", error))?;
    if payload.ok != 1 {
        return Err("auth profile returned ok!=1".to_string());
    }
    Ok(payload)
}

async fn fetch_messages_index(
    request: &ScreepsMessagesFetchRequest,
    limit: usize,
) -> Result<MessagesIndexResponse, String> {
    let client = shared_http_client()?;
    let mut query = HashMap::<String, Value>::new();
    query.insert("limit".to_string(), json!(limit));

    let response = perform_screeps_request(
        client,
        ScreepsRequest {
            base_url: request.base_url.clone(),
            endpoint: "/api/user/messages/index".to_string(),
            method: Some("GET".to_string()),
            token: Some(request.token.clone()),
            username: Some(request.username.clone()),
            query: Some(query),
            body: None,
        },
    )
    .await?;

    if !response.ok {
        return Err(format!("messages index request failed: HTTP {}", response.status));
    }
    if let Some(error) = payload_error(&response.data) {
        return Err(error);
    }

    let payload = serde_json::from_value::<MessagesIndexResponse>(response.data)
        .map_err(|error| format!("failed to parse /api/user/messages/index payload: {}", error))?;
    if payload.ok != 1 {
        return Err("messages index returned ok!=1".to_string());
    }
    Ok(payload)
}

async fn fetch_messages_list(
    request: &ScreepsMessagesFetchRequest,
    peer_id: &str,
    count: usize,
) -> Result<MessagesListResponse, String> {
    let client = shared_http_client()?;
    let mut query = HashMap::<String, Value>::new();
    query.insert("respondent".to_string(), json!(peer_id));
    query.insert("count".to_string(), json!(count));
    query.insert("offset".to_string(), json!(0));

    let response = perform_screeps_request(
        client,
        ScreepsRequest {
            base_url: request.base_url.clone(),
            endpoint: "/api/user/messages/list".to_string(),
            method: Some("GET".to_string()),
            token: Some(request.token.clone()),
            username: Some(request.username.clone()),
            query: Some(query),
            body: None,
        },
    )
    .await?;

    if !response.ok {
        return Err(format!(
            "messages list request failed for {}: HTTP {}",
            peer_id, response.status
        ));
    }
    if let Some(error) = payload_error(&response.data) {
        return Err(format!("messages list returned error for {}: {}", peer_id, error));
    }

    let payload = serde_json::from_value::<MessagesListResponse>(response.data)
        .map_err(|error| format!("failed to parse /api/user/messages/list payload: {}", error))?;
    if payload.ok != 1 {
        return Err(format!("messages list returned ok!=1 for {}", peer_id));
    }
    Ok(payload)
}

fn conversation_heads_from_index(
    base_url: &str,
    index_payload: MessagesIndexResponse,
    max_conversations: usize,
) -> Vec<ConversationHead> {
    let users = index_payload.users;
    let mut head_map = HashMap::<String, ConversationHead>::new();

    for item in index_payload.messages {
        let peer_id = item.peer_id.trim().to_string();
        if peer_id.is_empty() {
            continue;
        }
        let user_entry = users.get(&peer_id);
        let peer_username = user_entry
            .map(|user| user.username.trim().to_string())
            .filter(|username| !username.is_empty())
            .unwrap_or_else(|| peer_id.clone());
        let peer_avatar_url = user_entry.and_then(|user| pick_user_avatar_url(base_url, user));
        let peer_has_badge = user_entry.and_then(|user| user.badge.as_ref()).is_some();
        let latest_at = item.message.date.trim().to_string();
        let head = ConversationHead {
            peer_id: peer_id.clone(),
            peer_username,
            peer_avatar_url,
            peer_has_badge,
            latest_at,
            latest_message: item.message,
        };
        match head_map.get(&peer_id) {
            Some(current) if current.latest_at >= head.latest_at => {}
            _ => {
                head_map.insert(peer_id, head);
            }
        }
    }

    let mut heads = head_map.into_values().collect::<Vec<ConversationHead>>();
    heads.sort_by(|left, right| {
        if left.latest_at != right.latest_at {
            return right.latest_at.cmp(&left.latest_at);
        }
        left.peer_id.cmp(&right.peer_id)
    });
    if heads.len() > max_conversations {
        heads.truncate(max_conversations);
    }
    heads
}

#[tauri::command]
pub async fn screeps_messages_fetch(
    request: ScreepsMessagesFetchRequest,
) -> Result<HashMap<String, ScreepsConversationDto>, String> {
    if request.token.trim().is_empty() {
        return Err("Token cannot be empty".to_string());
    }
    if request.username.trim().is_empty() {
        return Err("Username cannot be empty".to_string());
    }

    let max_conversations = request
        .max_conversations
        .unwrap_or(DEFAULT_MAX_CONVERSATIONS)
        .clamp(1, MAX_CONVERSATIONS_LIMIT);

    let auth_profile = fetch_auth_profile(&request).await?;
    let self_id = auth_profile.self_id;
    let self_username = auth_profile.username;

    let index_payload = fetch_messages_index(&request, max_conversations).await?;
    if index_payload.messages.is_empty() {
        return Ok(HashMap::new());
    }

    let heads = conversation_heads_from_index(&request.base_url, index_payload, max_conversations);

    let mut output = HashMap::<String, ScreepsConversationDto>::new();
    for head in heads {
        let mut messages = Vec::<ScreepsConversationMessageDto>::new();
        if let Some(message) = to_conversation_message(
            head.latest_message,
            &self_id,
            &self_username,
            &head.peer_id,
            &head.peer_username,
        ) {
            messages.push(message);
        }

        output.insert(
            head.peer_id.clone(),
            ScreepsConversationDto {
                peer_id: head.peer_id,
                peer_username: head.peer_username,
                peer_avatar_url: head.peer_avatar_url,
                peer_has_badge: head.peer_has_badge,
                messages,
            },
        );
    }

    Ok(output)
}

#[tauri::command]
pub async fn screeps_messages_fetch_thread(
    request: ScreepsMessagesThreadRequest,
) -> Result<ScreepsConversationDto, String> {
    if request.token.trim().is_empty() {
        return Err("Token cannot be empty".to_string());
    }
    if request.username.trim().is_empty() {
        return Err("Username cannot be empty".to_string());
    }
    let peer_id = request.peer_id.trim().to_string();
    if peer_id.is_empty() {
        return Err("Peer id cannot be empty".to_string());
    }
    let peer_username = request
        .peer_username
        .as_deref()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| peer_id.clone());
    let peer_avatar_url = normalize_asset_url(&request.base_url, request.peer_avatar_url.as_deref());
    let peer_has_badge = request.peer_has_badge.unwrap_or(false);
    let per_limit = request
        .limit
        .unwrap_or(DEFAULT_PER_CONVERSATION_LIMIT)
        .clamp(1, MAX_PER_CONVERSATION_LIMIT);

    let fetch_request = ScreepsMessagesFetchRequest {
        base_url: request.base_url.clone(),
        token: request.token,
        username: request.username,
        max_conversations: Some(1),
    };

    let auth_profile = fetch_auth_profile(&fetch_request).await?;
    let self_id = auth_profile.self_id;
    let self_username = auth_profile.username;

    let list_payload = fetch_messages_list(&fetch_request, &peer_id, per_limit).await?;
    let mut messages = Vec::<ScreepsConversationMessageDto>::new();
    let mut seen = HashSet::<String>::new();
    for raw in list_payload.messages {
        if let Some(message) =
            to_conversation_message(raw, &self_id, &self_username, &peer_id, &peer_username)
        {
            if seen.insert(message.id.clone()) {
                messages.push(message);
            }
        }
    }

    messages.sort_by(compare_message_time_asc);
    if messages.len() > per_limit {
        let drain_count = messages.len() - per_limit;
        messages.drain(0..drain_count);
    }

    Ok(ScreepsConversationDto {
        peer_id,
        peer_username,
        peer_avatar_url,
        peer_has_badge,
        messages,
    })
}
