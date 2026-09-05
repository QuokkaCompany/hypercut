import { spawn } from 'node:child_process';
const processes = [
  spawn(process.execPath, ['server/index.mjs'], { stdio: 'inherit', env: { ...process.env, NODE_ENV: 'development' } }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js'], { stdio: 'inherit' })
];
const stop = () => { for (const child of processes) child.kill('SIGTERM'); };
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, stop);
for (const child of processes) child.on('exit', code => { if (code) { stop(); process.exitCode = code; } });
