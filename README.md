# AI 关联猜词游戏：不用 Railway Variables 版

这个版本已经默认配置好 SecondZero：

```text
API URL: https://api.secondzero-ai.com/v1/chat/completions
Model: gemini-3-flash-preview-minimal-search
```

你不需要在 Railway Variables 里填写 API Key。

## 使用方法

1. 把本压缩包解压。
2. 把文件上传到 GitHub 仓库根目录。
3. Railway 连接 GitHub 仓库并部署。
4. 打开 Railway 给你的网址。
5. 在网页里的“API Key”输入框粘贴你的 Key，点“保存到本机浏览器”。
6. 点“开始新游戏”。

Key 不会写进 GitHub，也不会写进 Railway Variables。它只保存在你当前浏览器的 localStorage 里，并在请求你自己的后端时临时发送。

## 本地运行

```bash
npm install
npm start
```

打开：

```text
http://localhost:3000
```

## 注意

不要把真实 API Key 写进 GitHub 代码里。即使仓库现在是 private，以后也容易不小心公开。
