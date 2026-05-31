import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { loadTemplate } from "./load-template.js";

export async function instantiateTemplate(options) {
  const template = await loadTemplate(resolveRequiredTemplateRoot(options.templateRoot));
  const relativePaths = await collectTemplateFiles(template.filesRoot);
  const params = options.params ?? {};

  return {
    manifest: JSON.parse(replaceTemplateTokens(template.manifestSource, params)),
    files: await Promise.all(
      relativePaths.map(async (relativePath) => {
        const sourcePath = resolve(template.filesRoot, relativePath);
        const renderedPath = stripTemplateSuffix(
          replaceTemplateTokens(relativePath, params),
        );
        const renderedContent = replaceTemplateTokens(
          await readFile(sourcePath, "utf8"),
          params,
        );

        return {
          path: renderedPath,
          content: renderedContent,
        };
      }),
    ),
  };
}

export async function materializeTemplatePlan(options) {
  const filesWithAbsolutePaths = options.plan.files.map((file) => ({
    file,
    absolutePath: resolve(options.outputDir, file.path),
  }));

  for (const { file, absolutePath } of filesWithAbsolutePaths) {
    if (typeof options.beforeWrite === "function") {
      await options.beforeWrite(absolutePath, file);
    }
  }

  for (const { file, absolutePath } of filesWithAbsolutePaths) {
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, file.content, "utf8");
  }

  return options.plan;
}

function resolveRequiredTemplateRoot(templateRoot) {
  if (!templateRoot) {
    throw new Error("Template root is required.");
  }

  return templateRoot;
}

async function collectTemplateFiles(root, current = root) {
  const entries = await readdir(current, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = resolve(current, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectTemplateFiles(root, absolutePath)));
      continue;
    }

    files.push(relative(root, absolutePath));
  }

  return files;
}

function replaceTemplateTokens(value, params) {
  return value.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_match, key) => {
    if (!(key in params) || params[key] === undefined || params[key] === null) {
      throw new Error(`Missing template parameter "${key}".`);
    }

    return String(params[key]);
  });
}

function stripTemplateSuffix(path) {
  return path.endsWith(".tpl") ? path.slice(0, -".tpl".length) : path;
}
