export type GuidedPhase='catalog'|'plan'|'execute'|'compose'|'complete'|'needs_input'|'failed'|'cancelled';
interface Progress {phase:GuidedPhase;started_at:string;updated_at:string}
const states=new Map<string,Progress>();
function key(root:string,name:string,session:string){
 if(!/^[A-Za-z][A-Za-z0-9_-]{0,39}$/.test(name)||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/.test(session))throw Error('Invalid progress identifier');
 return `${root}\0${name}\0${session}`;
}
export function progressOf(root:string,name:string,session:string){return states.get(key(root,name,session))??null;}
export function beginProgress(root:string,name:string,session:string){
 const id=key(root,name,session),previous=states.get(id);
 if(previous&&['catalog','plan','execute','compose'].includes(previous.phase))throw Error('This session is already running');
 for(const [k,v] of states)if(!['catalog','plan','execute','compose'].includes(v.phase)&&Date.now()-Date.parse(v.updated_at)>3600000)states.delete(k);
 if(states.size>=200){const done=[...states].find(([,v])=>!['catalog','plan','execute','compose'].includes(v.phase));if(done)states.delete(done[0]);else throw Error('Too many active sessions');}
 const started=new Date().toISOString();states.set(id,{phase:'catalog',started_at:started,updated_at:started});
 return (phase:GuidedPhase)=>states.set(id,{phase,started_at:started,updated_at:new Date().toISOString()});
}
