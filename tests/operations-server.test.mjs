import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { validateEvent,buildFilter,PgOperationsRepository } from '../server/operations-repository.mjs';
import { createOperationsHandler } from '../server/operations-app.mjs';
import { operationReport } from '../src/operationReports.js';
import ExcelJS from 'exceljs';
// Reads an exported workbook into { sheetName: [[cell values]] }.
const readBook=async response=>{const book=new ExcelJS.Workbook();await book.xlsx.load(Buffer.from(await response.arrayBuffer()));return Object.fromEntries(book.worksheets.map(ws=>[ws.name,ws.getSheetValues().filter(Boolean).map(row=>row.slice(1))]));};
const TEST_USERS={admin:{userId:'test-admin',userName:'测试管理员',isAdmin:true},alice:{userId:'test-alice',userName:'测试员工甲',isAdmin:false},bob:{userId:'test-bob',userName:'测试员工乙',isAdmin:false}};
// The shared WeCom session is stubbed here: a cookie names the test user and carries a fixed CSRF token.
const auth={authenticate:request=>{const user=/session=([a-z]+)/.exec(request.headers.get('cookie')||'')?.[1];return TEST_USERS[user]?{...TEST_USERS[user],csrf:'csrf-'+user}:null;}};
const event=()=>({version:1,eventId:randomUUID(),operationId:randomUUID(),time:new Date().toISOString(),action:'protect',result:'success',taskId:'ABC12345',format:'txt',inputName:'=测试.txt',outputName:'脱敏.txt'});

test('single-connection exports finish concurrently without holding a second connection',{skip:!process.env.OPERATIONS_TEST_DATABASE_URL},async()=>{
  const url=process.env.OPERATIONS_TEST_DATABASE_URL;
  if(!new URL(url).pathname.endsWith('_test'))throw new Error('Test database required');
  const repo=new PgOperationsRepository({connectionString:url});repo.pool.options.max=1;
  await repo.initialize(await readFile(new URL('../server/operations-schema.sql',import.meta.url),'utf8'));
  const origin='http://127.0.0.1:4175',taskId=randomUUID();
  const handler=createOperationsHandler({repository:repo,origin,auth});
  try {
    await repo.append(TEST_USERS.alice,{...event(),taskId});
    const session={csrf:'csrf-alice'},cookie='session=alice';
    await Promise.all(Array.from({length:3},async()=>{
      const response=await handler(new Request(origin+'/api/v1/operation-events/export',{method:'POST',headers:{origin,cookie,'content-type':'application/json','x-csrf-token':session.csrf},body:JSON.stringify({query:taskId})}));
      assert.equal(response.status,200);const book=await readBook(response);const detail=book['明细'].slice(1);assert.equal(detail.length,1);assert.equal(detail[0][2],taskId.slice(0,8));assert.ok(!detail.some(row=>row.includes('导出操作记录')));
    }));
  } finally {await repo.pool.query('DELETE FROM operation_events WHERE task_id=$1',[taskId]);await repo.close();}
});
test('event whitelist, task formats, timestamps and basename protection',()=>{
  assert.equal(validateEvent({...event(),inputName:'C:\\secret\\测试.txt'}).inputName,'测试.txt');
  assert.equal(validateEvent({...event(),taskId:randomUUID()}).taskId.length,36);
  for(const extra of [{mapping:{}},{userId:'forged'},{inputName:'a'.repeat(513)},{version:2},{time:'invalid'},{action:'import_credential',inputName:'x'},{taskId:'DEMO0001'}])assert.throws(()=>validateEvent({...event(),...extra}));
});
// Failures carry an error code so the records can say why; never free text, which could quote file content.
test('failed events keep a well-formed error code only',()=>{
  assert.equal(validateEvent({...event(),result:'failed',errorCode:'NO_VALUES'}).errorCode,'NO_VALUES');
  for(const extra of [{result:'success',errorCode:'NO_VALUES'},{result:'failed',errorCode:'所选列没有内容'},{result:'failed',errorCode:'x'.repeat(41)},{result:'failed',errorCode:42}])assert.throws(()=>validateEvent({...event(),...extra}));
});
test('department scope is for admins only and turns into a list of people',async()=>{
  const seen=[];const repo={ready:async()=>{},append:async()=>'accepted',listTasks:async(s,f)=>{buildFilter(s,f);seen.push(f);return{tasks:[],total:0,page:1,pageSize:10};}};
  const origin='http://127.0.0.1:4175';
  const handler=createOperationsHandler({repository:repo,origin,auth:{...auth,departmentUserIds:async id=>id==='2'?['test-alice','test-bob']:[]}});
  const get=(path,user)=>handler(new Request(origin+path,{headers:{cookie:'session='+user}}));
  assert.equal((await get('/api/v1/operation-tasks?department=2','admin')).status,200);
  assert.deepEqual(seen.at(-1).userIds,['test-alice','test-bob']);assert.equal(seen.at(-1).department,undefined);
  assert.equal((await get('/api/v1/operation-tasks?department=2','alice')).status,403);
  assert.equal((await get('/api/v1/operation-tasks?department=x1','admin')).status,400);
  assert.equal((await get('/api/v1/operation-tasks?department=','admin')).status,200);
  assert.equal(seen.at(-1).userIds,undefined);
  const f=buildFilter(TEST_USERS.admin,{userIds:['test-bob'],files:'1'});
  assert.ok(f.sql.includes('owner_user_id = ANY($1::text[])'));assert.deepEqual(f.values[0],['test-bob']);assert.ok(f.sql.includes("NOT IN ('view_all_records','export_records')"));
  assert.throws(()=>buildFilter(TEST_USERS.alice,{userIds:['test-bob']}),/FORBIDDEN/);
  for(const bad of [{userIds:'test-bob'},{userIds:[1]},{files:'yes'}])assert.throws(()=>buildFilter(TEST_USERS.admin,bad),/INVALID_FILTER/);
});
test('lists accept 10, 20, 50 or 100 rows a page and nothing else',()=>{
  assert.equal(buildFilter(TEST_USERS.alice,{}).pageSize,10);
  for(const size of ['10','20','50','100'])assert.equal(buildFilter(TEST_USERS.alice,{pageSize:size}).pageSize,Number(size));
  for(const size of ['30','0','101','1e3','abc'])assert.throws(()=>buildFilter(TEST_USERS.alice,{pageSize:size}),/INVALID_PAGE/);
});
test('filters always scope ordinary users and parameterize literal search',()=>{
  assert.throws(()=>buildFilter(TEST_USERS.alice,{user:'test-bob'}),/FORBIDDEN/);
  const f=buildFilter(TEST_USERS.alice,{query:"%' OR TRUE --",from:'2026-10-01',to:'2026-10-28'});
  assert.ok(f.sql.includes('owner_user_id = $1'));assert.ok(!f.sql.includes('OR TRUE'));assert.equal(f.values[0],'test-alice');assert.ok(f.sql.includes('Asia/Shanghai'));
  for(const bad of [{from:'2026-02-31'},{to:'9999-99-99'},{page:0},{format:'exe'},{result:'ok'},{userId:'forged'},null])assert.throws(()=>buildFilter(TEST_USERS.admin,bad));
});
test('shared sessions, CSRF, origin checks, limits and route hand-off',async()=>{
  const calls=[];const repo={ready:async()=>{},append:async(s,e)=>{validateEvent(e);calls.push(s);return'accepted';},list:async(s,f)=>{buildFilter(s,f);return{records:[],total:1,page:1,pageSize:10};},report:async(s,f)=>operationReport([],{from:f.from,to:f.to},{people:s.isAdmin}),async *exportRows(){yield [{...event(),userName:'测试甲'}];}};
  const origin='http://127.0.0.1:4175';const handler=createOperationsHandler({repository:repo,origin,auth});
  const request=(path,method='GET',body,headers={})=>handler(new Request(origin+path,{method,headers:{origin,'content-type':'application/json',...headers},...(body?{body:JSON.stringify(body)}:{})}));
  const cookie='session=alice';const headers={cookie,'x-csrf-token':'csrf-alice'};
  assert.equal((await request('/api/v1/operation-events')).status,401);
  assert.equal(await request('/api/v1/vault-tasks','GET',null,headers),null);
  assert.equal(await request('/api/v1/session','GET',null,headers),null);
  assert.equal(await request('/auth/wecom/callback'),null);
  assert.equal(await request('/__test/session','POST',{user:'alice'}),null);
  assert.equal((await request('/api/v1/operation-events','GET',null,{cookie:'session=mallory'})).status,401);
  assert.equal((await request('/api/v1/operation-events/batch','POST',{events:[event()]},{cookie})).status,403);
  assert.equal((await request('/api/v1/operation-events?user=test-bob','GET',null,headers)).status,403);
  assert.equal((await request('/api/v1/operation-events/batch','POST',{events:[event()]},headers)).status,200);
  assert.equal(calls[0].userId,'test-alice');
  assert.equal((await request('/api/v1/operation-events','GET',null,{...headers,origin:'https://evil.test'})).status,403);
  assert.equal((await request('/api/v1/operation-events','GET',null,{...headers,'sec-fetch-site':'cross-site'})).status,403);
  assert.equal((await request('/api/v1/operation-events?userId=forged','GET',null,headers)).status,400);
  assert.equal((await request('/api/v1/operation-events?to=9999-99-99','GET',null,headers)).status,400);
  const exported=await request('/api/v1/operation-events/export','POST',{format:'txt'},headers);
  assert.equal(exported.status,200);assert.match(exported.headers.get('content-type'),/spreadsheetml/);
  const body=Buffer.from(await exported.arrayBuffer());const book=await readBook(new Response(body));assert.deepEqual(Object.keys(book),['统计分析','明细','数据表']);
  // The analysis sheet states who exported and the scope; ordinary users see only themselves.
  assert.ok(book['统计分析'].some(row=>row.includes('仅本人')));
  assert.ok(!book['统计分析'].some(row=>row.includes('活跃用户')));
  assert.ok(book['数据表'].some(row=>row.includes('数据范围')&&row.some(v=>String(v).includes('仅本人'))));
  assert.ok(book['数据表'].some(row=>row.includes('格式')&&row.includes('TXT')));
  assert.ok(!book['数据表'].some(row=>row.includes('人员排行')));
  // The trend chart is a real chart part; ordinary users get no people ranking chart.
  const zip=await (await import('jszip')).default.loadAsync(body);
  assert.deepEqual(Object.keys(zip.files).filter(name=>name.startsWith('xl/charts/')&&name.endsWith('.xml')).sort(),['xl/charts/chart1.xml']);
  assert.match(await zip.file('xl/worksheets/sheet1.xml').async('string'),/<drawing r:id="rIdCharts"\/>/);
  // Text that looks like a formula stays plain text in the cell.
  assert.deepEqual(book['明细'][0],['时间（北京时间）','用户','任务编号','输入文件名','输出文件名','格式','操作','结果']);
  assert.equal(book['明细'][1][3],'=测试.txt');assert.equal(book['明细'][1][1],'测试甲');
  const bad=await request('/api/v1/operation-events/batch','POST',{events:[{...event(),mapping:'private'}]},headers);assert.equal((await bad.json()).results[0].status,'rejected');
  assert.equal((await request('/api/v1/operation-events/batch','POST',{events:Array.from({length:101},event)},headers)).status,400);
  assert.equal((await request('/healthz')).status,200);
});

test('admins reading all records leave one view event per 10 minutes; staff and self-scoped reads leave none',async()=>{
  const appended=[];const repo={append:async(s,e)=>{validateEvent(e);appended.push([s.userId,e.action]);return'accepted';},list:async()=>({records:[]}),listTasks:async()=>({tasks:[]}),statistics:async()=>({totals:{},users:[]})};
  const origin='http://127.0.0.1:4175',handler=createOperationsHandler({repository:repo,origin,auth});
  const get=(path,user)=>handler(new Request(origin+path,{headers:{cookie:'session='+user}}));
  for(const path of ['/api/v1/operation-tasks','/api/v1/operation-statistics','/api/v1/operation-events'])assert.equal((await get(path,'alice')).status,200);
  assert.equal((await get('/api/v1/operation-statistics?user=test-admin','admin')).status,200);
  assert.deepEqual(appended,[]);
  await Promise.all([get('/api/v1/operation-tasks','admin'),get('/api/v1/operation-statistics','admin')]);
  await get('/api/v1/operation-events?user=test-bob','admin');
  assert.deepEqual(appended,[['test-admin','view_all_records']]);
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
    const grouped=await repo.listTasks(alice);assert.equal(grouped.total,1);assert.equal(grouped.tasks[0].events.length,12);assert.equal(grouped.tasks[0].protect,'done');
    await assert.rejects(()=>repo.listTasks(alice,{user:bob.userId}),/FORBIDDEN/);assert.equal((await repo.listTasks(admin,{user:bob.userId})).total,1);
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
