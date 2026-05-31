import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(moduleDir, "..", "..");

export function resolveBuiltInTemplateRoot(runtime, name) {
  return resolve(repoRoot, "templates", "project", runtime, name);
}

export async function loadTemplate(templateRoot) {
  const manifestPath = resolve(templateRoot, "template.json");
  const manifestSource = await readFile(manifestPath, "utf8");
  const manifest = JSON.parse(manifestSource);

  if (manifest.kind !== "project" || !manifest.name) {
    throw new Error(`Invalid template manifest at "${manifestPath}".`);
  }

  return {
    manifest,
    manifestSource,
    root: templateRoot,
    filesRoot: resolve(templateRoot, "files"),
  };
}
