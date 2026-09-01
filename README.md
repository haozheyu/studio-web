# 片场 · AI Drama Studio Web

一个面向本地 AI 影视生产的导演工作台。当前采用 Vue 3 + TypeScript 前端、Node.js 内置 SQLite 后端，并通过 Vite Proxy 连接三套模型服务。

## 当前模型拓扑

```text
DeepSeek-7B      http://10.221.34.101:8000  编剧 / 导演 / Agent
FLUX.2-klein     http://10.221.34.101:8096  人物 / 场景 / 分镜 / 视频首帧
MiniMax-H3       http://10.221.34.101:8091  文生视频 / 图生视频 / 音视频
Studio API       http://127.0.0.1:8787       SQLite 项目状态与制作数据
```

## 已实现

- SQLite 持久化 Project / Scene / Shot / Job。
- SQLite 使用 WAL 模式，项目修改自动保存。
- 项目概览与制作能力矩阵。
- 小说/故事梗概通过 DeepSeek 生成剧本方案。
- 场次结构管理。
- 镜头板与镜头参数编辑。
- FLUX `/v1/images/generations` 生成视频首帧。
- MiniMax-H3 T2VA / FL2VA / Ref2VA 调用与任务轮询。
- DeepSeek / FLUX / MiniMax / SQLite 健康状态检测。

## 能力矩阵

| 场景能力 | 执行模型 | 当前成熟度 |
| --- | --- | --- |
| 小说转剧本 | DeepSeek | ★★★★★ |
| 分镜规划 | DeepSeek | ★★★★☆ |
| 人物设定 | DeepSeek + FLUX | ★★★★☆ |
| 人物定妆图 | FLUX | ★★★★☆ |
| 场景设计 | FLUX | ★★★★★ |
| 分镜图 | FLUX | ★★★★★ |
| 视频首帧 | FLUX | ★★★★★ |
| 文生视频 | H3 | ★★★★★ |
| 图生视频 | FLUX + H3 | ★★★★★ |
| 短剧 | 三者组合 | ★★★★☆ |
| 广告 | 三者组合 | ★★★★★ |
| MV | 三者组合 | ★★★★☆ |
| 漫剧 | 三者组合 | ★★★★★ |
| 数字人 | H3 | ★★★☆☆ |
| 电视剧 | 三者 + 制作系统 | ★★★☆☆ |
| 电影 | 三者 + 完整生产系统 | ★★★☆☆ |

## 运行环境

SQLite 后端使用 Node.js 内置 `node:sqlite`，要求：

```text
Node.js >= 22.5.0
```

复制环境变量：

```powershell
Copy-Item .env.example .env.local
```

Linux：

```bash
cp .env.example .env.local
```

根据实际环境修改 `.env.local`。

## 启动 SQLite Studio API

终端 1：

```bash
npm run server
```

首次启动会自动创建：

```text
data/studio.db
```

数据库文件、WAL 和 SHM 已加入 `.gitignore`，不会上传 GitHub。

健康检查：

```bash
curl http://127.0.0.1:8787/health
```

## 启动前端

终端 2：

```bash
npm install
npm run dev
```

默认：

```text
http://127.0.0.1:4173
```

## 数据模型

```text
Project
  └── Scene
       └── Shot

Project
  └── Job

Capabilities
```

SQLite 表：

```text
projects
scenes
shots
jobs
capabilities
```

## 生产链路

```text
故事 / 小说
   ↓
DeepSeek Director
   ↓
Scene / Shot
   ↓
FLUX 首帧 / 视觉资产
   ↓
MiniMax-H3 视频生成
   ↓
Job 状态
   ↓
SQLite Production State
```

## 架构权衡

当前 SQLite 适合单机导演工作台和早期 MVP：部署简单、事务明确、无需单独数据库服务。

当未来出现多人协作、多 Worker 并发写入、远程任务调度和大规模素材索引时，应将业务数据库迁移到 PostgreSQL，并增加 Redis + Worker Queue。媒体文件不应写入 SQLite BLOB，建议存储在本地对象目录、MinIO 或 S3，仅在数据库保存 URI 和元数据。
