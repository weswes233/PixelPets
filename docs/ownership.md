# 链上归属与养成档案同步

本模块把本服务已经登记的宠物与当前链上持有人同步。数据库档案不再一直属于最初领养它的游客；完成转移后的持有人可以接着养，原持有人不能再照顾或改名。

2026-10-09 已接入 HTTP 与 Godot 网页客户端，实际本地链转手、钱包找回、新主人免费养成与服务重启的证据见 [ownership-service-e2e.json](../chain/evidence/ownership-service-e2e.json)。

## 权限来源

`OwnershipService` 只读取链，不签名、不广播。每次操作已登记宠物前，它都会读取 RPC 的 `finalized` 账户快照，核验网络 genesis、游戏程序及 ProgramData、Core 程序、Config PDA、指定集合、集合管理权限、Core 资产及两个不可变插件、PetRecord PDA 与成长字段。钟表账户必须属于同一个快照 slot。

资产所有者、物种、形态、亲密度、checkpoint 与托管关系都来自这些已核验的账户，不接收客户端提供的替代值。如果存在 active_offer，将重新读取包含 Offer 的完整快照，检查规范 PDA、资产、maker、nonce、checkpoint 和 Core 当前托管 owner。托管期间显示只读状态，取消挂单恢复后才能继续照顾。

断网、RPC 错误、错误集合、无法解码的账户或不符合插件规则时，已登记伙伴停止修改；免费未登记的伙伴仍可玩。界面里的 `can_interact` 只是上次核验的展示结果，每次写操作仍需重新核验。

本地真实链验收观察到 Clock 与 RPC context 偶发不一致。服务会丢弃整份结果，最多读取三次；仍不一致时明确失败，不能修改任何档案。此限制没有改为“允许差几个 slot”。Agave 上游也记录了 [RPC context 与账户读取并非原子快照的问题](https://github.com/anza-xyz/agave/issues/4807)。Clock、单调 slot 和关联账户核验是保守的一致性筛选，不能证明 RPC 提供了全局原子快照；真实交易的最终权限仍由合约执行时检查。

## 归属变化与隐私规则

转移到已绑定钱包时，服务在 SQLite 事务中修改宠物档案的 `user_id`。转移到未绑定钱包或进入托管时，档案由一个没有登录会话的系统账户暂存；旧主人不会继续获得操作权限。

服务观察到实际持有人变化时：

- 保留宠物 ID、链上资产地址、经核验的物种与链上成长进度。
- 不继承上个主人的未登记亲密度、培养偏好、精力、心情或照顾次数。亲密度与形态重置为链上记录，精力为 80、心情为 70，新关系的照顾次数和偏好计数为 0。
- 昵称恢复为物种默认名，新主人可重新命名；`created_at` 表示新关系在本服务被观察到的时间，不宣称它是链上铸造时间或真实成交时间。
- 清除旧主人的登记请求 ID，并设置服务端 `chain.received=true`。接收资产不经过免费领养数量限制；自己的免费宠物上链并不会因此变成 received。
- 旧主人的个人日记仍按原 `user_id` 保留，不复制给新主人。旧档案快照进入内部 `ownership_transfers` 审计表，不通过公共 API 返回。
- 上架然后取消、并且受益人始终是同一个钱包时，保留该钱包原有养成进度和昵称。

## 已接入的 API 行为

- `GET /api/v1/pets` 返回归属展示信息，包括 `owned`、`escrow`、`unverified`、上次核验 slot 和时间。游客和找回后的普通游戏会话均可读取自己的列表；这个接口不会把上次快照冒充实时链上查询。
- `POST /api/v1/wallet/assets/sync` 接收空 JSON 对象，要求钱包会话，重新核验本服务登记过的资产。响应包含 `pets` 和 `ownership: { scope, scanned, synchronized, unavailable }`。未配置归属服务时明确返回 `503 OWNERSHIP_DISABLED`；某只资产查询失败会计入 `unavailable`。暂停签发不会阻止归属读取。
- 已登记伙伴的照顾、改名、登记准备、登记确认和登记查询都经过 `withOwnedPet`。钱包退出或会话过期后，普通游戏凭据不能修改已登记伙伴；重新进行钱包登录即可恢复正常照顾，照顾和改名本身不要求链上交易或逐次钱包签名。
- 准备、确认和查询可能在 RPC 返回后写数据库，因此其内部接收同一个 fence，且在 SQLite 写事务中再次验证。查询旧登记请求也不能绕过已经发生的归属转移，或向旧主人返回新主人的宠物档案。
- 照顾与领养的幂等事件在读取旧响应前先验证当前档案归属。转出后重放旧请求不能重新展示或复活该宠物。仍然拥有宠物时，幂等响应保留原事件的数值快照；另外附带最新归属展示信息。
- 接收宠物不占免费领养名额。自己领养后上链的宠物仍占名额，进入托管时也不会凭空腾出一个免费名额。

## 内部扩展要求

```typescript
const ownership = new OwnershipService(repository, configuration);
await ownership.syncWallet(auth); // auth 必须来自已验证钱包会话
ownership.listPets(auth.user_id);

await ownership.withOwnedPet(auth, petId, fence =>
  repository.care(auth.user_id, petId, requestBody, fence));

await ownership.withOwnedPet(auth, petId, async fence => {
  // 对异步事务准备，fence 必须传入内部并在写事务中、写入前调用。
  return chainService.prepare(auth, petId, kind, requestBody, fence);
});
```

每个资产使用独立 SQLite 租约：120 秒有效期、每 30 秒按 token 续期。跨进程接管后旧 worker 的 fence 失败；请求结束后不能再复用 fence。所有权迁移在事务中检查 token、有效期、当前资产身份和 slot。旧 slot 或同 slot 返回不同账户数据时拒绝覆盖。已确认交易的 finalized slot 和本地已确认 checkpoint 也构成快照下限。

只在 HTTP 路由前单独调用一次校验、随后脱离租约异步写入是不安全的；所有已登记宠物的修改路径必须使用上述包装。链上交易提交时仍由合约再次核验 owner，服务端准备成功不等于未来必然成交。

归属模块的测试之外，`ownership-http.test.ts` 从真实 HTTP、钱包签名登录和 SQLite 会话开始，覆盖转出前未手动同步、旧事件重放、新主人接收、名额、托管与 RPC 故障。`chain-service.test.ts` 还验证领取确认后进入归属保护、转出后无法继续确认旧成长请求，以及准备/确认在网络等待期间失去 fence 后不会写入最终状态。这些集成测试复用可控 RPC 账户夹具，没有假称公共链上的成交证据。

## 当前范围与限制

- 自动发现范围为本服务登记过的宠物，最多扫描 128 只。超过上限会明确要求启用索引服务，不返回一个伪完整清单。该原型逐只读取，公开大规模发布前应接入经核验的分页索引和异步同步队列。
- 不导入任意钱包 NFT，也不承诺发现通过其他发行入口创建的所有官方宠物。未来外部资产导入仍需相同验证，不能仅靠钱包 NFT 列表或集合名称判断。
- 这是最终状态轮询，没有链上完整转移历史索引。如果 A 转给 B 后又转回 A，并且两次转移之间服务从未观察到 B，当前 Core 状态无法证明这段中间持有历史。要对这种往返也强制开启新的养成关系，需要可靠的转移历史索引或合约记录持有周期；不能把轮询结果称为完整所有权历史。
- `finalized` 快照不能防止核验完成之后用户立即在外部转移资产。服务仅在下一次读取中同步新状态；已准备的链上交易必须依赖合约的即时 owner 检查。本地免费照顾不存在真实资金结算。
- 单元/HTTP 测试使用真实 IDL Borsh 账户编码与 Core 序列化夹具，另外已执行实际本地 Core 转移。两者都不等于公共链验收；仍需浏览器真实钱包与公共测试网验证。
