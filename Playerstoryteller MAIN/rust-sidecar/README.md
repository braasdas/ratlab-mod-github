# Ratlab Sidecar (Rust Edition)

This is the next-generation screen capture sidecar for the Ratlab project.
It replaces the Go/FFmpeg implementation with a high-performance **Rust** application that uses Native Windows APIs (`Windows.Graphics.Capture`).

## Why Rust?
- **Zero-Copy Capture:** Captures frames directly on the GPU without moving them to system RAM.
- **Multi-GPU Awareness:** Explicitly selects the correct GPU (NVIDIA/AMD/Intel) for capture, solving the "hybrid laptop" issues.
- **Security:** Strict memory safety preventing crashes common in C++ drivers.

## Prerequisites
You need to install the Rust programming language.

1.  Visit [rustup.rs](https://rustup.rs/).
2.  Download `rustup-init.exe` and run it.
3.  Press `1` (Proceed with installation/default).
4.  Once finished, close and reopen your terminal.

## Building & Running

1.  Open this folder in a terminal:
    ```powershell
    cd rust-sidecar
    ```

2.  Run the sidecar (it will automatically download dependencies and compile):
    ```powershell
    cargo run -- --pid 1234 --url "ws://localhost:3000"
    ```

## Development Status
- [x] Project Structure
- [x] GPU Detection & Selection Algorithm
- [x] DirectX 11 Device Initialization
- [ ] Windows.Graphics.Capture Implementation
- [ ] FFmpeg/Encoder Integration
