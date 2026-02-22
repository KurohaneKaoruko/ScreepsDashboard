mod console;
mod http;
mod messages;
mod requests;
mod rooms;

use crate::console::screeps_console_execute;
use crate::messages::{
    screeps_messages_fetch, screeps_messages_fetch_thread, screeps_messages_send,
};
use crate::requests::{screeps_request, screeps_request_many};
use crate::rooms::screeps_room_detail_fetch;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            screeps_request,
            screeps_request_many,
            screeps_console_execute,
            screeps_messages_fetch,
            screeps_messages_fetch_thread,
            screeps_messages_send,
            screeps_room_detail_fetch
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
