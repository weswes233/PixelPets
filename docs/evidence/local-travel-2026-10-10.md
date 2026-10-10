# Local travel and Web build verification

Date: 2026-10-10. Base: PR #1, `feature/travel-devnet-demo` at `4a5e3784de247da46ecad457b0d391eb4f38cb65`.

The original Windows failure occurred before a playable Web export existed. The patch repairs the dependency lock, writes export presets as UTF-8 without a BOM, waits for each Godot process, generates the missing codex, and requires nonempty game assets before reporting startup success. `tools/play.ps1` provides the build-and-start entry point.

Travel additions: personality-based departure notes; home away/return state; persisted bilingual postcard text and personal messages; album for revealed postcards in the latest 50 journeys; historical receipt lookup by trip ID without replacing a newer active trip. Existing canonical result bytes, program IDs, and contract code are unchanged. Display prose is outside the canonical hash. Older stored trips without a postcard snapshot remain readable.

## Executed checks

| Check | Result |
| --- | --- |
| Node 24.19.0 dependency install from repaired lock | PASS, npm ci --ignore-scripts |
| npm test | 149 passed, 0 failed |
| Server / SDK / wallet TypeScript checks | All passed |
| Godot 4.5.2 travel UI, including historical receipts | 50 checks, 0 failures |
| Godot client UI | 52 checks, 0 failures |
| Godot session storage | 26 checks, 0 failures |
| Godot HTTP client against isolated API | 11 checks, 0 failures |
| tools/build.ps1 -Target Web -ValidateOnly | PASS with PowerShell 7.4.6 on Linux |
| tools/build.ps1 -Target Web | PASS with PowerShell 7.4.6 on Linux |
| Export preset first bytes | [preset.0], no UTF-8 BOM |
| Web export plus wallet bridge | HTML, JS, Wasm, PCK and bridge generated |
| Chrome for Testing 151 browser flow, chain disabled | Adopt, pack, depart, home note, reload while waiting, reveal, album and historical read passed; no page/console errors |

Browser requests returned successful API responses for adoption (201), departure (201), reveal (200) and album reads (200). The browser used a separate test database under runtime; no player's database or wallet was used. Travel duration was the standard 45-second demo setting.

## Limits

Windows PowerShell 5.1, the user's PC, Phantom/Backpack extension popups, Devnet issuer configuration and live chain transactions were not exercised by this verification. Follow `docs/plan/windows-play.md` for the final PC check. The private font binary could not be downloaded through the connector; local rendering used the same public Noto Sans SC family. The GitHub branch retains the original font and other binary assets from the base tree.

The stories are templates. Keepsakes are game records. Neither this change nor its verification supplies mining rewards, a project token, AI-generated stories, or keepsake exchange.
