import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
export function verifySource(repo){
 if(!path.isAbsolute(repo))throw Error('Project path must be absolute');
 const root=fs.realpathSync(repo),file=path.join(root,'source-manifest.json');
 if(!fs.existsSync(file))return {ok:true,manifest:false,verified:false};
 const manifest=JSON.parse(fs.readFileSync(file,'utf8'));
 if(manifest.format!==1||manifest.product!=='Askill'||!manifest.files||typeof manifest.files!=='object'||Array.isArray(manifest.files))throw Error('Invalid source manifest');
 const entries=Object.entries(manifest.files);
 if(!entries.length||entries.length>20000)throw Error('Invalid source file count');
 for(const [name,hash] of entries){
   if(name.split('/').some(p=>['.local','.git','.aws','.codex','.venv','node_modules'].includes(p)||p.startsWith('.env'))||/\.(pem|key|pfx)$/i.test(name))throw Error('Private paths are not source files');
   if(!name||name.includes('\\')||name.includes(':')||name.split('/').some(p=>!p||p==='.'||p==='..')||path.isAbsolute(name)||!/^[a-f0-9]{64}$/.test(String(hash)))throw Error('Invalid manifest entry');
   const target=path.resolve(root,name),relative=path.relative(root,target);
   if(relative.startsWith('..')||path.isAbsolute(relative)||!fs.existsSync(target))throw Error(`Source file missing: ${name}`);
   const actualRelative=path.relative(root,fs.realpathSync(target));
   if(actualRelative.startsWith('..')||path.isAbsolute(actualRelative)||!fs.statSync(target).isFile())throw Error(`Invalid source path: ${name}`);
   if(crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex')!==hash)throw Error(`Source file changed: ${name}`);
 }
 return {ok:true,manifest:true,verified:true,files:entries.length,release:manifest.release===true};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 try{if(process.argv.length!==4||process.argv[2]!=='--repo')throw Error('Usage: node verify-source.mjs --repo <absolute project path>');console.log(JSON.stringify(verifySource(process.argv[3])));}
 catch(e){console.error(JSON.stringify({ok:false,error:e.message}));process.exitCode=1;}
}
