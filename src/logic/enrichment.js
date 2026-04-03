/**
 * ContextFlow enrichment helpers — plain JS port of classifier.ts and summarizer.ts.
 *
 * These are pure, synchronous functions that operate on a single node's text content.
 * They do not require the full ContextTree / focusPath from manager.ts, making them
 * safe to call inside the background Service Worker during saveFullConversation().
 *
 * classifyContent(content) — classify a user message into an intent category
 * summarizeContent(content) — produce a ≤15-word summary string + artifact list
 */

// ---------------------------------------------------------------------------
// Classifier — ported from src/logic/classifier.ts
// ---------------------------------------------------------------------------

const SHORT_MESSAGE_WORD_THRESHOLD = 10;

const COMPLETION_PATTERNS = [
  /\b(done|finished|resolved|complete|completed)\b/i,
  /\bgot it\b/i,
  /\bthat helps\b/i,
  /\bback to\b/i,
  /\breturn to\b/i,
  /\bresume\b/i,
];

const CONTEXT_SWITCH_PATTERNS = [
  /\bunrelated\b/i,
  /\bnew goal\b/i,
  /\bdifferent task\b/i,
  /\banother project\b/i,
  /\bswitch to\b/i,
  /\bseparate issue\b/i,
];

const SUBTASK_PATTERNS = [
  /\bnext\b/i,
  /\bthen\b/i,
  /\bstep\s*\d+\b/i,
  /\bstep\s+(one|two|three|four|five)\b/i,
  /\bpart of\b/i,
  /\bimplement\b/i,
  /\bbuild\b/i,
  /\bcreate\b/i,
  /\badd\b/i,
  /\bfix\b/i,
  /\bupdate\b/i,
  /\brefactor\b/i,
  /\bcontinue\b/i,
  /\bexplain\b/i,
];

const DETOUR_PATTERNS = [/\bhow\b/i, /\bwhat is\b/i, /\bwhy\b/i];

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'do', 'does', 'for',
  'from', 'go', 'how', 'i', 'if', 'in', 'into', 'instead', 'is', 'it',
  'let', 'me', 'my', 'now', 'of', 'on', 'or', 'part', 'people', 'please',
  'should', 'so', 'step', 'that', 'the', 'this', 'to', 'up', 'use', 'wait',
  'we', 'what', 'when', 'why', 'with', 'work',
]);

/**
 * Classify a single user message's content into an intent category.
 * Unlike the full classifyMessage() in classifier.ts, this does not require
 * a ContextTree — it relies solely on pattern matching against the text.
 *
 * @param {string} content - Raw text of the user node
 * @returns {'COMPLETION'|'CONTEXT_SWITCH'|'DETOUR'|'SUBTASK'|'ELABORATION'} category
 */
export function classifyContent(content) {
  const message = (content ?? '').trim();
  if (!message) return 'ELABORATION';

  const wordCount = message.trim() ? message.trim().split(/\s+/).length : 0;
  const hasQuestionMark = /[?？]/.test(message);
  const hasCompletionSignal = COMPLETION_PATTERNS.some(p => p.test(message));
  const hasContextSwitchSignal = CONTEXT_SWITCH_PATTERNS.some(p => p.test(message));
  const hasSubtaskSignal = SUBTASK_PATTERNS.some(p => p.test(message));
  const hasDetourSignal = hasQuestionMark || DETOUR_PATTERNS.some(p => p.test(message));
  const novelConcepts = extractConceptTokens(message);

  if (hasCompletionSignal) return 'COMPLETION';
  if (hasContextSwitchSignal) return 'CONTEXT_SWITCH';

  if (hasDetourSignal && novelConcepts.length > 0) return 'DETOUR';
  if (hasSubtaskSignal) return 'SUBTASK';

  if (wordCount > 0 && wordCount < SHORT_MESSAGE_WORD_THRESHOLD && !hasQuestionMark) {
    return 'ELABORATION';
  }
  if (novelConcepts.length >= 3) return 'CONTEXT_SWITCH';

  return 'ELABORATION';
}

/**
 * Extract meaningful concept tokens from text (stop-words removed, ≥4 chars).
 * @param {string} text
 * @returns {string[]}
 */
function extractConceptTokens(text) {
  const uniqueTokens = new Set();
  const rawTokens = text.match(/[A-Za-z0-9]+/g) ?? [];

  for (const rawToken of rawTokens) {
    const token = rawToken.toLowerCase();
    const isAcronym = /^[A-Z0-9]{2,}$/.test(rawToken);
    if (token.length < 4 && !isAcronym) continue;
    if (STOP_WORDS.has(token)) continue;
    uniqueTokens.add(isAcronym ? rawToken : token);
  }

  return [...uniqueTokens];
}

// ---------------------------------------------------------------------------
// Summarizer — ported from src/logic/summarizer.ts
// ---------------------------------------------------------------------------

const MAX_SUMMARY_WORDS = 15;
const MAX_CODE_ARTIFACT_LENGTH = 80;
const CONSOLIDATED_SUMMARY_TARGET = 3;
const CODE_BLOCK_PATTERN = /```[\s\S]*?```/g;
const FILE_PATH_PATTERN =
  /(?:^|[\s(])((?:\.{0,2}\/)?[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+\.[A-Za-z0-9]+)(?=$|[\s),:;])/g;

/**
 * Summarize a single node's content into a short sentence plus artifact refs.
 *
 * @param {string} content - Raw text of any node
 * @returns {{ summary: string, artifacts: string[] }}
 */
export function summarizeContent(content) {
  const normalizedContent = (content ?? '').trim();

  if (!normalizedContent) {
    return { summary: '', artifacts: [] };
  }

  const artifacts = extractArtifacts(normalizedContent);
  const cleanedText = stripArtifactsFromText(normalizedContent);
  const summary = buildSummary(cleanedText);

  return { summary, artifacts };
}

/**
 * Consolidate an array of summary bullets down to at most CONSOLIDATED_SUMMARY_TARGET items.
 * Used by mergeUpNode() to merge parent and child summaries.
 *
 * @param {string[]} bullets
 * @returns {string[]}
 */
export function consolidateSummaries(bullets) {
  const normalized = bullets.map(b => b.trim()).filter(b => b.length > 0);

  if (normalized.length <= CONSOLIDATED_SUMMARY_TARGET) {
    return [...new Set(normalized)];
  }

  const chunkSize = Math.ceil(normalized.length / CONSOLIDATED_SUMMARY_TARGET);
  const consolidated = new Set();

  for (let i = 0; i < normalized.length; i += chunkSize) {
    const chunk = normalized.slice(i, i + chunkSize);
    const synthesized = buildSummary(chunk.join(' '));
    if (synthesized) consolidated.add(synthesized);
  }

  return [...consolidated].slice(0, CONSOLIDATED_SUMMARY_TARGET);
}

function extractArtifacts(dialogue) {
  const artifacts = new Set();

  for (const match of dialogue.matchAll(new RegExp(FILE_PATH_PATTERN.source, 'g'))) {
    const filePath = match[1]?.trim();
    if (filePath) artifacts.add(filePath);
  }

  for (const codeBlock of dialogue.match(CODE_BLOCK_PATTERN) ?? []) {
    const snippet = extractCodeArtifactSnippet(codeBlock);
    if (snippet) artifacts.add(`codeblock:${snippet}`);
  }

  return [...artifacts];
}

function extractCodeArtifactSnippet(codeBlock) {
  const content = codeBlock
    .replace(/^```[a-zA-Z0-9_-]*\n?/, '')
    .replace(/```$/, '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .find(line => line.length > 0);

  if (!content) return '';
  return content.slice(0, MAX_CODE_ARTIFACT_LENGTH);
}

function stripArtifactsFromText(dialogue) {
  return dialogue
    .replace(CODE_BLOCK_PATTERN, ' ')
    .replace(new RegExp(FILE_PATH_PATTERN.source, 'g'), ' the referenced file ')
    .replace(/`+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.!?])/g, '$1')
    .trim();
}

function buildSummary(text) {
  const firstSentence =
    text
      .split(/(?<=[.!?])\s+/)
      .map(s => s.trim())
      .find(s => s.length > 0) ?? text;

  const words = firstSentence.match(/[A-Za-z0-9_.-]+/g) ?? [];

  if (words.length === 0) return 'Captured implementation details.';

  const trimmedWords = words.slice(0, MAX_SUMMARY_WORDS);
  const summary = trimmedWords.join(' ').trim();

  if (!summary) return 'Captured implementation details.';
  return /[.!?]$/.test(summary) ? summary : `${summary}.`;
}
