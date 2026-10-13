# PixelPets：交给 Grok 的一天研发计划

日期：2026-10-09。文件性质：可执行任务说明，**本次仅写规划，未实施下述功能**。

产品决策见[主策划](01-product-and-economy.md)，角色目录见[120 宠图鉴](03-pet-codex-120.md)。工作目录 `D:\05_AI\Codex\Web3\PixelPets`，仓库 [weswes233/PixelPets](https://github.com/weswes233/PixelPets)，规划时基线 `e6ebc2822dd3ea1754b44021fb434ca9a1844f85`。后续执行先检查最新分支与用户未提交修改，不要把这份基线视为强制回退目标。

## 1. 交付合同：一天究竟验收什么

**P0 必须完成：**公开 HTTPS 的英文主流程；原有三宠；一次免费、服务端权威、标注加速的旅行；故事和收藏反馈；真实 Solana Devnet 领取宠物；把本次旅行结果摘要通过 checkpoint 存证；刷新及重启后恢复；真实浏览器钱包演练；可复核的交易与结果证据。

**P1 优先追加：**两钱包赠送与接收后继续养成。这是最有价值的扩展，预计额外 2–4 小时有效工作，利用现有 SDK 与归属服务可尝试，但不能为赶它牺牲 P0 的确认、恢复和公开访问。若未完成，演示与 README 必须写“转移合约/SDK 已有，游戏赠送 UI 本轮未完成”。

**P2 才考虑：**中文全量校对、120 目录剪影浏览、商店预览、更多动作。完整固定价购买/交换界面另排，不在本日同时承诺。

本日不做：主网、真钱、项目 token、流动池、付费抽奖、VRF 金库、120 套美术、繁殖、硬件、AI API、多人实时游戏。所有 Devnet 数据不承诺兑换或迁移为主网奖励。

成功标准不是改了多少文件。陌生海外玩家应在网页中体验出游，持有人应能在 Devnet 查询实际资产和匹配的旅行证明。无法公共部署时可以提交部分完成证据，但 **P0 仍未通过**，不得用“准备就绪”替代“已上线”。

## 2. 已有基础与不能误判的地方

| 模块 | 权威文件/符号 | 当前状态 | 本日处理 |
| --- | --- | --- | --- |
| 角色与形态 | `server/src/domain.ts` 的 `catalog/Pet`；`game/scripts/main.gd` | moss/puddle/wisp，seed/sun/moon | 保持 ID 与枚举含义 |
| 像素画 | `game/scripts/pet_art.gd` | 三宠代码分支绘制 | 复用，只补出发/归来反馈 |
| 卡册 | `main.gd` 卡册构建 | 当前只显示 sun/moon 共 6 格 | 需要时扩成 9 状态；新纪念物册与宠物册分开 |
| 照顾 | `server/src/repository.ts` 的 `care()` | explore 是即时照顾动作，不是离线旅行 | 保留兼容；新增旅行入口，不能两个入口重复派奖 |
| 个体性格 | `domain.ts` 的 `favorite/traits` | 是偏好与成长计数，不是独立性格模型 | 新增向后兼容的离散 temperament，旧宠补默认值 |
| 链发行 | `chain/programs/pixel-pets/src/lib.rs`；`chain/INTERFACE.md` | species 0..2，发行上限、共签领取、防重回执 | 复用三种 edition，不扩大协议 |
| checkpoint | `server/src/chain-service.ts` 的 `newIntent()` | v1 摘要没有旅行结果 | 新增 v2 摘要及不可变 source，兼容旧 pending intent |
| 链交易 | `chain-client/src/index.ts` 的 `prepareGift()` 等 | Gift、swap、sale、buy 基础存在；市场付 SOL | P1 接 gift；不把 SOL 交易改字样叫 USDT |
| Web 钱包 | `wallet-web/src/bridge.ts/controller.ts/transactions.ts` | 领取、成长、恢复与只读市场；未全面验收扩展钱包 | 实际桌面浏览器钱包优先；Windows 原生钱包后置 |
| 归属 | `server/src/ownership-service.ts` | 本服务登记资产，全库扫描上限 128 | 小型 Demo 限额；不宣称可承载大规模 120 宠市场 |
| 存档 | `server/src/repository.ts`，SQLite user_version=2 | 既有用户、宠物、事件、意图、归属 | 新表 additive migration，备份再迁移 |
| 云发布 | `deploy/`、`docs/deployment.md` | 单实例 Node 24/SQLite/Caddy 模板，尚未外部实机验收 | 本日真实部署并外网检查 |
| 元数据 | `chain-client/src/metadata-uri.ts` | 只接受有效 ipfs:// 或 ar:// 格式，仅语法校验 | 真实上传图片与 JSON，外部检索核验 |

原有验证记录在 `docs/implementation_status.md` 和 `docs/acceptance-2026-10-09.json`。此前有 JS/Godot/本地链通过记录，但本轮新增代码需要重跑相关检查；脚本钱包测试不等于真实扩展钱包弹窗已通过。

## 3. 开工前的门槛

1. 检查 `git status`，保留用户未提交修改；创建工作分支，例如 `feature/travel-devnet-demo`。记录起始 commit。
2. 阅读 `docs/deployment.md`、`docs/ownership.md`、`docs/integration.md`、`chain/INTERFACE.md`、`server/README.md`。当前源码优先于规划中的猜测。
3. 使用 Node 24.x、Godot 4.5.2 与匹配导出模板；Anchor 依照仓库 0.32.1 和锁文件。不要为了“最新版”顺手升级全仓依赖。
4. 用现有 `tools/backup.ts` 的实际 CLI 帮助备份本机数据库，验证备份可读。另建 Demo 数据库，不把当前私人存档打包到公网。
5. 准备 Devnet 部署者、issuer、两个测试玩家钱包；密钥只在受控 secret 文件/钱包中，仓库记录公钥。资金只用 Devnet 测试 SOL。
6. 准备域名、Linux 主机与持久卷、可用 RPC、IPFS/Arweave 上传渠道。前端公开 RPC 不能含私密 token 或 query；私密 RPC 只放服务端。
7. 真实 metadata 与程序部署可能是最长等待项，先启动准备；不存在的部署脚本需要编写和验收，不能假设 `npm run deploy` 已经有。

部署 keypair 文件在原机器的 `chain/target/deploy` 中存在并不等于 Grok 已持有有效密钥。用公钥推导确认控制权；不要输出完整 keypair。若需要新程序地址，必须同步 `declare_id!`、`Anchor.toml`、IDL JSON/TS、客户端和前端构建；只换环境变量会被 SDK 的 IDL 地址校验拒绝。

## 4. 24 小时时间盒与减法规则

下面是单人＋Grok 的激进估算：约 **16 小时有效工作＋8 小时等待、休息与缓冲**，不是 24 小时持续编码，也不是保证。前提是现有代码可构建且外部账户可用。

| 墙钟时间 | 有效工作预算 | 工作与完成门槛 |
| --- | ---: | --- |
| H0–H2 | 1h | 备份、分支、工具链、密钥公钥与 Devnet 连通；确认真实存储上传渠道 |
| H2–H7 | 3h | 上传三角色图片/元数据；部署并验证程序、Core 集合、3 editions；真实浏览器 claim 一次 |
| H7–H11 | 3h | 旅行表/迁移/接口/一次性结算；2 地点、8 纪念物记录；服务重启后能揭晓 |
| H11–H14 | 2h | 旅行 manifest、checkpoint v2、可查证明与 finalized 恢复；本地自动校验摘要 |
| H14–H17 | 2h | 英文主流程、像素旅行反馈、收藏结果；有余量再做中文切换 |
| H17–H20 | 2h | 云端单实例 HTTPS、持久库、RPC/CSP、外部钱包和元数据访问 |
| H20–H22 | 1h | 最关键异常演练与修复；有预算才接 P1 赠送，不临时引入市场 |
| H22–H24 | 2h | 完整录屏、验证交易与 manifest、整理已完成/未完成证据、发布说明 |

缓冲不是预售给额外功能的时间。赠送若接入需从仍有余量的时段取预算，优先削减装饰、剪影目录和第二目的地，不删错误处理。

**止损点：**H7 仍无法完成真实 Devnet claim，暂停新玩法扩张，集中排除部署/钱包问题；H14 仍无法从 manifest 重算链上摘要，只保留一条旅行与一个结果模板；H20 仍无 HTTPS，冻结功能并解决公开访问。外部依赖确实拿不到时输出明确部分结果和下一步，不伪装成功。

## 5. T1：旅行数据模型与状态机

新增表为建议结构，字段名可按仓库习惯调整，语义不能丢失：

```text
trips
  id, public_receipt_id, user_id, pet_id, starting_wallet?, starting_asset?
  starting_ownership_version?, route_id, supplies_cost
  rules_version, loot_table_hash, content_version, temperament_snapshot
  started_at_ms, ready_at_ms, settled_at_ms?
  state: travelling | revealed | cancelled
  result_json?, canonical_result_bytes?, result_hash?
  start_event_id UNIQUE, reveal_event_id?, cancel_reason?

collection_discoveries
  user_id, collectible_id, discovered_at, quantity, source_trip_id
  UNIQUE(user_id, source_trip_id, collectible_id)

trip_checkpoint_receipts
  trip_id, chain_intent_id UNIQUE, schema_version
  canonical_checkpoint_bytes, checkpoint_hash
  network_genesis, program_id, asset_address, expected_checkpoint
  signature?, finalized_slot?, status

supplies_ledger
  user_id, event_id UNIQUE, delta, reason, trip_id?, utc_day
```

`travelling → revealed` 或 `travelling → cancelled`，两个终态不可再抽。链保存状态是独立 receipt 的 `not_saved/pending/confirmed/failed`，不重置旅行终态。用数据库事务和唯一约束实现“扣补给、创建出发、发放奖励、图鉴写入”各自的原子性；不能只依赖前端禁用按钮。

建议 API（**待新增，不是当前已存在接口**）：

```text
POST /api/v1/pets/:id/trips
  { event_id, route_id, packing_id }
GET  /api/v1/pets/:id/trips/current
POST /api/v1/trips/:id/reveal
  { event_id }
GET  /api/v1/collections
GET  /api/v1/trips/:public_receipt_id/proof
```

私有读写沿用当前会话鉴权；公开 proof 仅在持有人选择链上存证后开放，使用随机不可枚举 ID，内容不得包含登录信息、私人日记、真实姓名或钱包外的关联身份。公开链数据不能被承诺为可彻底删除。

接口应返回服务器时间、ready_at、状态与结果版本。客户端只展示倒计时，不决定结束、不提交奖励类型或中奖数量。重复 `event_id` 且内容一致返回原结果；相同 ID 改参数报冲突；并发两次 reveal 只能增加一次收藏。

一天规则：3 份初始免费补给；每天 UTC 补到 3、余额不因日期切换重复增发；每趟 1 份；单宠一个 active trip；演示用 45 秒。对自然日切换、余额上限、并发出发做测试。未来奖励含可卖资产时，游客限制和钱包签名本身不构成反女巫，必须另做资格与供应设计。

**归属中途变化的明确处理：**游戏内赠送按钮在 travelling 时禁用。链外仍可转移，因此每次揭晓前按已有归属规则校验。若已转手或托管，将未揭晓旅行原子取消，给发起用户退回一次无价补给，不发新奖励、不写成长；已经揭晓的私人记录仍归发起用户，但旧主人不能再为该宠 checkpoint。新主人须先同步归属再出发。不能靠一个前端锁声称资产在整个网络不可转移。

## 6. T2：随机结果与旅行证明

### 6.1 一天随机方案

使用服务端 CSPRNG，并以拒绝采样或运行时无偏整数 API 映射权重；不用 `Math.random`、时间戳、客户端种子、可操纵的交易时间当随机保障。结果只在成功事务中生成并落库一次；重试返回已落库结果。配置表必须版本化并哈希，已出发的旅行使用出发时版本，不受后来改表影响。

CSPRNG 不意味着玩家可以验证运营方没挑结果。英文详情必须明确：`Rewards are drawn by the server. The result is recorded on Solana.` 普通界面可简写 `Journey receipt`，不能写 `Provably fair` 或 `Fully on-chain gameplay`。

结果只发无可兑换保证的游戏内收藏记录和基础进度。8 张纪念物不是 8 个 NFT editions；宠物之外的新资产类型延期。

### 6.2 双层摘要，兼容“先玩再领链资产”

玩家可以先旅行后领取 NFT，所以旅行结果摘要不能依赖尚不存在的资产地址。采用两个独立且版本化的承诺，以下是固定顺序数组的建议格式：

```text
R = ["pixel-pets:trip-result:v1", public_receipt_id,
     route_id, packing_id, rules_version, loot_table_hash, content_version,
     temperament_snapshot, started_at_ms, ready_at_ms, settled_at_ms,
     event_code, [[collectible_id, quantity], ...]]

result_hash = SHA256(UTF8(canonical_json(R)))

C = ["pixel-pets:checkpoint:v2", network_genesis, program_id, asset_address,
     chain_intent_id, expected_checkpoint, pet_revision,
     form, bond, care_count, traits_sun, traits_moon,
     public_receipt_id, result_hash]

event_hash = SHA256(UTF8(canonical_json(C)))
```

规定 UTF-8、无额外空白、整数类型与范围、固定数组顺序、嵌套奖励按 ID 排序且同类合并；涉及 u64 的数值以十进制字符串表示，避免 JS 精度丢失。公开事件使用枚举代码，昵称和自然语言私密文本不进入哈希；英文/中文展示从事件代码渲染，不应因翻译改变证据。

把实际 canonical bytes 持久化并可导出，不只保存解析后的对象。验收用独立脚本重算 R 和 C，比较链上当前 `PetRecord.event_hash` 与交易证据。当前账户只保存最新摘要，之后 checkpoint 会覆盖，因此每次 receipt 与签名必须长期保留；不能声称只查询当前账户就能看到全部过去旅行。

### 6.3 对现有链服务的修改

- `ChainService.newIntent()` 的旧 v1 source 保持可读；新 v2 source 在创建时冻结，版本字段必须明确。
- issuer 只从服务器自己的结果、当前归属和成长快照构造 C；不接受玩家任意传入的 hash 直接签名。
- 保留现有模拟、费用提示、签名事务保存、finalized 确认和不确定结果恢复机制；不得用新的便捷分支绕过。
- 同一 trip 的同一次 checkpoint 恢复必须指向原 intent/签名。已确认不再请求钱包重复签；失败或过期是否新建 attempt 按原安全策略执行。
- 无需改变本日合约账户布局。合约允许 form/bond 不变的 checkpoint，但序号、非零/不同摘要、当前 owner+issuer 和不可挂牌约束仍要满足。
- 后续普通成长 checkpoint 可以继续使用版本化 source；UI 应明确“最近成长记录”和“某趟旅行记录”的区别。

## 7. T3：Devnet 与公共部署

必须显式使用 `devnet` 并核对完整 genesis，不能只相信 RPC URL 名称。规划时程序地址为 `2R4P5J6rwE1F2R8fRRF1dvqV9JxwSTix4Qf6FGhc3iQR`，它是代码配置地址，**不是已部署证明**。

部署顺序：

1. 锁定源码/IDL/SBF 产物与 program 公钥，核对 upgrade authority；记录产物 SHA-256。
2. 将三角色基础图片与 JSON 实际上传到内容寻址存储。至少从外部设备或不同网关检索，检查 MIME、非空、图片与 JSON 的引用匹配；固定 edition 后不可简单改 URI。
3. 在 Devnet 部署程序，查询 executable 与 owner，初始化 config 和 Core collection，再创建三个 edition。演示发行上限可设每种 20 个，总 60 个，保持在当前索引边界内；这只是可销毁的测试环境额度，不是正式稀缺性承诺。
4. 保存程序、集合、edition、issuer、公钥权限、genesis、交易签名与元数据哈希到部署 manifest。只记录公钥与引用，不记录密钥。
5. 按 `server/README.md` 配置 `CHAIN_ENABLED`、`CHAIN_NETWORK`、`CHAIN_PROGRAM_ID`、`CHAIN_COLLECTION_ADDRESS`、`CHAIN_RPC_URL`、`CHAIN_PUBLIC_RPC_URL`、`CHAIN_ISSUER_KEYPAIR_PATH`、`CHAIN_EDITIONS_JSON`、`CHAIN_GENESIS_HASH`。环境变量齐全不代表链已成功。
6. 独立 Demo SQLite 使用持久磁盘，单 API 实例；同域 HTTPS 提供网页和 `/api`。签名域与 `PUBLIC_ORIGIN` 必须匹配，前端 CSP 允许选定公开 RPC。按现有部署文档限定可信代理，不能开放后端端口后信任任意转发头。
7. 用外部网络、真实浏览器扩展钱包 A 完成领取和 checkpoint，再刷新。记录 Explorer 的 `?cluster=devnet` 地址及实际签名。

本日继续采用不可变 NFT 基础图；成长在应用与 PetRecord 中显示。不要试图为动态图像临时移除插件：现有交易解析有插件白名单，修改会带来资产兼容和权限风险。

现有构建命令确实存在，执行前核对最新文件：

```powershell
npm ci
npm test
npm run typecheck:server
npm run typecheck:sdk
npm run typecheck:wallet
powershell -ExecutionPolicy Bypass -File tools/build.ps1 -Target Web -ValidateOnly
powershell -ExecutionPolicy Bypass -File tools/build.ps1 -Target Web
```

`npm run build:web` 仅打包钱包桥，不能代替完整 Godot Web 导出。完整 Docker/Caddy 配置和命令复用 `docs/deployment.md`；规划没有替 Grok 运行云端命令。主网不在本任务范围。

## 8. T4：Godot 体验与英文界面

主流程只需要 Home、Pack & Travel、Return、Collection、Wallet 五个区域，可以在现有页面上扩展，不重构完整导航系统。先把新增 UI 拆小组件，避免继续把所有逻辑堆进 `main.gd`。

| 中文含义 | 英文主文案 | 触发条件 |
| --- | --- | --- |
| 免费领养 | Adopt a companion | 游客也可进入 |
| 出发 | Pack & go | 补给足够、无 active trip |
| 演示加速 | Demo trip · 45 seconds | 所有短旅持续显示 |
| 归来 | Your companion is back | 服务器 ready，不依赖本机时间 |
| 揭晓 | Open the postcard | 服务端结果一次结算 |
| 链上登记 | Claim on Devnet | 实际钱包签名，费用先展示 |
| 保存旅程 | Save journey receipt | 对应 trip 可存证，当前归属有效 |
| 确认中 | Submitted · checking confirmation | 已广播但未 finalized |
| 已确认 | Confirmed on Solana Devnet | 真正 finalized 且读回匹配 |
| 未开放 | Coming later | 设计目录内容，不可领取 |
| 可选赠送 | Send as a gift | P1 完成后才启用 |

像素要求：32×32/整数缩放/最近邻过滤、最多 8–12 主色；动作可用轻微弹跳、朝向变化、行囊闪动、归来展开；不要用模糊缩放或连续渐变破坏像素观感。英文文本和错误信息同样要可读，不能只翻译按钮。

游客凭据、钱包恢复和当前选中宠物的隔离继续沿用现有规则。换钱包时清掉旧页面和待处理操作，旧请求不得写回新账户画面。不会因为连接钱包就静默合并两个游客档案。

## 9. T5：P1 赠送的安全完成条件

用已有 `prepareGift()` 和官方 Core transfer 方式；不新造服务器代管玩家私钥。UI 显示网络、资产、接收公钥、费用，用户明确确认后才弹钱包。

A 发出 → finalized 读回 B 持有 → A 不能再照顾 → B 使用本服务同步/恢复 → B 看见同一链资产和可继承的公开形态 → B 可以继续照顾。私人日记、账户令牌、A 的其他宠物均不得复制。

转出后 UI 不得靠本地删除就当成功；RPC 不确定时保持待核对。对不存在钱包、取消签名、切换账户、重复点击、外部提前转移做异常处理。最小演示仅支持本服务登记的资产并明确说明范围。

若本日不接 gift，不在演示页留“点了就成功”的按钮。后续固定价 SOL 购买是独立任务：价格整数、费率快照、账户归属、模拟、签名、原子结算、失败回滚都要沿用现有协议。

## 10. 验收矩阵与证据文件

新增测试应该覆盖业务风险，不写只验证常量等于自身的测试。当前方案是状态与链交互变更，需要有意义的自动化与真实操作验证。

| 编号 | 操作 | 必须结果 | 证据 |
| --- | --- | --- | --- |
| A01 | 两个并发出发、同 ID 重试 | 只扣一次补给、只一趟 active trip | 数据库与 API 测试 |
| A02 | 改本机时间、提前揭晓 | 服务器拒绝提前结算 | API 测试 |
| A03 | 归来后刷新/服务重启/多次 reveal | 同一结果、只增加一次收藏 | 持久库与重启测试 |
| A04 | 旅行中换主人 | 原旅行取消且只退一次补给；旧主不能改宠 | 归属联动测试 |
| A05 | 旧库升级、旧 v1 pending intent 恢复 | 原宠物、日记、签名恢复路径均保留 | 迁移/兼容测试 |
| A06 | 钱包拒签或断网 | 不显示领取/保存成功，不重抽奖励 | 真浏览器录屏＋日志 |
| A07 | Devnet claim | Core 资产、collection、PetRecord、receipt、owner 全匹配 | 公钥、签名、finalized slot |
| A08 | 旅行 checkpoint | 独立重算 R/C 与该交易中的摘要一致 | canonical bytes、hash、签名 |
| A09 | 再做一次 checkpoint | 当前摘要更新，旧证明仍能通过旧交易核验 | 两条 receipt 与签名 |
| A10 | 云服务重启、外部设备恢复钱包 | 同档案与结果存在，SQLite 未重置 | 外部录屏与恢复记录 |
| A11 | 英文新用户走第一趟 | 无中文关键错误、未开放内容明确标注 | 人工体验记录 |
| A12/P1 | A 赠送 B 后 B 继续养成 | 新主可以照顾、旧主不可以、私人信息不转移 | 双钱包链交易与接口结果 |

交付建议新增 `docs/evidence/devnet-demo-<date>.json`，字段包括：commit、构建/SBF 摘要、网页 URL、网络/genesis、program、collection、editions、公开 metadata URI、钱包公钥别名、claim/checkpoint/gift 签名及 slot、trip receipt ID/hash、每项验收结果、未完成项。实际证据文件不能预填虚构地址或“passed”。私钥、session token、服务器 RPC 密钥、私人日记不进入证据。

运行与改动相关的已有单元、类型、Godot 和本地链检查。最后只有读回 finalized 状态匹配才能出现在 README 的“已部署”区域。保存失败日志但过滤秘密；不要把测试通过数当作产品付费证据。

## 11. 开源代码参考：复用模块，不找一个万能项目换皮

截至规划检查，没有找到已经核验许可、同时覆盖 Godot 像素养宠、Solana Core、离线旅行、孵蛋与繁殖的完整工程可直接交付。以下按用途拆开使用；执行时固定 commit 与依赖，保留 LICENSE/NOTICE，素材逐项核授权。

| 资源 | 用途 | 许可和适配边界 |
| --- | --- | --- |
| [Godot 官方 demos](https://github.com/godotengine/godot-demo-projects) | Tween、2D 动画与 UI 结构 | [MIT](https://raw.githubusercontent.com/godotengine/godot-demo-projects/master/LICENSE.md)；选匹配 4.5 的版本，逐素材检查 |
| [Solana Foundation program-examples](https://github.com/solana-foundation/program-examples) | Token、escrow、权重与状态机参考 | [MIT](https://raw.githubusercontent.com/solana-foundation/program-examples/main/LICENSE)；gacha 用 Pinocchio/Codama/Token-2022，不可直接塞入现有 Anchor/Core |
| [Lumberjack 游戏示例](https://github.com/solana-developers/solana-game-examples/tree/main/lumberjack) | 基于时间戳的能量恢复、懒结算 | 仓库 README 声明 MIT，本次未找到统一根许可证；逐目录核对并保存声明，旧工具链不照抄 |
| [Metaplex Umi](https://github.com/metaplex-foundation/umi) | 独立上传/管理工具参考 | [MIT](https://raw.githubusercontent.com/metaplex-foundation/umi/main/LICENSE)；本日不为它重写已可用客户端 |
| [Metaplex Core](https://github.com/metaplex-foundation/mpl-core) | 继续使用现有唯一资产标准与 SDK | [Metaplex NFT Open Source License](https://raw.githubusercontent.com/metaplex-foundation/mpl-core/main/LICENSE)，不是 MIT；调用既有协议与 fork 协议不同 |
| [ORAO Solana VRF](https://github.com/orao-network/solana-vrf) | 后续随机请求、回调和 SDK | [Apache-2.0](https://github.com/orao-network/solana-vrf/blob/master/LICENSE)；本轮未联调，不保证一天可集成 |
| [Switchboard 随机教程](https://docs.switchboard.xyz/docs-by-chain/solana-svm/randomness/randomness-tutorial)与[官方示例](https://github.com/switchboard-xyz/sb-on-demand-examples) | 学习 commit/reveal、请求关联与时效 | 本轮未确认示例明确许可证；仅读流程，复制前补查，不能视为可直接上线金库 |

特别说明：官方 [gacha 说明](https://raw.githubusercontent.com/solana-foundation/program-examples/main/games/gacha/pinocchio/README.md) 的 cc-vrf 模式采用 operator 签名、链上记录、链下验证，不能写成“链上阻止一切作弊”。Switchboard 示例也不是本项目已经审计的一次性赔付/偿付模板。真钱结算还要自建消费状态、退款、负债和储备检查。

未来 VRF 原型可单独估 2–5 个有效开发日，业务异常、超时、转移、一次性结算再估 1–2 周验证；这是工程估算，不含审计和法律周期。

## 12. 后续任务，不混进一天

| 任务 | 关键工作 | 开始前条件 |
| --- | --- | --- |
| 120 角色数据化 | catalog schema、独立剪影/动作、绘制器、双语数据、发现史 | 三宠旅行体验得到反馈 |
| 协议 species registry | 移除各层硬编码 <=2；验证允许列表/edition；兼容旧账号与 ID | 完整迁移方案、旧数据回归 |
| 新形态与外部展示 | 保留旧 0/1/2 含义；新 variant 或新版本，审查元数据/插件/市场兼容 | 不可变旧资产的展示策略确定 |
| 资产同步扩容 | wallet 索引、分页、外部导入/归属核对 | 超过当前 registered_here/128 的用户规模前 |
| SPL 稳定币市场 | quote mint 白名单、Token Program、ATA、decimals、transfer_checked、整型价格、原子结算 | 已有明确购买需求与地区支付方案 |
| 孵蛋与关系 | 发行资格、父母授权、一次性孵化、上限与冷却、转手处理 | 内容需求和供给模型明确 |
| AI 日记 | 结构化事实→受限文本、缓存、超时回退、成本上限 | 模板体验稳定 |
| 真钱随机旅行 | 独立资金池、可验证随机、负债、退款、安全审查、地区准入 | 不与本日代码混合试运行 |

`u8` 可以容纳 120 个物种编号，但现在多处校验只接受 0..2，不能把范围放到 255 就结束；应该有有效物种注册/发行规则。先保持已有编号，所有新增编号不可复用旧含义。

## 13. 可以直接发给 Grok 的任务文本

> 请基于 PixelPets 仓库执行一日 Devnet 演示迭代。先阅读本目录的 01、02、03 三份规划，以及仓库当前实现、部署、归属与链接口文档。先核对最新 Git 状态和依赖，保护现有用户数据，不回退用户修改。
>
> 只实施本文的 P0，优先真实 Devnet 领取与旅行 checkpoint，再做免费短旅行、英文主流程和公网 HTTPS。3 种现有宠物保持兼容；旅行结果由服务端一次结算，使用版本化 manifest 和 checkpoint v2 存证，不宣称公平随机或全链游戏。公开演示不接真实充值、不发行可交易 token、不承诺测试资产迁移。角色美术继续使用代码绘制的像素风。
>
> 使用有效数据迁移、服务器时间、幂等与持久化；旧 v1 pending intent 必须可恢复。持有人转移期间的旅行按本文规则取消/退无价补给，旧主人不能继续写成长。密钥只在受控服务端或钱包，不进入前端、仓库、日志、镜像或交付文档。
>
> 有余量时，优先完成两钱包 gift UI 与接收后照顾，再考虑剪影目录和商店预览。不要同时新增 USDT 市场、孵蛋繁殖、AI 或硬件。遇到地址变化，联动 program、IDL、SDK 和前端，不只改环境变量。
>
> 每阶段给出实际完成证据与剩余风险，运行有意义的相关测试。最终交付可访问 URL、真实 Devnet 公钥与交易、旅行证明字节/哈希、源码 commit、构建摘要、录屏、已完成/未完成清单及复现步骤。账户或网络阻塞则交付部分结果并准确标注，不能用本地测试或模拟界面冒充公开上线。

## 14. 提交给评委的描述边界

英文建议描述：*PixelPets is a cozy pixel companion game. You prepare a short trip, collect a postcard, and keep a verifiable journey receipt on Solana. Pet ownership is transferable; gameplay and reward generation currently run on our server.* 只有 P1 真实验收后，演示中再展示 transfer UI。

不要写：已支持 120 种可铸造宠物、完全去中心化、保证公平随机、已经盈利、主网已上线、测试奖品未来可兑真钱。要写：本轮真正完成的范围、原有工作的披露、用户试玩观察、剩余信任边界与下一步验证。
