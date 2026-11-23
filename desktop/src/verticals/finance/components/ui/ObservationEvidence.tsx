/** A saved player analysis reference points to a local, versioned workspace URL. */
export function ObservationEvidence({text,hide}:{text:string;hide:boolean}){
  const lines=text.split("\n");
  const last=lines[lines.length-1]??"";
  const linked=!hide&&/^\/player-analysis\?[^\s#]+$/.test(last);
  return <p className="whitespace-pre-wrap break-words">{linked?<>{lines.slice(0,-1).join("\n")}<br/><a className="text-primary" href={last}>查看选手分析原始记录 →</a></>:text}</p>;
}

