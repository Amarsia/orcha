export async function* readServerSentEvents(
  response: Response,
): AsyncGenerator<Record<string, unknown>> {
  if (!response.body) {
    throw new Error("Provider returned an empty streaming response.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let dataLines: string[] = [];

  const processLine = (
    line: string,
  ): Record<string, unknown> | undefined => {
    const normalized = line.endsWith("\r") ? line.slice(0, -1) : line;
    if (normalized) {
      if (normalized.startsWith("data:")) {
        dataLines.push(normalized.slice(5).trimStart());
      }
      return undefined;
    }
    if (dataLines.length === 0) {
      return undefined;
    }
    const data = dataLines.join("\n");
    dataLines = [];
    return data === "[DONE]"
      ? undefined
      : (JSON.parse(data) as Record<string, unknown>);
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex >= 0) {
        const event = processLine(buffer.slice(0, newlineIndex));
        if (event) {
          yield event;
        }
        buffer = buffer.slice(newlineIndex + 1);
        newlineIndex = buffer.indexOf("\n");
      }
      if (done) {
        break;
      }
    }
    if (buffer) {
      const event = processLine(buffer);
      if (event) {
        yield event;
      }
    }
    const finalEvent = processLine("");
    if (finalEvent) {
      yield finalEvent;
    }
  } finally {
    reader.releaseLock();
  }
}
