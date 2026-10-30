import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { OPERATION_LABELS, OPERATION_RESULTS } from '../src/operationLog.js';
import { buildFilter } from './operations-repository.mjs';

const json=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...headers}});
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
export const TEST_USERS = {admin:{userId:'test-admin',userName:'测试管理员',isAdmin:true},alice:{userId:'test-alice',userName:'测试员工甲',isAdmin:false},bob:{userId:'test-bob',userName:'测试员工乙',isAdmin:false}};
async function readJson(request) {
  if (!(request.headers.get('content-type') || '').startsWith('application/json')) throw Object.assign(new Error('JSON_REQUIRED'),{status:415});
  const reader=request.body?.getReader(); let size=0; const parts=[];
  if(!reader) throw new Error('INVALID_JSON');
  while(true) { const {done,value}=await reader.read(); if(done) break; size+=value.byteLength; if(size>256*1024) { await reader.cancel(); throw Object.assign(new Error('REQUEST_TOO_LARGE'),{status:413}); } parts.push(value); }
  try { return JSON.parse(Buffer.concat(parts).toString('utf8')); } catch { throw new Error('INVALID_JSON'); }
}
const csvCell=value=>{let s=String(value??'');if(/^[\s\uFEFF]*[=+@-]/u.test(s)||/^[\t\r\n]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
const csvLine=row=>row.map(csvCell).join(',')+'\r\n';
export function createOperationsHandler({repository,origin,sessionSecret,testMode=false,testSecret}) {
  if(!origin||typeof sessionSecret!=='string'||Buffer.byteLength(sessionSecret)<32) throw new Error('Operations origin and 32-byte session secret required');
  if(testMode&&(!testSecret||Buffer.byteLength(testSecret)<32||process.env.NODE_ENV!=='test')) throw new Error('Test identity requires NODE_ENV=test and 32-byte secret');
  if(testMode&&!['127.0.0.1','localhost','[::1]'].includes(new URL(origin).hostname))throw new Error('Test identity requires a loopback origin');
  const secure=new URL(origin).protocol==='https:';
  const sign=s=>createHmac('sha256',sessionSecret).update(s).digest('base64url');
  const authenticate=request=>{
    const cookie=String(request.headers.get('cookie')||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('ops_session='))?.slice(12);
    if(!cookie)return null;
    const [value,sig,...rest]=cookie.split('.'); if(rest.length||!equal(sign(value),sig))return null;
    try { const s=JSON.parse(Buffer.from(value,'base64url').toString()); return s.exp>Date.now()&&TEST_USERS[s.subject]&&testMode?{...TEST_USERS[s.subject],csrf:s.csrf,operations:true}:null; } catch{return null;}
  };
  const rates=new Map();
  const limit=key=>{const now=Date.now();let r=rates.get(key);if(!r||r.until<now)r={n:0,until:now+60000};r.n++;rates.set(key,r);if(rates.size>10000)for(const[k,v]of rates)if(v.until<now)rates.delete(k);if(r.n>120)throw Object.assign(new Error('RATE_LIMITED'),{status:429});};
  return async request=>{
    const url=new URL(request.url),path=url.pathname;
    try {
      if(path==='/healthz')return json({status:'ok'});
      if(path==='/readyz'){try{await repository.ready();return json({status:'ready'});}catch{return json({code:'DATABASE_UNAVAILABLE'},503);}}
      if(request.headers.get('origin')&&request.headers.get('origin')!==origin)return json({code:'ORIGIN_DENIED'},403);
      if(request.headers.get('sec-fetch-site')==='cross-site')return json({code:'ORIGIN_DENIED'},403);
      if(path==='/__test/session') {
        if(!testMode)return json({code:'NOT_FOUND'},404);
        if(request.method!=='POST'||request.headers.get('origin')!==origin||!equal(request.headers.get('x-test-secret'),testSecret))return json({code:'FORBIDDEN'},403);
        limit('test-login'); const body=await readJson(request);
        if(!body||Object.keys(body).some(k=>k!=='user')||typeof body.user!=='string'||!Object.hasOwn(TEST_USERS,body.user))return json({code:'INVALID_USER'},400);
        const csrf=randomBytes(24).toString('base64url');const value=Buffer.from(JSON.stringify({subject:body.user,csrf,exp:Date.now()+3600000})).toString('base64url');
        return json({...TEST_USERS[body.user],csrf,operations:true},200,{'set-cookie':`ops_session=${value}.${sign(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=3600${secure?'; Secure':''}`});
      }
      if(!path.startsWith('/api/'))return null;
      // No Vault route is registered in the operation-only service.
      if(!['/api/v1/session','/api/v1/operation-events/batch','/api/v1/operation-events','/api/v1/operation-statistics','/api/v1/operation-events/export'].includes(path))return json({code:'NOT_FOUND'},404);
      const session=authenticate(request); if(!session)return json({code:'AUTH_REQUIRED',message:'身份已过期，记录仍保留在本机待同步。'},401);
      limit(session.userId);
      if(request.method!=='GET'&&(request.headers.get('origin')!==origin||!equal(request.headers.get('x-csrf-token'),session.csrf)))return json({code:'CSRF_DENIED'},403);
      if(path==='/api/v1/session'&&request.method==='GET')return json(session);
      if(path==='/api/v1/operation-events/batch'&&request.method==='POST'){
        const body=await readJson(request);if(!body||Object.keys(body).some(k=>k!=='events')||!Array.isArray(body.events)||!body.events.length||body.events.length>100)throw new Error('INVALID_BATCH');
        const results=[];
        for(const event of body.events){try{results.push({eventId:event?.eventId,status:await repository.append(session,event)});}catch(e){if(!/^(INVALID_|EVENT_)/.test(e.message))throw e;results.push({eventId:typeof event?.eventId==='string'?event.eventId.slice(0,64):null,status:'rejected',code:e.message});}}
        return json({results});
      }
      const filters=Object.fromEntries(url.searchParams);
      if(path==='/api/v1/operation-events'&&request.method==='GET')return json(await repository.list(session,filters));
      if(path==='/api/v1/operation-statistics'&&request.method==='GET')return json(await repository.statistics(session,filters));
      if(path==='/api/v1/operation-events/export'&&request.method==='POST'){
        const f=await readJson(request);buildFilter(session,f);
        const scope=JSON.stringify({from:f.from||'最近180天',to:f.to||'当前',user:session.isAdmin?(f.user||'全部用户'):session.userId,format:f.format||'全部',result:f.result||'全部',action:f.action||'全部',query:f.query||''});
        const exportEventId=randomUUID();
        await repository.append(session,{eventId:exportEventId,operationId:randomUUID(),version:1,time:new Date().toISOString(),action:'export_records',result:'requested'});
        const iterator=repository.exportRows(session,f,exportEventId)[Symbol.asyncIterator]();
        // Start the query before sending headers so database failures are visible as an error.
        let first=await iterator.next();
        const encoder=new TextEncoder();let header=true;
        const stream=new ReadableStream({async pull(controller){try{
          if(header){controller.enqueue(encoder.encode('\uFEFF'+csvLine(['数据来源','筛选范围','用户','时间','任务','任务标记','输入文件名','输出文件名','格式','操作','结果'])));header=false;return;}
          const item=first||await iterator.next();first=null;
          if(item.done){controller.close();return;}
          controller.enqueue(encoder.encode(item.value.map(r=>csvLine(['集中操作记录',scope,r.userName,new Date(r.time).toISOString(),r.taskId,r.marker,r.inputName||'未记录',r.outputName||'未记录',r.format?.toUpperCase(),OPERATION_LABELS[r.action],OPERATION_RESULTS[r.result]])).join('')));
        }catch(e){controller.error(e);await iterator.return?.();}},async cancel(){await iterator.return?.();}});
        return new Response(stream,{headers:{'content-type':'text/csv; charset=utf-8','cache-control':'no-store','content-disposition':"attachment; filename*=UTF-8''%E9%9B%86%E4%B8%AD%E6%93%8D%E4%BD%9C%E8%AE%B0%E5%BD%95.csv"}});
      }
      return json({code:'METHOD_NOT_ALLOWED'},405);
    }catch(e){const status=e.status||(/^(INVALID_|EVENT_)/.test(e.message)?400:503);return json({code:status===503?'RECORDS_UNAVAILABLE':e.message,message:status===503?'记录服务暂不可用，请稍后重试。':'请求未通过检查。'},status);}
  };
}
