# PixelPets 产品长什么样（预览）

分支：`feature/travel-devnet-demo` · 草稿 PR：[weswes233/PixelPets#1](https://github.com/weswes233/PixelPets/pull/1)

一句话：**会替你出门的像素伙伴，以及可以交换的旅途收藏。**  
免费照顾三只原创宠物（苔苔 / 啵啵 / 微光），出游带回故事和纪念物；可选在 Solana Devnet 领取链上身份，并把旅途结果存证。

> 下面截图来自本机演示环境（英文主流程）。真钱包 Phantom 实测、公网 HTTPS 仍待完成。

## 主流程截图

### 出发旅行
![出发](../evidence/ui-smoke/06-travel.png)

### 旅途中
![旅途中](../evidence/ui-smoke/07-away.png)

### 归来
![归来](../evidence/ui-smoke/08-back.png)

### 明信片 / 收藏结果
![明信片](../evidence/ui-smoke/09-postcard.png)

### 刷新后仍在
![刷新后](../evidence/ui-smoke/10-postcard-after-reload.png)

### 钱包页
![钱包](../evidence/ui-smoke/12-wallet.png)

### 图鉴 / 卡册
![卡册](../evidence/ui-smoke/13-album.png)

### 中文切换
![中文](../evidence/ui-smoke/14-zh.png)

### 领取前 / 审阅 / 领取后（脚本钱包）
![领取前](../evidence/ui-smoke/35-before.png)
![审阅](../evidence/ui-smoke/36-review.png)
![领取后](../evidence/ui-smoke/37-after.png)

## Devnet（已部署）

| 项 | 链接 |
| --- | --- |
| 程序 | https://explorer.solana.com/address/2SCKfWszFZuqsjcmRbtmctHwZTgQopYmGSofoEtQm2nT?cluster=devnet |
| 集合 | https://explorer.solana.com/address/5BnUfTQ249v4v7sVAuohBEstsWF9JdzmaHwSbK7cuoiS?cluster=devnet |
| 证据 JSON | [devnet-demo-2026-10-10.json](../evidence/devnet-demo-2026-10-10.json) |

## 本机怎么打开

1. Node 24 + 仓库依赖已装好的话，可用 `./tools/demo-up.sh`（或按 README：`开始游玩.cmd` / `tools/start.ps1`）。
2. 浏览器打开本地演示页（默认 `http://127.0.0.1:9783/`）。
3. 链关闭时也能先玩养成与旅行；连 Devnet 需要钱包与当前 `runtime/devnet-chain.env` 配置。

## 还差什么（产品可见性）

- 公网 HTTPS 演示站（本机出站隧道受限，需要主机/域名）。
- 元数据公开固定（进行中）。
- 你用 Phantom/Backpack 实测领取、凭证、赠送。
