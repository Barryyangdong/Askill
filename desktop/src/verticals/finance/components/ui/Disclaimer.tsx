import { ContextHelp } from "./ContextHelp";
import { PRODUCT_NAME } from "@/lib/brand";

// 中立免责条 —— Agent 负责流程与校验、模型负责推理；产品不荐股、不预测、无倾向。
export function Disclaimer({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <p className="text-[11px] leading-relaxed text-muted-foreground/70">
        {PRODUCT_NAME} 只客观呈现公开数据与榜单，不推荐个股、不预测涨跌、不构成投资建议。
      </p>
    );
  }
  return (
    <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-border py-3 text-[11px] leading-relaxed text-muted-foreground">
      <span>公开数据与研究工具 · 不构成投资建议</span>
      <ContextHelp label="使用说明">
        {PRODUCT_NAME} 在本机组织公开数据、运行研究工具并校验证据，所选 AI 模型负责推理。榜单（连板股 / 成交额等）均为<b className="text-foreground">客观公开数据</b>；本产品<b className="text-foreground">不推荐个股、不预测涨跌、不给买卖时机、不构成投资建议</b>。
        模型输出可能出错，请沿证据链自行核实并独立决策，风险自担。
      </ContextHelp>
    </div>
  );
}
