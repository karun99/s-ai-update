# S-AI Build System

Multi-platform build infrastructure for S-AI v5.1.

## Platforms

| Platform | Artifact | Tool | Status |
|----------|----------|------|--------|
| Windows x64 | `s-ai.exe` | pkg | Supported |
| Windows x64 | `s-ai-setup.msi` | WiX Toolset | Supported |
| Linux x64 | `s-ai-linux` | pkg | Supported |
| Linux arm64 | `s-ai-linux-arm64` | pkg | Supported |
| macOS x64 | `s-ai-macos` | pkg | Supported |
| macOS arm64 | `s-ai-macos-arm64` | pkg | Supported |
| Android APK | `s-ai.apk` | Capacitor | Supported |
| Docker | `s-ai:latest` | Dockerfile | Supported |

## Quick Build

```bash
# Build all native executables
npm run build:exe

# Build Windows .msi installer
npm run build:msi

# Build Android APK
npm run build:apk

# Build everything
npm run build:all
```

## Prerequisites

### Native Executables (Windows/Linux/macOS)
- Node.js >= 18
- `npm run build` (compile TypeScript first)

### Windows MSI Installer
- WiX Toolset v3.11+ or v4+ (`wix` CLI)
- Wine (for cross-compilation from Linux/macOS)

### Android APK
- Android SDK (API 34+)
- Java 17+ (JDK)
- Gradle 8.x
- Capacitor CLI (`npm install -g @capacitor/cli`)

## Build Scripts

| Script | Description |
|--------|-------------|
| `scripts/build-exe.sh` | Build native executables via pkg for all platforms |
| `scripts/build-msi.sh` | Build Windows .msi installer via WiX |
| `scripts/build-apk.sh` | Build Android APK via Capacitor + Gradle |
| `scripts/build-docker.sh` | Build Docker image |

## Output Structure

```
build/dist/
  windows/
    s-ai.exe                    # Windows x64 executable
    s-ai-setup.msi              # Windows installer
  linux/
    s-ai-linux                  # Linux x64 executable
    s-ai-linux-arm64            # Linux ARM64 executable
  macos/
    s-ai-macos                  # macOS x64 executable
    s-ai-macos-arm64            # macOS ARM64 (Apple Silicon) executable
  android/
    s-ai.apk                    # Android APK (debug)
    s-ai-release.apk            # Android APK (release, signed)
```

## CI/CD

GitHub Actions workflow (`.github/workflows/build.yml`) automatically builds all platforms on push to `main` or when a version tag is pushed.

## Notes

- All executables bundle the Node.js runtime (~45MB per platform)
- The Android build uses Capacitor to wrap the web dashboard in a native WebView
- MSI installer includes Start Menu shortcuts, PATH setup, and uninstaller
- APK targets Android 7.0 (API 24) minimum, compiles against API 34
