#!/usr/bin/env node

void import("./cli.js").catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  const dependency = ["esbuild", "chokidar", "dotenv"].find((name) =>
    message.includes(`"${name}"`) || message.includes(`'${name}'`),
  );
  if (dependency) {
    console.error(
      `Orcha development tooling requires optional dependencies. Install them with:\n\n  npm install --save-dev esbuild chokidar dotenv`,
    );
  } else {
    console.error(message);
  }
  process.exitCode = 1;
});
