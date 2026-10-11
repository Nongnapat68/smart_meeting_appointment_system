import { rm } from "fs/promises";
import path from "path";

// Task attachments are stored on disk at public/uploads/tasks/<taskId>/ (see
// POST /api/tasks/[id]/attachments). Deleting a Task removes its
// TaskAttachment rows by cascade, but not these files — this removes them.

const TASK_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function taskUploadsRoot(): string {
  return path.resolve(process.cwd(), "public", "uploads", "tasks");
}

/**
 * The upload folder of one task, or null if the id could reach outside
 * public/uploads/tasks/ (only id-shaped names, and the resolved folder must be
 * a direct child of that root).
 */
export function taskUploadDir(taskId: string, root: string = taskUploadsRoot()): string | null {
  if (!TASK_ID_RE.test(taskId)) return null;
  const dir = path.resolve(root, taskId);
  return path.dirname(dir) === path.resolve(root) ? dir : null;
}

/** Removes a task's upload folder; a folder that doesn't exist is fine. */
export async function removeTaskUploads(taskId: string): Promise<void> {
  const dir = taskUploadDir(taskId);
  if (!dir) return;
  await rm(dir, { recursive: true, force: true });
}
