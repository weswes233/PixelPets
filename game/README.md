# 掌心伙伴 Godot 客户端

Godot 4.5.2，Compatibility 渲染器，纯 GDScript。主场景 `main.tscn`。

实际包含：原创代码绘制的猫／蛙／幽灵、每种两条成长分支；访客会话与服务端领养、命名、照顾、路线收集小游戏、六分支卡册、真实服务端日记；Web 钱包桥连接与未部署状态。没有钱包私钥或模拟链上成交。

Web API 使用当前 origin，桌面默认 `http://127.0.0.1:9782`，可由 `PIXELPETS_API_URL` 覆盖。访客通行证保存在 Godot 的 user 数据目录；给钱包桥的会话只通过内存消息传递，不放进 URL。余额、签名和最终交易状态来自独立钱包桥。桌面钱包配对尚未实现，界面明确说明。

打开项目前需先启动 API。服务不可用会显示重连入口，客户端不会自行生成可信进度。成长、冷却时间与六分支判定以服务返回结果为准。

测试：

```text
Godot_v4.5.2-stable_win64_console.exe --headless --path game --editor --import --quit
Godot_v4.5.2-stable_win64_console.exe --headless --path game --script res://tests/client_test.gd -- --client-test
```

测试覆盖离线不造宠物、幂等请求标识、服务端状态替换、360／1000 宽度布局、小游戏本地操作不改变可信成长、钱包连接／断开消息与链未配置状态。端到端 HTTP 与 Web 真机视觉由集成验收补充，不能由这些组件测试代替。

字体：Noto Sans SC，SIL Open Font License，见 `assets/fonts/OFL.txt`。所有宠物和场景图形直接由 `scripts/pet_art.gd` 中的像素矩形绘制，无外部角色图像。
