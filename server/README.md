# PixelPets API

Node 24 原生 HTTP + SQLite 服务。所有成长由服务端时钟和持久化事件决定，角色为苔苔、啵啵、微光。免费领养与成长是链下功能；未连接链上部署时不会返回虚构资产或交易成功。

在 `PixelPets` 目录执行：

```powershell
node server/src/index.ts
node --test server/tests/*.test.ts
node node_modules/typescript/bin/tsc -p server/tsconfig.json
```

默认地址 `http://127.0.0.1:9782`。默认数据库 `PixelPets/runtime/pets.sqlite`，自动建立目录、WAL、外键、事务。生产环境应单实例部署并配置持久磁盘、备份和 HTTPS 同源代理；当前实现不是多节点 Postgres 架构，不应横向复制 SQLite 文件。不要将 `runtime` 目录公开提供下载。

基础环境：`PIXELPETS_DB`、`HOST`、`PORT`、`PUBLIC_ORIGIN`（默认 `http://127.0.0.1:9783`，用于签名域名与 Origin 检查）、`CHAIN_NETWORK`（`localnet`、`devnet` 或 `mainnet-beta`）。仅设置网络不会开启交易。部署配置不完整或未开启时，API 不读取任何签发密钥文件，也不会读取 Solana CLI 默认钱包。API 不接收玩家私钥或助记词；钱包签名证明和完整已签交易存入 SQLite，用于恢复同一笔请求，不写入日志。

## 业务行为

- 每位用户最多 3 位伙伴。领养和照顾必须提供 8–96 位字母数字、`_`、`-` 事件标识。
- 同一用户同一事件的相同请求重放返回原响应；更改内容或操作目标返回 409。唯一约束与事务防止并发重复应用。重放返回历史快照，客户端按 `revision` 避免倒退。
- 每只宠物所有照顾动作共用 12 秒冷却。冷却内返回成功包但 `event.applied:false` 和 `next_allowed_at`；该事件也被记忆，下一次实际动作应使用新事件标识。
- 每次有效动作增加 1 羁绊，6 次成长为阳光或月色形态，方向取决于陪伴选择；平票使用物种偏好。客户端修改时间和上传羁绊无效。
- `GET /journal` 只返回当前用户最近 100 条记录。宠物和事件持久保留。
- 请求体最多 32 KiB、只接收明确字段、默认单 IP 每分钟 180 个请求及 12 次游客创建，钱包挑战/验证每分钟 20 次。限流为单进程内存，生产代理须额外提供全局限流；不信任客户端 `X-Forwarded-For`。

## 钱包会话

原游客 Bearer 始终保留用于原有伙伴。钱包令牌单独保存，默认 24 小时过期，数据库只存 SHA-256 哈希。钱包会话可在多台设备同时存在，重新连接不会使另一台设备下线。

1. `POST /api/v1/wallet/challenge`，游客 Bearer，`{address}` → `{challenge_id,message,expires_at}`。
2. 钱包对返回 `message` 的完整 UTF-8 字节执行 `signMessage`。消息由受信 `PUBLIC_ORIGIN` 生成，包含地址、链、URI、随机 nonce、签发/过期时间和请求 ID，有效期 5 分钟。
3. `POST /api/v1/wallet/verify`，同游客 Bearer，`{challenge_id,signature}`（标准 Base64 编码的 64 字节 Ed25519 签名）→ `{token,user_id,wallet_address,network,expires_at}`。
4. `GET /api/v1/wallet/session` 使用钱包 Bearer。`DELETE` 同路径撤销当前钱包会话，保留游客身份和宠物。

验证使用 Node crypto 的真实 Ed25519 验签；绑定挑战限原游客、一次性、严格过期检查。钱包和用户为一对一绑定，已绑定其他游客返回 `409 WALLET_ALREADY_LINKED`，提示改用找回档案，不静默合并资产。换绑钱包尚未提供；未绑定过钱包且丢失游客令牌的档案仍无法恢复。

### 换设备找回档案

找回流程独立于绑定流程，以下两个接口无需 Bearer，也不使用调用者现有游客身份。只有已绑定的钱包完成签名后，服务端才查找其原档案；不会按客户端传入的用户 ID 找回，不移动或合并任何游客宠物。

1. `POST /api/v1/wallet/recovery/challenge`，`{address}` → `{challenge_id,message,expires_at}`。对于格式有效的地址，无论是否绑定过档案均返回相同结构，不泄露用户 ID 或绑定状态。
2. 钱包签署返回消息的完整 UTF-8 字节。消息明确说明找回既有档案，并包含 `urn:pixelpets:account-recovery` 用途、受信域名、URI、网络、随机 nonce、请求 ID 和 5 分钟有效期。
3. `POST /api/v1/wallet/recovery/verify`，`{challenge_id,signature}` → `{token,game_token,user_id,wallet_address,network,expires_at,game_expires_at}`。
4. `token` 是 24 小时的 `wallet` 会话，供钱包专属接口使用；`game_token` 是 30 天的 `player` 会话，用于原档案的宠物与日记接口，不能替代钱包令牌访问领取、成长登记或交易请求。两个令牌均仅保存哈希。
5. 客户端在找回成功后切换为返回的 `user_id` 和 `game_token`，保留原游客令牌以便用户返回原游客档案。取消、签名失败或验证失败不能覆盖本地游客会话。断开钱包仅撤销当前钱包令牌，养成会话以及其他设备不受影响。

挑战保存在独立 `wallet_recovery_challenges` 表，显式绑定用途、域名和网络；服务重启不会丢失挑战或恢复令牌，配置切换后旧部署的挑战失效。已通过真实 Ed25519 验签的证明只可消费一次，包括未绑定钱包的证明；签名错误不会揭示绑定情况。数据库迁移只增加新表并将旧版本升级到 2，保留原游客、宠物、日记、会话及高于 2 的版本号。

| 错误 | 含义 |
| --- | --- |
| `400 INVALID_INPUT / INVALID_ADDRESS / INVALID_CHALLENGE` | 字段、地址或请求 ID 无效；客户端不能附带目标用户 ID、域名或网络 |
| `401 INVALID_SIGNATURE` | 签名无效或消息被修改，未查询绑定状态 |
| `401 CHALLENGE_EXPIRED` | 挑战缺失、已使用、到期、用途不匹配，或服务域名/网络已经变化 |
| `404 WALLET_NOT_LINKED` | 钱包已完成有效签名，但从未绑定档案；不会创建账户，需先免费领养并绑定 |
| `403 ORIGIN_REJECTED` | 浏览器来源与受信 `PUBLIC_ORIGIN` 不一致 |
| `429 RATE_LIMITED` | 同一 IP 的恢复挑战与验证共用每窗口 20 次额度，默认每分钟；同时受全局请求限流 |

恢复专项 `server/tests/recovery.test.ts` 使用独立内存/临时 SQLite 与真实 Ed25519，覆盖同宠物与日记恢复、游客隔离、跨用途/域名/网络、签名伪造、到期/重放、未知钱包、不提升游戏令牌权限、多设备与局部撤销、并发单次消费、旧库迁移和重启。本机玩家数据库不参与测试。真实浏览器钱包签名与手机换设备操作仍需客户端端到端验收。

## 已实现验证与边界

截至 2026-10-08，本目录自动测试 **36/36 通过**：9 项养成和身份、13 项链服务、14 项市场读取与 HTTP 测试。覆盖身份隔离、同事件并发提交、成长和冷却、SQLite 重开、入参/体积/Origin/限流、真实钱包签名、防冒用和防重放。链服务覆盖共同签名、交易替换、进程重开恢复、最终交易与账户匹配、过期重试、旧尝试后来确认、跨实例租约接管及 RPC 请求头/正文超时。市场测试覆盖精确整数金额、原始手续费快照、链上时间、托管身份、交换目标、分页、HTTP 会话和故障处理。

这些单元/服务测试使用真实 SQLite、Ed25519、Anchor/Core 编码及受控 RPC 响应，没有执行 Solana 程序。真实本地链验收由根项目的 `chain/tests` 单独执行并记录结果。浏览器钱包扩展、主网、跨设备恢复和生产负载仍需验收。该服务当前提供只读市场报价，没有发起买卖、交换、转赠或 AI 的路由，未知路由明确失败。

## 只读市场报价

真实 RPC 连接随完整链配置创建市场读取器；`/chain/config` 另外返回 `market_enabled`。浏览报价需要游客或钱包 Bearer，不要求签署交易。

- `GET /api/v1/offers?limit=16&cursor=<上一页游标>`：每页核对最多 16 条，返回 `offers / scanned / rejected / next_cursor / has_more / slot / chain_time`。不要将当前页没有有效报价理解为整座市场为空。
- `GET /api/v1/offers/:asset/:nonce`：读取特定挂单，包括已过期但尚未撤销的挂单。
- 每条挂单包含托管宠物、交换目标、出让人、价格、到期链上秒数、是否可成交。所有金额、nonce、checkpoint 都是十进制字符串；展示用 `price_sol / fee_sol / seller_sol` 同样为精确字符串。
- 读取 finalized 数据，用一次批量快照核对挂单、资产、成长记录、官方集合和 Clock。会核对资产归 Offer PDA 托管、当前挂单与成长快照一致；后续平台费率变化不会改写原挂单费率。
- 失效或无法核对的条目进入 `rejected`；RPC 故障返回明确错误。当前使用完整目录扫描后有界分页，超过 10,000 条目录会要求索引服务，不宣称适合大规模市场。

## 链上领取与成长保存

以下配置必须同时具备，且链上部署、集合、签发方及三种物种版本均通过核验，`GET /api/v1/chain/config` 才返回 `enabled:true`：

| 环境变量 | 含义 |
| --- | --- |
| `CHAIN_ENABLED` | 明确为 `true` 才启用 |
| `CHAIN_PROGRAM_ID` | 本仓库 IDL 对应的程序地址 |
| `CHAIN_COLLECTION_ADDRESS` | 部署配置中的官方 Core 集合 |
| `CHAIN_RPC_URL` | 服务端查询与模拟所用 RPC |
| `CHAIN_PUBLIC_RPC_URL` | 浏览器钱包所用 RPC；仅 HTTPS 或本机 HTTP，不能含用户名、密码、查询参数或片段 |
| `CHAIN_ISSUER_KEYPAIR_PATH` | 明确的绝对路径，指向签发方的 64 字节 JSON 密钥数组；只用于对领取/成长指令联署 |
| `CHAIN_EDITIONS_JSON` | 如 `{"moss":"1","puddle":"2","wisp":"3"}`；整数用字符串保存 |
| `CHAIN_GENESIS_HASH` | 本地链必填，公共网络必须匹配所选网络的完整 genesis hash |

所有以下路由需要已验证的钱包 Bearer，会核对当前用户、宠物及请求归属：

| 路由 | 行为 |
| --- | --- |
| `POST /api/v1/pets/:id/claim-intent`，正文 `{}` | 使用服务端物种及版本准备领取交易；签发方和新资产已联署，玩家尚未签名 |
| `POST /api/v1/pets/:id/checkpoint-intent`，正文 `{}` | 使用服务端成长值准备保存交易；核对当前链上所有人及成长序号 |
| `GET /api/v1/chain/intents/:id` | 查询并尝试核对最终链上结果；同钱包可取回已保存的完整交易以恢复广播 |
| `POST /api/v1/chain/intents/:id/confirm` | 正文包含 `signature` 和 `transaction_base64`；先核对全部签名和原始交易消息，再持久保存，最后查询最终结果 |

服务端只准备、签署授权指令、模拟和查询，**不广播交易**。玩家签名前由浏览器检查交易与费用；玩家签署后先将完整证明保存到 API，再由浏览器广播。确认成功同时要求最终签名状态、原始交易消息、回执、官方 Core 资产所有权及对应成长数据一致。

领取的唯一标识绑定网络、完整 genesis hash、程序和宠物。请求过期不会立即换一个新资产：必须先确认旧区块哈希已失效，或原交易已失败。恢复时保留原请求及每次尝试，不将未知状态当成成功。

RPC 单次 HTTP 交换（含正文读取）最多 15 秒，429 不在连接内部重试。每只宠物使用进程内队列和 SQLite 租约串行处理；租约 120 秒、每 30 秒续期。每次持久写入在同一条 SQLite 语句中核对租约令牌和有效期，过期请求不能覆盖另一进程已经恢复的数据。这保证共用同一个数据库文件的请求互斥，仍不代表支持复制 SQLite 文件进行多节点部署。
