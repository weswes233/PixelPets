# 本地真实链执行验证

本文件记录截至 2026-10-09 在 Windows 上实际运行的验证，不代表已经部署到 Devnet 或主网。

## 已取得的合约证据

`chain/evidence/local-validator-e2e.json` 记录 16 项检查、36 笔真实本地交易，最终结果为 `passed`，并读取了 finalized 状态。SBF 合约和 Metaplex Core 均由本地验证节点执行，没有替换 CPI 或模拟资产所有者。

- Genesis：`8M7v4mAevKxxossUfJ7HJT6eU3k2AbDSKmF23LbADvw5`
- 最后读取的 finalized slot：`68`
- 资产领取、唯一领取凭证、发行上限、成长顺序、实际 Core 插件和所有权已经核对。
- 双方交换、报价失效、原子回滚、定价出售、手续费快照、余额不足回滚、暂停期间撤销、nonce 防重放均有交易日志与账户证据。
- 只读市场模块已读取实际 finalized 挂单、Clock、托管宠物和原始费率，包含详情查询。
- 失败首轮的证据保留在同目录带 `previous` 的文件中；它通过了功能检查，但未取得最终确认，不能计作完整通过。

`chain/evidence/service-e2e.json` 另记录了完整跨层验证，2026-10-09 重跑结果为 `passed`：5 项检查、3 笔真实本地交易。具体 genesis 与时间以该 JSON 为准。验证包括实际 HTTP 领养和 SIWS 登录、签名提交中断后的 SQLite/HTTP 服务重启恢复、同一领取请求去重、实际照顾后的成长上链、再次重启后的身份与成长持久化。钱包由测试脚本中的一次性适配器签名；本结果不等同于已验证真实浏览器钱包扩展的弹窗和用户交互。

## 重现方式

从 PixelPets 目录执行：

```powershell
.\tools\start-local-chain.ps1 -RunContractTests -StopAfterTests
```

跨 HTTP、钱包签名流程和真实链的完整测试使用独立新链：

```powershell
.\tools\start-local-chain.ps1 -RunServiceTests -StopAfterTests
```

实际转手、钱包找回及接收方养成测试使用另一条独立新链：

```powershell
.\tools\start-local-chain.ps1 -RunOwnershipTests -StopAfterTests
```

对应证据是 [ownership-service-e2e.json](../chain/evidence/ownership-service-e2e.json)：6 项跨层检查、3 笔真实交易。旧主人即使尚未手动同步，也不能继续照顾已转出的伙伴；接收方已有 3 只免费宠物时仍可接收资产。新的 WalletController 用真实签名找回接收方档案，新主人免费养成后重启服务，身份和进度仍保留。采用脚本 Wallet Standard 签名器，不能代替浏览器扩展和手机钱包的验收。

三种测试独立运行。helper 每次创建新的 `runtime/validator-local-.../ledger`，保存日志、genesis 和 PID；不会删除旧 ledger，不会读取默认钱包，不会连接公共 RPC。它等待健康且 confirmed slot 至少为 2，避免 genesis 初始 slot 0 时程序账户已存在但还不能调用的启动竞态。端口被占用时退出；结束时只停止可执行路径和 ledger 参数与本次启动匹配的进程。

运行需要已有的官方 Agave 2.3.13 Windows 工具、本项目 SBF、Core SBF 和 `runtime/chain-fixtures/local-admin.keypair.json`。该钱包只用于隔离本地链。运行时所有余额都没有经济价值。

## Windows 兼容性边界

官方 Agave 4.3.0 在当前 Windows 环境创建 genesis 时遇到目录打开兼容问题。改用官方 2.3.13 后可以实际执行合约，但该 test-validator 的首次 rooted slot 100 快照会创建目录符号链接；当前权限不支持它，节点随后退出。`--log` 避免了启动日志符号链接，但不影响快照实现。

2.3.13 的 test-validator 命令没有关闭快照的参数。官方源码将 `full_snapshot_archive_interval_slots` 固定为 100；Windows 发布包也没有独立的 agave-validator.exe。helper 因此在节点健康后立即执行测试，在首次快照前完成读取 finalized 证据，并主动停止本次节点。它是短时测试工具，不是可长期使用的开发服务。

未修改 Windows 安全设置，未使用管理员权限，未修改官方节点二进制。后续长期运行应使用可配置快照的 Linux 验证节点或另行从源码构建的测试节点，并重新验证；不能将本次短时运行视为稳定性测试。

官方实现依据：

- [Agave 2.3.13 test-validator 源码](https://github.com/anza-xyz/agave/blob/v2.3.13/test-validator/src/lib.rs#L977-L1013)
- [test-validator CLI 参数及启动实现](https://github.com/anza-xyz/agave/blob/v2.3.13/validator/src/bin/solana-test-validator.rs)

## 本次执行的 SHA-256

| 文件 | SHA-256 |
| --- | --- |
| 官方 solana-test-validator.exe 2.3.13 | `78EC48F5586A10A6B24286B61C004FCB91DDC9ED5DD1D270F08EB534B479D79D` |
| pixel_pets.so | `F7808C45699515789D2B02C62D86C0FDDAFFB2FB6BFF71236AC27FF08B186F82` |
| mpl_core.so | `5680D2371204033F55CDCF0C08D393ED737D99CFE35D83F65BEFE80F7537484A` |

这些哈希标识本次使用的文件。后续重新构建或更新依赖后，应生成新的运行证据。
