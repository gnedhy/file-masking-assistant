import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID,createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { validateEvent,buildFilter,PgOperationsRepository } from '../server/operations-repository.mjs';
import { createOperationsHandler,TEST_USERS } from '../server/operations-app.mjs';
const event=()=>({version:1,eventId:randomUUID(),operationId:randomUUID(),time:new Date().toISOString(),action:'protect',result:'success',taskId:'ABC12345',format:'txt',inputName:'=测试.txt',outputName:'脱敏.txt'});

test('single-connection exports finish concurrently without holding a second connection',{skip:!process.env.OPERATIONS_TEST_DATABASE_URL},async()=>{
  const url=process.env.OPERATIONS_TEST_DATABASE_URL;
  if(!new URL(url).pathname.endsWith('_test'))throw new Error('Test database required');
  const repo=new PgOperationsRepository({connectionString:url});repo.pool.options.max=1;
  await repo.initialize(await readFile(new URL('../server/operations-schema.sql',import.meta.url),'utf8'));
  const prior=process.env.NODE_ENV;process.env.NODE_ENV='test';
  const origin='http://127.0.0.1:4175',secret='x'.repeat(32),taskId=randomUUID();
  const handler=createOperationsHandler({repository:repo,origin,sessionSecret:secret,testMode:true,testSecret:secret});
  try {
    await repo.append(TEST_USERS.alice,{...event(),taskId});
    const login=await handler(new Request(origin+'/__test/session',{method:'POST',headers:{origin,'content-type':'application/json','x-test-secret':secret},body:JSON.stringify({user:'alice'})}));
    const session=await login.json(),cookie=login.headers.get('set-cookie').split(';')[0];
    await Promise.all(Array.from({length:3},async()=>{
      const response=await handler(new Request(origin+'/api/v1/operation-events/export',{method:'POST',headers:{origin,cookie,'content-type':'application/json','x-csrf-token':session.csrf},body:JSON.stringify({query:taskId})}));
      assert.equal(response.status,200);const csv=await response.text();assert.ok(csv.includes(taskId));assert.ok(!csv.includes('导出操作记录'));
    }));
  } finally {await repo.pool.query('DELETE FROM operation_events WHERE task_id=$1',[taskId]);await repo.close();if(prior===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=prior;}
});
test('event whitelist, task formats, timestamps and basename protection',()=>{
  assert.equal(validateEvent({...event(),inputName:'C:\\secret\\测试.txt'}).inputName,'测试.txt');
  assert.equal(validateEvent({...event(),taskId:randomUUID()}).taskId.length,36);
  for(const extra of [{mapping:{}},{userId:'forged'},{inputName:'a'.repeat(513)},{version:2},{time:'invalid'},{action:'import_credential',inputName:'x'},{taskId:'DEMO0001'}])assert.throws(()=>validateEvent({...event(),...extra}));
});
test('filters always scope ordinary users and parameterize literal search',()=>{
  assert.throws(()=>buildFilter(TEST_USERS.alice,{user:'test-bob'}),/FORBIDDEN/);
  const f=buildFilter(TEST_USERS.alice,{query:"%' OR TRUE --",from:'2026-10-01',to:'2026-10-28'});
  assert.ok(f.sql.includes('owner_user_id = $1'));assert.ok(!f.sql.includes('OR TRUE'));assert.equal(f.values[0],'test-alice');assert.ok(f.sql.includes('Asia/Shanghai'));
  for(const bad of [{from:'2026-02-31'},{to:'9999-99-99'},{page:0},{format:'exe'},{result:'ok'},{userId:'forged'},null])assert.throws(()=>buildFilter(TEST_USERS.admin,bad));
});
test('HTTP test sessions, CSRF, disabled Vault, limits and unauthorized requests',async()=>{
  const previous=process.env.NODE_ENV;process.env.NODE_ENV='test';
  const calls=[];const repo={ready:async()=>{},append:async(s,e)=>{validateEvent(e);calls.push(s);return'accepted';},list:async(s,f)=>{buildFilter(s,f);return{records:[],total:0,page:1,pageSize:10};},async *exportRows(){yield [{...event(),userName:'测试甲'}];}};
  const origin='http://127.0.0.1:4175';const secret='x'.repeat(32);const handler=createOperationsHandler({repository:repo,origin,sessionSecret:secret,testMode:true,testSecret:secret});
  const request=(path,method='GET',body,headers={})=>handler(new Request(origin+path,{method,headers:{origin,'content-type':'application/json',...headers},...(body?{body:JSON.stringify(body)}:{})}));
  try{
    assert.equal((await request('/api/v1/session')).status,401);
    assert.equal((await request('/api/v1/vault-tasks')).status,404);
    assert.equal((await request('/__test/session','POST',{user:'alice'})).status,403);
    const login=await request('/__test/session','POST',{user:'alice'},{'x-test-secret':secret});assert.equal(login.status,200);
    const session=await login.json();const cookie=login.headers.get('set-cookie').split(';')[0];assert.ok(login.headers.get('set-cookie').includes('HttpOnly'));
    const headers={cookie,'x-csrf-token':session.csrf};
    assert.equal((await request('/api/v1/session','GET',null,{cookie:cookie+'tampered'})).status,401);
    const expired=Buffer.from(JSON.stringify({subject:'admin',csrf:'forged',exp:Date.now()-1})).toString('base64url');
    const signature=createHmac('sha256',secret).update(expired).digest('base64url');
    assert.equal((await request('/api/v1/session','GET',null,{cookie:`ops_session=${expired}.${signature}`})).status,401);
    assert.equal((await request('/api/v1/operation-events/batch','POST',{events:[event()]},{cookie})).status,403);
    assert.equal((await request('/api/v1/operation-events?user=test-bob','GET',null,headers)).status,403);
    assert.equal((await request('/api/v1/operation-events/batch','POST',{events:[event()]},headers)).status,200);
    assert.equal(calls[0].userId,'test-alice');
    assert.equal((await request('/api/v1/session','GET',null,{cookie,origin:'https://evil.test'})).status,403);
    assert.equal((await request('/api/v1/operation-events?userId=forged','GET',null,headers)).status,400);
    assert.equal((await request('/api/v1/operation-events?to=9999-99-99','GET',null,headers)).status,400);
    const exported=await request('/api/v1/operation-events/export','POST',{format:'txt'},headers);
    assert.equal(exported.status,200);const csv=await exported.text();assert.ok(csv.includes('筛选范围'));assert.ok(csv.includes('test-alice'));assert.ok(csv.includes("'=测试.txt"));
    const bad=await request('/api/v1/operation-events/batch','POST',{events:[{...event(),mapping:'private'}]},headers);assert.equal((await bad.json()).results[0].status,'rejected');
    assert.equal((await request('/api/v1/operation-events/batch','POST',{events:Array.from({length:101},event)},headers)).status,400);
    const disabled=createOperationsHandler({repository:repo,origin,sessionSecret:secret});assert.equal((await disabled(new Request(origin+'/__test/session'))).status,404);
  }finally{if(previous===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=previous;}
});

test('PostgreSQL isolation, duplicate conflict, pagination, statistics and export',{skip:!process.env.OPERATIONS_TEST_DATABASE_URL},async()=>{
  const connectionString=process.env.OPERATIONS_TEST_DATABASE_URL;
  if(!new URL(connectionString).pathname.endsWith('_test'))throw new Error('Only explicit test databases are allowed');
  const repo=new PgOperationsRepository({connectionString});await repo.initialize(await readFile(new URL('../server/operations-schema.sql',import.meta.url),'utf8'));
  const suffix=randomUUID();const alice={userId:'test-'+suffix,userName:'测试甲',isAdmin:false};const bob={userId:'test-b-'+suffix,userName:'测试乙',isAdmin:false};const admin={...alice,isAdmin:true};
  try{
    const first=event();assert.equal(await repo.append(alice,first),'accepted');assert.equal(await repo.append(alice,first),'duplicate');await assert.rejects(()=>repo.append(alice,{...first,result:'failed'}),/EVENT_CONFLICT/);
    for(let i=0;i<11;i++)await repo.append(alice,{...event(),action:'download_protect',result:'requested'});
    await repo.append(bob,event());
    assert.equal((await repo.list(alice)).total,12);assert.equal((await repo.list(alice)).records.length,10);assert.equal((await repo.list(alice,{page:2})).records.length,2);
    await assert.rejects(()=>repo.list(alice,{user:bob.userId}),/FORBIDDEN/);
    assert.equal((await repo.list(admin,{user:bob.userId})).total,1);
    const stats=await repo.statistics(alice);assert.equal(stats.totals.protected,1);assert.equal(stats.totals.downloads,11);
    let count=0;for await(const batch of repo.exportRows(alice))count+=batch.length;assert.equal(count,12);
    const same=event();const concurrent=await Promise.all([repo.append(alice,same),repo.append(alice,same)]);assert.deepEqual(concurrent.sort(),['accepted','duplicate']);
    const cursor=repo.exportRows(alice);await cursor.next();await cursor.return();await repo.ready();
    await repo.append(alice,{...event(),action:'restore',result:'partial'});await repo.append(alice,{...event(),action:'restore',result:'missing'});
    assert.equal((await repo.statistics(alice)).totals.restored,1);
    const shanghaiDay=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    assert.ok((await repo.list(alice,{from:shanghaiDay,to:shanghaiDay})).total>=1);
    await repo.pool.query("UPDATE operation_events SET occurred_at=now()-interval '181 days' WHERE owner_user_id=$1",[bob.userId]);await repo.cleanupExpired();assert.equal((await repo.list(admin,{user:bob.userId})).total,0);
  }finally{await repo.pool.query('DELETE FROM operation_events WHERE owner_user_id=ANY($1)',[[alice.userId,bob.userId]]);await repo.close();}
});
