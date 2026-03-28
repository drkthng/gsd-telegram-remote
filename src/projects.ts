/**
 * projects.ts — List GSD-managed projects from ~/.gsd/projects/
 *
 * GSD maintains a registry at {gsdHome}/projects/{name}/repo-meta.json.
 * Each entry records the projectDir path where PROJECT.md lives.
 * We scan the registry, read PROJECT.md for a description, and return
 * a sorted list of { name, description } objects.
 */

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

export interface ProjectEntry {
  name: string;
  description: string;
}

interface RepoMeta {
  projectDir?: string;
}

/**
 * Extract the first meaningful line from PROJECT.md content as a description.
 * Prefers the first H1 heading (without the `#`), falls back to the first
 * non-empty non-heading line.
 */
function extractDescription(content: string): string {
  const lines = content.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("# ")) {
      return trimmed.slice(2).trim();
    }
    // First non-empty line that isn't a heading
    if (!trimmed.startsWith("#")) {
      return trimmed;
    }
    // It's a heading but not H1 — return it stripped
    return trimmed.replace(/^#+\s*/, "");
  }
  return "";
}

/**
 * List all GSD projects registered under {gsdHome}/projects/.
 * Returns [] on any top-level filesystem error.
 * Entries that lack repo-meta.json are silently skipped.
 * Entries whose PROJECT.md cannot be read get an empty description.
 */
export async function listProjects(gsdHome?: string): Promise<ProjectEntry[]> {
  const home = gsdHome ?? path.join(os.homedir(), ".gsd");
  const projectsDir = path.join(home, "projects");

  let entries: string[];
  try {
    const dirents = await fs.readdir(projectsDir, { withFileTypes: true });
    entries = dirents
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }

  const results: ProjectEntry[] = [];

  for (const entry of entries) {
    const entryDir = path.join(projectsDir, entry);
    const metaPath = path.join(entryDir, "repo-meta.json");

    // Skip entries without repo-meta.json
    try {
      await fs.access(metaPath);
    } catch {
      continue;
    }

    // Read PROJECT.md path from repo-meta.json, fall back to entry dir
    let projectMdPath = path.join(entryDir, "PROJECT.md");
    try {
      const metaRaw = await fs.readFile(metaPath, "utf-8");
      const meta: RepoMeta = JSON.parse(metaRaw);
      if (meta.projectDir) {
        projectMdPath = path.join(meta.projectDir, "PROJECT.md");
      }
    } catch {
      // Use default path
    }

    // Read description from PROJECT.md — empty string on any error
    let description = "";
    try {
      const content = await fs.readFile(projectMdPath, "utf-8");
      description = extractDescription(content);
    } catch {
      // Leave description as empty string
    }

    results.push({ name: entry, description });
  }

  return results.sort((a, b) => a.name.localeCompare(b.name));
}
