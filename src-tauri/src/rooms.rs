use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::http::{perform_screeps_request, shared_http_client, ScreepsRequest};

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ScreepsRoomEndpointConfig {
    pub endpoint: String,
    pub method: Option<String>,
    pub query: Option<HashMap<String, Value>>,
    pub body: Option<Value>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ScreepsRoomDetailRequest {
    pub base_url: String,
    pub token: String,
    pub username: String,
    pub room_name: String,
    pub shard: Option<String>,
    pub rooms_endpoint: Option<ScreepsRoomEndpointConfig>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RoomSourceSummary {
    pub x: i64,
    pub y: i64,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RoomMineralSummary {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub r#type: Option<String>,
    pub x: i64,
    pub y: i64,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RoomStructureSummary {
    pub r#type: String,
    pub x: i64,
    pub y: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hits: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hits_max: Option<f64>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RoomCreepSummary {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    pub x: i64,
    pub y: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ttl: Option<f64>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RoomObjectActionTarget {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RoomObjectSpawningSummary {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub need_time: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub spawn_time: Option<f64>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RoomObjectBodyPartSummary {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub r#type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hits: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub boost: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RoomObjectSaySummary {
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_public: Option<bool>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RoomObjectReservationSummary {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_time: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ticks_to_end: Option<f64>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RoomObjectSummary {
    pub id: String,
    pub r#type: String,
    pub x: i64,
    pub y: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub owner: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hits: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hits_max: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ttl: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub store: Option<HashMap<String, f64>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub energy: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub energy_capacity: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub level: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progress: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progress_total: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mineral_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body: Option<Vec<RoomObjectBodyPartSummary>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub say: Option<RoomObjectSaySummary>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reservation: Option<RoomObjectReservationSummary>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub spawning: Option<RoomObjectSpawningSummary>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cooldown_time: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action_log: Option<HashMap<String, RoomObjectActionTarget>>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RoomDetailSnapshot {
    pub fetched_at: String,
    pub room_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shard: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub owner: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub controller_level: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub energy_available: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub energy_capacity: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub terrain_encoded: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub game_time: Option<f64>,
    pub sources: Vec<RoomSourceSummary>,
    pub minerals: Vec<RoomMineralSummary>,
    pub structures: Vec<RoomStructureSummary>,
    pub creeps: Vec<RoomCreepSummary>,
    pub objects: Vec<RoomObjectSummary>,
}

#[derive(Debug, Default)]
struct ParsedEntities {
    shard: Option<String>,
    owner: Option<String>,
    controller_level: Option<f64>,
    energy_available: Option<f64>,
    energy_capacity: Option<f64>,
    sources: Vec<RoomSourceSummary>,
    minerals: Vec<RoomMineralSummary>,
    structures: Vec<RoomStructureSummary>,
    creeps: Vec<RoomCreepSummary>,
    objects: Vec<RoomObjectSummary>,
}

fn as_object(value: &Value) -> Option<&Map<String, Value>> {
    value.as_object()
}

fn value_as_non_empty_string(value: &Value) -> Option<String> {
    let text = value.as_str()?;
    let trimmed = text.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn value_as_f64(value: &Value) -> Option<f64> {
    match value {
        Value::Number(number) => number.as_f64(),
        Value::String(text) => text.trim().parse::<f64>().ok(),
        _ => None,
    }
}

fn value_as_i64(value: &Value) -> Option<i64> {
    let raw = value_as_f64(value)?;
    if !raw.is_finite() {
        return None;
    }
    let rounded = raw.round();
    if (raw - rounded).abs() > 1e-6 {
        return None;
    }
    if rounded < i64::MIN as f64 || rounded > i64::MAX as f64 {
        return None;
    }
    Some(rounded as i64)
}

fn value_as_bool(value: &Value) -> Option<bool> {
    match value {
        Value::Bool(raw) => Some(*raw),
        Value::Number(number) => match number.as_i64() {
            Some(1) => Some(true),
            Some(0) => Some(false),
            _ => None,
        },
        Value::String(text) => {
            let normalized = text.trim().to_ascii_lowercase();
            match normalized.as_str() {
                "true" | "1" => Some(true),
                "false" | "0" => Some(false),
                _ => None,
            }
        }
        _ => None,
    }
}

fn map_first_string(map: &Map<String, Value>, keys: &[&str]) -> Option<String> {
    for key in keys {
        if let Some(value) = map.get(*key).and_then(value_as_non_empty_string) {
            return Some(value);
        }
    }
    None
}

fn map_first_f64(map: &Map<String, Value>, keys: &[&str]) -> Option<f64> {
    for key in keys {
        if let Some(value) = map.get(*key).and_then(value_as_f64) {
            return Some(value);
        }
    }
    None
}

fn normalize_shard(shard_input: Option<&str>) -> Option<String> {
    let shard = shard_input?.trim().to_ascii_lowercase();
    if !shard.starts_with("shard") {
        return None;
    }
    let number_part = &shard[5..];
    if number_part.is_empty() || !number_part.chars().all(|ch| ch.is_ascii_digit()) {
        return None;
    }
    Some(shard)
}

fn extract_room_candidate(value: &str) -> Option<String> {
    let upper = value.to_ascii_uppercase();
    let chars = upper.chars().collect::<Vec<char>>();
    for start in 0..chars.len() {
        if chars[start] != 'W' && chars[start] != 'E' {
            continue;
        }
        let mut index = start + 1;
        let mut has_horizontal_digits = false;
        while index < chars.len() && chars[index].is_ascii_digit() {
            has_horizontal_digits = true;
            index += 1;
        }
        if !has_horizontal_digits || index >= chars.len() {
            continue;
        }
        if chars[index] != 'N' && chars[index] != 'S' {
            continue;
        }
        index += 1;
        let mut has_vertical_digits = false;
        while index < chars.len() && chars[index].is_ascii_digit() {
            has_vertical_digits = true;
            index += 1;
        }
        if !has_vertical_digits {
            continue;
        }
        return Some(chars[start..index].iter().collect::<String>());
    }
    None
}

fn normalize_room_name(room_name: &str) -> Result<String, String> {
    let normalized = room_name.trim().to_ascii_uppercase();
    if extract_room_candidate(&normalized).as_deref() != Some(normalized.as_str()) {
        return Err(format!("Invalid room name: {}", room_name));
    }
    Ok(normalized)
}

fn extract_record_room_name(record: &Map<String, Value>) -> Option<String> {
    for key in ["room", "roomName", "room_id", "roomId", "_id", "name"] {
        if let Some(value) = record.get(key).and_then(value_as_non_empty_string) {
            if let Some(room_name) = extract_room_candidate(&value) {
                return Some(room_name);
            }
        }
    }
    None
}

fn flatten_records(payload: &Value, depth: usize, sink: &mut Vec<Map<String, Value>>) {
    if depth > 6 {
        return;
    }
    match payload {
        Value::Array(items) => {
            for item in items {
                flatten_records(item, depth + 1, sink);
            }
        }
        Value::Object(record) => {
            sink.push(record.clone());
            for nested in record.values() {
                flatten_records(nested, depth + 1, sink);
            }
        }
        _ => {}
    }
}

fn collect_numeric_map(value: Option<&Value>) -> Option<HashMap<String, f64>> {
    let record = value.and_then(as_object)?;
    let mut output = HashMap::new();
    for (key, raw) in record {
        if let Some(number) = value_as_f64(raw) {
            output.insert(key.clone(), number);
        }
    }
    if output.is_empty() {
        None
    } else {
        Some(output)
    }
}

fn parse_body(value: Option<&Value>) -> Option<Vec<RoomObjectBodyPartSummary>> {
    let items = value?.as_array()?;
    let mut body = Vec::new();
    for item in items {
        if let Some(part_type) = value_as_non_empty_string(item) {
            body.push(RoomObjectBodyPartSummary {
                r#type: Some(part_type),
                hits: None,
                boost: None,
            });
            continue;
        }
        let Some(record) = as_object(item) else {
            continue;
        };
        let part_type = map_first_string(record, &["type", "part"]);
        let hits = record.get("hits").and_then(value_as_f64);
        let boost = map_first_string(record, &["boost"]);
        if part_type.is_none() && hits.is_none() && boost.is_none() {
            continue;
        }
        body.push(RoomObjectBodyPartSummary { r#type: part_type, hits, boost });
    }
    if body.is_empty() {
        None
    } else {
        Some(body)
    }
}

fn parse_say(value: Option<&Value>) -> Option<RoomObjectSaySummary> {
    let raw = value?;
    if let Some(text) = value_as_non_empty_string(raw) {
        return Some(RoomObjectSaySummary { text, is_public: None });
    }
    let record = as_object(raw)?;
    let text = map_first_string(record, &["text", "message", "say"])?;
    let is_public = record.get("isPublic").and_then(value_as_bool);
    Some(RoomObjectSaySummary { text, is_public })
}

fn parse_reservation(value: Option<&Value>) -> Option<RoomObjectReservationSummary> {
    let record = value.and_then(as_object)?;
    let username = map_first_string(record, &["username", "name"]);
    let user = map_first_string(record, &["user", "userId", "id", "_id"]);
    let end_time = map_first_f64(record, &["endTime", "time"]);
    let ticks_to_end = map_first_f64(record, &["ticksToEnd", "ticksRemaining", "ttl"]);
    if username.is_none() && user.is_none() && end_time.is_none() && ticks_to_end.is_none() {
        return None;
    }
    Some(RoomObjectReservationSummary { username, user, end_time, ticks_to_end })
}

fn parse_spawning(value: Option<&Value>) -> Option<RoomObjectSpawningSummary> {
    let record = value.and_then(as_object)?;
    let need_time = map_first_f64(record, &["needTime", "remainingTime"]);
    let spawn_time = map_first_f64(record, &["spawnTime", "endTime", "time"]);
    if need_time.is_none() && spawn_time.is_none() {
        return None;
    }
    Some(RoomObjectSpawningSummary { need_time, spawn_time })
}

fn parse_action_log(value: Option<&Value>) -> Option<HashMap<String, RoomObjectActionTarget>> {
    let record = value.and_then(as_object)?;
    let mut out = HashMap::new();
    for key in [
        "attacked",
        "attack",
        "build",
        "harvest",
        "heal",
        "healed",
        "power",
        "rangedAttack",
        "rangedHeal",
        "repair",
        "reserveController",
        "runReaction",
        "reverseReaction",
        "transferEnergy",
        "upgradeController",
    ] {
        let Some(target) = record.get(key).and_then(as_object) else {
            continue;
        };
        let Some(x) = target.get("x").and_then(value_as_f64) else {
            continue;
        };
        let Some(y) = target.get("y").and_then(value_as_f64) else {
            continue;
        };
        out.insert(key.to_string(), RoomObjectActionTarget { x, y });
    }
    if out.is_empty() {
        None
    } else {
        Some(out)
    }
}

fn is_structure_type(kind: &str) -> bool {
    matches!(
        kind,
        "constructedWall"
            | "container"
            | "controller"
            | "extension"
            | "extractor"
            | "factory"
            | "invaderCore"
            | "keeperLair"
            | "lab"
            | "link"
            | "nuker"
            | "observer"
            | "portal"
            | "powerBank"
            | "powerSpawn"
            | "rampart"
            | "road"
            | "spawn"
            | "storage"
            | "terminal"
            | "tower"
            | "wall"
    )
}

fn resolve_object_type(record: &Map<String, Value>) -> Option<String> {
    if let Some(kind) = map_first_string(record, &["type", "objectType", "structureType"]) {
        return Some(kind);
    }
    if map_first_f64(record, &["progress"]).is_some()
        && map_first_f64(record, &["progressTotal"]).is_some()
    {
        return Some("constructionSite".to_string());
    }
    if map_first_string(record, &["depositType"]).is_some() {
        return Some("deposit".to_string());
    }
    if map_first_string(record, &["mineralType"]).is_some() {
        return Some("mineral".to_string());
    }
    if map_first_string(record, &["name", "creepName"]).is_some()
        && map_first_f64(record, &["ticksToLive", "ttl"]).is_some()
    {
        return Some("creep".to_string());
    }
    None
}

fn collect_object_records_from_value(value: &Value, sink: &mut Vec<Map<String, Value>>) {
    match value {
        Value::Array(items) => {
            for item in items {
                if let Some(record) = as_object(item) {
                    sink.push(record.clone());
                }
            }
        }
        Value::Object(record) => {
            if record.get("x").and_then(value_as_f64).is_some()
                && record.get("y").and_then(value_as_f64).is_some()
            {
                sink.push(record.clone());
                return;
            }
            for nested in record.values() {
                if let Some(nested_record) = as_object(nested) {
                    if nested_record.get("x").and_then(value_as_f64).is_some()
                        && nested_record.get("y").and_then(value_as_f64).is_some()
                    {
                        sink.push(nested_record.clone());
                    }
                }
            }
        }
        _ => {}
    }
}

fn extract_room_object_records(payload: &Value) -> Vec<Map<String, Value>> {
    let root = as_object(payload);
    let mut out = Vec::new();
    if let Some(root_record) = root {
        for key in ["objects", "roomObjects", "data", "result", "message"] {
            if let Some(value) = root_record.get(key) {
                collect_object_records_from_value(value, &mut out);
            }
        }
        for key in ["data", "result", "message"] {
            if let Some(container) = root_record.get(key).and_then(as_object) {
                for nested_key in ["objects", "roomObjects"] {
                    if let Some(value) = container.get(nested_key) {
                        collect_object_records_from_value(value, &mut out);
                    }
                }
            }
        }
    }
    if !out.is_empty() {
        return out;
    }
    let mut fallback = Vec::new();
    flatten_records(payload, 0, &mut fallback);
    fallback
        .into_iter()
        .filter(|record| {
            record.get("x").and_then(value_as_f64).is_some()
                && record.get("y").and_then(value_as_f64).is_some()
        })
        .collect()
}

fn parse_entities(
    room_name: &str,
    shard_hint: Option<String>,
    payloads: &[Option<&Value>],
) -> ParsedEntities {
    let mut sources = HashMap::<String, RoomSourceSummary>::new();
    let mut minerals = HashMap::<String, RoomMineralSummary>::new();
    let mut structures = HashMap::<String, RoomStructureSummary>::new();
    let mut creeps = HashMap::<String, RoomCreepSummary>::new();
    let mut objects = HashMap::<String, RoomObjectSummary>::new();

    let mut owner = None;
    let mut controller_level = None;
    let mut energy_available: Option<f64> = None;
    let mut energy_capacity: Option<f64> = None;
    let mut shard = shard_hint;

    for payload in payloads {
        let Some(payload_value) = *payload else {
            continue;
        };
        for record in extract_room_object_records(payload_value) {
            if let Some(record_room_name) = extract_record_room_name(&record) {
                if record_room_name != room_name {
                    continue;
                }
            }

            if shard.is_none() {
                shard = map_first_string(&record, &["shard", "worldShard", "mapShard"])
                    .and_then(|value| normalize_shard(Some(&value)));
            }

            let Some(x) = record.get("x").and_then(value_as_i64) else {
                continue;
            };
            let Some(y) = record.get("y").and_then(value_as_i64) else {
                continue;
            };
            if !(0..=49).contains(&x) || !(0..=49).contains(&y) {
                continue;
            }

            let Some(object_type) = resolve_object_type(&record) else {
                continue;
            };
            let object_id = map_first_string(&record, &["_id", "id"])
                .unwrap_or_else(|| format!("{}:{}:{}:{}", object_type, x, y, objects.len() + 1));
            let object_owner = map_first_string(&record, &["owner", "user"]);
            let object_name = map_first_string(&record, &["name", "creepName"]);
            let store = collect_numeric_map(record.get("store"));
            let object_energy = map_first_f64(&record, &["energy"])
                .or_else(|| store.as_ref().and_then(|item| item.get("energy").copied()));
            let object_energy_capacity = map_first_f64(&record, &["energyCapacity"]);

            let object_summary = RoomObjectSummary {
                id: object_id.clone(),
                r#type: object_type.clone(),
                x,
                y,
                owner: object_owner.clone(),
                name: object_name.clone(),
                hits: record.get("hits").and_then(value_as_f64),
                hits_max: record.get("hitsMax").and_then(value_as_f64),
                ttl: map_first_f64(&record, &["ticksToLive", "ttl"]),
                user: map_first_string(&record, &["user", "userId"]),
                store,
                energy: object_energy,
                energy_capacity: object_energy_capacity,
                level: record.get("level").and_then(value_as_f64),
                progress: record.get("progress").and_then(value_as_f64),
                progress_total: map_first_f64(&record, &["progressTotal", "total"]),
                mineral_type: map_first_string(&record, &["mineralType"]),
                body: parse_body(
                    record
                        .get("body")
                        .or_else(|| record.get("bodyParts"))
                        .or_else(|| record.get("parts")),
                ),
                say: parse_say(record.get("say").or_else(|| record.get("message"))),
                reservation: parse_reservation(record.get("reservation")),
                spawning: parse_spawning(record.get("spawning")),
                cooldown_time: map_first_f64(
                    &record,
                    &["cooldownTime", "cooldown", "nextRegenerationTime"],
                ),
                action_log: parse_action_log(
                    record.get("actionLog").or_else(|| record.get("actions")),
                ),
            };
            objects.insert(
                format!("{}:{}:{}:{}", object_summary.id, object_summary.r#type, x, y),
                object_summary,
            );

            if object_type == "source" {
                sources.insert(format!("{}:{}", x, y), RoomSourceSummary { x, y });
                continue;
            }

            if object_type == "mineral" || map_first_string(&record, &["mineralType"]).is_some() {
                minerals.insert(
                    format!("{}:{}", x, y),
                    RoomMineralSummary {
                        r#type: map_first_string(&record, &["mineralType"])
                            .or(Some(object_type.clone())),
                        x,
                        y,
                    },
                );
                continue;
            }

            if object_type == "controller" {
                if owner.is_none() {
                    owner = object_owner;
                }
                if controller_level.is_none() {
                    controller_level = map_first_f64(&record, &["level"]);
                }
                continue;
            }

            if object_type == "creep" || object_type == "powerCreep" {
                let creep_name =
                    object_name.unwrap_or_else(|| format!("{}-{}-{}", object_type, x, y));
                creeps.insert(
                    creep_name.clone(),
                    RoomCreepSummary {
                        name: creep_name,
                        role: map_first_string(&record, &["role"]),
                        x,
                        y,
                        ttl: map_first_f64(&record, &["ticksToLive", "ttl"]),
                    },
                );
                continue;
            }

            if is_structure_type(&object_type) {
                structures.insert(
                    format!("{}:{}:{}", object_type, x, y),
                    RoomStructureSummary {
                        r#type: object_type.clone(),
                        x,
                        y,
                        hits: record.get("hits").and_then(value_as_f64),
                        hits_max: record.get("hitsMax").and_then(value_as_f64),
                    },
                );
                if object_type == "spawn" || object_type == "extension" {
                    if let Some(value) = object_energy {
                        energy_available = Some(energy_available.unwrap_or(0.0) + value);
                    }
                    if let Some(value) = object_energy_capacity {
                        energy_capacity = Some(energy_capacity.unwrap_or(0.0) + value);
                    }
                }
            }
        }
    }

    ParsedEntities {
        shard,
        owner,
        controller_level,
        energy_available,
        energy_capacity,
        sources: sources.into_values().collect(),
        minerals: minerals.into_values().collect(),
        structures: structures.into_values().collect(),
        creeps: creeps.into_values().collect(),
        objects: objects.into_values().collect(),
    }
}

fn merge_by_key<T>(primary: Vec<T>, secondary: Vec<T>, key_of: impl Fn(&T) -> String) -> Vec<T> {
    let mut merged = HashMap::<String, T>::new();
    for item in secondary {
        merged.insert(key_of(&item), item);
    }
    for item in primary {
        merged.insert(key_of(&item), item);
    }
    merged.into_values().collect()
}

fn to_fallback_objects(entities: &ParsedEntities) -> Vec<RoomObjectSummary> {
    let mut output = Vec::new();
    for item in &entities.structures {
        output.push(RoomObjectSummary {
            id: format!("structure:{}:{}:{}", item.r#type, item.x, item.y),
            r#type: item.r#type.clone(),
            x: item.x,
            y: item.y,
            owner: None,
            name: None,
            hits: item.hits,
            hits_max: item.hits_max,
            ttl: None,
            user: None,
            store: None,
            energy: None,
            energy_capacity: None,
            level: None,
            progress: None,
            progress_total: None,
            mineral_type: None,
            body: None,
            say: None,
            reservation: None,
            spawning: None,
            cooldown_time: None,
            action_log: None,
        });
    }
    for item in &entities.creeps {
        output.push(RoomObjectSummary {
            id: format!("creep:{}", item.name),
            r#type: "creep".to_string(),
            x: item.x,
            y: item.y,
            owner: None,
            name: Some(item.name.clone()),
            hits: None,
            hits_max: None,
            ttl: item.ttl,
            user: None,
            store: None,
            energy: None,
            energy_capacity: None,
            level: None,
            progress: None,
            progress_total: None,
            mineral_type: None,
            body: None,
            say: None,
            reservation: None,
            spawning: None,
            cooldown_time: None,
            action_log: None,
        });
    }
    for item in &entities.sources {
        output.push(RoomObjectSummary {
            id: format!("source:{}:{}", item.x, item.y),
            r#type: "source".to_string(),
            x: item.x,
            y: item.y,
            owner: None,
            name: None,
            hits: None,
            hits_max: None,
            ttl: None,
            user: None,
            store: None,
            energy: None,
            energy_capacity: None,
            level: None,
            progress: None,
            progress_total: None,
            mineral_type: None,
            body: None,
            say: None,
            reservation: None,
            spawning: None,
            cooldown_time: None,
            action_log: None,
        });
    }
    output
}

fn extract_terrain(payload: &Value) -> Option<String> {
    let root = as_object(payload)?;
    map_first_string(root, &["terrain", "encodedTerrain"])
        .or_else(|| root.get("terrain").and_then(value_as_non_empty_string))
        .or_else(|| root.get("encodedTerrain").and_then(value_as_non_empty_string))
}

fn extract_game_time(payload: &Value) -> Option<f64> {
    let root = as_object(payload)?;
    map_first_f64(root, &["gameTime", "time", "tick"])
}

fn build_request(
    base_url: &str,
    token: &str,
    username: &str,
    endpoint: &str,
    method: &str,
    query: Option<HashMap<String, Value>>,
    body: Option<Value>,
) -> ScreepsRequest {
    ScreepsRequest {
        base_url: base_url.to_string(),
        endpoint: endpoint.to_string(),
        method: Some(method.to_string()),
        token: Some(token.to_string()),
        username: Some(username.to_string()),
        query,
        body,
    }
}

async fn request_first_success(requests: Vec<ScreepsRequest>) -> Option<Value> {
    let client = shared_http_client().ok()?;
    for request in requests {
        let Ok(response) = perform_screeps_request(client, request).await else {
            continue;
        };
        if response.ok {
            return Some(response.data);
        }
    }
    None
}

fn fetched_at_millis() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

#[tauri::command]
pub async fn screeps_room_detail_fetch(
    request: ScreepsRoomDetailRequest,
) -> Result<RoomDetailSnapshot, String> {
    if request.token.trim().is_empty() {
        return Err("Token cannot be empty".to_string());
    }
    if request.username.trim().is_empty() {
        return Err("Username cannot be empty".to_string());
    }

    let room_name = normalize_room_name(&request.room_name)?;
    let shard = normalize_shard(request.shard.as_deref());
    let shard_value = shard.clone().unwrap_or_else(|| "shard0".to_string());

    let terrain_payload = request_first_success(vec![
        build_request(
            &request.base_url,
            &request.token,
            &request.username,
            "/api/game/room-terrain",
            "GET",
            Some(HashMap::from([
                ("room".to_string(), Value::String(room_name.clone())),
                ("encoded".to_string(), json!(1)),
                ("shard".to_string(), Value::String(shard_value.clone())),
            ])),
            None,
        ),
        build_request(
            &request.base_url,
            &request.token,
            &request.username,
            "/api/game/room-terrain",
            "GET",
            Some(HashMap::from([
                ("room".to_string(), Value::String(room_name.clone())),
                ("encoded".to_string(), json!(1)),
            ])),
            None,
        ),
    ])
    .await;

    let map_stats_payload = request_first_success(vec![build_request(
        &request.base_url,
        &request.token,
        &request.username,
        "/api/game/map-stats",
        "POST",
        None,
        Some(json!({
            "rooms": [room_name.clone()],
            "statName": "owner0",
            "shard": shard.clone(),
        })),
    )])
    .await;

    let overview_payload = request_first_success(vec![
        build_request(
            &request.base_url,
            &request.token,
            &request.username,
            "/api/game/room-overview",
            "GET",
            Some(HashMap::from([
                ("room".to_string(), Value::String(room_name.clone())),
                ("interval".to_string(), json!(8)),
                ("shard".to_string(), Value::String(shard_value.clone())),
            ])),
            None,
        ),
        build_request(
            &request.base_url,
            &request.token,
            &request.username,
            "/api/game/room-overview",
            "POST",
            None,
            Some(json!({
                "room": room_name.clone(),
                "interval": 8,
                "shard": shard.clone(),
            })),
        ),
    ])
    .await;

    let room_objects_payload = request_first_success(vec![
        build_request(
            &request.base_url,
            &request.token,
            &request.username,
            "/api/game/room-objects",
            "GET",
            Some(HashMap::from([
                ("room".to_string(), Value::String(room_name.clone())),
                ("shard".to_string(), Value::String(shard_value.clone())),
            ])),
            None,
        ),
        build_request(
            &request.base_url,
            &request.token,
            &request.username,
            "/api/game/room-objects",
            "POST",
            None,
            Some(json!({
                "room": room_name.clone(),
                "shard": shard.clone(),
            })),
        ),
        build_request(
            &request.base_url,
            &request.token,
            &request.username,
            "/api/game/room-objects",
            "GET",
            Some(HashMap::from([("room".to_string(), Value::String(room_name.clone()))])),
            None,
        ),
    ])
    .await;

    let rooms_payload = if let Some(config) = request.rooms_endpoint.as_ref() {
        request_first_success(vec![build_request(
            &request.base_url,
            &request.token,
            &request.username,
            &config.endpoint,
            config.method.as_deref().unwrap_or("GET"),
            config.query.clone(),
            config.body.clone(),
        )])
        .await
    } else {
        None
    };

    let parsed_room_objects =
        parse_entities(&room_name, shard.clone(), &[room_objects_payload.as_ref()]);
    let fallback_entities = parse_entities(
        &room_name,
        shard.clone(),
        &[map_stats_payload.as_ref(), rooms_payload.as_ref(), overview_payload.as_ref()],
    );

    let fallback_shard = fallback_entities.shard.clone();
    let fallback_owner = fallback_entities.owner.clone();
    let fallback_controller_level = fallback_entities.controller_level;
    let fallback_energy_available = fallback_entities.energy_available;
    let fallback_energy_capacity = fallback_entities.energy_capacity;
    let fallback_objects = to_fallback_objects(&fallback_entities);

    let sources = merge_by_key(parsed_room_objects.sources, fallback_entities.sources, |item| {
        format!("{}:{}", item.x, item.y)
    });
    let minerals = merge_by_key(parsed_room_objects.minerals, fallback_entities.minerals, |item| {
        format!("{}:{}:{}", item.r#type.clone().unwrap_or_default(), item.x, item.y)
    });
    let structures =
        merge_by_key(parsed_room_objects.structures, fallback_entities.structures, |item| {
            format!("{}:{}:{}", item.r#type, item.x, item.y)
        });
    let creeps = merge_by_key(parsed_room_objects.creeps, fallback_entities.creeps, |item| {
        item.name.clone()
    });
    let objects =
        merge_by_key(parsed_room_objects.objects, fallback_objects, |item| item.id.clone());

    let terrain_encoded = terrain_payload.as_ref().and_then(extract_terrain);
    let game_time = room_objects_payload
        .as_ref()
        .and_then(extract_game_time)
        .or_else(|| overview_payload.as_ref().and_then(extract_game_time))
        .or_else(|| map_stats_payload.as_ref().and_then(extract_game_time))
        .or_else(|| terrain_payload.as_ref().and_then(extract_game_time))
        .or_else(|| rooms_payload.as_ref().and_then(extract_game_time));

    Ok(RoomDetailSnapshot {
        fetched_at: fetched_at_millis(),
        room_name,
        shard: parsed_room_objects.shard.or(fallback_shard).or(shard),
        owner: parsed_room_objects.owner.or(fallback_owner),
        controller_level: parsed_room_objects.controller_level.or(fallback_controller_level),
        energy_available: parsed_room_objects.energy_available.or(fallback_energy_available),
        energy_capacity: parsed_room_objects.energy_capacity.or(fallback_energy_capacity),
        terrain_encoded,
        game_time,
        sources,
        minerals,
        structures,
        creeps,
        objects,
    })
}
