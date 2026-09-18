use std::sync::Mutex;

use serde::Serialize;
use serde_json::Value;
use tauri::ipc::Channel;

use crate::error::HostError;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostEvent {
    channel: String,
    payload: Value,
}

#[derive(Default)]
pub struct EventBus {
    channel: Mutex<Option<Channel<HostEvent>>>,
}

impl EventBus {
    pub fn initialize(&self, channel: Channel<HostEvent>) -> Result<(), HostError> {
        let mut current = self
            .channel
            .lock()
            .map_err(|_| HostError::new("state_poisoned", "Native event state is unavailable."))?;
        *current = Some(channel);
        Ok(())
    }

    pub fn send(&self, channel: impl Into<String>, payload: Value) {
        let Ok(current) = self.channel.lock() else {
            return;
        };
        let Some(events) = current.as_ref() else {
            return;
        };
        let _ = events.send(HostEvent {
            channel: channel.into(),
            payload,
        });
    }
}
