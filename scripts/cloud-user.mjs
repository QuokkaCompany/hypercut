import path from 'node:path';
import { openStore, createUser } from '../tests/reference/server/cloud/store.mjs';
const email = process.argv[2];
if (!email || process.stdin.isTTY) { console.error('Usage: read a password securely, then pipe it to npm run cloud:user -- email@example.com. Passwords must not be command arguments.'); process.exit(1); }
let password = '';
for await (const chunk of process.stdin) { password += chunk; if (password.length > 258) throw new Error('Password is too long.'); }
const store = openStore(path.resolve(process.env.HYPERCUT_CLOUD_DATA || '.hypercut/cloud'));
try { const user = await createUser(store, email, password.replace(/\r?\n$/, '')); console.log(`Created account: ${user.email}`); }
finally { store.close(); password = ''; }
