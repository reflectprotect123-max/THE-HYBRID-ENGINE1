// THE Hybrid Engine — Windows wrapper. The window navigates straight to the
// live PWA; all app logic and data live in the web app, so the desktop build
// tracks production automatically.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running THE Hybrid Engine");
}
