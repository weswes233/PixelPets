# PixelPets 一日计划 · 今日执行清单

来源：[01 产品](01-product-and-economy.md) · [02 一日交接](02-grok-one-day-build-plan.md) · [03 图鉴](03-pet-codex-120.md)。分支 `feature/travel-devnet-demo`，起点 `e6ebc28`（main）。状态只写已核实的事实：✅ 完成 / 🟡 部分 / ❌ 未完成 / ⏸ 等 Wes。时间均为 UTC+8。

## P0 / P1 / P2（与 Astra 02 §1 一致）

| 级别 | 内容 | 状态 | 证据 / 备注 |
| --- | --- | --- | --- |
| P0 | 公开 HTTPS 英文主流程 | 🟡 部分 | 英文主流程本地完成（`tools/demo-up.sh local`）；公开 HTTPS 未完成：本盒出站 7844/22 被封；GitHub Pages 未启用；静态 `dist/web` 可另上 Pages 但 API 仍需主机 |
| P0 | 原有三宠（moss/puddle/wisp）保持兼容 | ✅ | 基线测试全绿（见 H0–H2） |
| P0 | 一次免费、服务端权威、标注加速（45 s）的旅行 | ✅ | 服务端 CSPRNG + 补给账本；`npm test` 146/146；Godot travel 26/26 |
| P0 | 故事与收藏反馈（2 地点、8 纪念物） | ✅ | 明信片 + 纪念物；Album 优先显示；截图 `docs/evidence/ui-smoke/` |
| P0 | 真实 Solana Devnet 领取宠物 | ✅ Devnet（脚本钱包） | 程序/集合/editions 已部署；脚本 claim+赠送已通。真实 Phantom 仍需 Wes（见 `docs/plan/wes-verify.md`） |
| P0 | 旅行结果摘要 checkpoint v2 存证 | ✅ localnet + ✅ Devnet | localnet：截图 37 + smoke 4 PASS。Devnet：`chain/tests/devnet-stack-smoke.mjs` 4 PASS；旅程收据 sig `2WtTemMx…5mix`，公开证明 `jr_eIE4lv-XhPMvy0bgFLcUTw`（独立验证器 10 项） |
| P0 | 刷新及服务重启后恢复 | ✅ localnet | `chain/tests/restart-recovery-localnet.mjs` 4 PASS：旅行中 SIGKILL 重启，ready_at 不变；重启后揭晓；未签名旅程收据意图跨重启保留并确认（`chain/evidence/restart-recovery-localnet.json`） |
| P0 | 真实浏览器钱包演练（扩展钱包弹窗） | 🟡 部分 | 在无头 Chrome 中用 Wallet Standard 测试钱包走通（SIWS、claim、receipt）；真实 Phantom/Backpack 弹窗需 Wes |
| P0 | 可复核的交易与结果证据 | ✅ localnet + ✅ Devnet | Devnet 证明 `jr_eIE4lv-XhPMvy0bgFLcUTw` 经独立验证器 10 项；`docs/evidence/devnet-demo-2026-10-10.json` + `chain/evidence/deployed-stack-smoke-devnet.json`（含 explorer 链接） |
| P1 | 两钱包赠送 + 接收后继续养成（UI） | ✅ localnet + ✅ Devnet（脚本） | localnet 6 PASS；Devnet `chain/tests/gift-two-wallet-devnet.mjs` 6 PASS（gift sig `5ZNrPvAM…`）。真实扩展钱包仍需 Wes |
| P2 | 中文全量校对、120 剪影目录、商店预览、更多动作 | 🟡 部分 | 旅行/收据/赠送中文切换有测试；120 图鉴剪影浏览（按家族分页，未发行仅剪影）已完成；全量校对、商店预览、更多动作未做 |

## H0–H24 时间盒与止损点

| 墙钟 | 预算 | 门槛 | 状态 |
| --- | ---: | --- | --- |
| H0–H2 | 1h | 备份、分支、工具链、密钥公钥、Devnet 连通、确认存储上传渠道 | 🟡 见下表 |
| H2–H7 | 3h | 上传三角色图/元数据；部署程序、Core 集合、3 editions；真实浏览器 claim 一次 | 🟡 Devnet 程序/集合/3 editions + 脚本 claim 已完成（10-10 10:15）；元数据仍仅本地 kubo；真实浏览器扩展钱包 claim 需 Wes |
| H7–H11 | 3h | 旅行表/迁移/接口/一次性结算；2 地点 8 纪念物；重启后可揭晓 | ✅ |
| H11–H14 | 2h | 旅行 manifest、checkpoint v2、证明接口、finalized 恢复；本地重算摘要 | ✅ localnet |
| H14–H17 | 2h | 英文主流程、像素旅行反馈、收藏结果 | ✅ |
| H17–H20 | 2h | 云端单实例 HTTPS、持久库、RPC/CSP、外部钱包与元数据访问 | 🟡 已做 PUBLIC_ORIGIN 白名单与服务端 RPC；HTTPS 隧道被封，未上线 |
| H20–H22 | 1h | 关键异常演练；有余量才接 P1 赠送 | 🟡 已演练未签名意图恢复与 finalize 等待；赠送 UI 未做 |
| H22–H24 | 2h | 录屏、交易与 manifest 核验、完成/未完成证据、发布说明 | 🟡 Devnet 交易与证明证据已写；公开 HTTPS 录屏与真实钱包录屏仍缺 |

**止损：**H7 仍无真实 Devnet claim → 停止新玩法扩张，集中解决部署/钱包；H14 仍无法从 manifest 重算链上摘要 → 只保留一条旅行与一个结果模板；H20 仍无 HTTPS → 冻结功能处理公开访问。外部依赖拿不到时输出部分结果，不伪装成功。

## H0–H2 门槛核验（2026-10-10 00:40–01:20 UTC+8，本机 Linux）

| 门槛 | 状态 | 结果 |
| --- | --- | --- |
| 分支 | ✅ | `feature/travel-devnet-demo` 自 `e6ebc28`；未推送 main |
| 备份工具 | ✅ | `node tools/backup.ts backup\|verify\|restore --source FILE [--destination NEW_FILE]`。本克隆无 `runtime/pets.sqlite`（默认路径备份报 ENOENT，属正常）。新建空 Demo 库 `runtime/demo/pets-demo-devnet.sqlite`（schema v2，13 表，0 行），backup→verify→restore 全部通过 |
| Demo 库路径 | ✅ | Demo 用 `PIXELPETS_DB=runtime/demo/pets-demo-devnet.sqlite`，备份到 `runtime/backups/`；云端用独立持久卷，不打包本机私人存档 |
| Node | ✅ | 盒内 Node 24.11 跑 `npm test` 有 14 个文件失败（CJS 具名导出 `BN` 识别不到）；升级到 Node 24.21.0（与 `node:24-bookworm-slim` 一致）后通过。建议 engines 收紧到 `>=24.13` |
| JS 测试 | ✅ | `npm test` 136/136；typecheck server/sdk/wallet 全部 0 错 |
| Godot | ✅ | 4.5.2 stable（SHA-512 与官方一致）+ 模板 `web_nothreads_release.zip`/`windows_release_x86_64.exe`；`build.ps1 -Target Web -ValidateOnly` 用 pwsh 7.5.3 通过 |
| Godot 测试 | ✅ | client 49/49，session storage 26/26，HTTP 11/11 |
| 合约构建 | ✅ | `anchor build -- --tools-version v1.57`（默认 v1.51 的 cargo 1.84 不支持锁文件里的 edition2024 依赖）；`cargo test` 15/15；重新生成的 IDL 与仓库 IDL 完全一致 |
| 程序地址 | 🟡 已上 Devnet，待 Wes 批准 | Devnet 已部署到 `2SCKfWszFZuqsjcmRbtmctHwZTgQopYmGSofoEtQm2nT`（原 `2R4P5J6r…3iQR` 私钥不在本机）。合并/主网前需 Wes 批准该程序 id |
| Devnet 公钥 | ✅ | deployer `294hmkx1…W9BU`、issuer `Cf6QfJVb…oTxX`、player-a `5wpnLLhK…jdow`、player-b `9WFW2Avm…GX1P`（私钥在 `runtime/devnet-keys/`，gitignored） |
| Devnet 连通 | ✅ | Helius devnet genesis `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG` |
| Devnet 资金 | ✅ | 10-10 上午 deployer 收到 5 SOL（转账 sig `38c6KpY5…XA4qp`）；部署后约 1.99 SOL 剩余；player-a/b 各 0.05 SOL |
| 部署成本估算 | — | `pixel_pets.so` 569,888 B → ProgramData 租金约 3.97 SOL（加缓冲区与手续费按 ≈4.2 SOL 备）；config/collection/3 editions/首批 claim < 0.1 SOL；两名玩家各 0.05 SOL。总计建议 **5 SOL** |
| 元数据通道 | 🟡 已 pin（Lighthouse 同 CID + Irys 网关字节可取） | 链上仍为原 `ipfs://bafkrei…`（不可变）。Lighthouse 上传 CID 全匹配；Irys Devnet 网关 HTTP 200+sha256。公开 ipfs.io 对 curl 仍挑战。证据 `docs/evidence/lighthouse-pin-2026-10-10.json` / `irys-devnet-*.json` |

## 缺的依赖（需要 Wes）

1. ~~**Devnet SOL ≈5 SOL**~~ ✅ 已到账并完成部署（deployer 现约 1.99 SOL）。
2. ~~**元数据上传账户**~~ 🟡 Lighthouse 已无账号 pin 同 CID；可选 Pinata/Filebase 仪表盘二次确认。
3. **域名**（或接受临时 `trycloudflare.com` 演示地址）。
4. **Linux 主机 + 持久卷**，用于 HTTPS 单实例（Caddy + Node 24 + SQLite）。本盒出站 7844/22 被封。
5. **真实浏览器钱包**：在真机上安装 Phantom 或 Backpack，切到 Devnet，完成 claim + 保存旅程 + 刷新恢复的录屏（A06/A07/A10）。脚本钱包 Devnet 主流程已通。
6. ~~**第二个钱包 / Devnet gift**~~ ✅ 脚本双钱包 Devnet 已通（`gift-two-wallet-devnet.json`）；真实 Phantom 第二账户仍建议你点一遍。
7. **批准程序地址** `2SCKfWszFZuqsjcmRbtmctHwZTgQopYmGSofoEtQm2nT` 替换代码中的 `2R4P5J6r…`（原密钥不在本机；已部署到 Devnet）。

## Devnet 部署核验（2026-10-10 10:12–10:16 UTC+8）

| 项 | 结果 |
| --- | --- |
| 部署前余额 | 5.0000 SOL（转账 sig `38c6KpY5VmW6SCW18uZvtb4exuPzRCCt35ZptD7riUG3Tf9HeSwi8TXiQtwBVX2b638ALEuNmPCbGd5FQG1XA4qp`） |
| 程序部署 | sig `5dtmhPyRYgwAqncdRbF5LY3QoNcAwPzADCRbUspBvRv5iyKMAkCnXApfLNmEuGo1D3U1BAyzAuyQB2RwNvPSxpWj`；bytes sha256 与本地一致 |
| Config + Core 集合 | `5BnUfTQ249v4v7sVAuohBEstsWF9JdzmaHwSbK7cuoiS`；sig `4ZENShTMsjAuvSeRFPPoEmd9QYd8abk6pf78WkakJ54HBQUZ6qZc8gQVDtk18XnoGkVCahcDQcaUdesMHm1ESQmZ` |
| Editions | moss/puddle/wisp = 1001/1002/1003 |
| 部署花费 | ≈2.9088 SOL；部署后 deployer ≈2.0912 SOL；给 player-a/b 各 0.05 后 ≈1.9912 SOL |
| 脚本主流程 | claim → trip → reveal → journey receipt → 独立验证 10/10（`chain/tests/devnet-stack-smoke.mjs`） |
| 汇总证据 | `docs/evidence/devnet-demo-2026-10-10.json`（network=devnet，含 explorer 链接） |
