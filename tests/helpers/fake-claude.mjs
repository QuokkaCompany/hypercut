import { writeFile } from 'node:fs/promises';
import path from 'node:path';

// Disposable process fixture. It never contacts a model or reads user auth.
export async function fakeClaude(directory) {
  const executable = path.join(directory, 'fake-claude'), config = path.join(directory, 'fake-cli-config.json'), record = path.join(directory, 'fake-cli-request.json');
  const defaults = { loggedIn: true, delayMs: 0, fail: false };
  await writeFile(config, JSON.stringify(defaults));
  await writeFile(executable, `#!${process.execPath}
const fs=require('node:fs');
const args=process.argv.slice(2), config=JSON.parse(fs.readFileSync(${JSON.stringify(config)},'utf8'));
if(args.includes('--version')){console.log('2.1.260 (Claude Code fixture)');process.exit(0)}
if(args.includes('--help')){console.log('--safe-mode --tools --strict-mcp-config --mcp-config --no-session-persistence --json-schema --output-format --setting-sources --system-prompt --permission-mode --permission-prompts');process.exit(0)}
if(args.includes('auth')){console.log(JSON.stringify({loggedIn:config.loggedIn,authMethod:config.loggedIn?'claude.ai':'none',apiProvider:'firstParty',email:'private-fixture@example.invalid'}));process.exit(config.loggedIn?0:1)}
let input='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>{
fs.writeFileSync(${JSON.stringify(record)},JSON.stringify({args,input,apiKeyInherited:!!process.env.ANTHROPIC_API_KEY,providerOverrideInherited:!!process.env.ANTHROPIC_BASE_URL}));
setTimeout(()=>{console.log(JSON.stringify(config.fail?{type:'result',subtype:'error_during_execution',is_error:true,result:'private-provider-failure'}:{type:'result',subtype:'success',is_error:false,structured_output:{settings:{thresholdDb:-45,minSilenceMs:700,preRollMs:120,postRollMs:180},explanation:'모의 CLI: 긴 무음에 맞춘 설정입니다.'},usage:{input_tokens:123,output_tokens:45},modelUsage:{'fixture-model':{}},session_id:'private-session-fixture'}));},config.delayMs);
});
`, { mode: 0o700 });
  return { executable, record, async set(value) { await writeFile(config, JSON.stringify({ ...defaults, ...value })); } };
}
