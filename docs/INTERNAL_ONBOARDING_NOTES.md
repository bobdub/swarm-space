# Internal Onboarding Notes

## Toolchain Validation (2025-10-25)

- **Node.js**: v22.19.0 (meets ≥18 requirement for Vite 5 / Capacitor 7)
- **npm**: 11.4.2 (meets ≥9 requirement for Vite 5 / Capacitor 7)
- **Global prerequisites**:
  - CocoaPods: Not installed in this Linux CI container. Requires macOS environment with `sudo gem install cocoapods`.
  - Android Studio: Not available in container. Install locally alongside JDK 11+ following `docs/MOBILE_SETUP.md`.
- **npm install**: Completed with no peer-dependency warnings; packages aligned with `package.json`.
- **Capacitor Doctor**: `@capacitor/cli`, `core`, `android`, `ios` all at 7.4.4 and synchronized.

For local onboarding, replicate the above versions and install the missing global tools on macOS/Windows/Linux workstations as applicable.
