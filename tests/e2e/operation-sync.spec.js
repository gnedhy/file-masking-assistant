import { test, expect } from "@playwright/test";

const syncState = page => page.evaluate(async () => (await import('/src/operationSync.js')).getOperationSyncState());
const retry = page => page.evaluate(async () => (await import('/src/operationSync.js')).retryOperationSync());
const record = (page, name = '虚构记录.txt') => page.evaluate(async name => (await import('/src/operationLog.js')).recordOperation('protect','success',{ inputName:name,outputName:'脱敏结果.txt',format:'txt',taskId:'ABCD1234',mapping:'禁止进入队列' }), name);

test('集中记录离线持久补传、身份隔离、去重确认及永久拒绝', async ({ page }) => {
  let user = 'alice', available = false, rejected = false;
  const received = [];
  await page.route('**/api/v1/session', route => route.fulfill({json:{userId:user,userName:user,isAdmin:user==='admin',csrf:`csrf-${user}`}}));
  await page.route('**/api/v1/operation-events/batch', async route => {
    if (!available) return route.fulfill({ status:503,json:{code:'TEMPORARY'} });
    const events=route.request().postDataJSON().events;
    received.push({user,events});
    await route.fulfill({json:{results:events.map(e=>({eventId:e.eventId,status:rejected?'rejected':'accepted'}))}});
  });
  await page.goto('/');
  await page.evaluate(async()=> (await import('/src/operationSync.js')).startOperationSync());
  await expect.poll(async()=> (await syncState(page)).session?.userId).toBe('alice');
  expect(await record(page,'C:\\private\\虚构记录.txt')).toBe(true);
  await expect.poll(async()=> (await syncState(page)).pending).toBe(1);
  await page.reload();
  await page.evaluate(async()=> (await import('/src/operationSync.js')).startOperationSync());
  await expect.poll(async()=> (await syncState(page)).pending).toBe(1);
  user='bob'; available=true;
  await retry(page);
  await expect.poll(async()=> (await syncState(page)).session?.userId).toBe('bob');
  await expect.poll(async()=> (await syncState(page)).otherPending).toBe(1);
  expect(received).toHaveLength(0);
  await record(page,'Bob.txt');
  await expect.poll(()=>received.length).toBe(1);
  expect(received[0].user).toBe('bob');
  expect(received[0].events[0].inputName).toBe('Bob.txt');
  user='alice'; await retry(page);
  await expect.poll(()=>received.length).toBe(2);
  expect(received[1].events[0].inputName).toBe('虚构记录.txt');
  expect(JSON.stringify(received)).not.toContain('private');
  expect(JSON.stringify(received)).not.toContain('禁止进入队列');
  await expect.poll(async()=> (await syncState(page)).pending).toBe(0);
  expect((await syncState(page)).lastConfirmed).toBeTruthy();
  rejected=true; await record(page,'拒绝.txt');
  await expect.poll(async()=> (await syncState(page)).rejected).toBe(1);
  const count=received.length; await retry(page);
  await expect.poll(async()=> (await syncState(page)).pending).toBe(0);
  expect(received.length).toBe(count);
});

test('未登录不补历史，队列上限不覆盖已有记录，401暂停且不改变归属', async ({ page }) => {
  test.setTimeout(90000);
  let loggedIn=false;
  await page.route('**/api/v1/session',route=>route.fulfill(loggedIn?{json:{userId:'alice',userName:'Alice',csrf:'csrf'}}:{status:401,json:{}}));
  await page.route('**/api/v1/operation-events/batch',route=>route.fulfill({status:401,json:{}}));
  // Keep the page here instead of following the automatic WeCom sign-in redirect.
  await page.route('**/auth/wecom/start',route=>route.fulfill({status:204}));
  await page.goto('/');
  await page.evaluate(async()=> (await import('/src/operationSync.js')).startOperationSync());
  await record(page,'未登录.txt');
  loggedIn=true; await retry(page);
  await expect.poll(async()=> (await syncState(page)).session?.userId).toBe('alice');
  expect((await syncState(page)).pending).toBe(0);
  await page.evaluate(async()=>{
    const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('file-masking-assistant-v2-operation-outbox',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    await new Promise((resolve,reject)=>{const tx=db.transaction('events','readwrite');tx.oncomplete=resolve;tx.onerror=reject;for(let i=0;i<5000;i++){const eventId=crypto.randomUUID();tx.objectStore('events').add({eventId,owner:'another-user',event:{eventId},bytes:100});}});db.close();
  });
  expect(await record(page,'超出容量.txt')).toBe(false);
  await expect.poll(async()=> (await syncState(page)).otherPending).toBe(5000);
  expect((await syncState(page)).error).toContain('不完整');
  await page.evaluate(async()=>{
    const db=await new Promise(resolve=>{const r=indexedDB.open('file-masking-assistant-v2-operation-outbox');r.onsuccess=()=>resolve(r.result);});
    await new Promise(resolve=>{const tx=db.transaction('events','readwrite');tx.objectStore('events').clear();tx.oncomplete=resolve;});db.close();
  });
  await record(page,'会话到期.txt');
  await expect.poll(async()=> (await syncState(page)).session).toBe(null);
  await expect.poll(async()=> (await syncState(page)).otherPending).toBe(1);
});

test('响应丢失重试使用相同事件ID，队列写入失败如实提示且不阻断处理',async({page})=>{
  const attempts=[];
  await page.route('**/api/v1/session',route=>route.fulfill({json:{userId:'alice',userName:'Alice',csrf:'csrf'}}));
  await page.route('**/api/v1/operation-events/batch',async route=>{
    const events=route.request().postDataJSON().events; attempts.push(events);
    if(attempts.length===1) return route.abort();
    await route.fulfill({json:{results:events.map(e=>({eventId:e.eventId,status:'duplicate'}))}});
  });
  await page.goto('/');
  await page.evaluate(async()=> (await import('/src/operationSync.js')).startOperationSync());
  await expect.poll(async()=> (await syncState(page)).session?.userId).toBe('alice');
  await record(page);
  await expect.poll(()=>attempts.length).toBe(2);
  expect(attempts[0][0].eventId).toBe(attempts[1][0].eventId);
  await expect.poll(async()=> (await syncState(page)).pending).toBe(0);
  await page.evaluate(()=>{
    const add=IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add=function(...args){
      if(this.transaction.db.name==='file-masking-assistant-v2-operation-outbox') throw new DOMException('quota','QuotaExceededError');
      return add.apply(this,args);
    };
  });
  expect(await record(page,'配额测试.txt')).toBe(false);
  await expect.poll(async()=> (await syncState(page)).error).toContain('不完整');
  expect(attempts.length).toBe(2);
});

test('队列10MiB边界拒绝新增且保留既有待同步记录',async({page})=>{
  await page.route('**/api/v1/session',route=>route.fulfill({json:{userId:'alice',userName:'Alice',csrf:'csrf'}}));
  await page.route('**/api/v1/operation-events/batch',route=>route.fulfill({status:503,json:{}}));
  await page.goto('/');
  await page.evaluate(async()=> (await import('/src/operationSync.js')).startOperationSync());
  await expect.poll(async()=> (await syncState(page)).session?.userId).toBe('alice');
  await record(page,'既有记录.txt');
  await expect.poll(async()=> (await syncState(page)).pending).toBe(1);
  await page.evaluate(async()=>{
    const db=await new Promise(resolve=>{const r=indexedDB.open('file-masking-assistant-v2-operation-outbox');r.onsuccess=()=>resolve(r.result);});
    await new Promise(resolve=>{const tx=db.transaction('meta','readwrite');tx.objectStore('meta').put(10*1024*1024,'bytes');tx.oncomplete=resolve;});db.close();
  });
  expect(await record(page,'超出字节.txt')).toBe(false);
  await expect.poll(async()=> (await syncState(page)).error).toContain('不完整');
  expect((await syncState(page)).pending).toBe(1);
});
