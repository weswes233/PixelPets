# Windows 本机游玩

更新于 2026-10-10。适用于旅行分支，以及在它之上增加明信片册和 Windows 构建修复的 `codex/travel-companion-experience` 分支。

## 先区分两个网址

GitHub PR #1 是代码审阅页，浏览器能打开它并不代表游戏已启动。游戏运行在你电脑的 `http://127.0.0.1:9783/`。9783 提供游戏网页并代理 API；9782 提供养成和旅行 API。这两个端口都不是钱包连接端口。

## 推荐从新文件夹运行

这样保留原来的代码和 `runtime/pets.sqlite`。新文件夹默认创建新的游戏数据库；原存档不会自动迁移。不要在运行中复制 SQLite 文件或删除 runtime 目录。

先停止旧文件夹的服务，释放 9782、9783。以下路径按目前提供的电脑路径填写：

```powershell
cd C:\Users\86189\PixelPets
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\stop.ps1
cd C:\Users\86189
git clone --branch codex/travel-companion-experience --single-branch https://github.com/weswes233/PixelPets.git PixelPets-Travel
cd .\PixelPets-Travel
$env:PIXELPETS_GODOT_PATH = 'D:\Godot_v4.5.2-stable_win64.exe'
$env:PIXELPETS_GODOT_TEMPLATES = 'C:\Users\86189\PixelPets\runtime'
$env:CHAIN_ENABLED = 'false'
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\play.ps1
```

要求 Node.js **24.x**、Godot **4.5.2 stable**。原 runtime 目录需要存在同版 `web_nothreads_release.zip`，它是已解压的导出模板，不是 `.tpz` 本身。新分支的锁文件已补齐 `bufferutil` 和 `utf-8-validate`，正常使用 `npm ci`。

`play.ps1` 依次安装依赖、生成图鉴、等待 Godot 完成导入和 Web 导出、构建钱包桥接代码、停止当前文件夹旧服务、启动 API 与网页，并自动打开浏览器。构建失败会停止，不会继续显示启动成功。导出预设使用无 BOM 的 UTF-8，兼容 Windows PowerShell 5.1。

启动完成后打开 **http://127.0.0.1:9783/**。如果还是旧页面，按 Ctrl+F5。后续不改代码时，可直接执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\start.ps1 -OpenBrowser
```

## 先完成一次旅行

1. 在陪伴页免费领养伙伴。领养和旅行使用游戏档案，不要求钱包。
2. 进入旅行页，选择阳光集市或月灯小径，再选择点心盒或小提灯。行囊影响故事，不影响掉落概率。
3. 点击出发，消耗 1 份免费补给。默认演示旅行 45 秒；可以关掉网页，服务端保存出发与归来时间。
4. 返回时打开明信片，阅读性格故事与伙伴留言。结果揭晓一次后保存，刷新不会再抽取。
5. 到卡册回看明信片与纪念物。界面显示最近 50 次旅程中的明信片；纪念物是游戏记录，目前不提供交换。

故事现在是双语模板，按性格、目的地、行囊和结果组合。新明信片在揭晓时保存文案快照；旧数据没有快照时仍能读取。Solana 收据保存规范结果的摘要，规范结果包含事件代码与物品，不包含明信片文案，也不证明抽奖公平。

## 可选的 Solana Devnet

上面的步骤明确关闭链服务，只测试本地旅行。仓库里的程序地址和集合地址不足以启用领取，还需要队友提供这套部署对应的 **服务端配置**。发行密钥只能留在服务端本机，不能发到聊天、提交 GitHub 或放进网页。

已有 `runtime/devnet-chain.env` 和它引用的发行密钥文件后，停止免费模式服务，再执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\stop.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\start-devnet.ps1 -OpenBrowser
```

钱包通过网页中的 Wallet Standard 桥接连接扩展钱包。链服务核验部署后，才开放领取与保存旅程收据。新机器上的 Phantom/Backpack 弹窗、网络 RPC 和真实签名仍需在该电脑验收。PR #1 对程序地址有待维护者审批，不要为了运行游戏先合并它。

## 失败时看哪里

| 情况 | 下一步 |
| --- | --- |
| GitHub 或 git clone 无访问权限 | 登录有仓库权限的 GitHub 账号，确认已接受队友邀请 |
| 缺少 Web 模板 | 检查 PIXELPETS_GODOT_TEMPLATES 指向的目录里是否有同版 web_nothreads_release.zip |
| 端口被占用 | 用原项目 tools/stop.ps1 停止原项目服务，保留其他应用 |
| 网页服务能连接，但游戏没有生成 | 执行 tools/play.ps1，查看第一个构建错误 |
| 服务启动失败 | 查看 runtime/api.err.log、runtime/web.err.log |
| 钱包领取按钮不可用 | 先查看 /api/v1/chain/config；本地免费模式的 enabled:false 是预期结果 |

## 本次验证范围

已在开发环境验证 Node API/SDK/钱包逻辑、Godot 界面、HTTP 客户端，以及实际 Godot Web 导出。Windows PowerShell 5.1 和你的电脑未由远程运行，因此最终本机验收以上述命令的输出为准。开发环境中的私有字体附件无法由连接器下载，视觉验证使用同一 Noto Sans SC 字体系列；GitHub 交付分支保留原仓库字体资源。
