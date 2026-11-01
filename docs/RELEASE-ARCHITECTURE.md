# Apple silicon releases

Starting with Scoreline 1.0.31, the Mac app supports Apple silicon only, with macOS 15 or later. Builds compile once for `arm64`; `--universal` is retired. Historical verification records for 1.0.30 and earlier describe the universal binaries that were shipped then.

## Bundling and verification

`build.sh` copies the checksum-verified Sparkle framework into the app, removes unused XPC services and development headers, and thins its three remaining Mach-O files to `arm64`. It does not change the vendor download. File modes, entitlements and hardened-runtime flags are preserved through the existing inside-out signing sequence. Localizations remain available.

`Support/verify-architecture.sh <Scoreline.app>` checks the main executable and every embedded Mach-O file. Both the build and release scripts use it, including a second check after the ZIP is unpacked. Deep/strict code-signature verification and the archive's EdDSA signature checks remain required. Architecture checks alone do not verify signatures.

The installer checks `hw.optional.arm64` before downloading or modifying an installed app. This identifies Apple silicon hardware even when the invoking shell uses Rosetta. It also checks the downloaded executable before replacing the existing copy.

## Existing Intel installations

Keep the current `SUFeedURL`, bundle identifier and signing key. Every new appcast item must contain:

```xml
<sparkle:hardwareRequirements>arm64</sparkle:hardwareRequirements>
```

[Sparkle's publishing documentation](https://sparkle-project.org/documentation/publishing/#minimum-system-version-requirements) specifies this hardware gate beginning in Sparkle 2.9. Scoreline introduced auto-updates in commit `c209206` with Sparkle 2.10.0, and `Support/fetch-sparkle.sh` has retained that version. Existing updater-equipped Intel installations therefore understand the restriction and are not offered the incompatible download. Sparkle's standard manual-check UI explains the hardware requirement and links to the app's install page.

The [2.10.0 selection implementation](https://github.com/sparkle-project/Sparkle/blob/2.10.0/Sparkle/SUAppcastDriver.m#L471-L488) checks hardware eligibility when filtering supported updates. Merely shipping an arm64 executable, changing the latest download's filename, or adding a release-note warning is not a substitute for the appcast gate.

Do not publish a manually assembled appcast without this element. `release.sh` emits and validates it. No ARM-only 1.0.31 release is considered published by these script changes; packaging, installation checks and publication are separate steps.

## Script validation, November 1, 2026

Shell syntax checks and the retired-flag guard passed. Simulated Intel installation stopped before download or destination creation; simulated Apple silicon hardware with an x86_64 shell reached download. A scratch copy of Sparkle was processed by the actual embedding and signing sections of `build.sh`: deep/strict signature verification passed, with unchanged file modes, entitlements and hardened-runtime flags. The original vendor binaries' SHA-256 hashes were unchanged. The three embedded executables shrank from 2,024,256 to 905,344 bytes in total.

The architecture verifier accepted the four-file arm64 fixture and rejected an added universal helper. The generated appcast template parsed with the namespaced `arm64` requirement. These checks did not compile or launch Scoreline; the full ARM-only app build and packaged installation still require release verification.
