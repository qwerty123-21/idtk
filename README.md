# AI 关联猜词游戏：关系提示优化版

这版优化了“关联提示”：

- AI 必须提到玩家猜的词
- AI 不能直接说出隐藏答案，会用“那个词”代替
- AI 必须讲具体关系，比如：属性、组成、场景、功能、因果、同类、反义、谐音、常见搭配
- 禁止“月色是它在夜里悄悄撒下的银白”这种写诗式废话

默认配置：

```text
API 地址：https://api.secondzero-ai.com/v1/chat/completions
模型：gpt-5.3-codex-spark
```

## 上传 GitHub

解压后，把这些文件上传到 GitHub 仓库根目录：

```text
package.json
server.js
README.md
.gitignore
public/
```

不要上传压缩包本身。

## Railway

GitHub 上传后，Railway 会自动部署。  
部署完成后打开 Railway 生成的网址，在网页里填写 API Key，然后点“保存到本机浏览器”。

API Key 不会写进 GitHub，也不需要填 Railway Variables。

## 本地运行

```bash
npm install
npm start
```

然后打开：

```text
http://localhost:3000
```
