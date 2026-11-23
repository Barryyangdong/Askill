export async function pollDeepRun<T extends {status: string}>(id: string, fingerprint: string, resume: (id: string, fingerprint: string) => Promise<T>): Promise<T> {
  return resume(id, fingerprint);
}
