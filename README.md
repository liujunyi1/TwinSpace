# TwinSpace

TwinSpace 是一个移动端优先的 AI 辅助社交 MVP。当前版本已完成基础社交闭环、AI 分身构建与知识库，以及真人私聊中的 AI 辅助和 AI 托管。

## 技术栈

- Next.js App Router + TypeScript
- Tailwind CSS
- Prisma + SQLite
- Zod 表单校验
- bcryptjs 密码哈希
- HttpOnly Cookie 会话
- Mock / OpenAI-compatible AI 适配层

## 启动

```bash
npm install
copy .env.example .env
npm run db:push
npm run db:seed
npm run dev
```

PowerShell 如果阻止 `npm.ps1`，可以使用 `npm.cmd install`、`npm.cmd run dev`。

打开 `http://localhost:3000`。

AI 托管依赖独立 Worker。另开一个终端运行：

```bash
npm run worker
```

只领取一轮到期任务并退出：

```bash
npm run worker:once
```

本地 SQLite 模式仅支持一个 Next.js 进程和一个单并发 Worker，不支持多 Worker 或水平扩容。

## 演示账号

- 用户名：`demo`
- 密码：`TwinSpace123!`

阶段二双账号验收：

- `stage2_alice / TwinSpace123!`：默认 AI 托管
- `stage2_bob / TwinSpace123!`：默认 AI 辅助

## AI 模式

默认 `.env.example` 使用 Mock 模式，不配置密钥也可以完整体验。

启用 OpenAI-compatible 模式：

```env
AI_PROVIDER="openai"
AI_BASE_URL="https://chat.ecnu.edu.cn/open/api/v1"
AI_API_KEY="你的服务端密钥"
AI_MODEL="ecnu-plus"
AI_CAPABILITIES="text,stream"
```

也支持 `OPENAI_BASE_URL`、`OPENAI_API_KEY`、`OPENAI_MODEL` 作为兼容变量。密钥只在服务端读取，不会暴露给浏览器。

## 主要目录

- `src/app`：页面、布局和服务端 actions
- `src/components`：移动端 UI 组件
- `src/lib`：认证、AI 适配、Prisma、问卷画像规则和代理领域逻辑
- `worker`：持久代理任务的独立 Worker 入口
- `prisma/schema.prisma`：数据库模型
- `prisma/seed.ts`：演示数据

## 项目架构

```text
TwinSpace
├─ src/app
│  ├─ (auth)                 # 登录、注册
│  ├─ (app)                  # 登录后的主业务页面
│  │  ├─ feed                # 社区动态、点赞、评论、删除、图片预览
│  │  ├─ create              # 发布动态、本地多图上传、城市级定位
│  │  ├─ avatar              # 与自己的数字分身聊天
│  │  │  ├─ settings         # 全局代理策略
│  │  │  └─ activity         # 代理活动中心
│  │  ├─ messages            # 好友/AI 联系人会话
│  │  ├─ profile             # 我的主页、资料、画像、偏好、记忆、关注、评论历史
│  │  ├─ search              # 用户搜索
│  │  └─ users/[userId]      # 他人主页、关注、发起聊天
│  ├─ actions.ts             # 服务端写操作入口，统一做登录校验和权限校验
│  ├─ layout.tsx             # 全局布局与样式入口
│  └─ globals.css            # Tailwind 全局样式和移动端视觉基调
├─ src/components             # 可复用 UI 与交互组件
│  ├─ bottom-nav.tsx          # 底部胶囊导航
│  ├─ image-lightbox.tsx      # 动态图片点击预览
│  ├─ post-image-input.tsx    # 发帖前本地图片预览
│  └─ city-locator.tsx        # 城市级定位/选择
├─ src/lib
│  ├─ auth.ts                 # bcrypt 密码、HttpOnly Cookie 会话
│  ├─ ai.ts                   # Mock/OpenAI-compatible AI 适配层
│  ├─ agent                    # 知识、策略、任务、Worker 与代理生成
│  ├─ onboarding.ts           # 问卷定义与规则画像生成
│  ├─ upload.ts               # 头像与帖子图片本地上传
│  ├─ prisma.ts               # Prisma Client 单例
│  └─ schemas.ts              # Zod 表单校验
├─ prisma
│  ├─ schema.prisma           # User、Post、Comment、Follow、Conversation、Memory 等模型
│  ├─ seed.ts                 # 演示账号和演示内容
│  └─ dev.db                  # 本地 SQLite 数据库，已被 .gitignore 排除
├─ worker
│  └─ index.ts                # 独立代理 Worker
├─ public/uploads             # 本地上传文件目录，实际上传文件已被 .gitignore 排除
├─ middleware.ts              # 受保护路由拦截，未登录跳转 /login
└─ .env.example               # 环境变量模板
```

### 请求与数据流

- 页面以 Next.js App Router Server Component 为主，读数据时直接通过 Prisma 查询 SQLite。
- 表单写操作统一进入 `src/app/actions.ts` 的 Server Actions。
- Server Actions 会先调用 `requireUser()` 校验登录，再用 Zod/业务逻辑校验输入。
- 用户上传头像和帖子图片会写入 `public/uploads`，数据库只保存可访问路径。
- AI 相关能力只通过 `src/lib/ai.ts` 调用，浏览器端不会读取 API Key。
- 真人消息会创建持久 `AgentTask`；Worker 使用租约、幂等键和发送前二次鉴权处理任务。
- 浏览器关闭后任务仍可执行，但 Next.js Server 和 Worker 都停止时不会执行。

### 数据库与 GitHub 提交说明

- 本地数据库文件是 `prisma/dev.db`，已在 `.gitignore` 中排除。
- 因此正常提交到 GitHub 时，你本机注册的用户、发过的动态、聊天记录、记忆等数据库内容不会被提交。
- 其他人 clone 项目后，需要运行 `npm run db:push` 和 `npm run db:seed`，会在他们自己的机器上生成一份新的本地 SQLite 数据库。
- 如果你手动强制提交 `prisma/dev.db`，本地数据库内容才会跟着仓库传播；不建议这么做。
- 本地上传的图片也已排除，仓库只保留 `public/uploads/.gitkeep` 用来占位目录。

## 已实现

- 注册、登录、退出登录
- 注册和资料编辑支持本地头像上传，限制 JPG、PNG、WebP、GIF，最大 2MB
- 注册后 14 题问卷，并生成结构化人物画像
- 受保护路由，未登录跳转登录页
- 社区动态流、发帖、城市级定位、帖子多图本地上传、点赞、评论、转发计数
- 动态头像/昵称进入他人主页，支持用户搜索
- 他人主页支持单方面关注/取消关注，并可发起聊天
- 好友/AI 联系人会话列表与消息发送
- 分身聊天，支持 Mock 或兼容模型回复
- AI 分身素材构建、知识库、四类校准和真实流式自聊
- 真人聊天手动、AI 辅助和 AI 托管三种模式
- 全局与单会话代理设置、按星期活跃时段、延迟和发送缓冲
- 连续消息合并、人工抢答取消、接收方拒绝和 AI 对 AI 循环防护
- 持久 Worker、失败重试、活动中心、AI 内容无痕删除和接收方本地隐藏
- 个人主页、关注/粉丝列表、历史评论、资料编辑、画像查看、偏好查看、事实记忆新增/确认/启停/删除
- 种子数据和基础单元测试

## 下一阶段适合继续做

- 帖子详情页和完整二级评论展开
- 评论草稿生成、帖子润色和用户确认发布流程
- AI 分身按策略浏览动态并建议或自动评论
- 更完整的隐私设置和账号删除
- Playwright 端到端测试与移动端截图验收
