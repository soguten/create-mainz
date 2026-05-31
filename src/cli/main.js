import { access } from "node:fs/promises";
import { basename, resolve } from "node:path";
import process from "node:process";
import {
  instantiateTemplate,
  materializeTemplatePlan,
  resolveBuiltInTemplateRoot,
} from "../templates/index.js";

class CliUsageError extends Error {
  constructor(message) {
    super(message);
    this.name = "CliUsageError";
  }
}

export async function main(args = process.argv.slice(2)) {
  try {
    return await runCli(args);
  } catch (error) {
    if (error instanceof Error) {
      console.error(`[create-mainz] ${error.message}`);
      console.error('[create-mainz] Run "create-mainz --help" for usage.');
      return 1;
    }

    throw error;
  }
}

async function runCli(args) {
  if (
    args.length === 0 ||
    args.includes("--help") ||
    args.includes("-h") ||
    args[0] === "help"
  ) {
    printHelp();
    return 0;
  }

  const options = parseInitOptions(args);
  const outputDir = options.name
    ? resolve(process.cwd(), options.name)
    : process.cwd();
  const runtime = options.runtime ?? "node";
  const templateName = options.template ?? "empty";
  const projectName = sanitizeProjectName(basename(outputDir) || "mainz-app");
  const templateRoot = resolveBuiltInTemplateRoot(runtime, templateName);
  const templateParams = buildTemplateParams({
    runtime,
    projectName,
    mainzSpecifier: options.mainzSpecifier,
  });
  const plan = await instantiateTemplate({
    templateRoot,
    params: templateParams,
  });

  validateTemplateCompatibility(plan.manifest, runtime, templateName);

  await materializeTemplatePlan({
    plan,
    outputDir,
    beforeWrite: assertCanCreateFile,
  });

  console.log(
    `[create-mainz] Created Mainz ${templateName} project in ${outputDir}.`,
  );
  console.log(
    `[create-mainz] Created ${plan.files.map((file) => file.path).join(", ")}.`,
  );
  return 0;
}

function parseInitOptions(args) {
  const options = {
    name: undefined,
    mainzSpecifier: undefined,
    runtime: undefined,
    template: undefined,
  };
  let positionalName;

  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];

    if (current === "--mainz") {
      options.mainzSpecifier = readOptionValue(current, args[index + 1]);
      index += 1;
      continue;
    }

    if (current === "--runtime") {
      const runtime = readOptionValue(current, args[index + 1]);
      if (runtime !== "node" && runtime !== "deno") {
        throw new CliUsageError(
          `Unsupported runtime "${runtime}". Use "node" or "deno".`,
        );
      }

      options.runtime = runtime;
      index += 1;
      continue;
    }

    if (current === "--template") {
      const template = readOptionValue(current, args[index + 1]);
      if (template !== "empty" && template !== "starter") {
        throw new CliUsageError(
          `Unsupported template "${template}". Use "empty" or "starter".`,
        );
      }

      options.template = template;
      index += 1;
      continue;
    }

    if (current.startsWith("--")) {
      throw new CliUsageError(`Unknown option "${current}".`);
    }

    if (positionalName) {
      throw new CliUsageError(
        `Received multiple project names "${positionalName}" and "${current}".`,
      );
    }

    positionalName = current;
  }

  options.name = positionalName;
  return options;
}

function readOptionValue(option, value) {
  if (!value || value.startsWith("--")) {
    throw new CliUsageError(`Option "${option}" requires a value.`);
  }

  return value;
}

function buildTemplateParams(options) {
  if (options.runtime === "deno") {
    const mainzSpecifier = options.mainzSpecifier ?? "jsr:@mainz/mainz";
    return {
      projectName: options.projectName,
      mainzSpecifier,
      mainzSubpathPrefix: renderGeneratedMainzSubpathPrefix(mainzSpecifier),
      mainzCliSpecifier: "jsr:@mainz/cli-deno",
      denoConfigPath: "deno.json",
      appName: "app",
      appId: "app",
      appNavigation: "enhanced-mpa",
      appTitle: options.projectName,
      rootDir: "./app",
      outDir: "dist/app",
    };
  }

  return {
    projectName: options.projectName,
    mainzSpecifier: options.mainzSpecifier ?? "latest",
    appName: "app",
    appId: "app",
    appNavigation: "enhanced-mpa",
    appTitle: options.projectName,
    rootDir: "./app",
    outDir: "dist/app",
  };
}

function renderGeneratedMainzSubpathPrefix(mainzSpecifier) {
  const trimmed = mainzSpecifier.trim().replace(/\/+$/, "");
  if (trimmed.startsWith("jsr:@")) {
    return `jsr:/${trimmed.slice("jsr:".length)}/`;
  }

  return `${trimmed}/`;
}

function sanitizeProjectName(value) {
  return value.toLowerCase().replace(/[^a-z0-9-_]/g, "-");
}

function validateTemplateCompatibility(manifest, runtime, templateName) {
  if (manifest.kind !== "project") {
    throw new CliUsageError(`Template "${templateName}" is not a project template.`);
  }

  if (manifest.runtime !== runtime) {
    throw new CliUsageError(
      `Template "${templateName}" only supports runtime "${manifest.runtime}".`,
    );
  }
}

async function assertCanCreateFile(path) {
  try {
    await access(path);
    throw new CliUsageError(`Refusing to overwrite existing file "${path}".`);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return;
    }

    throw error;
  }
}

function printHelp() {
  console.log(
    [
      "create-mainz",
      "",
      "Usage:",
      "  create-mainz [<name>] [--template <empty|starter>] [--runtime <node|deno>] [--mainz <specifier>]",
      "",
      "Options:",
      "  --template <empty|starter>  Choose the project template. Defaults to empty.",
      "  --runtime <node|deno>       Choose which Mainz runtime template to generate.",
      "  --mainz <specifier>         Override the Mainz package specifier written to the project.",
      "",
      "Examples:",
      "  npm create mainz@latest my-app",
      "  npm create mainz@latest my-app -- --template starter",
      "  npm create mainz@latest my-deno-app -- --runtime deno",
    ].join("\n"),
  );
}
