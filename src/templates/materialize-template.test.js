import test from "node:test";
import assert from "node:assert/strict";
import { instantiateTemplate, resolveBuiltInTemplateRoot } from "./index.js";

test("instantiates node starter template", async () => {
  const plan = await instantiateTemplate({
    templateRoot: resolveBuiltInTemplateRoot("node", "starter"),
    params: {
      projectName: "demo-app",
      mainzSpecifier: "latest",
      appName: "app",
      appId: "app",
      appNavigation: "enhanced-mpa",
      appTitle: "demo-app",
      rootDir: "./app",
      outDir: "dist/app",
    },
  });

  assert.equal(plan.manifest.kind, "project");
  assert.equal(plan.manifest.runtime, "node");
  assert.ok(plan.files.some((file) => file.path === "package.json"));
  assert.ok(
    plan.files.some((file) => file.path.replaceAll("\\", "/") === "app/src/app.ts"),
  );
});
