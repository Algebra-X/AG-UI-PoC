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

// role + tool
const messageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant", "system", "tool"]),
  content: z.string(),
  toolCallId: z.string().optional(),
  name: z.string().optional(),
});

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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function stepStarted(encoder: EventEncoder, stepId: string, title: string) {
  return encoder.encode({ type: "STEP_STARTED", stepId, title } as any);
}
function stepFinished(encoder: EventEncoder, stepId: string) {
  return encoder.encode({ type: "STEP_FINISHED", stepId } as any);
}
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

/**
 * Time-intent detector (RU + EN)
 */
function needsClientTime(userText: string) {
  const t = userText.toLowerCase().trim();

  const ruTriggers = [
    "который час",
    "который сейчас час",
    "сколько времени",
    "сколько сейчас времени",
    "текущее время",
    "время сейчас",
    "какое сейчас время",
  ];

  const enTriggers = [
    "what time is it",
    "current time",
    "local time",
    "time now",
    "clock",
  ];

  if (ruTriggers.some((x) => t.includes(x))) return true;
  if (enTriggers.some((x) => t.includes(x))) return true;

  if (/(котор(ый|ая|ое)\s+.*час)/i.test(t)) return true;
  if (/(сколько\s+.*времен)/i.test(t)) return true;

  return false;
}

/**
 * Searching for tool-result getClientTime AFTER the last user message.
 */
function findLatestClientTimeResult(messages: any[]) {
  const lastUserIdx =
    [...messages]
      .map((m, i) => ({ m, i }))
      .reverse()
      .find((x) => x.m.role === "user")?.i ?? -1;

  const afterLastUser = messages.slice(lastUserIdx + 1);

  const toolMsg = [...afterLastUser]
    .reverse()
    .find((m) => m.role === "tool" && m.name === "getClientTime");

  return toolMsg;
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

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  const encoder = new EventEncoder();
  const messageId = `assistant-${input.runId}`;

  res.write(
    encoder.encode({
      type: "RUN_STARTED",
      threadId: input.threadId,
      runId: input.runId,
    } as any),
  );

  const lastUser = [...input.messages].reverse().find((m) => m.role === "user");
  const userText = lastUser?.content ?? "empty message";

  // =========================================================
  // TIME SCENARIO 
  // =========================================================
  if (needsClientTime(userText)) {
    const existingTime = findLatestClientTimeResult(input.messages);

    if (!existingTime) {
      // ---- RUN-1: only tool request ----
      await runStep(
        res,
        encoder,
        `step-${input.runId}-1`,
        "Detecting that the user is asking for local time",
        650,
      );

      await runStep(
        res,
        encoder,
        `step-${input.runId}-2`,
        "Requesting local time from the browser",
        450,
      );

      const timeToolCallId = `client-time-${input.threadId}`;

      res.write(
        encoder.encode({
          type: "TOOL_CALL_START",
          toolCallId: timeToolCallId,
          toolCallName: "getClientTime",
        } as any),
      );

      res.write(
        encoder.encode({
          type: "TOOL_CALL_ARGS",
          toolCallId: timeToolCallId,
          delta: JSON.stringify({ format: "iso" }),
        } as any),
      );

      res.write(
        encoder.encode({
          type: "TOOL_CALL_END",
          toolCallId: timeToolCallId,
        } as any),
      );

      res.write(
        encoder.encode({
          type: "RUN_FINISHED",
          threadId: input.threadId,
          runId: input.runId,
          pendingToolCall: {
            toolCallId: timeToolCallId,
            toolCallName: "getClientTime",
            args: { format: "iso" },
            reason: "user asked about local time",
          },
        } as any),
      );

      res.end();
      return;
    }

    // ---- RUN-2: response based on the ready tool-result ----
    await runStep(
      res,
      encoder,
      `step-${input.runId}-1`,
      "Reading the time returned by the browser tool",
      450,
    );

    await runStep(
      res,
      encoder,
      `step-${input.runId}-2`,
      "Replying with the user's local time",
      300,
    );

    const timeText = existingTime.content;
    const answer = `Your local time is: ${timeText}`;

    res.write(
      encoder.encode({
        type: "TEXT_MESSAGE_START",
        messageId,
        role: "assistant",
      } as any),
    );

    for (let i = 0; i < answer.length; i += 20) {
      res.write(
        encoder.encode({
          type: "TEXT_MESSAGE_CONTENT",
          messageId,
          delta: answer.slice(i, i + 20),
        } as any),
      );
      await sleep(20);
    }

    res.write(
      encoder.encode({
        type: "TEXT_MESSAGE_END",
        messageId,
      } as any),
    );

    res.write(
      encoder.encode({
        type: "RUN_FINISHED",
        threadId: input.threadId,
        runId: input.runId,
      } as any),
    );

    res.end();
    return;
  }

  // =========================================================
  //  WEATHER SCENARIO
  // =========================================================
  await runStep(
    res,
    encoder,
    `step-${input.runId}-1`,
    "Interpreting the user's weather request",
    1000,
  );

  await runStep(
    res,
    encoder,
    `step-${input.runId}-2`,
    "Extracting location from the conversation",
    450,
  );

  await runStep(
    res,
    encoder,
    `step-${input.runId}-3`,
    "Preparing a weather data tool call",
    450,
  );

  const weatherAgent =
    (mastra as any).getAgent?.("weatherAgent") ??
    (mastra as any).agents?.weatherAgent;

  let replyText = "";

  if (!weatherAgent) {
    replyText = `Could not find weatherAgent. Pseudo-response to: "${userText}"`;
  } else {
    const step4 = `step-${input.runId}-4`;
    res.write(stepStarted(encoder, step4, "Running the Mastra weather agent"));

    try {
      const mastraMessages = input.messages
        .filter(
          (m) =>
            (m.role === "user" ||
              m.role === "assistant" ||
              m.role === "system" ||
              m.role === "tool") &&
            String(m.content ?? "").trim().length > 0,
        )
        .map((m) => {
          if (m.role === "tool") {
            return {
              role: "system" as const,
              content: `Tool result (${m.name ?? "tool"} / ${m.toolCallId}): ${m.content}`,
            };
          }
          return {
            role: m.role as "user" | "assistant" | "system",
            content: m.content,
          };
        });

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
      replyText = `Sorry, I couldn't get the weather. Details: ${String(err)}`;
    } finally {
      res.write(stepFinished(encoder, step4));
    }
  }

  await runStep(
    res,
    encoder,
    `step-${input.runId}-5`,
    "Formatting the response and weather card",
    350,
  );

  const { cleanText, weather } = extractWeatherJson(replyText);

  res.write(
    encoder.encode({
      type: "TEXT_MESSAGE_START",
      messageId,
      role: "assistant",
    } as any),
  );

  for (let i = 0; i < cleanText.length; i += 20) {
    const chunk = cleanText.slice(i, i + 20);
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

  res.write(
    encoder.encode({
      type: "TEXT_MESSAGE_END",
      messageId,
    } as any),
  );

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
  }

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
    `AG-UI Mastra server (Frontend tool calls + Thinking + UI) running at http://localhost:${PORT}/mastra-agent`,
  );
});
