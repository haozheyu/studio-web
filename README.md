# 片场 · AI Drama Studio Web

Vue 3 + TypeScript 的本地 AI 短剧导演工作台。开发服务器通过 Vite 代理连接三个 OpenAI 兼容端点，浏览器无需直接跨域访问局域网模型。

```powershell
npm install
npm run dev
```

模型路由在 `vite.config.ts` 中配置：DeepSeek `:8000`、FLUX.2-klein `:8096`、MiniMax-H3 `:8091`。当前导演对话已接通 DeepSeek `/v1/chat/completions`；FLUX 与 MiniMax 在工作流中作为镜头任务目标展示，具体生成请求需按服务实际暴露的生成端点补齐。
