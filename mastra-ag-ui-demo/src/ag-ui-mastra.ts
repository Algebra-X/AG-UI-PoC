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

const aguiInputSchema = z.object({
  threadId: z.string(),
  runId: z.string(),
  messages: z.array(messageSchema),
  tools: z.array(z.unknown()).optional(),
  context: z.array(z.unknown()).optional(),
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
  } catch (e) {
    console.warn("Failed to parse weather JSON:", jsonStr);
  }

  const cleanText = text.replace(regex, "").trim();
  return { cleanText, weather };
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

  const encoder: any = new EventEncoder();

  // ✅ уникальный id для каждого ответа
  const messageId = `assistant-${input.runId}`;

  // 1) RUN_STARTED
  res.write(
    encoder.encode({
      type: "RUN_STARTED",
      threadId: input.threadId,
      runId: input.runId,
    } as any),
  );

  // Берём последнее user-сообщение (для UI fallback)
  const lastUser = [...input.messages].reverse().find((m) => m.role === "user");
  const userText = lastUser?.content ?? "empty message";

  // 2) Вызываем Mastra weatherAgent
  let replyText = "";

  const weatherAgent =
    (mastra as any).getAgent?.("weatherAgent") ??
    (mastra as any).agents?.weatherAgent;

  if (!weatherAgent) {
    console.error("weatherAgent not found in mastra");
    replyText = `Could not find weatherAgent. Pseudo-response to: "${userText}"`;
  } else {
    try {
      const mastraMessages = input.messages
        .filter((m) => ["user", "assistant", "system"].includes(m.role))
        .map((m) => ({
          role: m.role as "user" | "assistant" | "system",
          content: m.content,
        }));

      const result: any = await (weatherAgent as any).generate(
        mastraMessages as any,
      );

      replyText =
        result?.text ??
        (typeof result === "string" ? result : String(result ?? ""));
    } catch (err) {
      console.error("weatherAgent error:", err);
      replyText = `Sorry, I couldn't get the weather. Details: ${String(err)}`;
    }
  }

  // ✅ вытаскиваем JSON и чистим текст
  const { cleanText, weather } = extractWeatherJson(replyText);

  // 3) TEXT_MESSAGE_START
  res.write(
    encoder.encode({
      type: "TEXT_MESSAGE_START",
      messageId,
      role: "assistant",
    } as any),
  );

  // 4) Стримим ответ чанками (ТОЛЬКО cleanText!)
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

    await new Promise((resolve) => setTimeout(resolve, 30));
  }

  // 5) TEXT_MESSAGE_END
  res.write(
    encoder.encode({
      type: "TEXT_MESSAGE_END",
      messageId,
    } as any),
  );

  // 6) UI_COMPONENT (реальные данные из weather JSON)
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
    // fallback если агент не прислал JSON
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

  // 7) RUN_FINISHED
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
    `AG-UI Mastra server (with weatherAgent) running at http://localhost:${PORT}/mastra-agent`,
  );
});
