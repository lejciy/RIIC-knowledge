import { readFile } from "node:fs/promises";

export async function loadKnowledgeRules() {
  return readFile(new URL("./KNOWLEDGE_RULES.md", import.meta.url), "utf8");
}

export async function renderKnowledgePrompt({ context, question }) {
  const [template, rules] = await Promise.all([
    readFile(new URL("./SYSTEM_PROMPT.md", import.meta.url), "utf8"),
    loadKnowledgeRules(),
  ]);
  const values = { knowledge_rules: rules, context, question };
  return template.replace(/\{(knowledge_rules|context|question)\}/g, (_, key) => values[key]);
}
