// The worker and downloaded bookmark execute the same browser-side functions.
export function contestPageScript(source:string, entry:"contestViewerId"|"readContestDay") {
  return "(()=>{"+source.replace(/^export /gm,"")+"\nreturn "+entry+";})()";
}
