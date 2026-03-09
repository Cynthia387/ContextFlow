/// <reference path="../src/types/node-shims.d.ts" />

import { readFile, rm } from "node:fs/promises";
import path from "node:path";

import { ContextManager } from "../src/core/manager.ts";

async function main(): Promise<void> {
  const stateFilePath = path.resolve(process.cwd(), "state.json");

  await rm(stateFilePath, { force: true });

  const manager = new ContextManager(stateFilePath);

  console.log("Step 1: Initialize with Node A: Project Start");
  const initializedTree = await manager.initialize({
    title: "Project Start",
    definitionOfDone: "Ship the initial product flow.",
  });
  console.log(JSON.stringify(initializedTree, null, 2));
  console.log(await manager.renderContextUI());
  console.log("");

  const step2Message = "Let's build the login page";
  console.log(`Step 2: ${step2Message}`);
  const step2Analysis = await manager.analyzeIntent(step2Message, manager.getCurrentTree());
  console.log(step2Analysis);
  await manager.updateNodeSummary("A", "Build the login page.");
  console.log(await manager.renderContextUI(step2Message, step2Analysis));
  console.log("");

  const step2bMessage = "Now explain the CSS Flexbox part of that login page.";
  console.log(`Step 2b: ${step2bMessage}`);
  const step2bAnalysis = await manager.analyzeIntent(step2bMessage, manager.getCurrentTree());
  console.log(step2bAnalysis);
  if (step2bAnalysis.category !== "SUBTASK") {
    throw new Error("Expected the Flexbox message to classify as SUBTASK.");
  }
  console.log("");

  const step2cMessage = "Wait, why do people use Tailwind instead of CSS modules?";
  console.log(`Step 2c: ${step2cMessage}`);
  const step2cAnalysis = await manager.analyzeIntent(step2cMessage, manager.getCurrentTree());
  console.log(step2cAnalysis);
  if (step2cAnalysis.category !== "DETOUR") {
    throw new Error("Expected the Tailwind message to classify as DETOUR.");
  }
  const tailwindUi = await manager.renderContextUI(step2cMessage, step2cAnalysis);
  console.log(tailwindUi);
  if (!tailwindUi.footer?.includes("User Action Required")) {
    throw new Error("Expected a low-confidence detour to show the user-action footer.");
  }
  if (!tailwindUi.quickActions.includes("[Done]")) {
    throw new Error("Expected quick actions to be shown in the context UI.");
  }
  console.log("");

  const step3Message = "Wait, how does JWT work?";
  console.log(`Step 3: ${step3Message}`);
  const step3Analysis = await manager.analyzeIntent(step3Message, manager.getCurrentTree());
  console.log(step3Analysis);
  console.log("Tentative UI before confirming detour:");
  console.log(await manager.renderContextUI(step3Message, step3Analysis));

  let detourId: string | null = null;
  if (step3Analysis.category === "DETOUR") {
    const detourNode = await manager.addNode("A", {
      title: "JWT work",
      type: "detour",
      summary: ["Understand how JWT works for authentication."],
      definitionOfDone: "Understand JWT basics well enough to continue the login flow.",
    });
    detourId = detourNode.id;
  }

  if (!detourId) {
    throw new Error("Expected a detour node to be created in Step 3.");
  }

  console.log("Confirmed detour UI:");
  console.log(await manager.renderContextUI());
  console.log("");

  const step4Message = "Got it, back to the login page";
  console.log(`Step 4: ${step4Message}`);
  const step4Analysis = await manager.analyzeIntent(step4Message, manager.getCurrentTree());
  console.log(step4Analysis);

  if (step4Analysis.category === "COMPLETION") {
    await manager.updateNodeSummary("A", "Resume the login page implementation.");
  }

  console.log(await manager.renderContextUI(step4Message, step4Analysis));
  console.log("");

  const step5Message = `The login page should validate tokens in src/auth/jwt.ts before rendering protected content.
Use this helper to isolate token parsing:
\`\`\`ts
export function verifyJwt(token: string) {
  return decodeJwt(token);
}
\`\`\`
This keeps authentication logic reusable across guards and the login flow.`;
  console.log("Step 5: Long technical explanation with artifact extraction");
  await manager.updateNodeSummary("A", step5Message);
  console.log(await manager.renderContextUI());
  console.log("");

  const step5State = await readFile(stateFilePath, "utf8");
  const parsedState = JSON.parse(step5State) as {
    nodes?: Record<string, { summary?: string[]; artifacts?: string[] }>;
  };
  const rootNode = parsedState.nodes?.A;

  if (!rootNode) {
    throw new Error("Expected root node A to exist in state.json.");
  }

  const hasMeaningfulSummary = rootNode.summary?.some((entry) =>
    entry.toLowerCase().includes("validate tokens"),
  );
  const hasFileArtifact = rootNode.artifacts?.includes("src/auth/jwt.ts");
  const hasCodeArtifact = rootNode.artifacts?.some((entry) =>
    entry.startsWith("codeblock:export function verifyJwt"),
  );

  if (!hasMeaningfulSummary) {
    throw new Error("Expected Step 5 to create a meaningful auto-summary in node A.");
  }

  if (!hasFileArtifact || !hasCodeArtifact) {
    throw new Error("Expected Step 5 to extract both file-path and code-block artifacts.");
  }

  console.log("Step 5 verification passed:");
  console.log({
    summary: rootNode.summary,
    artifacts: rootNode.artifacts,
  });
  console.log("");

  console.log("Step 6: Deep detour context injection and collapse verification");
  const detourRoot = await manager.addNode("A", {
    title: "OAuth hardening",
    type: "detour",
    summary: ["Explore OAuth hardening for the login flow."],
    definitionOfDone: "Choose a hardened OAuth approach for sign-in.",
  });
  await manager.updateNodeSummary(
    detourRoot.id,
    "OAuth hardening must preserve the original product goal while tightening auth safety.",
  );

  const levelTwo = await manager.addNode(detourRoot.id, {
    title: "PKCE exchange",
    type: "concept",
    summary: ["Understand the PKCE verifier and challenge exchange."],
    definitionOfDone: "Understand PKCE well enough to continue implementation.",
  });
  await manager.updateNodeSummary(
    levelTwo.id,
    "PKCE binds the authorization code to the original client request.",
  );

  await manager.addNode(levelTwo.id, {
    title: "Legacy callback cleanup",
    type: "detour",
    summary: ["Review the deprecated callback route."],
    status: "done",
  });
  await manager.addNode(levelTwo.id, {
    title: "Session cookie fallback",
    type: "detour",
    summary: ["Document the fallback cookie strategy."],
    status: "done",
  });
  await manager.addNode(levelTwo.id, {
    title: "Token introspection note",
    type: "detour",
    summary: ["Compare token introspection with local validation."],
    status: "done",
  });

  const deepFocus = await manager.addNode(levelTwo.id, {
    title: "Refresh token rotation",
    type: "decision",
    summary: ["Compare strict rotation against reuse detection."],
    definitionOfDone: "Select the refresh token rotation policy.",
  });
  await manager.updateNodeSummary(
    deepFocus.id,
    "Refresh rotation should reduce replay risk without breaking the sign-in flow.",
  );

  const injectedContext = await manager.getInjectedContext();
  console.log(injectedContext);
  console.log("");

  if (!injectedContext.includes("Current Focus: A.2.1.4 (Refresh token rotation).")) {
    throw new Error("Expected injected context to point at the deepest focus node.");
  }

  if (!injectedContext.includes("Root Definition of Done: Ship the initial product flow.")) {
    throw new Error("Expected injected context to include the root definition_of_done.");
  }

  if (!injectedContext.includes("Session cookie fallback")) {
    throw new Error("Expected injected context collapse view to include recent sibling context.");
  }

  if (!injectedContext.includes("Token introspection note")) {
    throw new Error("Expected injected context collapse view to include the last sibling branch.");
  }

  if (injectedContext.includes("Legacy callback cleanup")) {
    throw new Error("Expected injected context collapse view to omit older done sibling branches.");
  }

  console.log("Step 6 verification passed.");
  console.log("");

  console.log("Step 7: Summary consolidation verification");
  const consolidationUpdates = [
    "Document login validation edge cases for suspended accounts.",
    "Capture token expiry retry behavior for the sign-in flow.",
    "Track audit logging requirements for authentication failures.",
    "Record accessibility notes for the login error states.",
    "Summarize the deployment checklist for auth configuration.",
  ];

  for (const update of consolidationUpdates) {
    await manager.updateNodeSummary("A", update);
  }

  const consolidatedRoot = await manager.consolidateSummary("A");
  const injectedAfterConsolidation = await manager.getInjectedContext();

  console.log({
    consolidatedSummary: consolidatedRoot.summary,
    summaryCount: consolidatedRoot.summary.length,
  });
  console.log("");

  if (consolidatedRoot.summary.length > 3) {
    throw new Error("Expected consolidated root summary to compress into 2-3 synthesis bullets.");
  }

  if (!injectedAfterConsolidation.includes("Summary so far:")) {
    throw new Error("Expected injected context to use the consolidated summaries.");
  }

  console.log("Step 7 verification passed.");
  console.log("");

  console.log("Step 8: Manual override with merge_up correction");
  const mistakenDetour = await manager.addNode("A", {
    title: "Flexbox style tangent",
    type: "detour",
    summary: ["Investigate whether Flexbox should really stay in the main flow."],
  });
  await manager.updateNodeSummary(
    mistakenDetour.id,
    "This was placed as a detour, but it actually belongs in the main implementation branch.",
  );

  const mergedTree = await manager.mergeUp(mistakenDetour.id);
  console.log(mergedTree);
  console.log("");

  if (mergedTree.nodes[mistakenDetour.id]) {
    throw new Error("Expected merge_up to remove the mistaken detour node.");
  }

  const mergedRoot = mergedTree.nodes.A;
  if (
    !mergedRoot.summary.some((entry) =>
      entry.toLowerCase().includes("investigate whether flexbox should really stay"),
    )
  ) {
    throw new Error("Expected merge_up to preserve the mistaken detour summary on the parent node.");
  }

  console.log("Step 8 verification passed.");
  console.log("");

  const finalState = await readFile(stateFilePath, "utf8");
  console.log("Final state.json:");
  console.log(finalState);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
