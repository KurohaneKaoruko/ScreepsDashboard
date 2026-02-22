use serde::Deserialize;

use crate::http::{
    error_response, perform_screeps_request, shared_http_client, ScreepsRequest, ScreepsResponse,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreepsBatchRequest {
    requests: Vec<ScreepsRequest>,
    max_concurrency: Option<usize>,
}

#[tauri::command]
pub async fn screeps_request(request: ScreepsRequest) -> Result<ScreepsResponse, String> {
    let client = shared_http_client()?;
    perform_screeps_request(client, request).await
}

#[tauri::command]
pub async fn screeps_request_many(
    batch: ScreepsBatchRequest,
) -> Result<Vec<ScreepsResponse>, String> {
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
