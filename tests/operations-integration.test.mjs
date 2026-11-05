import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import os from 'node:os';
import {PgOperationsRepository} from '../server/operations-repository.mjs';
test('isolated 100k database performance and permissions', async()=>{
 const repo=new PgOperationsRepository({connectionString:'postgres://operations_test@127.0.0.1:55434/filemask_operations_test'});
 try {
 await repo.initialize(await readFile(new URL('../server/operations-schema.sql',import.meta.url),'utf8'));
 await repo.pool.query(`INSERT INTO operation_events(owner_user_id,user_name,event_id,operation_id,version,occurred_at,action,result,task_id,format,input_name,output_name,payload) SELECT 'performance-fixture','虚构性能用户',md5('perf-event-'||i)::uuid,md5('perf-op-'||i)::uuid,1,now() - (i%29)*interval '1 day','protect','success',lpad(to_hex(i),8,'0'),'txt','虚构输入.txt','虚构输出.txt','{}'::jsonb FROM generate_series(1,100000) i ON CONFLICT DO NOTHING`);
 const session={userId:'performance-fixture',userName:'虚构性能用户',isAdmin:false};
 for(const [name,fn] of [['page',()=>repo.list(session,{page:1})],['filtered',()=>repo.list(session,{query:'虚构输入',format:'txt'})],['statistics',()=>repo.statistics(session,{})],['export',()=>repo.exportRows(session,{})]]) {
 const start=performance.now();const result=await fn();console.log(JSON.stringify({name,ms:Math.round(performance.now()-start),machine:os.cpus()[0].model,rows:Array.isArray(result)?result.length:result.total}));
 if(name==='page') {assert.equal(result.total,100000);assert.equal(result.records.length,10);}
 if(name==='export') {let count=0;for await(const batch of result) count+=batch.length;assert.equal(count,100000);console.log(JSON.stringify({name:'export-consumed',ms:Math.round(performance.now()-start),rows:count}));}
 }
 assert.equal((await repo.list({userId:'unrelated-user',isAdmin:false},{})).total,0);
 } finally {await repo.close();}
});
