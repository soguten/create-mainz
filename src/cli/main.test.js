import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "./main.js";

test("creates a node empty project", async () => {
  const root = await mkdtemp(join(tmpdir(), "create-mainz-node-"));

  try {
    const exitCode = await main([root]);
    assert.equal(exitCode, 0);

    const packageJson = JSON.parse(
      await readFile(join(root, "package.json"), "utf8"),
    );

    assert.equal(
      packageJson.name,
      root.split(/[/\\]/).at(-1)?.toLowerCase(),
    );
    assert.equal(packageJson.dependencies.mainz, "latest");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("creates a deno starter project", async () => {
  const parent = await mkdtemp(join(tmpdir(), "create-mainz-deno-"));
  const root = join(parent, "demo-app");

  try {
    const exitCode = await main([root, "--runtime", "deno", "--template", "starter"]);
    assert.equal(exitCode, 0);

    const denoJson = JSON.parse(await readFile(join(root, "deno.json"), "utf8"));
    assert.equal(denoJson.imports.mainz, "jsr:@mainz/mainz");

    const configSource = await readFile(join(root, "mainz.config.ts"), "utf8");
    assert.match(configSource, /name: "app"/);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
