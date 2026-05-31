import { cp, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzip } from "node:zlib";
import { promisify } from "node:util";

const gunzipAsync = promisify(gunzip);
const tarBlockSize = 512;
const archiveUrl = "https://codeload.github.com/soguten/mainz/tar.gz/refs/heads/main";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const destinationRoot = resolve(repoRoot, "templates", "project");

const tempRoot = await mkdtemp(join(tmpdir(), "create-mainz-sync-"));

try {
  const archiveBytes = await fetchArchive(archiveUrl);
  const extractedRoot = resolve(tempRoot, "archive");
  await mkdir(extractedRoot, { recursive: true });

  const entries = parseTarArchive(
    new Uint8Array(await gunzipAsync(archiveBytes)),
    archiveUrl,
  );

  for (const entry of entries) {
    if (
      !entry.path.startsWith("mainz-main/templates/project/") ||
      entry.path.endsWith("/")
    ) {
      continue;
    }

    const relativePath = entry.path.slice("mainz-main/templates/project/".length);
    if (!relativePath) {
      continue;
    }

    const outputPath = resolve(extractedRoot, relativePath);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, entry.content, "utf8");
  }

  await mkdir(resolve(repoRoot, "templates"), { recursive: true });
  await rm(destinationRoot, { recursive: true, force: true });
  await cp(extractedRoot, destinationRoot, { recursive: true });

  console.log(`[create-mainz] Synced templates from ${archiveUrl}`);
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

async function fetchArchive(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Could not fetch Mainz templates from "${url}": ${response.status} ${response.statusText}.`,
    );
  }

  return new Uint8Array(await response.arrayBuffer());
}

function parseTarArchive(bytes, source) {
  const entries = [];
  let offset = 0;

  while (offset + tarBlockSize <= bytes.length) {
    const header = bytes.subarray(offset, offset + tarBlockSize);
    if (header.every((value) => value === 0)) {
      break;
    }

    const path = readTarString(header, 0, 100);
    const prefix = readTarString(header, 345, 155);
    const fullPath = normalizeArchivePath(prefix ? `${prefix}/${path}` : path);
    const typeFlag = readTarString(header, 156, 1);
    const size = readTarOctal(header, 124, 12);
    const contentOffset = offset + tarBlockSize;
    const nextOffset = contentOffset + Math.ceil(size / tarBlockSize) * tarBlockSize;

    if (nextOffset > bytes.length) {
      throw new Error(`Archive "${source}" has a truncated tar entry.`);
    }

    if (typeFlag === "" || typeFlag === "0") {
      entries.push({
        path: fullPath,
        content: textDecode(bytes.subarray(contentOffset, contentOffset + size)),
      });
    }

    offset = nextOffset;
  }

  return entries;
}

function normalizeArchivePath(filePath) {
  const normalized = filePath.trim().replaceAll("\\", "/").replace(/^\/+/, "");
  if (!normalized || normalized.split("/").some((segment) => segment === "..")) {
    throw new Error(`Invalid archive entry path "${filePath}".`);
  }

  return normalized;
}

function readTarString(bytes, offset, length) {
  const slice = bytes.subarray(offset, offset + length);
  const end = slice.indexOf(0);
  return textDecode(end >= 0 ? slice.subarray(0, end) : slice).trim();
}

function readTarOctal(bytes, offset, length) {
  const value = readTarString(bytes, offset, length).replace(/\0/g, "").trim();
  return value ? Number.parseInt(value, 8) : 0;
}

function textDecode(bytes) {
  return new TextDecoder().decode(bytes);
}
