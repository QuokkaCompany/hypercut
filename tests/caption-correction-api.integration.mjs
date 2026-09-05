import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm,readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { startServer } from '../server/app.mjs';
import { createClaudeCLI } from '../server/claude-cli.mjs';
import { fakeClaude } from './helpers/fake-claude.mjs';
import { DEFAULT_SETTINGS } from '../shared/timeline.mjs';
const input={requestId:randomUUID(),instruction:'오타만 수정',glossary:'캡컶 → 캡컷',cues:[{id:'a',text:'캡컶에서 10분을 편집햇어요.'}]};
const proposal={requestId:input.requestId,changes:[{id:'a',before:input.cues[0].text,after:'캡컷에서 10분을 편집했어요.',reason:'맞춤법 수정'}]};
async function client(server){const {token}=await(await fetch(server.url+'/api/config')).json();return(route,body,method=body?'POST':'GET')=>fetch(server.url+'/api/ai/'+route,{method,headers:{'Content-Type':'application/json','X-Hypercut-Token':token},body:body&&JSON.stringify(body)});}
test('C08: pre-start cancellation, duplicate delivery and an old cancellation cannot execute or stop a different request',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'hypercut-correction-order-'));let calls=0,delay=false,release,started;const running=new Promise(resolve=>started=resolve);
 const server=await startServer({port:0,dataDir:directory,aiFetch:async(_url,options)=>{calls++;const body=JSON.parse(options.body),data=JSON.parse(body.messages[0].content.split('\nRequest: ').at(-1));if(delay){started();await new Promise(resolve=>release=resolve);}return Response.json({done:true,message:{content:JSON.stringify({requestId:data.requestId,changes:[]})}});}});
 try{const call=await client(server);await call('connection',{provider:'ollama',model:'selected-model'});const cancelled={...input,requestId:randomUUID()};
  await call('correction',{requestId:cancelled.requestId},'DELETE');assert.equal((await call('correction',cancelled)).status,400);assert.equal(calls,0);
  const fresh={...input,requestId:randomUUID()};await call('correction',{requestId:cancelled.requestId},'DELETE');assert.equal((await call('correction',fresh)).status,200);assert.equal(calls,1);
  assert.equal((await call('correction',fresh)).status,400);assert.equal(calls,1);
  delay=true;const newest={...input,requestId:randomUUID()},pending=call('correction',newest);await running;await call('correction',{requestId:cancelled.requestId},'DELETE');release();assert.equal((await pending).status,200);assert.equal(calls,2);
 }finally{await server.close();await rm(directory,{recursive:true,force:true});}
});
test('C08: correction shares the single active request and discards late replies after disconnect',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'hypercut-correction-api-'));let respond,started;const called=new Promise(resolve=>started=resolve);let count=0;
 const server=await startServer({port:0,dataDir:directory,aiFetch:async()=>{count++;started();return new Promise(resolve=>{respond=()=>resolve(Response.json({done:true,message:{content:JSON.stringify(proposal)}}));});}});
 try{const call=await client(server);await call('connection',{provider:'ollama',model:'selected-model'});const pending=call('correction',input);await called;
  assert.equal((await call('correction',input)).status,400);assert.equal((await call('proposal',{instruction:'test',settings:DEFAULT_SETTINGS})).status,400);assert.equal(count,1);
  await call('connection',undefined,'DELETE');respond();const old=await pending;assert.equal(old.status,400);assert.match((await old.json()).error,/취소|폐기/);
  assert.deepEqual(await(await call('connection')).json(),{connected:false});
 }finally{await server.close();await rm(directory,{recursive:true,force:true});}
});
test('C07/C08: actual disposable Claude CLI process receives correction schema/text and no files or tools',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'hypercut-correction-cli-')),fake=await fakeClaude(directory);await fake.set({output:proposal});
 const server=await startServer({port:0,dataDir:directory,claudeCLI:createClaudeCLI({executable:fake.executable})});
 try{const call=await client(server);await call('connection',{provider:'claude_cli',model:'selected-model'});assert.equal((await(await call('connection')).json()).verified,false);
  const response=await call('correction',{...input,mediaPath:'/private/user.mov',cues:input.cues.map(cue=>({...cue,start:8,end:9}))});assert.equal(response.status,200);assert.deepEqual(await response.json(),proposal);
  const recorded=JSON.parse(await readFile(fake.record,'utf8'));assert.ok(recorded.input.includes(input.requestId));assert.ok(!recorded.input.includes('/private'));assert.ok(!recorded.input.includes('"start"'));assert.ok(!recorded.input.includes('"end"'));
  assert.equal(recorded.args[recorded.args.indexOf('--tools')+1],'');assert.equal(recorded.args[recorded.args.indexOf('--mcp-config')+1],'{"mcpServers":{}}');assert.ok(recorded.args.includes('--no-session-persistence'));assert.equal(JSON.parse(recorded.args[recorded.args.indexOf('--json-schema')+1]).properties.changes.type,'array');
  const state=await(await call('connection')).json();assert.equal(state.verified,true);assert.equal(state.lastExecution.inputTokens,123);assert.equal(state.lastExecution.requestedModel,'selected-model');assert.ok(!JSON.stringify(state).includes('private-session'));
  const badRequest={...input,requestId:randomUUID()};await fake.set({output:{...proposal,requestId:badRequest.requestId,changes:[{...proposal.changes[0],after:'100분'}]}});assert.equal((await call('correction',badRequest)).status,400);assert.equal((await(await call('connection')).json()).verified,false);
 }finally{await server.close();await rm(directory,{recursive:true,force:true});}
});
test('C08: actual CLI correction cancellation settles and permits a subsequent request',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'hypercut-correction-cancel-')),fake=await fakeClaude(directory);await fake.set({output:proposal,delayMs:30000});
 const server=await startServer({port:0,dataDir:directory,claudeCLI:createClaudeCLI({executable:fake.executable})});
 try{const call=await client(server);await call('connection',{provider:'claude_cli',model:'selected-model'});const pending=call('correction',input);
  let live=false;for(let i=0;i<200;i++){if(await readFile(fake.record).catch(()=>null)){live=true;break;}await new Promise(resolve=>setTimeout(resolve,10));}assert.ok(live);
  const at=performance.now();await call('correction',undefined,'DELETE');assert.equal((await pending).status,400);assert.ok(performance.now()-at<5000);
  const fresh={...input,requestId:randomUUID()},answer={...proposal,requestId:fresh.requestId};await fake.set({output:answer});const retry=await call('correction',fresh);assert.equal(retry.status,200);assert.deepEqual(await retry.json(),answer);
 }finally{await server.close();await rm(directory,{recursive:true,force:true});}
});
