extends RefCounted
class_name L10n
## English-first UI strings. The source text in main.gd stays Chinese; `t()` maps it to English when lang == "en".
## Unknown strings pass through unchanged, so already-English text and server data are safe to pass in.

static var lang: String = "en"

const EN := {
	"苔苔": "Moss", "会把每一片落叶当作礼物的小猫。": "A little cat who treats every fallen leaf as a gift.",
	"向阳苔苔": "Sunny Moss", "月影苔苔": "Moonshade Moss",
	"啵啵": "Puddle", "喜欢坐在水边，陪你发一会儿呆。": "Likes sitting by the water and daydreaming with you.",
	"晴天啵啵": "Sunny Puddle", "夜露啵啵": "Night-dew Puddle",
	"微光": "Wisp", "有点害羞，但总会为你留一盏小灯。": "A little shy, but always leaves a small light on for you.",
	"晨曦微光": "Dawn Wisp", "星夜微光": "Starlit Wisp",
	"正在寻找你的伙伴……": "Looking for your companion…", "未配置": "not configured",
	"掌心伙伴": "PixelPets", "小小的陪伴，慢慢成为独一无二。": "A tiny companion. A world of stories. Collect the journey.",
	"陪伴": "Home", "旅行": "Travel", "卡册": "Album", "日记": "Journal", "交换": "Wallet",
	"正在连接伙伴小屋……": "Connecting to the pet house…",
	"无法保存本机通行证，请检查浏览器存储或磁盘空间后重试。": "Couldn't save your local pass. Check browser storage or disk space and try again.",
	"这张通行证已过期。可在交换页用原钱包找回，或重连创建新档案。": "This pass has expired. Recover with your original wallet on the Wallet tab, or reconnect to start a new profile.",
	"通行证已过期，但本机存储暂时无法更新。请检查浏览器存储或磁盘空间后重试。": "This pass has expired, but local storage can't be updated right now. Check browser storage and try again.",
	"小屋已连接。每次照顾都会留下真实的小记忆。": "Connected. Every bit of care leaves a real little memory.",
	"让相遇被记住": "Make the meeting memorable",
	"领养与成长保存在伙伴服务里。连接成功后，就可以免费领养你的第一位伙伴。": "Adoption and growth are saved by the game server. Once connected you can adopt your first companion for free.",
	"正在连接……": "Connecting…", "重新连接": "Reconnect", "伙伴": "Companion",
	"今天也很高兴见到你。一起出去走走吧。": "So happy to see you today. Shall we go somewhere?",
	"想找个舒服的角落，和你一起歇一会儿。": "I'd like a cozy corner to rest with you for a bit.",
	"这些一起度过的日子，已经成为我的模样。": "The days we spent together became who I am.",
	"我们的日常": "Our days", "亲密": "Bond", "精神": "Energy", "心情": "Mood",
	"再积累 %d 点亲密，就会迎来新的模样。": "%d more bond until a new form.",
	"已经长成独特的模样。陪伴还会继续。": "Grown into a unique form. The companionship goes on.",
	"喂一口": "Feed", "陪它玩": "Play", "歇一会": "Rest", "小小出游": "Short walk",
	"每种照顾都有自己的节奏。没有死亡，也不用担心落下一天。": "Each kind of care has its own rhythm. Pets never die, and missing a day is fine.",
	"查看钱包与伙伴归属": "Open wallet & ownership", "给它取个新名字": "Rename",
	"再认识一位伙伴  ·  %d / 3": "Adopt another companion  ·  %d / 3",
	"伙伴正在等待成交，取回并同步归属后才能继续照顾。": "This companion is listed. Cancel the offer and sync ownership to keep caring for it.",
	"连接并验证钱包后，可以继续免费照顾这位链上伙伴。": "Connect and verify your wallet to keep caring for this on-chain companion (still free).",
	"请先在交换页同步钱包伙伴，确认它仍属于你。": "Sync wallet companions on the Wallet tab to confirm it's still yours.",
	"从一个小小的相遇开始": "Adopt a companion",
	"免费领养 · 照顾成长 · 收集回忆\n无需钱包即可开始；领养本身不会发行链上资产。": "Free to adopt · grow together · collect memories\nNo wallet needed to start; adopting does not mint anything on-chain.",
	"给伙伴起个名字（最多 16 字）": "Name your companion (up to 16 characters)",
	"带它回家": "Take it home",
	"日光与月色会留下不同的成长印记。每种伙伴都有两条成长分支。": "Sun and moon leave different marks. Each companion has two growth branches.",
	"认识新伙伴": "Meet a new companion", "为这次相遇取一个名字吧。": "Give this companion a name.",
	"%s 已经到家了。第一天，请多关照。": "%s is home. Day one — take good care!",
	"正在记下这次陪伴……": "Saving this moment…", "这次陪伴已经记住了。": "This moment was saved.",
	"初遇 · ": "First meeting · ", "已登记链上": "Claimed on Devnet", "等待链上确认": "Waiting for confirmation", "小屋伙伴": "House companion",
	"每种模样，都有一段相处": "Every form has its own story",
	"3 种伙伴 · 6 条成长分支。灰色记录代表尚未拥有，预览不计入收藏。": "3 companions · 6 growth branches. Grey cards are previews you don't own yet.",
	"已经相遇": "Met", "尚未收集 · 成长预览": "Not yet · preview",
	"陪伴比稀有更珍贵": "Companionship over rarity",
	"日光与月色偏好影响成长。现阶段没有付费抽卡，也没有承诺收益；喜欢哪种，就陪它慢慢长成那种模样。": "Sun and moon preferences shape growth. There are no paid draws and no promised returns — just raise the one you love.",
	"一起度过的小日子": "Little days together", "这些是实际发生的照顾记录。换一个名字，回忆也还在。": "These are real care records. Renaming keeps the memories.",
	"第一篇日记，从相遇开始。": "The first entry starts with meeting.",
	"领养一位伙伴，再喂它一口、陪它走走。服务保存的回忆会出现在这里。": "Adopt a companion, feed it, take it out. Saved memories appear here.",
	"翻开最新一页": "Refresh",
	"让喜欢，遇见另一个喜欢": "Wallet & Devnet", "先一起生活，再决定是否把它变成可转让的链上宠物。": "Live together first, then decide whether to claim it as a transferable Devnet asset.",
	"钱包已连接": "Wallet connected", "你的钱包": "Your wallet",
	"小屋伙伴无需钱包。已登记的伙伴需验证钱包身份，日常照顾仍然免费。": "House companions need no wallet. Claimed companions need a verified wallet; daily care stays free.",
	"断开钱包": "Disconnect wallet", "连接钱包": "Connect wallet", "同步钱包里的伙伴": "Sync wallet companions",
	"同步本游戏已登记伙伴的最新归属；接收的伙伴不占免费领养名额。": "Syncs current ownership of companions claimed in this game; received companions don't use adoption slots.",
	"找回已有伙伴 / 切换档案": "Recover companions / switch profile",
	"换设备后，用原来绑定的钱包找回伙伴。当前游客档案会保留在这台设备，不会自动合并。": "On a new device, recover with the wallet you linked before. This guest profile stays on this device and is never merged automatically.",
	"切回上一份本机档案": "Switch back to the previous local profile",
	"链上登记与交换": "Solana Devnet", "网络：": "Network: ", "交易服务尚未开放": "Chain features are not open yet",
	"先免费领养，记录你们的日常。链上身份与交换开放后，你可以选择把伙伴带进钱包。": "Adopt for free and keep playing. When chain features open you can choose to claim your companion into your wallet.",
	"登记和交易需要逐笔确认钱包。请核对宠物、对象与费用。": "Every claim or save asks your wallet to approve. Check the pet, recipient and fee first. Devnet test assets have no cash value.",
	"保存成长到链上": "Save growth checkpoint", "登记当前伙伴": "Claim on Devnet", "查看真实报价": "View offers (Coming later)",
	"想换哪只，就换哪只": "Ownership is on Solana",
	"送给朋友": "Send as a gift", "作为礼物送出": "Send as a gift", "接收者钱包地址": "Recipient wallet address",
	"输入接收者的 Solana 钱包地址。确认前会显示网络、资产、接收者和费用；私人日记与其他伙伴不会转移。": "Enter the recipient's Solana wallet address. You'll review network, asset, recipient and fee before your wallet asks. Your private journal and other companions stay with you.",
	"只有已登记到链上的伙伴可以赠送。": "Only companions claimed on Solana can be gifted.", "请先连接并验证钱包。": "Connect and verify your wallet first.",
	"伙伴正在旅行，回来后才能赠送。": "Your companion is travelling. Gifting opens again after it is back.",
	"请先同步钱包，确认你仍拥有这位伙伴。": "Sync your wallet first to confirm you still own this companion.",
	"赠送正在处理中……": "Gift in progress…", "请输入接收者钱包地址。": "Enter the recipient's wallet address.",
	"请在钱包中核对赠送……": "Review the gift in your wallet…",
	"礼物已在链上确认。接收者同步钱包后即可继续照顾。": "Gift confirmed on Solana. The recipient can sync their wallet to continue care.",
	"赠送已提交，正在等待确认。稍后同步钱包核对。": "Gift submitted · checking confirmation. Sync your wallet later.",
	"未来的交换将明确展示双方宠物，并由同一次链上结算完成交割。未成交时可按规则取回。所有权以确认后的链上记录为准。": "Pet ownership is a transferable Metaplex Core asset. Gameplay and reward generation currently run on our server; journeys are recorded on Solana when you save a receipt.",
	"链上报价": "Offers", "现在可以查看报价，暂未开放在游戏内成交。报价刷新后可能变化。": "Offers are read-only for now. They may change on refresh.",
	"市场目前暂停成交。": "The market is paused.", "这一页暂时没有可展示的有效报价。": "No valid offers on this page.",
	"亲密 %s · 成长记录 %s": "Bond %s · checkpoint %s", "成交款内含市场费用 %s SOL；买方另付网络费用。": "Includes a %s SOL market fee; the buyer also pays network fees.",
	"希望交换：": "Wants: ", "指定伙伴：": "Specific pet: ", "宠物：": "Pet: ", "这条报价目前不能成交。": "This offer can't settle right now.",
	"本页有 %d 条已过期或未通过核对的报价，已隐藏。": "%d expired or unverified offers on this page were hidden.", "查看下一页": "Next page",
	"请在网页版使用钱包。桌面版的浏览器配对尚未开放。": "Use the web version for wallet features. Desktop wallet pairing is not available yet.",
	"档案恢复回应无效，原档案保持不变。": "The recovery response was invalid; your profile is unchanged.",
	"无法保存恢复后的档案，原档案保持不变。请检查浏览器存储或磁盘空间。": "Couldn't save the recovered profile; your profile is unchanged. Check browser storage.",
	"已核对当前页的链上报价。": "Offers on this page were verified on-chain.",
	"伙伴已同步；还有 %d 份归属暂未能确认，请稍后重试。": "Synced; %d ownership records couldn't be confirmed yet. Try again soon.",
	"伙伴归属已同步，可以继续你们的日常了。": "Ownership synced. Carry on!", "正在核对钱包伙伴的最新归属……": "Checking wallet ownership…",
	"找回已有伙伴": "Recover companions",
	"请使用之前绑定的钱包。验证后打开原来的宠物档案；当前游客伙伴不会被合并或删除，你可以在这台设备切回。": "Use the wallet you linked before. After verification your original profile opens; this guest profile is not merged or deleted and you can switch back.",
	"首次使用钱包时，请先关闭这个窗口，选择「连接钱包」来绑定当前伙伴。": "Using a wallet for the first time? Close this and choose \"Connect wallet\" to link the current profile.",
	"用原钱包找回": "Recover with original wallet", "正在打开这份伙伴档案……": "Opening this profile…",
	"无法保存档案切换，原档案保持不变。请检查浏览器存储或磁盘空间。": "Couldn't save the profile switch; nothing changed. Check browser storage.",
	"返回小屋": "Back", "一个只属于它的名字": "A name just for it", "记住这个名字": "Save name", "名字还空着呢。": "The name is empty.",
	"它记住了这个新名字：": "It learned its new name: ",
	"今天，想走哪条小路？": "Which path today?",
	"找到三片记忆碎片，一起带回家。走过的路线会影响伙伴的日光或月色偏好。": "Find three memory fragments and bring them home. The path nudges a sun or moon preference.",
	"沿着日光，去草地散步": "Sunny meadow walk", "循着月色，听风的声音": "Moonlit breeze walk",
	"日光草地": "Sunny meadow", "月色小径": "Moonlit path",
	"轻点记忆碎片，把今晚的风声和星光一起带回家。": "Tap the memory fragments to bring tonight's breeze and starlight home.",
	"轻点记忆碎片，把今天的暖风和阳光一起带回家。": "Tap the memory fragments to bring today's warm wind and sunshine home.",
	"记忆 %d / 3": "Memory %d / 3",
}

## English text for server error codes. Unknown codes fall back to the server message.
const ERRORS := {
	"CONNECTION": "Can't reach the game server. Check your connection and retry — nothing was changed.",
	"RESPONSE": "The server reply couldn't be read. Please retry.",
	"TEST_OFFLINE": "Test mode: offline.",
	"RATE_LIMITED": "Too many requests. Wait a moment and retry.",
	"UNAUTHORIZED": "Your session expired. Reconnect to continue.", "AUTH_REQUIRED": "Please reconnect to continue.",
	"SESSION_EXPIRED": "Your wallet session expired. Connect your wallet again.", "INVALID_TOKEN": "Your session is invalid. Reconnect to continue.",
	"PET_LIMIT": "You already adopted 3 companions.", "INVALID_NICKNAME": "Names must be 1–16 characters.",
	"INVALID_SPECIES": "Choose one of the three companions.", "PET_NOT_FOUND": "That companion isn't in this profile any more.",
	"EVENT_CONFLICT": "That action was already used for something else. Please retry.",
	"NO_SUPPLIES": "No travel supplies left today. They refill to 3 at 00:00 UTC.",
	"TRIP_ACTIVE": "This companion is already travelling.", "TRIP_NOT_READY": "Not back yet — the server says the trip is still underway.",
	"TRIP_NOT_FOUND": "That trip couldn't be found.", "TRIP_ALREADY_SETTLED": "This postcard was already opened.",
	"TRIP_NOT_REVEALED": "Open the postcard before saving a journey receipt.", "TRIP_PET_MISMATCH": "This trip belongs to another companion.",
	"INVALID_ROUTE": "Choose an open destination.", "INVALID_PACKING": "Choose something to pack.",
	"PET_OWNER_CHANGED": "This companion now belongs to another wallet. Its trip was cancelled and the supply refunded.",
	"PET_ESCROWED": "This companion is listed in an offer. Cancel the offer to travel.",
	"PET_NOT_REGISTERED": "Claim this companion on Devnet first.", "WALLET_SESSION_REQUIRED": "Connect and verify your wallet first.",
	"WALLET_AUTH_REQUIRED": "Connect and verify your wallet first.", "WALLET_NOT_LINKED": "Link a wallet first.",
	"WALLET_MISMATCH": "This wallet doesn't own that companion.", "WALLET_BUSY": "Your wallet is still handling the previous request.",
	"USER_CANCELLED": "You cancelled in the wallet. Nothing was submitted.", "WRONG_NETWORK": "Switch your wallet to Solana Devnet.",
	"NETWORK_MISMATCH": "Your wallet is on a different network. Switch to Solana Devnet.",
	"CHAIN_NOT_DEPLOYED": "Devnet features are not open on this server yet. Your progress is still saved.",
	"CHAIN_DISABLED": "Devnet features are not open on this server yet.", "CHAIN_BUSY": "Another chain request for this companion is in progress. Retry shortly.",
	"PROGRESSION_CONFLICT": "Your on-chain record moved on. Refresh and try saving again.",
	"EDITION_EXHAUSTED": "This edition reached its Devnet supply cap.", "PROTOCOL_PAUSED": "The program is paused for maintenance.",
	"SIMULATION_FAILED": "The transaction would fail, so it was not sent. Check your Devnet SOL balance.",
	"TRANSACTION_NOT_COMPLETED": "The transaction didn't finish. Check your wallet and network, then retry — it is safe to retry.",
	"TRANSACTION_FAILED": "The transaction failed on-chain. Nothing changed.", "INTENT_EXPIRED": "That request expired. Start again.",
	"ACCOUNT_CHANGED": "Your wallet or profile changed. Reconnect and check your companion.",
	"WALLET_UNSUPPORTED": "This wallet can't sign Solana transactions here.", "SIGNATURE_INVALID": "The wallet signature couldn't be verified.",
	"ORIGIN_REJECTED": "This page origin isn't allowed by the server.", "SERVICE_UNAVAILABLE": "The server is busy. Retry shortly.",
	"RPC_UNAVAILABLE": "Solana RPC is unavailable right now. Retry shortly.", "RPC_TIMEOUT": "Solana RPC timed out. Retry shortly.",
	"PROOF_NOT_FOUND": "No confirmed journey receipt for that id yet.", "NOT_FOUND": "That isn't available.",
	"METHOD_UNSUPPORTED": "This action isn't supported in this version.", "INVALID_REQUEST": "That request was invalid. Refresh and retry.",
	"GIFT_BLOCKED_TRAVELLING": "Your companion is travelling. Gifting opens again after it is back.",
	"RECIPIENT_INVALID": "That is not a valid Solana wallet address.", "SELF_TRANSFER": "You already own this companion.",
	"GIFT_NOT_REGISTERED": "Only companions claimed on Solana can be gifted.",
	"WALLET_REQUEST_FAILED": "The wallet request didn't finish. Check the wallet prompt and retry.",
}

static func t(text: String) -> String:
	if lang != "en":
		return text
	return str(EN.get(text, text))

static func error_text(result: Dictionary) -> String:
	var error: Variant = result.get("error", {})
	if not error is Dictionary:
		return str(error)
	var code: String = str(error.get("code", ""))
	if lang == "en":
		if ERRORS.has(code):
			return str(ERRORS[code])
		var message: String = str(error.get("message", ""))
		return message if not message.is_empty() and not _has_cjk(message) else "Something didn't finish (%s). Please retry." % (code if not code.is_empty() else "error")
	return str(error.get("message", "这次操作没有完成，请重试。"))

static func pick(localized: Variant) -> String:
	## Server content carries {"en": ..., "zh": ...}.
	if localized is Dictionary:
		return str(localized.get(lang, localized.get("en", "")))
	return str(localized)

static func _has_cjk(value: String) -> bool:
	for character in value:
		var code: int = character.unicode_at(0)
		if code >= 0x3000 and code <= 0x9fff:
			return true
	return false
