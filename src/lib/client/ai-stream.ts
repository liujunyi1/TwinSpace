export type AiStreamEvent =
  | {
      type: "start";
      userMessage?: unknown;
      assistantId?: string;
      kind?: string;
    }
  | {
      type: "delta";
      delta: string;
    }
  | {
      type: "replace";
      text: string;
      streamed: false;
    }
  | {
      type: "done";
      streamed: boolean;
    }
  | {
      type: "error";
      message: string;
    };

function parseEvent(line: string): AiStreamEvent {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    throw new Error("服务返回了无法解析的流式数据");
  }

  if (!value || typeof value !== "object") {
    throw new Error("服务返回了无效的流式事件");
  }

  const record = value as Record<string, unknown>;
  const type = record.type ?? record.event;
  if (
    type !== "start" &&
    type !== "delta" &&
    type !== "replace" &&
    type !== "done" &&
    type !== "error"
  ) {
    throw new Error("服务返回了未知的流式事件");
  }

  return { ...record, type } as AiStreamEvent;
}

export async function readAiStream(
  response: Response,
  onEvent: (event: AiStreamEvent) => void
) {
  if (!response.body) {
    throw new Error(`服务没有返回内容（HTTP ${response.status}）`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const consumeLine = (line: string) => {
    const trimmed = line.trim();
    if (trimmed) onEvent(parseEvent(trimmed));
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      consumeLine(buffer.slice(0, newlineIndex).replace(/\r$/, ""));
      buffer = buffer.slice(newlineIndex + 1);
      newlineIndex = buffer.indexOf("\n");
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) consumeLine(buffer);
}
