fn main() {
    let root = std::env::var_os("OBRYTH_VAULT")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| {
            std::env::var_os("HOME")
                .or_else(|| std::env::var_os("USERPROFILE"))
                .map(std::path::PathBuf::from)
                .unwrap_or_default()
                .join("Obryth")
        });
    if let Err(error) = obryth_cli::browser_bridge::run(&root) {
        eprintln!("{error:#}");
        std::process::exit(1);
    }
}
