use serde::Serialize;

#[derive(Clone, Debug, Serialize)]
pub struct HostError {
    pub code: &'static str,
    pub message: String,
}

impl HostError {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}
