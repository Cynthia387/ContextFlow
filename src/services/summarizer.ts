export interface SummarizationResult {
  summary: string;
  artifacts: string[];
}

const MAX_SUMMARY_WORDS = 15;
const MAX_CODE_ARTIFACT_LENGTH = 80;
const CONSOLIDATED_SUMMARY_TARGET = 3;
const CODE_BLOCK_PATTERN = /```[\s\S]*?```/g;
const FILE_PATH_PATTERN =
  /(?:^|[\s(])((?:\.{0,2}\/)?[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+\.[A-Za-z0-9]+)(?=$|[\s),:;])/g;

export function summarizeDialogue(dialogue: string): SummarizationResult {
  const normalizedDialogue = dialogue.trim();

  if (!normalizedDialogue) {
    return {
      summary: "",
      artifacts: [],
    };
  }

  const artifacts = extractArtifacts(normalizedDialogue);
  const cleanedText = stripArtifactsFromText(normalizedDialogue);
  const summary = buildSummary(cleanedText);

  return {
    summary,
    artifacts,
  };
}

export function consolidateSummaries(bullets: string[]): string[] {
  const normalizedBullets = bullets
    .map((bullet) => bullet.trim())
    .filter((bullet) => bullet.length > 0);

  if (normalizedBullets.length <= CONSOLIDATED_SUMMARY_TARGET) {
    return [...new Set(normalizedBullets)];
  }

  const chunkSize = Math.ceil(normalizedBullets.length / CONSOLIDATED_SUMMARY_TARGET);
  const consolidated = new Set<string>();

  for (let index = 0; index < normalizedBullets.length; index += chunkSize) {
    const chunk = normalizedBullets.slice(index, index + chunkSize);
    const synthesized = buildSummary(chunk.join(" "));
    if (synthesized) {
      consolidated.add(synthesized);
    }
  }

  return [...consolidated].slice(0, CONSOLIDATED_SUMMARY_TARGET);
}

function extractArtifacts(dialogue: string): string[] {
  const artifacts = new Set<string>();

  for (const match of dialogue.matchAll(FILE_PATH_PATTERN)) {
    const filePath = match[1]?.trim();
    if (filePath) {
      artifacts.add(filePath);
    }
  }

  for (const codeBlock of dialogue.match(CODE_BLOCK_PATTERN) ?? []) {
    const snippet = extractCodeArtifactSnippet(codeBlock);
    if (snippet) {
      artifacts.add(`codeblock:${snippet}`);
    }
  }

  return [...artifacts];
}

function extractCodeArtifactSnippet(codeBlock: string): string {
  const content = codeBlock
    .replace(/^```[a-zA-Z0-9_-]*\n?/, "")
    .replace(/```$/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  if (!content) {
    return "";
  }

  return content.slice(0, MAX_CODE_ARTIFACT_LENGTH);
}

function stripArtifactsFromText(dialogue: string): string {
  return dialogue
    .replace(CODE_BLOCK_PATTERN, " ")
    .replace(FILE_PATH_PATTERN, " the referenced file ")
    .replace(/`+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.!?])/g, "$1")
    .trim();
}

function buildSummary(text: string): string {
  const firstSentence =
    text
      .split(/(?<=[.!?])\s+/)
      .map((segment) => segment.trim())
      .find((segment) => segment.length > 0) ?? text;

  const words = firstSentence.match(/[A-Za-z0-9_.-]+/g) ?? [];

  if (words.length === 0) {
    return "Captured implementation details.";
  }

  const trimmedWords = words.slice(0, MAX_SUMMARY_WORDS);
  const summary = trimmedWords.join(" ").trim();

  if (!summary) {
    return "Captured implementation details.";
  }

  return /[.!?]$/.test(summary) ? summary : `${summary}.`;
}
