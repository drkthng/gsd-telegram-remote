/**
 * projects.ts — List GSD-managed projects from ~/.gsd/projects/
 *
 * GSD maintains a registry at {gsdHome}/projects/{hash}/repo-meta.json.
 * Each repo-meta.json records a `gitRoot` field pointing to the project
 * directory where .gsd/PROJECT.md lives.
 *
 * Strategy:
 *   1. Derive human name from path.basename(gitRoot)
 *   2. Deduplicate by gitRoot (multiple registry hashes can point to same dir)
 *   3. Read .gsd/PROJECT.md for description, falling back to folder name
 *      when the H1 is the template placeholder "Project"
 *   4. Skip entries without repo-meta.json or without a gitRoot field
 */

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

export interface ProjectEntry {
  name: string;
  description: string;
}

interface RepoMeta {
  gitRoot?: string;
  // legacy field name — kept for forward-compat in case it changes back
  projectDir?: string;
}

/**
 * Extract the first meaningful line from PROJECT.md content as a description.
 * Prefers the first H1 heading (without the `#`), falls back to the first
 * non-empty non-heading line. Returns empty string if nothing found.
 */
function extractDescription(content: string): string {
  const lines = content.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("# ")) {
      return trimmed.slice(2).trim();
    }
    if (!trimmed.startsWith("#")) {
      return trimmed;
    }
    return trimmed.replace(/^#+\s*/, "");
  }
  return "";
}

/**
 * List all GSD projects registered under {gsdHome}/projects/.
 * Returns [] on any top-level filesystem error.
 * Entries without repo-meta.json or without a gitRoot are silently skipped.
 * Entries are deduplicated by gitRoot — only the most recently created entry
 * per gitRoot is kept (createdAt field, falls back to directory mtime).
 * Entries whose PROJECT.md cannot be read or whose H1 is the template
 * placeholder "Project" fall back to path.basename(gitRoot) as the name.
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

  // Collect all valid entries keyed by gitRoot for deduplication
  // Map: gitRoot -> { createdAt, projectMdDir }
  const byGitRoot = new Map<string, { createdAt: string; projectMdDir: string }>();

  for (const entry of entries) {
    const entryDir = path.join(projectsDir, entry);
    const metaPath = path.join(entryDir, "repo-meta.json");

    let meta: RepoMeta;
    try {
      const raw = await fs.readFile(metaPath, "utf-8");
      meta = JSON.parse(raw) as RepoMeta;
    } catch {
      continue; // no repo-meta.json or invalid JSON — skip
    }

    // Support both field names; gitRoot is authoritative
    const gitRoot = meta.gitRoot ?? meta.projectDir;
    if (!gitRoot) continue;

    // Normalise path separators to forward slashes for consistent keying
    const normRoot = gitRoot.replace(/\\/g, "/");

    // Extract createdAt for deduplication preference (latest wins)
    let createdAt = "";
    try {
      const raw = await fs.readFile(metaPath, "utf-8");
      const parsed = JSON.parse(raw) as { createdAt?: string };
      createdAt = parsed.createdAt ?? "";
    } catch {
      // leave empty — will lose deduplication tie-break to any entry with a date
    }

    const existing = byGitRoot.get(normRoot);
    if (!existing || createdAt > existing.createdAt) {
      byGitRoot.set(normRoot, { createdAt, projectMdDir: gitRoot });
    }
  }

  const results: ProjectEntry[] = [];

  for (const [normRoot, { projectMdDir }] of byGitRoot) {
    // Human-readable name: basename of the git root directory
    const folderName = path.basename(normRoot);

    // Description from .gsd/PROJECT.md
    let description = "";
    try {
      const projectMdPath = path.join(projectMdDir, ".gsd", "PROJECT.md");
      const content = await fs.readFile(projectMdPath, "utf-8");
      const extracted = extractDescription(content);
      // If the H1 is the template placeholder, fall back to the folder name
      description = extracted === "Project" ? folderName : extracted;
    } catch {
      description = folderName;
    }

    results.push({ name: folderName, description });
  }

  return results.sort((a, b) => a.name.localeCompare(b.name));
}
