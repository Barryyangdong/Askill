import { DebateReport } from "./DebateReport";

export function conclusionSections(content: string) {
  const sections: { title: string; body: string }[] = [];
  for (const line of content.split("\n")) {
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading) sections.push({ title: heading[1]!, body: "" });
    else {
      if (!sections.length) sections.push({ title: "综合判断", body: "" });
      sections[sections.length - 1]!.body += line + "\n";
    }
  }
  return sections.filter(s => s.body.trim());
}

export function DebateConclusion({ content, provisional = false }: { content: string; provisional?: boolean }) {
  const sections = conclusionSections(content);
  return <section aria-label="辩论综合判断" className="space-y-3">
    {provisional && <p role="status" className="text-xs text-muted-foreground">综合判断生成中 · 以下内容尚未定稿</p>}
    <div className="grid gap-3 lg:grid-cols-2">
      {sections.map((section, index) => <article key={`${index}-${section.title}`}
        className={`min-w-0 rounded-lg border p-4 ${index === 0 ? "border-primary/30 bg-primary/[0.04] lg:col-span-2" : "border-border bg-card"}`}>
        <h3 className="mb-3 text-sm font-semibold">{section.title}</h3>
        <DebateReport content={section.body} />
      </article>)}
    </div>
  </section>;
}
