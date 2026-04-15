use reqwest::Client;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize)]
struct ChatCompletionRequest {
    model: String,
    messages: Vec<ApiMessage>,
    temperature: f32,
    max_tokens: u32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct ApiMessage {
    role: String,
    content: String,
}

#[derive(Debug, Deserialize)]
struct ChatCompletionResponse {
    choices: Option<Vec<Choice>>,
    error: Option<ApiError>,
}

#[derive(Debug, Deserialize)]
struct Choice {
    message: Option<ChoiceMessage>,
}

#[derive(Debug, Deserialize)]
struct ChoiceMessage {
    content: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ApiError {
    message: String,
    // error_type: Option<String>,
}

/// Errors that the AI service can return, with user-friendly messages.
#[derive(Debug)]
pub enum AiError {
    MissingApiKey,
    InvalidUrl(String),
    NetworkError(String),
    RateLimit(String),
    ApiError(String),
    EmptyResponse,
}

impl std::fmt::Display for AiError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AiError::MissingApiKey => write!(
                f,
                "API key is not set. Please add your Groq API key in Settings."
            ),
            AiError::InvalidUrl(u) => write!(f, "Invalid model URL: {}. Check your Settings.", u),
            AiError::NetworkError(e) => {
                write!(f, "Network error: {}. Check your internet connection.", e)
            }
            AiError::RateLimit(msg) => write!(f, "Rate limited by the API: {}", msg),
            AiError::ApiError(msg) => write!(f, "API error: {}", msg),
            AiError::EmptyResponse => write!(
                f,
                "The AI returned an empty response. Try again or check your model settings."
            ),
        }
    }
}

/// Call a Groq-compatible chat completion endpoint.
///
/// `base_url` should be something like `https://api.groq.com/openai/v1`
/// — we append `/chat/completions` to it.
pub async fn chat_completion(
    api_key: &str,
    base_url: &str,
    model: &str,
    messages: Vec<(String, String)>, // (role, content) pairs
) -> Result<String, AiError> {
    // ── Validate inputs ───────────────────────────────────────────
    if api_key.is_empty() {
        return Err(AiError::MissingApiKey);
    }

    let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));

    // Quick sanity check on the URL
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err(AiError::InvalidUrl(base_url.to_string()));
    }

    // ── Build request body ────────────────────────────────────────
    let api_messages: Vec<ApiMessage> = messages
        .into_iter()
        .map(|(role, content)| ApiMessage { role, content })
        .collect();

    let body = ChatCompletionRequest {
        model: model.to_string(),
        messages: api_messages,
        temperature: 0.7,
        max_tokens: 4096,
    };

    // ── Make the HTTP request ─────────────────────────────────────
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| AiError::NetworkError(e.to_string()))?;

    let response = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| {
            if e.is_timeout() {
                AiError::NetworkError("Request timed out after 60 seconds".to_string())
            } else if e.is_connect() {
                AiError::NetworkError(format!("Could not connect to {}", base_url))
            } else {
                AiError::NetworkError(e.to_string())
            }
        })?;

    let status = response.status();

    // ── Handle HTTP-level errors ──────────────────────────────────
    if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
        let body_text = response.text().await.unwrap_or_default();
        return Err(AiError::RateLimit(if body_text.is_empty() {
            "Too many requests. Please wait and try again.".to_string()
        } else {
            body_text
        }));
    }

    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        return Err(AiError::ApiError(
            "Authentication failed. Check your API key in Settings.".to_string(),
        ));
    }

    let body_text = response
        .text()
        .await
        .map_err(|e| AiError::NetworkError(e.to_string()))?;

    if !status.is_success() {
        // Try to get a structured error message
        if let Ok(parsed) = serde_json::from_str::<ChatCompletionResponse>(&body_text) {
            if let Some(err) = parsed.error {
                return Err(AiError::ApiError(err.message));
            }
        }
        return Err(AiError::ApiError(format!(
            "HTTP {} — {}",
            status.as_u16(),
            if body_text.len() > 500 {
                &body_text[..500]
            } else {
                &body_text
            }
        )));
    }

    // ── Parse successful response ─────────────────────────────────
    let parsed: ChatCompletionResponse = serde_json::from_str(&body_text)
        .map_err(|e| AiError::ApiError(format!("Failed to parse API response: {}", e)))?;

    // Check for API-level error in the body (some providers embed this)
    if let Some(err) = parsed.error {
        return Err(AiError::ApiError(err.message));
    }

    let content = parsed
        .choices
        .and_then(|choices| choices.into_iter().next())
        .and_then(|choice| choice.message)
        .and_then(|msg| msg.content)
        .unwrap_or_default();

    if content.trim().is_empty() {
        return Err(AiError::EmptyResponse);
    }

    Ok(content)
}
