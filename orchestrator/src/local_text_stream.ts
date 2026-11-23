/** Only visible text blocks are previews. Thinking, tool input and diagnostics stay private. */
export class LocalTextStream {
  text = "";
  resultLine = "";
  #pending = "";
  #blocks = new Map<number, string>();
  #sent = "";
  private readonly onText: (text: string) => void;
  constructor(onText: (text: string) => void) { this.onText = onText; }
  push(chunk: string): void {
    const lines = (this.#pending + chunk).split("\n");
    this.#pending = lines.pop() ?? "";
    if (this.#pending.length > 4 * 1024 * 1024) throw new Error("Stream line too large");
    for (const line of lines) this.line(line);
  }
  finish(): string { if (this.#pending.trim()) this.line(this.#pending); return this.resultLine; }
  private line(line: string): void {
    let row: any;
    try { row = JSON.parse(line); } catch { return; }
    if (row.type === "result" || typeof row.result === "string" || row.structured_output !== undefined) { this.resultLine = line; return; }
    const event = row.type === "stream_event" ? row.event : row;
    if (event?.type === "content_block_start" && event.content_block?.type === "text") {
      this.#blocks.set(event.index, event.content_block.text ?? "");
    } else if (event?.type === "content_block_delta" && event.delta?.type === "text_delta" && this.#blocks.has(event.index)) {
      this.#blocks.set(event.index, this.#blocks.get(event.index)! + event.delta.text);
    } else return;
    this.text = [...this.#blocks.values()].join("");
    // A completed paragraph cannot later gain a hidden reasoning delimiter or secret suffix.
    const end = this.text.lastIndexOf("\n\n");
    if (end > 0 && this.text.slice(0, end) !== this.#sent) {
      this.#sent = this.text.slice(0, end);
      this.onText(this.#sent);
    }
  }
}
