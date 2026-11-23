import { useEffect, useRef, useState, type ReactNode } from "react";
import { Activity, ChartNoAxesCombined, Landmark, Layers3, ShieldCheck, Telescope } from "lucide-react";
import { MarketOverview } from "../pages/DailyReview";
import { TodayTab, type TodayPanels } from "./TodayTab";
import { ReviewCheckSummary } from "./ReviewCheckSummary";

const chapters = {
  market: { title: "市场全景", icon: ChartNoAxesCombined },
  emotion: { title: "短线情绪", icon: Activity },
  relay: { title: "涨停与接力", icon: Layers3 },
  themes: { title: "题材与资金", icon: Landmark },
  risk: { title: "风险与验证", icon: ShieldCheck },
  background: { title: "市场背景", icon: Telescope },
};
type Chapter = keyof typeof chapters;
const order = Object.keys(chapters) as Chapter[];

function ChapterNav() {
  const nav = useRef<HTMLElement>(null);
  const [active, setActive] = useState<Chapter>("market");
  useEffect(() => {
    const bar = nav.current;
    const main = bar?.closest("main");
    if (!bar || !main) return;
    let frame = 0;
    const readPosition = () => {
      frame = 0;
      const threshold = main.getBoundingClientRect().top + bar.offsetHeight + 20;
      let current: Chapter = "market";
      for (const id of order) {
        const element = document.getElementById(`review-${id}`);
        if (element && element.getBoundingClientRect().top <= threshold) current = id;
      }
      if (main.scrollHeight > main.clientHeight && main.scrollTop + main.clientHeight >= main.scrollHeight - 2) current = "background";
      setActive(current);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(readPosition); };
    main.addEventListener("scroll", schedule, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    observer?.observe(main);
    if (bar.parentElement) observer?.observe(bar.parentElement);
    schedule();
    return () => { main.removeEventListener("scroll", schedule); observer?.disconnect(); cancelAnimationFrame(frame); };
  }, []);
  useEffect(() => {
    const bar = nav.current;
    const item = bar?.querySelector<HTMLElement>('[aria-current="location"]');
    if (!bar || !item || bar.scrollWidth <= bar.clientWidth) return;
    const delta = item.getBoundingClientRect().left - bar.getBoundingClientRect().left;
    if (delta < 0 || delta + item.offsetWidth > bar.clientWidth) bar.scrollLeft += delta - (bar.clientWidth - item.offsetWidth) / 2;
  }, [active]);

  return <nav ref={nav} aria-label="盘面目录" className="review-chapter-nav">
    {order.map(id => <a key={id} href={`#review-${id}`} aria-current={active === id ? "location" : undefined}
      onClick={event => {
        if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        const target = document.getElementById(`review-${id}`);
        target?.focus({ preventScroll: true });
        target?.scrollIntoView({ block: "start" });
      }}>{chapters[id].title}</a>)}
  </nav>;
}

type BoardProps = {
  day: string | null;
  date?: string;
  recentDay: string | null;
  refreshNonce: number;
  panels: TodayPanels;
  onThemes: (tag?: string) => void;
  onVerify: () => void;
};

export function ReviewBoard({ day, date, recentDay, refreshNonce, panels, onThemes, onVerify }: BoardProps) {
  const today = (section: "emotion" | "relay" | "themes" | "risk" | "cycle" | "seal" | "timing") =>
    <TodayTab day={day} section={section} panels={panels} showDate={false} onOpenThemes={onThemes} />;
  const renderSection = (id: Chapter, content: ReactNode) => {
    const { title, icon: Icon } = chapters[id];
    return <section key={id} id={`review-${id}`} tabIndex={-1} aria-labelledby={`review-heading-${id}`} className="review-chapter">
      <h2 id={`review-heading-${id}`}><Icon size={19} aria-hidden="true" />{title}</h2>
      {id === "themes" && today(id)}
      {id === "emotion"
        ? <div className="mb-4 grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">{content}{today("cycle")}</div>
        : content}
      {(id === "emotion" || id === "risk") && today(id)}
      {id === "risk" && day && <ReviewCheckSummary day={day} refreshNonce={refreshNonce} onOpen={onVerify} />}
    </section>;
  };
  return <div className="review-reading-flow">
    <ChapterNav />
    <MarketOverview day={date} recentDay={recentDay} refreshNonce={refreshNonce}
      renderSection={renderSection} relayDetails={(tradingTable: ReactNode) => <>{today("relay")}{tradingTable}{today("seal")}</>}
      themeTiming={today("timing")} />
  </div>;
}
