# Third-party provenance

- Prospero: https://github.com/linn0x/Prospero
- Pinned source commit: `b4e34246716cb5c74db620554cb9ba6bcfbe0f34`
- Upstream license: MIT, Copyright (c) 2026 linn0x; see `vendor/prospero/LICENSE`.
- Rust daemon/client/protocol and JavaScript encryption protocol are reused. Upstream implementation source is preserved; generated build output, dependencies, development plans and agent instruction files are excluded from source control. The complete upstream documentation remains available at the pinned commit above.

Cargo.lock and pnpm-lock.yaml record exact dependency resolutions. Tauri, Dockview, xterm.js, Tiptap, CodeMirror, UniFFI, Expo, Ratatui and their transitive dependencies retain their respective licenses. Distribution should retain the upstream Prospero license alongside its daemon binary.

- React Activity Calendar 3.2.1: https://github.com/grubersjoe/react-activity-calendar. Used for the desktop activity calendar. MIT license: `apps/desktop/src-tauri/licenses/react-activity-calendar.txt`, also included in desktop application resources.

- JetBrains Mono 2.304: https://github.com/JetBrains/JetBrainsMono/tree/v2.304. Regular, Bold, Italic and Bold Italic WOFF2 fonts are bundled locally for desktop terminals. SIL Open Font License 1.1: `apps/desktop/src/assets/fonts/JetBrainsMono-OFL.txt`.
- JetBrains Mono Nerd Font Mono, Nerd Fonts v3.4.0: https://github.com/ryanoasis/nerd-fonts/tree/v3.4.0/patched-fonts/JetBrainsMono. Regular TTF reused from the vendored Prospero mobile assets as an optional terminal font and icon fallback. License: `apps/desktop/src/assets/fonts/JetBrainsMonoNerdFont-OFL.txt`.
