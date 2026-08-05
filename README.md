# 勋 · 常驻在线后端

让 TA **即使你没打开 App，也能定时主动联系你**。

- 纯前端 PWA 关掉页面就没有进程了，所以「关掉也能主动找你」必须由**常驻后端**来实现。
- 后端做三件事：① 接收 App 注册设备并保存上下文（人设/学习档案/最近对话）；② 按频率规则**定时生成主动消息**（用你配置的真实大模型，或内置离线话术）；③ 通过 **Web Push** 把消息推到你的设备（锁屏/通知栏也能看到），你打开 App 时也会自动把漏收的消息补进对话。

---

## 一、本地运行（先跑通）

```bash
cd backend
npm install
cp .env.example .env      # 可选：填入 VAPID / AI 模型
npm start
```

启动后访问 `http://localhost:3000/api/health` 看到 `{"ok":true}` 即成功。
（本地没配 VAPID 会临时自动生成，仅适合测试；真机推送需固定密钥，见下文。）

## 二、部署到公网（让手机/平板真正收到推送）

Web Push **要求后端是 HTTPS**，推荐用免费托管：

### 方案 A：Render.com（最简单，免费）
1. 把整个 `backend/` 目录推到 GitHub 仓库。
2. 打开 https://render.com → New → Web Service → 连仓库。
3. 设置：
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: Free
4. 在 Environment 里添加变量（见 `.env.example`）：
   - 必须：`VAPID_PUBLIC_KEY`、`VAPID_PRIVATE_KEY`（用 `npx web-push generate-vapid-keys` 生成）
   - 可选：`AI_ENDPOINT` / `AI_KEY` / `AI_MODEL`（填了就用真实大模型生成主动消息）
   - 频率：`MAX_PER_DAY`(默认4) / `MIN_GAP_MS`(默认3小时) / `TICK_PROBABILITY`
5. 部署完成后得到 `https://xxx.onrender.com`，这就是**后端地址**。

> 其他可选：Fly.io / Railway / 任意 VPS（用 pm2 或 systemd 常驻 `npm start`）。
> CloudStudio 目前只托管静态前端，**不能同时跑这个 Node 后端**，所以后端请放上面任一平台。

## 三、在 App 里连接后端

1. 打开 App → ⚙️ 设置 → **🌐 常驻在线服务**。
2. 「服务地址」填上面的后端地址（如 `https://xxx.onrender.com`）。
3. 打开「启用常驻在线」开关（或点「连接服务 / 允许通知」）。
4. 浏览器会请求**通知权限** → 允许。
5. 状态变为「在线」即完成。之后即使关掉 App，TA 也会按节奏主动给你发消息。

> 提示：推送依赖系统通知，请确认手机/电脑没有把该站点通知静音或折叠。

## 四、主动消息频率

| 变量 | 默认 | 说明 |
|------|------|------|
| `MAX_PER_DAY` | 4 | 每个设备每天最多主动发几条 |
| `MIN_GAP_MS` | 10800000 (3h) | 两条主动消息最小间隔 |
| `TICK_PROBABILITY` | 0.02 | 每个 60 秒周期触发概率（实际发送受上面约束，所以时间点是随机的）|

## 五、接口一览（供调试）

- `GET /api/health` — 健康检查
- `GET /api/config` — 返回 VAPID 公钥
- `POST /api/register` — 注册设备（返回 deviceId）
- `POST /api/context` — 更新人设/学习档案上下文
- `POST /api/subscribe` — 保存 Web Push 订阅
- `POST /api/heartbeat` — 心跳（更新 lastSeen + 上下文）
- `GET /api/pending?deviceId=` — 拉取未读主动消息
- `POST /api/pending/ack` — 确认已收到（去重）

数据默认存本地 `backend/data/store.json`，零数据库依赖，开箱即跑。
