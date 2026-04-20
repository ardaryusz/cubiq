use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::AppHandle;
use tokio_util::sync::CancellationToken;
use serde::Serialize;

// ── Event payloads ──────────────────────────────────────────────────────

#[derive(Clone, Serialize)]
pub struct StreamDelta {
    pub request_id: String,
    pub delta: String,
}

#[derive(Clone, Serialize)]
pub struct StreamDone {
    pub request_id: String,
}

#[derive(Clone, Serialize)]
pub struct StreamError {
    pub request_id: String,
    pub message: String,
}

// ── Shared cancellation registry ────────────────────────────────────────

#[derive(Clone)]
pub struct StreamRegistry {
    tokens: Arc<Mutex<HashMap<String, CancellationToken>>>,
}

impl StreamRegistry {
    pub fn new() -> Self {
        Self {
            tokens: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Register a new stream. If a stream already exists for this request_id, cancel it first.
    pub fn register(&self, request_id: &str) -> CancellationToken {
        let token = CancellationToken::new();
        let mut map = self.tokens.lock().unwrap();
        if let Some(old) = map.insert(request_id.to_string(), token.clone()) {
            old.cancel();
        }
        token
    }

    /// Cancel a specific stream by request_id.
    pub fn cancel(&self, request_id: &str) -> bool {
        let mut map = self.tokens.lock().unwrap();
        if let Some(token) = map.remove(request_id) {
            token.cancel();
            true
        } else {
            false
        }
    }

    /// Remove a completed stream (no cancel signal).
    pub fn remove(&self, request_id: &str) {
        let mut map = self.tokens.lock().unwrap();
        map.remove(request_id);
    }

    /// Cancel all streams whose request_id starts with a given prefix (e.g., window label).
    #[allow(dead_code)]
    pub fn cancel_by_prefix(&self, prefix: &str) {
        let mut map = self.tokens.lock().unwrap();
        let keys: Vec<String> = map
            .keys()
            .filter(|k| k.starts_with(prefix))
            .cloned()
            .collect();
        for k in keys {
            if let Some(token) = map.remove(&k) {
                token.cancel();
            }
        }
    }
}

// ── Streaming runner ────────────────────────────────────────────────────

/// Starts a streaming HTTP request and emits deltas to the given window.
/// This function is designed to be called from a spawned tokio task.
pub async fn run_stream(
    app_handle: AppHandle,
    target_window: String,
    request_id: String,
    api_key: String,
    base_url: String,
    model: String,
    messages: Vec<(String, String)>,
    cancel_token: CancellationToken,
) {
    use futures_util::StreamExt;
    use reqwest::Client;

    log::info!("[stream] START target_window={} request_id={}", target_window, request_id);

    // ── Validate inputs ─────────────────────────────────────────────
    if api_key.is_empty() {
        emit_error(&app_handle, &target_window, &request_id,
            "API key is not set. Please add your Groq API key in Settings.");
        return;
    }

    let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));
    if !url.starts_with("http://") && !url.starts_with("https://") {
        emit_error(&app_handle, &target_window, &request_id,
            &format!("Invalid model URL: {}. Check your Settings.", base_url));
        return;
    }

    // ── Build request body ──────────────────────────────────────────
    let api_messages: Vec<serde_json::Value> = messages
        .into_iter()
        .map(|(role, content)| {
            serde_json::json!({ "role": role, "content": content })
        })
        .collect();

    let body = serde_json::json!({
        "model": model,
        "messages": api_messages,
        "temperature": 0.7,
        "max_tokens": 4096,
        "stream": true,
    });

    // ── Make the HTTP request ────────────────────────────────────────
    let client = match Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            emit_error(&app_handle, &target_window, &request_id,
                &format!("Network error: {}", e));
            return;
        }
    };

    let response = tokio::select! {
        _ = cancel_token.cancelled() => {
            // Cancelled before response arrived
            return;
        }
        result = client
            .post(&url)
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .json(&body)
            .send() => {
            match result {
                Ok(r) => r,
                Err(e) => {
                    let msg = if e.is_timeout() {
                        "Request timed out after 120 seconds".to_string()
                    } else if e.is_connect() {
                        format!("Could not connect to {}", base_url)
                    } else {
                        format!("Network error: {}", e)
                    };
                    emit_error(&app_handle, &target_window, &request_id, &msg);
                    return;
                }
            }
        }
    };

    let status = response.status();

    // ── Handle HTTP-level errors ────────────────────────────────────
    if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
        let body_text = response.text().await.unwrap_or_default();
        let msg = if body_text.is_empty() {
            "Too many requests. Please wait and try again.".to_string()
        } else {
            format!("Rate limited by the API: {}", &body_text[..body_text.len().min(500)])
        };
        emit_error(&app_handle, &target_window, &request_id, &msg);
        return;
    }

    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        emit_error(&app_handle, &target_window, &request_id,
            "Authentication failed. Check your API key in Settings.");
        return;
    }

    if !status.is_success() {
        let body_text = response.text().await.unwrap_or_default();
        let truncated = if body_text.len() > 500 {
            &body_text[..500]
        } else {
            &body_text
        };
        emit_error(&app_handle, &target_window, &request_id,
            &format!("API error: HTTP {} — {}", status.as_u16(), truncated));
        return;
    }

    // ── Stream the SSE response ─────────────────────────────────────
    let mut byte_stream = response.bytes_stream();
    let mut buffer = String::new();

    loop {
        tokio::select! {
            _ = cancel_token.cancelled() => {
                // Cancelled during streaming
                return;
            }
            chunk = byte_stream.next() => {
                match chunk {
                    Some(Ok(bytes)) => {
                        let text = String::from_utf8_lossy(&bytes);
                        buffer.push_str(&text);

                        // Process complete SSE lines
                        while let Some(line_end) = buffer.find('\n') {
                            let line = buffer[..line_end].trim().to_string();
                            buffer = buffer[line_end + 1..].to_string();

                            if line.is_empty() || line.starts_with(':') {
                                continue;
                            }

                            if line == "data: [DONE]" {
                                log::info!("[stream] DONE target_window={} request_id={}", target_window, request_id);
                                emit_done(&app_handle, &target_window, &request_id);
                                return;
                            }

                            if let Some(json_str) = line.strip_prefix("data: ") {
                                if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(json_str) {
                                    // Check for error in the stream
                                    if let Some(err) = parsed.get("error") {
                                        let msg = err.get("message")
                                            .and_then(|m| m.as_str())
                                            .unwrap_or("Unknown streaming error");
                                        emit_error(&app_handle, &target_window, &request_id, msg);
                                        return;
                                    }

                                    // Extract delta content
                                    if let Some(delta) = parsed
                                        .get("choices")
                                        .and_then(|c| c.get(0))
                                        .and_then(|c| c.get("delta"))
                                        .and_then(|d| d.get("content"))
                                        .and_then(|c| c.as_str())
                                    {
                                        if !delta.is_empty() {
                                            emit_delta(&app_handle, &target_window, &request_id, delta);
                                        }
                                    }
                                }
                            }
                        }
                    }
                    Some(Err(e)) => {
                        emit_error(&app_handle, &target_window, &request_id,
                            &format!("Stream read error: {}", e));
                        return;
                    }
                    None => {
                        // Stream ended without [DONE] — treat as done
                        emit_done(&app_handle, &target_window, &request_id);
                        return;
                    }
                }
            }
        }
    }
}

// ── Event emitters ─────────────────────────────────────────────────────────
// Strategy: use app_handle.emit() — global broadcast to all webviews.
//
// Tauri v2 has THREE emit mechanisms, each with a matching JS receiver:
//   1. app.emit()          → EventTarget::App   → JS: listen() (no options)     ✓ GLOBAL
//   2. app.emit_to(label)  → EventTarget::AnyLabel → JS: listen() with matching target filter
//   3. w.emit()            → EventTarget::Webview  → JS: win.listen() with WebviewWindow filter
//
// emit_to + global listen() does NOT match (different target kinds).
// w.emit() + win.listen() has a Webview/WebviewWindow mismatch on some platforms.
// Only (1) is universally reliable.
//
// Isolation is maintained via request_id — QuickAsk handlers check for "qa-*" prefix,
// main chat handlers check for "chat-*". Cross-window events are filtered in JS.

fn emit_delta(app: &AppHandle, _window: &str, request_id: &str, delta: &str) {
    use tauri::Emitter;
    let preview: String = delta.chars().take(20).collect();
    log::info!("[stream] DELTA request_id={} len={} preview={:?}",
        request_id, delta.len(), preview);
    let result = app.emit("cubiq:stream_delta", StreamDelta {
        request_id: request_id.to_string(),
        delta: delta.to_string(),
    });
    if let Err(e) = &result {
        log::warn!("[stream] DELTA emit failed: {}", e);
    } else {
        log::info!("[stream] DELTA emit OK (global) request_id={}", request_id);
    }
}

fn emit_done(app: &AppHandle, _window: &str, request_id: &str) {
    use tauri::Emitter;
    log::info!("[stream] emit_done request_id={}", request_id);
    let result = app.emit("cubiq:stream_done", StreamDone {
        request_id: request_id.to_string(),
    });
    if let Err(e) = &result {
        log::warn!("[stream] DONE emit failed: {}", e);
    } else {
        log::info!("[stream] DONE emit OK (global) request_id={}", request_id);
    }
}

fn emit_error(app: &AppHandle, _window: &str, request_id: &str, message: &str) {
    use tauri::Emitter;
    log::info!("[stream] emit_error request_id={} message={}", request_id, message);
    let result = app.emit("cubiq:stream_error", StreamError {
        request_id: request_id.to_string(),
        message: message.to_string(),
    });
    if let Err(e) = &result {
        log::warn!("[stream] ERROR emit failed: {}", e);
    }
}

