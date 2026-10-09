# PixelPets 一日计划 · 今日执行清单

来源：[01 产品](01-product-and-economy.md) · [02 一日交接](02-grok-one-day-build-plan.md) · [03 图鉴](03-pet-codex-120.md)。分支 `feature/travel-devnet-demo`，起点 `e6ebc28`（main）。状态只写已核实的事实：✅ 完成 / 🟡 部分 / ❌ 未完成 / ⏸ 等 Wes。时间均为 UTC+8。

## P0 / P1 / P2（与 Astra 02 §1 一致）

| 级别 | 内容 | 状态 | 证据 / 备注 |
| --- | --- | --- | --- |
| P0 | 公开 HTTPS 英文主流程 | 🟡 部分 | 英文主流程本地完成（`tools/demo-up.sh local`）；公开 HTTPS 未完成：本盒出站 7844/22 被封，cloudflared/localhost.run/serveo 均不可用，需 Wes 提供主机或域名 |
| P0 | 原有三宠（moss/puddle/wisp）保持兼容 | ✅ | 基线测试全绿（见 H0–H2） |
| P0 | 一次免费、服务端权威、标注加速（45 s）的旅行 | ✅ | 服务端 CSPRNG + 补给账本；`npm test` 146/146；Godot travel 26/26 |
| P0 | 故事与收藏反馈（2 地点、8 纪念物） | ✅ | 明信片 + 纪念物；Album 优先显示；截图 `docs/evidence/ui-smoke/` |
| P0 | 真实 Solana Devnet 领取宠物 | 🟡 部分（10-10 03:30 仍 0 SOL；devnet-pow 所有水龙头余额为 0） | localnet 上浏览器内 claim 已确认（资产 `2bL2TGgg…BHvTA`）；Devnet 未部署：deployer 仍 0 SOL（airdrop 限流），`tools/devnet-deploy.ts --network devnet --execute` 已就绪 |
| P0 | 旅行结果摘要 checkpoint v2 存证 | ✅ localnet | 浏览器中钱包签名并确认（截图 37）；`chain/tests/deployed-stack-smoke.mjs` 4 PASS |
| P0 | 刷新及服务重启后恢复 | ✅ localnet | `chain/tests/restart-recovery-localnet.mjs` 4 PASS：旅行中 SIGKILL 重启，ready_at 不变；重启后揭晓；未签名旅程收据意图跨重启保留并确认（`chain/evidence/restart-recovery-localnet.json`） |
| P0 | 真实浏览器钱包演练（扩展钱包弹窗） | 🟡 部分 | 在无头 Chrome 中用 Wallet Standard 测试钱包走通（SIWS、claim、receipt）；真实 Phantom/Backpack 弹窗需 Wes |
| P0 | 可复核的交易与结果证据 | ✅ localnet | 公开证明 `jr_…` 经独立验证器 10 项检查；`chain/evidence/*.json` |
| P1 | 两钱包赠送 + 接收后继续养成（UI） | ✅ localnet | Wallet 页「Send as a gift」：prepareGift 本地构建、审阅显示网络/资产/接收者/费用、旅行中禁用；finalized 后同步归属。`chain/tests/gift-two-wallet-localnet.mjs` 6 PASS（A 不能再照顾，B 同步后继续照顾）。未在真实扩展钱包中演练 |
| P2 | 中文全量校对、120 剪影目录、商店预览、更多动作 | 🟡 部分 | 旅行/收据/赠送中文切换有测试；120 图鉴剪影浏览（按家族分页，未发行仅剪影）已完成；全量校对、商店预览、更多动作未做 |

## H0–H24 时间盒与止损点

| 墙钟 | 预算 | 门槛 | 状态 |
| --- | ---: | --- | --- |
| H0–H2 | 1h | 备份、分支、工具链、密钥公钥、Devnet 连通、确认存储上传渠道 | 🟡 见下表 |
| H2–H7 | 3h | 上传三角色图/元数据；部署程序、Core 集合、3 editions；真实浏览器 claim 一次 | 🟡 localnet 全部完成；Devnet 缺 SOL；元数据为本地 kubo 固定（开发用临时路径） |
| H7–H11 | 3h | 旅行表/迁移/接口/一次性结算；2 地点 8 纪念物；重启后可揭晓 | ✅ |
| H11–H14 | 2h | 旅行 manifest、checkpoint v2、证明接口、finalized 恢复；本地重算摘要 | ✅ localnet |
| H14–H17 | 2h | 英文主流程、像素旅行反馈、收藏结果 | ✅ |
| H17–H20 | 2h | 云端单实例 HTTPS、持久库、RPC/CSP、外部钱包与元数据访问 | 🟡 已做 PUBLIC_ORIGIN 白名单与服务端 RPC；HTTPS 隧道被封，未上线 |
| H20–H22 | 1h | 关键异常演练；有余量才接 P1 赠送 | 🟡 已演练未签名意图恢复与 finalize 等待；赠送 UI 未做 |
| H22–H24 | 2h | 录屏、交易与 manifest 核验、完成/未完成证据、发布说明 | ❌ |

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
| 程序地址 | 🟡 | 代码地址 `2R4P5J6r…3iQR` 的私钥不在本机，无法部署到该地址。已生成新程序密钥 `2SCKfWsz…Qm2nT`；切换需同步 `lib.rs declare_id!`、`Anchor.toml`、`chain/idl/pixel_pets.json`、`chain/idl/pixel_pets.ts`、`chain/INTERFACE.md`，再重新构建 |
| Devnet 公钥 | ✅ | deployer `294hmkx1…W9BU`、issuer `Cf6QfJVb…oTxX`、player-a `5wpnLLhK…jdow`、player-b `9WFW2Avm…GX1P`（私钥在 `runtime/devnet-keys/`，gitignored） |
| Devnet 连通 | ✅ | Helius devnet genesis `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG` |
| Devnet 资金 | ❌ | Helius 与公共 devnet airdrop 均限流，余额 0 |
| 部署成本估算 | — | `pixel_pets.so` 569,888 B → ProgramData 租金约 3.97 SOL（加缓冲区与手续费按 ≈4.2 SOL 备）；config/collection/3 editions/首批 claim < 0.1 SOL；两名玩家各 0.05 SOL。总计建议 **5 SOL** |
| 元数据通道 | 🟡 | 合约只认 `ipfs://` / `ar://`。可先在本机按内容计算 CID（不需账号，地址由内容决定），之后任何 pinning 服务上传相同字节即可让同一 URI 可取回；可用渠道见下 |

## 缺的依赖（需要 Wes）

1. **Devnet SOL ≈5 SOL** 打到 deployer `294hmkx17KS7ww6CzA6ZeDx2F3o7zybo8txRYRvhW9BU`（faucet.solana.com 用 GitHub 登录可领；或任意已有 devnet 余额的钱包转账）。
2. **元数据上传账户**（任选一）：Pinata 免费层 JWT / Filebase 免费层 S3 key / Storacha(web3.storage) 邮箱账户。上传后核对 CID 与本地计算一致。
3. **域名**（或接受临时 `trycloudflare.com` 演示地址）。
4. **Linux 主机 + 持久卷**，用于 HTTPS 单实例（Caddy + Node 24 + SQLite）。
5. **真实浏览器钱包**：在真机上安装 Phantom 或 Backpack，切到 Devnet，完成 claim + 保存旅程 + 刷新恢复的录屏（A06/A07/A10）。
6. **第二个钱包**（P1 赠送验收，可同一台机器另建账户）。
7. 确认是否允许用新程序地址 `2SCKfWsz…` 替换代码中的 `2R4P5J6r…`（原密钥不在本机）。
