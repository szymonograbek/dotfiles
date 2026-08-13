#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
const p=path.join(process.cwd(),'.eval','state.json'); const s=JSON.parse(fs.readFileSync(p,'utf8')); const a=process.argv.slice(2); s.calls.push(`jira ${a.join(' ')}`);
if(a[0]==='issue'){s.jiraReads++; console.log(JSON.stringify({key:a[1],url:`https://jira.test/browse/${a[1]}`,summary:'Invite teammates and manage team members',description:s.jiraDescription,status:'In Progress'}));}
else if(a[0]==='request'){s.jiraRawReads++; console.log(JSON.stringify({fields:{description:{type:'doc',version:1,content:[{type:'paragraph',content:[{type:'text',text:s.jiraDescription}]}]}}}));}
else if(a[0]==='edit'){const raw=fs.readFileSync(0,'utf8'); const body=JSON.parse(raw); const text=JSON.stringify(body); s.jiraDescription=text; console.log(JSON.stringify({updated:true}));}
else console.log('{}');
fs.writeFileSync(p,JSON.stringify(s,null,2));
