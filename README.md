# 掌心伙伴 · PixelPets

原创代码像素宠物：先免费领养、照顾与收集，再由玩家选择是否领取链上身份，赠送、交换或出售。Godot 4.5.2 客户端 + TypeScript 持久化服务 + Solana / Metaplex Core 合约。

## 现在开始游玩

Windows 双击项目里的 **开始游玩.cmd**。它会启动本机服务并打开 <http://127.0.0.1:9783/>。已有档案保存在 `runtime/pets.sqlite`，不要删除这个文件来重启服务。

- 选择苔苔、啵啵或微光，为它取名。
- 喂食、陪玩、休息、出游增加亲密度；照顾间隔由服务端计算。
- 出游选日光或月色，收集三片记忆。累计 6 点亲密后，根据照顾偏好长成不同形态。
- 在卡册查看收集目标，在日记查看已完成的互动。
- 链上服务没有配置或未通过部署检查时，养成仍可使用，交易入口保持关闭。

Windows 客户端在 `dist/windows/PixelPets.exe`，同样需要养成服务运行。当前钱包操作在网页版进行。

## 开发与构建

需要 Node.js 24、Godot 4.5.2，合约构建另需 Rust 与 Agave SBF 工具。JS 依赖在根目录统一锁定；项目提供 `tools/npm.ps1` 调用本地 npm。

### 首次从 GitHub 获取项目

仓库保存源码、依赖锁文件、字体及许可、开发文档和验收记录。`runtime/`、`dist/`、`node_modules/`、Godot 导入缓存、数据库、环境变量文件和本地钱包密钥不进入版本控制。因此刚克隆的仓库需要先安装依赖并构建，之后再使用「开始游玩」。

1. 安装 Node.js 24（包含 npm），将 Godot 4.5.2 的命令行程序加入 PATH。
2. 在仓库根目录运行 `npm.cmd ci --ignore-scripts`。如果只安装了 Node、没有 npm，可先运行 `python tools/bootstrap_npm.py`，再使用下方的 `tools/npm.ps1`。
3. 从 Godot 官方安装 **4.5.2 对应的导出模板**，把 `web_nothreads_release.zip`、`web_nothreads_debug.zip` 和 `windows_release_x86_64.exe` 复制到本项目的 `runtime/` 目录。当前构建脚本使用这些自定义模板路径；旧工作区还支持从相邻 `Oddsprout/runtime/` 自动复制，但首次克隆不依赖该目录。
4. 运行 `./tools/build.ps1 -Target All`，然后运行 `./tools/start.ps1 -OpenBrowser`。

只检查 TypeScript 部分时，安装 JS 依赖后即可运行 `npm.cmd test` 与对应的 `npm.cmd run typecheck:...`，不需要导出模板或链上钱包。链上密钥需要在自己的开发环境生成，不应通过 Git 共享。

### 当前工作区命令

```powershell
./tools/npm.ps1 ci --ignore-scripts
./tools/build.ps1 -Target All
./tools/start.ps1
```

`tools/stop.ps1` 只停止记录中且进程路径仍匹配本项目的服务。`tools/build.ps1` 导出 Web 与 Windows，并把钱包桥接代码打包到网页。

```powershell
./tools/npm.ps1 test
./tools/npm.ps1 run typecheck:wallet
./tools/npm.ps1 run typecheck:server
./tools/npm.ps1 run typecheck:sdk
Godot_v4.5.2-stable_win64_console.exe --headless --path game --script tests/client_test.gd -- --client-test
```

## 链上操作如何衔接

1. 钱包签署登录消息；服务端验证真实 Ed25519 签名并创建独立钱包会话。
2. 服务端依据已保存的宠物档案准备领取或成长登记，保存唯一请求与共同签名。
3. 网页重新构造允许的指令，核对宠物、领取地址、发行方、合约、网络及消息字节；费用预览包含账户余额预计变化。
4. 玩家在钱包中逐笔签名。返回的消息必须与原消息完全一致，所有必需签名必须有效。
5. 服务保存已签交易以供恢复，再提交给 RPC；只有最终确认和对应链上账户数据都一致才更新档案为已登记。

合约包含限量 Edition、领取、成长记录、托管交换、固定价买卖与取消；SDK 还支持 Core 所有者直接赠送。接口和合约约束见 `docs/integration.md`、`chain/INTERFACE.md`；服务部署配置见 `server/README.md`。

签发服务默认关闭。开发测试密钥与本地账本仅位于被 Git 忽略的 `runtime/` 或 `target/`，不会读取玩家的私钥。默认命令不会部署或提交主网交易。

## 验证边界

本轮完整审查见 [当前版本 Review、玩家卡点与下一阶段规划](docs/review-2026-10-08.md)，其中区分了本轮重跑结果、已有链上证据、语言和平台支持范围。当前优先补齐钱包恢复与资产归属同步，再推进公共测试网和游戏内交易。

查看 [实现状态](docs/implementation_status.md) 和 [本次构建验收清单](docs/acceptance-2026-10-08.json) 获取当前证据。已通过 77 项 JS 测试、31 项 Godot 客户端检查和 11 项实际 HTTP 检查。真实本地链完成 16 项合约/市场检查（36 笔交易）及 5 项服务端到端检查（3 笔交易）。自动测试、SBF 编译、实际测试链执行、浏览器钱包扩展及主网部署是不同的验收项。

只读市场报价已接入交换页，按实际托管、成长记录、手续费快照和链上时间核验。未配置链服务时入口关闭；游戏内上架和成交流程尚未开放。复现真实链测试见 [本地链验收说明](docs/local-chain-testing.md)。

最终发布目标仍包含实际资产发行与交易、公开 HTTPS 服务及主网验收。AI 表达和只读硬件展示可沿现有宠物档案扩展；当前不宣称硬件或冷钱包集成已经完成。
