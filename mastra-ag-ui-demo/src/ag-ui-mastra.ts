// src/ag-ui-mastra.ts
import express, { Request, Response } from "express";
import cors from "cors";
import { z } from "zod";

import { EventEncoder } from "@ag-ui/encoder";

const app = express();
app.use(cors());
app.use(express.json());

// Простая схема входных данных AG-UI (под то, что шлёт Chat.vue)
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

  // Включаем SSE
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  // 👇 важное место — говорим TS, что нам не нужны строгие типы
  const encoder: any = new EventEncoder();

  // 1) RUN_STARTED
  encoder.encode({
    type: "RUN_STARTED",
    threadId: input.threadId,
    runId: input.runId,
  });

  res.write(
    encoder.encode({
      type: "RUN_STARTED",
      threadId: input.threadId,
      runId: input.runId,
    } as any),
  );

  // 2) Берём последнее user-сообщение
  const lastUser = [...input.messages].reverse().find((m) => m.role === "user");
  const userText = lastUser?.content ?? "empty message";

  // 3) Простейший ответ
  const replyText = `Псевдо-ответ агента на: "${userText}"`;

  // 4) Начинаем текстовое сообщение
  res.write(
    encoder.encode({
      type: "TEXT_MESSAGE_START",
      messageId: "assistant-1",
      role: "assistant",
    } as any),
  );

  // 5) Стримим текст по кусочкам
  const chunkSize = 20;
  for (let i = 0; i < replyText.length; i += chunkSize) {
    const chunk = replyText.slice(i, i + chunkSize);
    if (!chunk) continue;

    res.write(
      encoder.encode({
        type: "TEXT_MESSAGE_CONTENT",
        messageId: "assistant-1",
        delta: chunk,
      } as any),
    );

    // небольшая задержка для эффекта "печати"
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, 30));
  }

  // 6) Завершаем текст
  res.write(
    encoder.encode({
      type: "TEXT_MESSAGE_END",
      messageId: "assistant-1",
    } as any),
  );

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
    `AG-UI dummy server running at http://localhost:${PORT}/mastra-agent`,
  );
});
