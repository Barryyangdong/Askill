/** Decode incrementally, including multibyte text split across network packets. */
export async function readNdjson(response: Response, onEvent: (event: any) => void, signal?: AbortSignal): Promise<void> {
  if (!response.ok || !response.body) throw new Error("无法建立实时连接，请重试。");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  const feed = (text: string) => {
    const lines = (pending + text).split("\n");
    pending = lines.pop() ?? "";
    if (pending.length > 1024 * 1024) throw new Error("实时消息超出上限。");
    for (const line of lines) if (line.trim()) {
      let event: unknown;
      try { event = JSON.parse(line); }
      catch { throw new Error("实时消息格式异常，连接已停止；已生成内容保留。"); }
      onEvent(event);
    }
  };
  try {
    while (true) {
      signal?.throwIfAborted();
      const next = await reader.read();
      if (next.done) break;
      feed(decoder.decode(next.value, { stream: true }));
    }
    feed(decoder.decode() + "\n");
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
