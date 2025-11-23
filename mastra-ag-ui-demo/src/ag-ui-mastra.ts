// src/ag-ui-mastra.ts
import "dotenv/config";
import express, { Request, Response } from "express";
import cors from "cors";
import { z } from "zod";

import { EventEncoder } from "@ag-ui/encoder";
import { mastra } from "./mastra";

const app = express();
app.use(cors());
app.use(express.json());

const messageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant", "system"]),
  content: z.string(),
});

// правильные схемы tools/context под твой payload
const toolSchema = z.object({
  name: z.string(),
  description: z.string(),
  parameters: z.any().optional(),
});

const contextSchema = z.object({
  value: z.string(),
  description: z.string(),
});

const aguiInputSchema = z.object({
  threadId: z.string(),
  runId: z.string(),
  messages: z.array(messageSchema),
  tools: z.array(toolSchema).optional(),
  context: z.array(contextSchema).optional(),
  forwardedProps: z.record(z.unknown()).optional(),
  state: z.record(z.unknown()).optional(),
});

type WeatherPayload = {
  location: string;
  temperatureC: number;
  status: string;
  humidityPct: number;
  windMs: number;
};

// ищем в тексте блок:
// ```weather
// {...json...}
// ```
function extractWeatherJson(text: string): {
  cleanText: string;
  weather?: WeatherPayload;
} {
  const regex = /```weather\s*([\s\S]*?)```/i;
  const match = text.match(regex);

  if (!match) return { cleanText: text };

  const jsonStr = match[1].trim();
  let weather: WeatherPayload | undefined;

  try {
    weather = JSON.parse(jsonStr);
  } catch {
    console.warn("Failed to parse weather JSON:", jsonStr);
  }

  const cleanText = text.replace(regex, "").trim();
  return { cleanText, weather };
}

// helper для задержек
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// helper для шагов
function stepStarted(encoder: EventEncoder, stepId: string, title: string) {
  return encoder.encode({
    type: "STEP_STARTED",
    stepId,
    title,
  } as any);
}

function stepFinished(encoder: EventEncoder, stepId: string) {
  return encoder.encode({
    type: "STEP_FINISHED",
    stepId,
  } as any);
}

// helper чтобы шаги были компактные
async function runStep(
  res: Response,
  encoder: EventEncoder,
  stepId: string,
  title: string,
  ms: number,
) {
  res.write(stepStarted(encoder, stepId, title));
  await sleep(ms);
  res.write(stepFinished(encoder, stepId));
}

app.post("/mastra-agent", async (req: Request, res: Response) => {
  const parsed = aguiInputSchema.safeParse(req.body);

  if (!parsed.success) {
    console.error("Invalid AG-UI payload:", parsed.error.format());
    res.status(400).json({
      error: "Invalid AG-UI payload",
      details: parsed.error.format(),
    });
    return;
  }

  const input = parsed.data;

  // SSE headers
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  const encoder = new EventEncoder();

  // уникальный messageId на каждый run
  const messageId = `assistant-${input.runId}`;

  // 1) RUN_STARTED
  res.write(
    encoder.encode({
      type: "RUN_STARTED",
      threadId: input.threadId,
      runId: input.runId,
    } as any),
  );

  // Берём последнее user-сообщение (fallback + props)
  const lastUser = [...input.messages].reverse().find((m) => m.role === "user");
  const userText = lastUser?.content ?? "empty message";

  // === THINKING STEPS (English, first longer) ===
  await runStep(
    res,
    encoder,
    `step-${input.runId}-1`,
    "Understanding the user's request",
    1200,
  );

  await runStep(
    res,
    encoder,
    `step-${input.runId}-2`,
    "Extracting location from the message",
    450,
  );

  await runStep(
    res,
    encoder,
    `step-${input.runId}-3`,
    "Preparing tool call for weather data",
    500,
  );

  // достаём агента
  const weatherAgent =
    (mastra as any).getAgent?.("weatherAgent") ??
    (mastra as any).agents?.weatherAgent;

  let replyText = "";

  if (!weatherAgent) {
    console.error("weatherAgent not found in mastra");
    replyText = `Could not find weatherAgent. Pseudo-response to: "${userText}"`;
  } else {
    // ✅ ШАГ 4 ДОЛЖЕН ИДТИ РОВНО СТОЛЬКО, СКОЛЬКО ДУМАЕТ АГЕНТ
    const step4 = `step-${input.runId}-4`;
    res.write(stepStarted(encoder, step4, "Running Mastra weather agent"));

    try {
      const mastraMessages = input.messages
        .filter(
          (m) =>
            (m.role === "user" ||
              m.role === "assistant" ||
              m.role === "system") &&
            String(m.content ?? "").trim().length > 0,
        )
        .map((m) => ({
          role: m.role as "user" | "assistant" | "system",
          content: m.content,
        }));

      if (mastraMessages.length === 0) {
        mastraMessages.push({
          role: "user",
          content: userText || "hi",
        });
      }

      const result: any = await (weatherAgent as any).generate(
        mastraMessages as any,
      );

      replyText =
        result?.text ??
        (typeof result === "string" ? result : String(result ?? ""));
    } catch (err) {
      console.error("weatherAgent error:", err);
      replyText = `Sorry, I couldn't get the weather. Details: ${String(err)}`;
    } finally {
      // ✅ теперь шаг 4 завершаем только ПОСЛЕ агента
      res.write(stepFinished(encoder, step4));
    }
  }

  // маленький шаг “сборки ответа”
  await runStep(
    res,
    encoder,
    `step-${input.runId}-5`,
    "Formatting response and UI card",
    350,
  );

  // вытаскиваем JSON и чистим текст
  const { cleanText, weather } = extractWeatherJson(replyText);

  // 2) TEXT_MESSAGE_START
  res.write(
    encoder.encode({
      type: "TEXT_MESSAGE_START",
      messageId,
      role: "assistant",
    } as any),
  );

  // 3) TEXT_MESSAGE_CONTENT (стрим cleanText)
  const chunkSize = 20;
  for (let i = 0; i < cleanText.length; i += chunkSize) {
    const chunk = cleanText.slice(i, i + chunkSize);
    if (!chunk) continue;

    res.write(
      encoder.encode({
        type: "TEXT_MESSAGE_CONTENT",
        messageId,
        delta: chunk,
      } as any),
    );

    await sleep(30);
  }

  // 4) TEXT_MESSAGE_END
  res.write(
    encoder.encode({
      type: "TEXT_MESSAGE_END",
      messageId,
    } as any),
  );

  // 5) UI_COMPONENT (реальные данные из weather JSON)
  if (weather) {
    res.write(
      encoder.encode({
        type: "UI_COMPONENT",
        messageId,
        component: "weather-card",
        props: {
          location: weather.location,
          temperature: `${weather.temperatureC}°C`,
          status: weather.status,
          humidity: `${weather.humidityPct}%`,
          wind: `${weather.windMs} m/s`,
        },
      } as any),
    );
  } else {
    res.write(
      encoder.encode({
        type: "UI_COMPONENT",
        messageId,
        component: "weather-card",
        props: {
          location: userText || "Unknown",
          temperature: "—",
          status: "No data",
          humidity: "—",
          wind: "—",
        },
      } as any),
    );
  }

  // 6) RUN_FINISHED
  res.write(
    encoder.encode({
      type: "RUN_FINISHED",
      threadId: input.threadId,
      runId: input.runId,
    } as any),
  );

  res.end();
});

const PORT = 8000;
app.listen(PORT, () => {
  console.log(
    `AG-UI Mastra server (Thinking Steps + UI + weather JSON) running at http://localhost:${PORT}/mastra-agent`,
  );
});
