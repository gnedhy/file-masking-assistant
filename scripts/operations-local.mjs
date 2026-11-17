import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = path.join(root, 'tests/output/operations-pg');
const bin = process.env.OPERATIONS_PG_BIN || 'C:/Program Files/PostgreSQL/18/bin';
const run = (name, args, allowFailure = false) => {
  const r = spawnSync(path.join(bin, name + (process.platform === 'win32' ? '.exe' : '')), args, {encoding:'utf8', windowsHide:true, stdio:name === 'pg_ctl' && args.includes('start') ? 'ignore' : 'pipe'});
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.error || r.status && !allowFailure) throw r.error || new Error(`${name} failed (${r.status})`);
  return r.status;
};
const conn = ['-h','127.0.0.1','-p','55434','-U','operations_test'];
const command = process.argv[2] || 'status';
if (command === 'start') {
  mkdirSync(path.dirname(data), {recursive:true});
  // Test-only loopback cluster; never use these trust credentials for enterprise deployment.
  if (!existsSync(path.join(data,'PG_VERSION'))) run('initdb',['-D',data,'-U','operations_test','-A','trust','--encoding=UTF8','--locale=C']);
  if (run('pg_ctl',['-D',data,'status'],true) !== 0) run('pg_ctl',['-D',data,'-l',path.join(data,'server.log'),'-o','-h 127.0.0.1 -p 55434','-w','start']);
  const check = spawnSync(path.join(bin,'psql.exe'),[...conn,'-d','postgres','-tAc',"SELECT 1 FROM pg_database WHERE datname='filemask_operations_test'"],{encoding:'utf8',windowsHide:true});
  if (check.status !== 0) throw new Error('Isolated database unavailable');
  if (!check.stdout.trim()) run('createdb',[...conn,'filemask_operations_test']);
} else if (command === 'stop') run('pg_ctl',['-D',data,'-m','fast','-w','stop']);
else if (command === 'status') run('pg_ctl',['-D',data,'status'],true);
else if (command === 'backup') run('pg_dump',[...conn,'-d','filemask_operations_test','-Fc','-f',path.join(data,'operations.backup')]);
else if (command === 'restore-check') {
  const name = `operations_restore_${Date.now()}`;
  run('createdb',[...conn,name]);
  run('pg_restore',[...conn,'-d',name,'--exit-on-error',path.join(data,'operations.backup')]);
  run('psql',[...conn,'-d',name,'-c',"SELECT tablename FROM pg_tables WHERE schemaname='public'"]);
  console.log(`Restored validation database retained: ${name}`);
} else throw new Error('Use start, stop, status, backup or restore-check');
