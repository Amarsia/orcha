declare module "@google/genai/web" {
  export class GoogleGenAI {
    constructor(configuration: Record<string, unknown>);
    models: import("../providers/google-gemini.js").GoogleContentClient["models"];
  }
}

declare module "@google/genai/node" {
  export class GoogleGenAI {
    constructor(configuration: Record<string, unknown>);
    models: import("../providers/google-gemini.js").GoogleContentClient["models"];
  }
}
