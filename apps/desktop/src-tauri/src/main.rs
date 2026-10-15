fn main() {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    if let Some(index) = args.iter().position(|arg| arg == "--vault") {
        if let Some(path) = args.get(index + 1) {
            std::env::set_var("OBRYTH_VAULT", path);
        }
    }
    let root = obryth_desktop::vault_root();
    if args.iter().any(|arg| arg == "serve") {
        if let Err(error) = tokio::runtime::Runtime::new()
            .unwrap()
            .block_on(obryth_cli::service::serve(root))
        {
            eprintln!("{error:#}");
            std::process::exit(1);
        }
        return;
    }
    if args.iter().any(|arg| arg == "browser-bridge") {
        if let Err(error) = obryth_cli::browser_bridge::run(&root) {
            eprintln!("{error:#}");
            std::process::exit(1);
        }
        return;
    }
    obryth_desktop::run();
}
