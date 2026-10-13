# Wes 验收清单（2026-10-10）

分支 `feature/travel-devnet-demo` · 草稿 PR：https://github.com/weswes233/PixelPets/pull/1  
产品长什么样：https://github.com/weswes233/PixelPets/blob/feature/travel-devnet-demo/docs/plan/PRODUCT-PREVIEW.md

---

## A) 批准程序 ID 变更

| 项 | 内容 |
| --- | --- |
| 新程序 ID | `2SCKfWszFZuqsjcmRbtmctHwZTgQopYmGSofoEtQm2nT` |
| Explorer | https://explorer.solana.com/address/2SCKfWszFZuqsjcmRbtmctHwZTgQopYmGSofoEtQm2nT?cluster=devnet |
| 原因 | 原声明地址 `2R4P5J6r…` 私钥不在本机构建盒；已用本机 `program-pixel_pets` 密钥部署到 Devnet |
| 通过标准 | 你口头/PR 评论同意该 ID 可作为当前 Devnet（及后续合并）程序地址；未同意前勿合并 main / 勿上主网 |

---

## B) Phantom：领取 + 旅行 + 凭证（Devnet）

1. Phantom 切到 **Devnet**，导入或使用自有钱包，保证有少量 Devnet SOL（≥0.05）。
2. 本机启动：`./tools/demo-up.sh local`（或 Windows **开始游玩.cmd**），打开 http://127.0.0.1:9783/
3. 连接钱包 → 领养一只宠物 → **Claim**（弹窗签名）。
4. 出发旅行 → 等待归来 → 揭晓 → 保存旅程凭证（旅程收据签名）。
5. 打开独立证明（若 UI 给出 `jr_…` 链接）或对照证据 JSON。

**建议打开的 Explorer：**

| 用途 | URL |
| --- | --- |
| 程序 | https://explorer.solana.com/address/2SCKfWszFZuqsjcmRbtmctHwZTgQopYmGSofoEtQm2nT?cluster=devnet |
| 集合 | https://explorer.solana.com/address/5BnUfTQ249v4v7sVAuohBEstsWF9JdzmaHwSbK7cuoiS?cluster=devnet |
| 脚本已跑通的 claim 示例 | https://explorer.solana.com/tx/5RX2AWhvE3g1iWQZ8XxusRZExdbew9VqhVG4ivMMS6NwaUgEmbTzdXj63Jtiz67SSMBMuPAz677shUHz77pu7NcT?cluster=devnet |
| 旅程收据示例 | https://explorer.solana.com/tx/2WtTemMxoS1jSFmQ6by5BE3jBmXNWdFsmezTEMqzuPS7qrPknbsCnu9WB5i2FTsjdvDcki8nbrANdGocYKZC5mix?cluster=devnet |

**通过标准：** Phantom 弹窗完成 claim；旅行揭晓后有链上旅程收据；刷新页面伙伴与明信片仍在。

---

## C) 第二钱包赠送（Devnet）

脚本双钱包已通过（player-a → player-b）。你可用两个 Phantom 账户复现：

| 项 | 链接 |
| --- | --- |
| Gift 交易（脚本） | https://explorer.solana.com/tx/5ZNrPvAMSG7GxoXTQMTZc7AnerHSG4Ca5p9eXoTZHE9wBFnqbVFYpUWxFB4NtT3g7PxdZApvRUGXsW9XqHEe9UW2?cluster=devnet |
| 被赠送资产 | https://explorer.solana.com/address/FNjCcimb9gSo2c7frYJDGq5NXVamVM8u2CHtgMzuJddm?cluster=devnet |
| 证据 | `chain/evidence/gift-two-wallet-devnet.json` |

**通过标准：** A 赠送后不能再照顾；B 同步后能继续照顾；Explorer 上 Transfer 成功。

---

## D) 元数据公开固定（可选，若你仍要 Pinata/Storacha）

已完成（无需你账号）：

- **Lighthouse**：7 个文件以**相同** CIDv1（`bafkrei…`）上传并请求 pin（见 `docs/evidence/lighthouse-pin-2026-10-10.json`）。链上 URI 未改（Core 不可变，原本就是这些 CID）。
- **Irys Devnet**：相同字节可经 `https://gateway.irys.xyz/<id>` 公开拉取（HTTP 200 + sha256 一致）。注意：Irys L1/devnet 的 id **不是** 本仓库 `ar://` 校验接受的格式，**不能**直接当链上 `ar://` URI。

公开 IPFS 网关（ipfs.io / dweb.link）对 curl 目前返回 bot/Service-Worker 挑战；钱包自带网关可能仍可解析。若你希望 Pinata/Filebase 仪表盘可见：

1. 注册 Pinata 免费层 → 创建 JWT  
2. 或 Filebase 免费桶 → S3/Pinning token  
3. 把 JWT/token 交给执行者（或你本机）对 `deploy/metadata/` 再 pin 一次（CID 应不变）

**通过标准：** 浏览器打开任一公共网关 URL 能看到 JSON/PNG；或 Pinata 控制台显示 7 个 CID。

---

## E) 公网 HTTPS（仍需你）

本盒出站 7844/22 被封，cloudflared / localhost.run / serveo 不可用。Wrangler Cloudflare 登录需你的账号。GitHub Pages 未启用。

**可选路径：**

1. 给你一台有公网 IP/域名的 Linux 主机 + 持久卷 → 跑 `tools/demo-up.sh` 同类栈（Caddy + Node 24 + SQLite）。  
2. 或登录 Cloudflare → `wrangler login` 后部署 Workers/Pages（静态 Godot 可上 Pages，**API 仍要单独主机**；不要假装全栈已通）。  
3. 仅看产品外观：打开 PRODUCT-PREVIEW.md 截图即可（无需 HTTPS）。

**通过标准：** 你能用手机/另一网络打开一个 `https://…` 演示 URL 完成英文主流程（或明确接受「仅静态预览 + 本机 API」拆分）。

## F) Phantom P0 on public demo (bot QA, 2026-10-10)

Real Phantom extension on https://175.178.27.231/ with test wallet player-a:
claim + journey receipt **PASS**. Evidence: `docs/evidence/phantom-p0-2026-10-10/`.
