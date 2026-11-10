import * as Effect from 'effect/Effect';
import {createStore} from './store.mjs';

export default {
  apiVersion:1,id:'project-memory',name:'Shared Project Memory',version:'1.0.0',
  activate: context => Effect.gen(function*(){
    if(!context.capabilities?.includes('command-invocation-context') || !context.environmentId || !context.notifications) throw new Error('Requires prototype host with command-invocation-context, environment identity and project targets.');
    const environmentId=yield* context.environmentId;
    const store=createStore(context.dataDirectory,environmentId);
    let selected, page=1;
    const attempt=fn=>Effect.sync(()=>{try{return fn()}catch(e){return {$t3:'notice',tone:'danger',text:e.message}}});
    const user=(invocation)=>{if(invocation?.audience!=='client')throw new Error('This command is available only to users.');};
    const project=(input,invocation)=>{
      if(invocation?.audience==='agent'){
        if(invocation.environmentId!==environmentId || !invocation.projectId || !invocation.threadId)throw new Error('A live T3 thread in this environment is required.');
        return invocation.projectId;
      }
      user(invocation);
      if(typeof input.projectId!=='string'||!input.projectId)throw new Error('Select a project first.');return input.projectId;
    };
    const provenance=invocation=>invocation.audience==='agent'?{actor:'agent',threadId:invocation.threadId,environmentId}:{actor:'user',environmentId};
    const command=(id,title,agent,write,run)=>({id,title,description:title,agent,permission:write?'orchestration:operate':'orchestration:read',run:(input,invocation)=>attempt(()=>run(input,invocation))});
    const commands=[
      command('remember','Remember or correct learned project knowledge. Supply content and source; supply id to correct. Project comes from the calling thread.',true,true,(i,c)=>store.remember(project(i,c),i,provenance(c))),
      command('recall','Recall project knowledge with lexical AND search. Optional query, limit (1–20), budget (1–20000 characters). No automatic prompt injection.',true,false,(i,c)=>store.recall(project(i,c),i)),
      command('forget','Forget an entry by id in the calling project. Removes its correction history too.',true,true,(i,c)=>store.forget(project(i,c),i.id,c.audience==='agent')),
      command('configure','Enable or disable agent memory for this project',false,true,(i,c)=>{user(c);return store.configure(project(i,c),i.enabled)}),
      command('clear','Delete all project memory and disable agent access',false,true,(i,c)=>{user(c);if(i.confirm!=='DELETE')throw new Error('Type DELETE to clear this project.');return store.clear(project(i,c))}),
      command('export','Export project memory, including provenance and recent corrections, three entries per page',false,false,(i,c)=>{user(c);return store.export(project(i,c),i.page)}),
      command('select','Inspect project memory',false,false,(i,c)=>{user(c);selected=project(i,c);page=Number.isInteger(Number(i.page))&&Number(i.page)>0?Number(i.page):1;return {selected,page}}),
    ];
    const field=(name,label,value,kind='text')=>({name,label,kind,value});
    const form=(id,label,cmd,input,fields)=>({id,kind:'form',label,command:cmd,input,fields});
    return {commands,views:[{id:'memory',title:'Shared Project Memory',location:'settings-page',permission:'orchestration:read',read:()=>Effect.gen(function*(){
      const targets=yield* context.notifications.targets;
      const projects=[...new Map([...targets.projects,...store.projects().map(id=>({id,label:id}))].map(p=>[p.id,p])).values()].slice(0,99);
      const blocks=[{id:'about',kind:'text',text:'Agent-accessible learned knowledge, off by default for each project. Recall is pull-only. Disabling retains entries for inspection/export/delete; clearing deletes entries and disables access. This environment only: no automatic sync or private Project Notes access.'}];
      if(!projects.length)return {title:'Shared Project Memory',blocks:[...blocks,{id:'empty',kind:'text',text:'Create a project on this environment first.'}]};
      blocks.push(form('choose','Inspect project','select',{},[{name:'projectId',label:'Project',kind:'select',value:selected??projects[0].id,options:projects.map(p=>({label:p.label.slice(0,200),value:p.id}))},field('page','Page',page,'number')]));
      if(!selected)return {title:'Shared Project Memory',blocks};
      const data=store.read(selected), input={projectId:selected};
      blocks.push({id:'identity',kind:'text',text:`Environment: ${environmentId}\nProject: ${selected}\n${data.entries.length}/500 entries. Page ${page}.`});
      blocks.push(form('enabled','Agent access','configure',input,[field('enabled','Enable agent memory',data.enabled,'boolean')]));
      blocks.push(form('add','Remember knowledge','remember',input,[field('content','Knowledge',''),field('source','Source or reason','')]));
      for(const entry of data.entries.slice((page-1)*3,page*3)) {
        blocks.push({id:'meta-'+entry.id,kind:'text',text:`${entry.id}\nCreated ${entry.createdAt}; updated ${entry.updatedAt}\n${JSON.stringify(entry.provenance)}\nRecent corrections: ${JSON.stringify(entry.history)}`});
        blocks.push(form('edit-'+entry.id,'Correct memory','remember',{...input,id:entry.id},[field('content','Knowledge',entry.content),field('source','Source or reason',entry.source)]));
        blocks.push({id:'delete-'+entry.id,kind:'actions',actions:[{id:'forget',label:'Delete entry and history',command:'forget',input:{...input,id:entry.id}}]});
      }
      blocks.push(form('export','Export JSON (three entries per page)','export',input,[field('page','Export page',page,'number')]));
      blocks.push(form('clear','Clear all memory and disable','clear',input,[field('confirm','Type DELETE to permanently clear this project','')]));
      return {title:'Shared Project Memory',blocks};
    })}]};
  })
};
