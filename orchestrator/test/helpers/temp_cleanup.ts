import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/** Let child close handlers run before retrying Windows directory-handle release. */
export async function removeTestTemp(dir: string): Promise<void> {
  const target = path.resolve(dir);
  if (path.dirname(target) !== path.resolve(os.tmpdir()) || !path.basename(target).startsWith("vra-")) {
    throw new Error("Refusing cleanup outside an owned test directory");
  }
  await fs.rm(target, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}
