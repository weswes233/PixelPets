# PixelPets — Demo Day 演讲稿（配合视频 + 现场演示）

总时长建议 **3 分钟口播 + 最多 2 分钟视频/演示**（评委场次若更短，砍「商业模式」段，保留钩子 → 循环 → 链上 → 收尾）。

现场准备：
- 公网：https://175.178.27.231/（自签证书点继续）
- Phantom 切 **Devnet**，测试钱包 ≥0.05 SOL
- Demo 视频（v4/v5）已开好、全屏待命；口播卡时优先播视频，不硬点链上
- Explorer 备用标签页：program `2SCKfWszFZuqsjcmRbtmctHwZTgQopYmGSofoEtQm2nT`

---

## 英文口播稿（上台用，约 3:00）

### 0:00–0:20 钩子
*[站定，屏幕显示首页或 Moss]*

Hi, I'm Wes. This is **PixelPets** — a tiny companion that leaves the house for you, and comes back with a postcard you can keep, gift, and prove on Solana.

Not another mint-and-flip pet. Play first. Chain when you choose.

### 0:20–0:45 问题与时机
Most on-chain pets lead with speculation, confusing wallets, or empty JPEGs. Games like Travel Frog already proved the emotion: prepare, wait, surprise, show.

Solana is perfect for the missing piece — **ownership, journey provenance, and gifts** — without putting every feed on-chain. That's why we built this for Colosseum now.

### 0:45–1:15 玩家循环（可切视频前半）
*[点「播放 Demo 视频」或现场：Adopt]*

The loop is five steps:

1. **Adopt** Moss, Puddle, or Wisp — free, no wallet.
2. **Care** on soft timers; pets never die from neglect.
3. **Travel** — pack a bag, pick a place. Demo trips are labelled accelerated.
4. **Return** — a story postcard, maybe a keepsake in your Album.
5. **Optional chain** — claim a Metaplex Core companion, save a journey receipt, gift to a friend.

Emotion order: prepare → wait → surprise → show → share.

### 1:15–2:00 演示配合（视频或现场二选一）

**方案 A — 播产品 Demo 视频（推荐，稳）**  
*[播放 ≤3 分钟 Demo；口播压低，只点关键帧]*

- “Here is a real Phantom on Devnet.”
- Claim 弹窗出现时：“Co-signed claim — you see network, asset, fee.”
- Receipt 确认时：“Checkpoint v2 journey receipt — settled trip hashed on-chain.”
- Gift 成功时：“Owner-signed transfer; the friend syncs and keeps caring.”

**方案 B — 现场点公网站（时间够、网络稳时）**  
1. 打开 https://175.178.27.231/ → 过证书警告  
2. Adopt / 打开 Moss → Care 一下  
3. Connect Phantom → Claim（快速点 Continue）  
4. 若时间紧：跳过 Travel，直接指 Album / 已有凭证；或播加速旅行片段  
5. Save journey receipt → 打开 Explorer 交易  
6. （加分）Gift 预告：我们已用第二钱包跑通 sync + feed

### 2:00–2:25 链上怎么用
On **Solana Devnet**: Anchor program + Metaplex Core collection, three limited editions.

- Claim writes a PetRecord.
- Journey receipt stores a hash of the settled trip — public proof, independently checked.
- Gift is a Core transfer the owner signs.

Daily care and travel RNG stay off-chain for UX. The chain stores **provenance**, not every snack.

Program: `2SCKfWsz…Qm2nT` — live in the repo README and Explorer.

### 2:25–2:45 诚实与商业
Devnet only today — no cash value. No project token by design.

Later: fixed cosmetics and theme packs players can preview — not emissions, not a casino wrapped as a pet. If players only ask “wen token,” we fix the toy, we don't print a chart.

### 2:45–3:00 收尾 + Ask
Live demo: https://175.178.27.231/  
Repo: github.com/weswes233/PixelPets — default branch is the hackathon build.

We're asking judges for feedback on the **emotion loop** and the **Solana surface area** — not whether the tokenomics are aggressive enough.

Thanks — happy to take questions, or walk you through a claim live.

---

## 中文对照（排练用，台上仍建议讲英文）

| 时间 | 你在说什么 | 屏幕做什么 |
| --- | --- | --- |
| 0:00 | 我是 Wes，PixelPets：会替你出门的像素伙伴，明信片可收藏、可赠送、可上链证明 | 首页 / Moss |
| 0:20 | 链游宠物常押投机；旅行青蛙证明了情绪。Solana 适合做归属与旅途凭证，而不是每口粮都上链 | 可静帧对比 |
| 0:45 | 领养→照料→旅行→明信片/图鉴→可选 Claim / Receipt / Gift | 播 Demo 或现场 Adopt |
| 1:15 | 真 Phantom、Devnet；Claim / 旅程凭证 / 赠送 | 视频特写或现场弹窗 |
| 2:00 | Core + Anchor；照料链下，证明链上 | Explorer / program id |
| 2:25 | 无项目代币；以后靠外观与主题包 | 一页诚实声明 |
| 2:45 | 求反馈情绪循环与 Solana 用面；谢谢 | 公网 + GitHub |

---

## 90 秒急救版（被砍时间时）

Hi, I'm Wes — PixelPets. A Travel Frog–style companion: adopt free, send on trips, collect postcards. Optionally claim on Solana Devnet with Metaplex Core, save a verifiable journey receipt, and gift to a friend. Care stays off-chain; chain is for identity, provenance, and gifts. No project token. Live at 175.178.27.231 — real Phantom QA done. Repo weswes233/PixelPets. We want feedback on the emotion loop and the Solana surface — thank you.

---

## 问答预备（30 秒答）

- **Why Devnet?** Ship honest play-first loop this weekend; mainnet after review.  
- **Why no token?** Emotion retention first; cosmetics later if unpaid players stick.  
- **Is travel RNG fair?** Server settles the trip; chain stores the hash + public proof id.  
- **Mobile?** Godot Web today; mobile later if retention proves out.  
- **What did AI build?** Grok coding agents drove the one-day travel + Devnet track; product direction is Wes’s.

