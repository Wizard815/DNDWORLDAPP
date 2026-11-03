#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .setup(|app| {
            // Verify frontend build exists
            let dist = app.path().frontend_res_path("index.html");
            if !dist.exists() {
                eprintln!("Frontend build not found. Run `npm run build` in apps/desktop/ first.");
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
