import express from "express";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";
import { pinyin } from "pinyin-pro";

const app = express();
const PORT = process.env.PORT || 3000;

const DEFAULT_AI_API_URL = "https://api.secondzero-ai.com/v1/chat/completions";
const DEFAULT_AI_MODEL = "gpt-5.3-codex-spark";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const games = new Map();
const GAME_TTL_MS = 2 * 60 * 60 * 1000;

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

setInterval(() => {
  const now = Date.now();
  for (const [id, game] of games.entries()) {
    if (now - game.createdAt > GAME_TTL_MS) {
      games.delete(id);
    }
  }
}, 10 * 60 * 1000);

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    defaultApiHost: safeHost(DEFAULT_AI_API_URL),
    defaultModel: DEFAULT_AI_MODEL,
    node: process.version
  });
});

app.post("/api/new-game", async (req, res) => {
  try {
    const ai = getAIConfig(req);
    const category = safeText(req.body?.category || "随机", 20);
    const difficulty = safeText(req.body?.difficulty || "普通", 20);

    const word = await generateSecretWord(ai, category, difficulty);
    const code = makeCode(word);
    const gameId = crypto.randomUUID();

    games.set(gameId, {
      word,
      code,
      category,
      difficulty,
      lives: 8,
      rounds: 0,
      over: false,
      createdAt: Date.now(),
      guesses: []
    });

    res.json({
      gameId,
      code,
      lives: 8,
      rounds: 0
    });
  } catch (err) {
    console.error("[new-game error]", err);
    res.status(500).json({ error: friendlyError(err) });
  }
});

app.post("/api/guess", async (req, res) => {
  try {
    const ai = getAIConfig(req);
    const gameId = String(req.body?.gameId || "");
    const guess = cleanGuess(req.body?.guess || "");
    const game = games.get(gameId);

    if (!game) {
      return res.status(404).json({ error: "游戏不存在或已过期，请重新开始。" });
    }

    if (game.over) {
      return res.json({
        correct: false,
        over: true,
        answer: game.word,
        message: `这一局已经结束，答案是：${game.word}`
      });
    }

    if (!guess) {
      return res.status(400).json({ error: "请输入你的猜测。" });
    }

    game.rounds += 1;
    game.guesses.push(guess);

    if (normalizeText(guess) === normalizeText(game.word)) {
      game.over = true;
      return res.json({
        correct: true,
        over: true,
        answer: game.word,
        rounds: game.rounds,
        lives: game.lives,
        message: `答对了！答案就是「${game.word}」。你用了 ${game.rounds} 回合。`
      });
    }

    game.lives -= 1;

    const message = await generateAssociationHint(
      ai,
      game.word,
      guess,
      game.code,
      game.difficulty
    );

    if (game.lives <= 0) {
      game.over = true;
      return res.json({
        correct: false,
        over: true,
        answer: game.word,
        rounds: game.rounds,
        lives: 0,
        message: `${message}\n机会用完了，答案是「${game.word}」。`
      });
    }

    res.json({
      correct: false,
      over: false,
      rounds: game.rounds,
      lives: game.lives,
      message
    });
  } catch (err) {
    console.error("[guess error]", err);
    res.status(500).json({ error: friendlyError(err) });
  }
});

app.post("/api/hint", async (req, res) => {
  try {
    const ai = getAIConfig(req);
    const gameId = String(req.body?.gameId || "");
    const game = games.get(gameId);

    if (!game) {
      return res.status(404).json({ error: "游戏不存在或已过期，请重新开始。" });
    }

    if (game.over) {
      return res.json({
        over: true,
        answer: game.word,
        message: `这一局已经结束，答案是：${game.word}`
      });
    }

    if (game.lives > 1) {
      game.lives -= 1;
    }

    const message = await generateExtraHint(
      ai,
      game.word,
      game.code,
      game.category,
      game.difficulty
    );

    res.json({
      over: false,
      lives: game.lives,
      rounds: game.rounds,
      message: `${message}\n提示消耗 1 次机会。`
    });
  } catch (err) {
    console.error("[hint error]", err);
    res.status(500).json({ error: friendlyError(err) });
  }
});

app.post("/api/reveal", (req, res) => {
  const gameId = String(req.body?.gameId || "");
  const game = games.get(gameId);

  if (!game) {
    return res.status(404).json({ error: "游戏不存在或已过期，请重新开始。" });
  }

  game.over = true;

  res.json({
    over: true,
    answer: game.word,
    message: `答案公布：${game.word}`
  });
});

app.listen(PORT, () => {
  console.log(`AI 关联猜词游戏已启动：http://localhost:${PORT}`);
  console.log(`[config] Default API host: ${safeHost(DEFAULT_AI_API_URL)}`);
  console.log(`[config] Default model: ${DEFAULT_AI_MODEL}`);
});

function getAIConfig(req) {
  const apiKey = String(req.headers["x-ai-api-key"] || "").trim();
  const apiUrl = String(req.headers["x-ai-api-url"] || DEFAULT_AI_API_URL).trim();
  const model = String(req.headers["x-ai-model"] || DEFAULT_AI_MODEL).trim();

  if (!apiKey) {
    throw new Error("请先在网页里填写 API Key。");
  }

  return { apiKey, apiUrl, model };
}

async function generateSecretWord(ai, category, difficulty) {
  const prompt = `
你是一个中文关联猜词游戏出题器。

请生成一个适合玩家猜的中文词语。

要求：
- 题材：${category}
- 难度：${difficulty}
- 只生成中文词语
- 2 到 4 个汉字
- 不要英文、数字、标点
- 不要太冷门
- 不要使用敏感、成人、政治攻击内容
- 不要生成专有名词、人名、地名
- 返回严格 JSON，不要 Markdown，不要解释

JSON 格式：
{
  "word": "答案词"
}
`;

  for (let i = 0; i < 3; i++) {
    const content = await callAI(ai, [
      { role: "system", content: "你只输出合法 JSON，不输出 Markdown。" },
      { role: "user", content: prompt }
    ], {
      temperature: 0.9,
      max_tokens: 120,
      response_format: { type: "json_object" }
    });

    const data = parseJson(content);
    const word = cleanWord(data.word);

    if (isGoodChineseWord(word)) {
      return word;
    }
  }

  throw new Error("AI 没有生成合格词语，请再试一次。");
}

async function generateAssociationHint(ai, answer, guess, code, difficulty) {
  const prompt = `
你是中文“关联猜词”游戏的反馈助手。

隐藏答案是：「${answer}」
玩家猜的是：「${guess}」
公开线索是：「${code}」
难度是：「${difficulty}」

你的任务：
给出「玩家猜的词」和「隐藏答案」之间的具体关系提示。

非常重要：
- 不能直接说出隐藏答案
- 不能出现隐藏答案这个完整词
- 必须用“那个词”代替隐藏答案
- 必须明确提到玩家猜的词：「${guess}」
- 必须说明一种具体关系，不要写诗，不要空泛比喻
- 关系类型只能从这些里面选：属性、组成、场景、功能、因果、同类、反义、谐音、常见搭配、上下位关系
- 只输出一句中文
- 25 到 55 个中文字符
- 不要说“你猜错了”
- 不要说“没有关联”
- 不要说“答案是”

推荐句式：
- 「${guess}」是那个词相关场景里的……
- 「${guess}」和那个词都属于……
- 「${guess}」常和那个词一起出现在……
- 「${guess}」是那个词带来的/产生的/照出的……
- 「${guess}」可以作为那个词的……

好例子：
隐藏答案「月亮」，玩家猜「月色」：
「月色」是那个词照出来的光感。

隐藏答案「月亮」，玩家猜「音乐」：
「音乐」常是那个词出现时的夜晚背景。

隐藏答案「犹豫」，玩家猜「床单」：
「床单」所在的床上，人可能会陷入那个词。

隐藏答案「苹果」，玩家猜「水果」：
「水果」是那个词所属的大类。

坏例子，禁止这样写：
- 那个词在夜里悄悄撒下银白。
- 你说音乐时，那个词会随旋律一起摇晃。
- 它们都很美。
- 有一点关系。

现在请按规则输出一句关系提示。
`;

  const text = await callAI(ai, [
    {
      role: "system",
      content: "你是中文猜词游戏裁判。回答必须具体、像正常人解释关系，禁止诗意废话。"
    },
    {
      role: "user",
      content: prompt
    }
  ], {
    temperature: 0.45,
    max_tokens: 120
  });

  return enforceRelationText(text, answer, guess);
}

async function generateExtraHint(ai, answer, code, category, difficulty) {
  const prompt = `
你是中文关联猜词游戏的提示助手。

隐藏答案是：「${answer}」
公开线索是：「${code}」
题材是：「${category}」
难度是：「${difficulty}」

请给玩家一个额外提示。

规则：
- 不能直接说出隐藏答案
- 不能出现隐藏答案这个完整词
- 必须用“那个词”代替隐藏答案
- 不要透露拼音
- 不要透露具体字形
- 不能说“答案是”
- 只输出一句中文
- 20 到 45 个中文字符
- 提示要具体，不要写诗

例子：
那个词常出现在夜晚，也常和抬头看有关。
`;

  const text = await callAI(ai, [
    { role: "system", content: "你是中文猜词游戏提示助手，回答具体、简短，不要写诗。" },
    { role: "user", content: prompt }
  ], {
    temperature: 0.55,
    max_tokens: 100
  });

  return sanitizeModelText(text, answer);
}

async function callAI(ai, messages, options = {}) {
  const body = {
    model: ai.model,
    messages,
    temperature: options.temperature ?? 0.8,
    max_tokens: options.max_tokens ?? 200,
    stream: false
  };

  if (options.response_format) {
    body.response_format = options.response_format;
  }

  return await postAI(ai, body, Boolean(options.response_format));
}

async function postAI(ai, body, canRetryWithoutResponseFormat) {
  let response = await fetch(ai.apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ai.apiKey}`
    },
    body: JSON.stringify(body)
  });

  if (!response.ok && canRetryWithoutResponseFormat) {
    const firstErrorText = await response.text();
    console.error("[AI first request failed, retry without response_format]", response.status, firstErrorText);

    const retryBody = { ...body };
    delete retryBody.response_format;

    response = await fetch(ai.apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ai.apiKey}`
      },
      body: JSON.stringify(retryBody)
    });
  }

  if (!response.ok) {
    const text = await response.text();
    console.error("[AI API ERROR]", {
      status: response.status,
      apiUrlHost: safeHost(ai.apiUrl),
      model: ai.model,
      body: text
    });
    throw new Error(`AI 接口请求失败：${response.status} ${text}`);
  }

  const data = await response.json();

  const content =
    data?.choices?.[0]?.message?.content ||
    data?.choices?.[0]?.text ||
    "";

  if (!content) {
    console.error("[AI EMPTY RESPONSE]", data);
    throw new Error("AI 没有返回内容。");
  }

  return String(content).trim();
}

function parseJson(text) {
  let clean = String(text || "").trim();

  clean = clean
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  const first = clean.indexOf("{");
  const last = clean.lastIndexOf("}");

  if (first !== -1 && last !== -1) {
    clean = clean.slice(first, last + 1);
  }

  return JSON.parse(clean);
}

function makeCode(word) {
  const chars = Array.from(word);
  const firstChar = chars[0];

  const first = pinyin(firstChar, {
    pattern: "first",
    toneType: "none"
  });

  const letter = String(first || "").charAt(0).toUpperCase();
  return `${letter || "?"}${chars.length}`;
}

function cleanWord(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/[，。！？、,.!?;；:："'“”‘’《》<>[\]()（）{}【】]/g, "");
}

function cleanGuess(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/[，。！？、,.!?;；:："'“”‘’《》<>[\]()（）{}【】]/g, "");
}

function normalizeText(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/[，。！？、,.!?;；:："'“”‘’《》<>[\]()（）{}【】]/g, "")
    .toLowerCase();
}

function isGoodChineseWord(word) {
  return /^[\u4e00-\u9fff]{2,4}$/.test(word);
}

function safeText(value, maxLength) {
  return String(value || "").replace(/[<>]/g, "").slice(0, maxLength);
}

function enforceRelationText(text, answer, guess) {
  let result = sanitizeModelText(text, answer);

  if (guess && !result.includes(guess)) {
    result = `「${guess}」和那个词有关：${result}`;
  }

  const vaguePatterns = [
    "悄悄", "撒下", "摇晃", "很美", "有一点关系", "某种关系", "难以言说", "银白", "诗意"
  ];

  if (vaguePatterns.some((word) => result.includes(word))) {
    result = `「${guess}」和那个词有关：它们常能出现在同一个场景里。`;
  }

  if (result.length > 75) {
    result = result.slice(0, 75);
  }

  return result;
}

function sanitizeModelText(text, answer) {
  let result = String(text || "")
    .replace(/^```[\s\S]*?```$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (answer) {
    result = result.replaceAll(answer, "那个词");
  }

  result = result
    .replace(/^["“]/, "")
    .replace(/["”]$/, "")
    .trim();

  if (result.length > 90) {
    result = result.slice(0, 90);
  }

  return result || "它们常能出现在同一个场景里。";
}

function safeHost(url) {
  try {
    return new URL(url).host;
  } catch {
    return "invalid-url";
  }
}

function friendlyError(err) {
  const msg = String(err?.message || err || "");

  if (msg.includes("403")) {
    return "AI 接口返回 403。通常是余额不足、Key 没权限、模型无权限，或平台拒绝这个请求。";
  }

  if (msg.includes("401")) {
    return "AI 接口返回 401。API Key 可能不对。";
  }

  if (msg.includes("404")) {
    return "AI 接口返回 404。API 地址或模型名可能不对。";
  }

  if (msg.includes("Failed to fetch")) {
    return "请求失败。请刷新页面，或看 Railway 日志确认服务是否重启。";
  }

  return msg || "服务器出错了。";
}
