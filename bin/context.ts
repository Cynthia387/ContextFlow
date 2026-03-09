/// <reference path="../src/types/node-shims.d.ts" />

import path from "node:path";

import { ContextManager } from "../src/core/manager.ts";

async function main(): Promise<void> {
  const stateFilePath = path.resolve(process.cwd(), "state.json");
  const manager = new ContextManager(stateFilePath);
  const ui = await manager.renderContextUI();

  console.log("# Context Tree");
  console.log("");
  console.log(ui.progressBar);
  console.log("");
  console.log(ui.tree);
  console.log("");
  console.log("## Breadcrumb");
  console.log("");
  console.log(ui.breadcrumb);
  console.log(`Next: ${ui.nextStep}`);
  console.log("");
  console.log("## Quick Actions");
  console.log("");
  console.log(ui.quickActions.join(" "));
  console.log("");
  console.log("## Suggested Commands");
  console.log("");
  console.log(ui.suggestedCommands.map((command) => `- \`${command}\``).join("\n"));

  if (ui.footer) {
    console.log("");
    console.log("## Footer");
    console.log("");
    console.log(ui.footer);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
