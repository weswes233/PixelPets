# PixelPets 公开试玩部署与备份

更新：2026-10-09。本目录提供可审阅的部署模板，当前工作机没有 Docker/Caddy，尚未执行容器启动、外部 DNS、ACME 证书签发或公网验证；不要把模板视作已经上线。Node 24 的来源解析和备份代码已在本机真实测试。首次部署限定单实例养成试玩，链开关仍为关闭状态。

## 1. 部署结构和约束

浏览器 → 同一域名 HTTPS Caddy → `/api/*` 转发到 Node 24；其余路径提供 Godot Web 文件。SQLite 放在命名持久卷 `pixelpets_pets-data`。API 没有宿主机端口映射，HTTPS 证书另用持久卷保存。升级 API 容器不会重置存档。不要使用 `docker compose down -v`，它会删除持久卷。

当前应用使用 SQLite 和进程内限流，保持 **一个 API 实例**。不要把它直接扩成多个副本，也不要使用临时磁盘的无状态函数托管。单实例不提供高可用；定期一致性备份、异地副本和恢复演练仍是必要交付。

本模板让 Caddy 直接面向公网。容器网络明确固定 Caddy 为 `172.29.11.2`、API 为 `172.29.11.3`，API 仅信任前者。若主机已有重叠网段，必须一起修改 Compose 中的网段、两台容器 IP 和 `TRUSTED_PROXY_IPS`。不要只改其中一个值。[Docker 网络说明](https://docs.docker.com/compose/how-tos/networking/)

## 2. 从源码生成 Web 产物

在项目根目录安装 Node **24.x** 和锁文件中的依赖，安装 **Godot 4.5.2.stable** 及同版本导出模板。脚本严格检查引擎版本和所选模板的二进制版本标识。只构建 Web 时仅需 `web_nothreads_release.zip`；只构建 Windows 时仅需 `windows_release_x86_64.exe`；`All` 需要这两个 release 模板。无需 debug 模板。模板、依赖与产物不在 Git 中。

可以使用 Godot 的 Manage Export Templates 安装到标准目录，或把官方模板包中相应文件放在项目的 `runtime/`。引擎不在 PATH 时设置 `PIXELPETS_GODOT_PATH` 为引擎完整路径；模板另存时设置 `PIXELPETS_GODOT_TEMPLATES` 为解压后的模板目录（不是 `.tpz` 文件）。显式模板目录会完全替代自动搜索；未指定时依次检查项目 `runtime/`、当前用户的 `4.5.2.stable` 标准模板目录、引擎的自包含模板目录及旧项目 `../Oddsprout/runtime` 兼容后备路径。新环境无需旧项目。

```powershell
npm ci
powershell -ExecutionPolicy Bypass -File tools/build.ps1 -Target Web -ValidateOnly
powershell -ExecutionPolicy Bypass -File tools/build.ps1 -Target Web
npm test
npm run typecheck:server
npm run typecheck:sdk
npm run typecheck:wallet
```

`-ValidateOnly` 仅验证所选引擎、所选平台的 release 模板及版本，不复制模板、不修改导出设置、不导入或导出游戏。构建使用单线程 Web 模板，启用 Godot 的实验性虚拟键盘；HTML 设置中文语言、允许浏览器缩放及设备安全区。键盘弹起、手机缩放和钱包回跳仍需真实设备验收。

`dist/web/` 必须存在完整的 `index.html`、`index.wasm`、`index.pck`、`bridge.js` 等文件。仅运行 `npm run build:web` 只会打包钱包桥，不能替代 Godot 导出。容器 Web 构建会检查四个关键文件非空。源码和 `dist/web` 一起放到构建主机，再在项目根目录执行下面的命令。

Docker 构建使用各自的 `.Dockerfile.dockerignore` 白名单，API 镜像只接收源码、IDL、锁文件及备份工具；Web 镜像只接收生成的静态文件和 Caddy 配置。本地 `runtime`、密钥、玩家数据库不会进入镜像构建上下文。

## 3. 配置和启动

1. 准备一台 Linux Docker 主机、域名和持久磁盘。域名 A/AAAA 记录必须指向正确主机，开放 TCP 80/443 和可选 UDP 443。尚未配置 IPv6 时不要保留错误的 AAAA 记录。
2. 复制 `deploy/.env.example` 为 `deploy/.env`，填写真实 `DOMAIN` 和证书通知邮箱。`PUBLIC_ORIGIN` 自动使用此域名，必须与玩家实际访问的来源相同。`.env` 不提交 Git。
3. 官方镜像标签会更新。公开发布前审核并记录选用的镜像摘要，再将 `NODE_IMAGE`、`CADDY_IMAGE` 改成带摘要的引用；不要随意覆盖已经验收的镜像。
4. 从项目根目录执行：

```sh
docker compose --env-file deploy/.env -f deploy/compose.yaml config --quiet
docker compose --env-file deploy/.env -f deploy/compose.yaml build
docker compose --env-file deploy/.env -f deploy/compose.yaml run --rm --no-deps web caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
docker compose --env-file deploy/.env -f deploy/compose.yaml up -d
docker compose --env-file deploy/.env -f deploy/compose.yaml ps
```

Caddy 自动申请和续订 HTTPS 证书；这一过程需要可用的域名、网络入口与持久证书存储。Compose 等 API 的健康检查通过才启动 Web。[Caddy HTTPS](https://caddyserver.com/docs/automatic-https)、[Compose 启动顺序](https://docs.docker.com/compose/how-tos/startup-order/)

容器存活检查访问 `/api/v1/live`，只检查进程可响应和 SQLite 可读，不访问链上 RPC。`/api/v1/health` 保留更完整的就绪状态；链上服务暂时异常不应反复重启能够正常保存养成进度的 API。

API 默认关闭链上功能；这不会自动创建 Devnet 程序、发行集合、上传元数据或产生真实交易。未来启用链上功能需要独立配置程序/集合/edition/RPC，并把签发密钥以只读 secret 文件挂载后指定绝对路径 `CHAIN_ISSUER_KEYPAIR_PATH`。不要把密钥内容写到 `.env.example`、Dockerfile 或镜像。

`CHAIN_PUBLIC_RPC_ORIGIN` 只控制网页 CSP 允许访问的公开 RPC 来源，必须是与公开 RPC URL 对应的 `https://主机[:端口]`，不能填私有带密钥地址。配置值不是启用链的开关。

## 4. 真实来源与限流

应用默认只看 TCP socket 来源，从不使用 `X-Forwarded-For` 或 `Forwarded`。只有 `TRUSTED_PROXY_IPS` 显式列出的单个 IPv4/IPv6 地址才有资格提供唯一的 `X-PixelPets-Client-IP`。未设置环境变量时信任列表为空；不会自动信任 localhost。这样桌面 Godot 和 API 自身健康检查可直接访问，不必伪装成反向代理。

Caddy 的 `header_up X-PixelPets-Client-IP {http.request.remote.host}` 会**覆盖**访问者带来的同名头，不会追加链条。应用拒绝直连伪造这个头、可信代理漏传、重复头、逗号多值、端口、域名、CIDR、zone ID 等畸形输入。IPv4-mapped IPv6 和标准 IPv4 会归到同一个限流桶。[Caddy 头覆盖语义](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy#headers)

不要把 `TRUSTED_PROXY_IPS` 改成整个私有网络，也不要为方便而开放 API 端口。如果未来要接 CDN、负载均衡器或多级代理，需要重新明确每一跳的信任关系；当前模板不能直接套用到那种拓扑。多人在同一家庭/公司 NAT 后仍共享一个公网 IP 限额，这是当前策略的边界。

## 5. 压缩与缓存

静态路径启用 Zstandard/Gzip，并明确覆盖 Wasm、PCK 的 MIME 与压缩匹配。API 保持 `no-store`，不参与静态压缩缓存。当前导出文件名没有内容哈希，所以静态文件使用 `max-age=0, must-revalidate`，结合 Caddy 文件服务的 ETag/Last-Modified 复用缓存，避免长期缓存旧 JS、新 PCK 混用。后续加入版本化目录后才适合 `immutable` 长缓存。[Caddy 压缩](https://caddyserver.com/docs/caddyfile/directives/encode)、[文件服务](https://caddyserver.com/docs/caddyfile/directives/file_server)

## 6. 在线备份和恢复演练

`tools/backup.ts` 使用 Node 24 的 `node:sqlite.backup` 一致性备份 API，可读取正在使用 WAL 的数据库。**不要只复制在线数据库的 `.sqlite` 主文件**，否则已提交到 WAL 的数据可能遗漏。[Node 24 官方备份 API](https://nodejs.org/download/release/v24.13.0/docs/api/sqlite.html#sqlitebackupsource-db-path-options)

本机示例（项目根目录）：

```sh
node tools/backup.ts backup
node tools/backup.ts backup --source runtime/pets.sqlite --destination runtime/backups/pre-release.sqlite
node tools/backup.ts verify --source runtime/backups/pre-release.sqlite
node tools/backup.ts restore --source runtime/backups/pre-release.sqlite --destination runtime/restore-drill.sqlite
```

默认来源使用 `PIXELPETS_DB` 或项目 `runtime/pets.sqlite`；默认目标是 `runtime/backups/` 下带时间和随机标识的新文件。指定目标时，它及其 SQLite sidecar 必须都不存在。脚本先在目标旁的新临时目录中完成快照，转成独立单文件，验证 integrity、foreign keys 和项目必需表，然后刷盘、以不覆盖的硬链接原子发布。目标文件系统必须支持硬链接（例如本机 NTFS 或 Linux ext4）；不支持时操作失败，不降级成有覆盖风险的复制。失败清理仅涉及本次建立的临时文件，不递归删除备份目录。

容器在线备份及独立验证：

```sh
docker compose --env-file deploy/.env -f deploy/compose.yaml exec -T api node tools/backup.ts backup
docker compose --env-file deploy/.env -f deploy/compose.yaml exec -T api node tools/backup.ts verify --source /app/runtime/backups/填写刚才输出的备份文件名.sqlite
```

命令输出 SHA-256、字节数、表数量与完整性结果；不打印用户记录、会话令牌或签名交易内容。备份包含恢复会话、钱包关联和待确认链上请求所需数据，因此应像数据库本体一样限制访问。Linux 新备份文件权限为 0600；Windows 还需依赖存储目录 ACL。

建议初次公开试玩每小时备份，升级前额外备份，每天把已验证的快照加密转存到独立设备/存储；这些是运维安排，**当前没有创建定时任务，也没有配置异地存储**。保留策略可先用 24 份小时备份及 7 份日备份，删除旧备份应由明确的运维流程执行，当前脚本不自动删除历史快照。

恢复步骤：

1. 用 `verify` 检查目标快照，并保存其摘要和表数量记录。
2. 用 `restore` 输出一个**新文件名**；工具从不覆盖正在运行的数据库，也不替你切换数据库路径。
3. 在独立端口/独立进程中，用 `PIXELPETS_DB` 指向恢复文件、`CHAIN_ENABLED=false` 启动验证，确认游客/钱包能找回同一档案、宠物和幂等事件一致、待确认链请求仍保留。
4. 需要实际恢复生产时先进入维护期并停止写入，再更改 API 的 `PIXELPETS_DB` 指向已验证的新文件并重启；保留原数据库与其 sidecar，不直接覆盖。恢复旧快照后的链上已确认状态须重新读取链校准，不能假定数据库时间点等于链状态。
5. 验证健康接口和一个实际游戏流程后再恢复访问；记录故障时间、快照时间和可能丢失的时间窗。

## 7. 外部验收清单

- 外网设备通过正式 HTTPS 域名打开，领养/照顾/刷新后档案一致；API 无公开 9782 端口。
- 手机切换网络、钱包恢复/签名回跳实际通过；配置模板不能替代设备验收。
- 13 个不同来源经过同一个受信代理时不共用游客限额；同一来源连续超额仍返回 429；伪造头无法绕过限流。
- 浏览器确认 `.wasm` 与 `.pck` 使用压缩编码，重复访问能条件请求；记录手机弱网下载量与加载时间。
- 重启容器后档案仍存在；完成一次在线备份、独立恢复、应用读取验证。
- 镜像摘要、源码提交、Web 产物摘要、备份恢复结果留在发布记录。链功能另外完成 Devnet 与真实钱包验收，再考虑主网。

目前自动测试覆盖代理来源解析、在线 WAL 快照、用户/宠物/events/wallet/pending chain 表保留、新增钱包恢复挑战和资产归属/转移记录保留、已有目标保护、并发输出竞争和恢复 CLI。构建前置检查已验证显式引擎/模板路径、Web 不依赖 Windows 模板、缺少所选平台模板时失败、文件名正确但 Wasm 版本不符时失败。公网入口、容器镜像、证书、流量压缩、异地备份仍需按上表验证。
