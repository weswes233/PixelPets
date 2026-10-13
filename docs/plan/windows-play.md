# Windows 本机游玩（travel / Devnet）

更新时间：2026-10-10（Asia/Shanghai）

## 打开地址

在浏览器打开：**http://127.0.0.1:9783/**

这是 travel 分支的 `dist/web`（含旅行 UI / bridge），经本机静态服务 + API 反代。

## 启动方式

在仓库根目录 `D:\05_AI\Codex\Web3\PixelPets`：

```powershell
powershell -ExecutionPolicy Bypass -File tools\start-devnet.ps1
# 或自动打开浏览器：
powershell -ExecutionPolicy Bypass -File tools\start-devnet.ps1 -OpenBrowser
```

停止：

```powershell
powershell -ExecutionPolicy Bypass -File tools\stop.ps1
```

`start.ps1` **不会**加载 `CHAIN_*` 环境变量；日常 Devnet 请用 `start-devnet.ps1`。

## 当前已验证

| 检查项 | 状态 |
|--------|------|
| `GET http://127.0.0.1:9783/` | travel 静态页（`dist/web`） |
| `GET /api/v1/live`（经 9783） | ok |
| `GET /api/v1/health`（经 9783） | ok（依赖链配置探测） |
| `GET /api/v1/chain/config` | `enabled:true`（服务器走 Helius Devnet） |
| `GET /api/v1/travel/catalog` | 旅行目录可用 |

## 网络说明（重要）

- 本机解析 `api.devnet.solana.com` 常被劫持到 Facebook 段 IP，TCP 超时；**不要**依赖官方 Devnet RPC。
- 服务器侧 `CHAIN_RPC_URL` 使用 `runtime/helius.local.env` 中的 Helius Devnet（带 api-key，仅服务端）。
- 浏览器侧 `CHAIN_PUBLIC_RPC_URL` 使用 `https://mango.devnet.rpcpool.com`（无密钥）。curl/浏览器可用；Node 默认 UA 会被该端点 403，因此服务端不走 mango。
- 反代：`SERVE_FORWARD_CLIENT_IP=1` + API `TRUSTED_PROXY_IPS=127.0.0.1`，避免 `INVALID_CLIENT_IP`。

## 程序与配置

- Program：`2SCKfWszFZuqsjcmRbtmctHwZTgQopYmGSofoEtQm2nT`（Devnet）
- Genesis：`EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`
- 发行密钥：`runtime/devnet-keys/issuer.json`（勿提交、勿打印）

## 剩余注意

- Windows 上 GitHub TCP 443 常失败；从 box 同步文件请落到 `C:\Users\Wes\Downloads\` 再拷进仓库。
- 若 Helius key 失效，`chain/config` 会回到 `enabled:false` / `RPC_UNAVAILABLE`；旅行养成 API 仍可玩，链上登记会停。
- 未切换 git 到 `feature/travel-devnet-demo` 时，以已覆盖的 `server/src` + `dist/web` 为准。
