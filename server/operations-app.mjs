import { randomUUID, timingSafeEqual } from 'node:crypto';
import { buildFilter, exportRange } from './operations-repository.mjs';
import { recordsWorkbook } from './operations-export.mjs';

const json=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...headers}});
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
async function readJson(request) {
  if (!(request.headers.get('content-type') || '').startsWith('application/json')) throw Object.assign(new Error('JSON_REQUIRED'),{status:415});
  const reader=request.body?.getReader(); let size=0; const parts=[];
  if(!reader) throw new Error('INVALID_JSON');
  while(true) { const {done,value}=await reader.read(); if(done) break; size+=value.byteLength; if(size>256*1024) { await reader.cancel(); throw Object.assign(new Error('REQUEST_TOO_LARGE'),{status:413}); } parts.push(value); }
  try { return JSON.parse(Buffer.concat(parts).toString('utf8')); } catch { throw new Error('INVALID_JSON'); }
}
// requestsPerMinute caps each signed-in user; the dev server raises it because parallel browser tests share accounts.
export function createOperationsHandler({repository,origin,auth,requestsPerMinute=120}) {
  if(!origin||!auth)throw new Error('Operations origin and auth required');
  const rates=new Map();
  // An admin reading other people's records leaves one event per 10 minutes, so filter changes do not flood the log.
  const viewed=new Map();
  const recordAdminView=async(session,filters)=>{
    if(!session.isAdmin||filters.user===session.userId||viewed.get(session.userId)>Date.now())return;
    viewed.set(session.userId,Date.now()+10*60000);
    try{await repository.append(session,{eventId:randomUUID(),operationId:randomUUID(),version:1,time:new Date().toISOString(),action:'view_all_records',result:'success'});}
    catch(e){viewed.delete(session.userId);throw e;}
  };
  // An admin may narrow records to a department (and the departments under it); it becomes a list of people.
  const resolveScope=async(session,filters)=>{
    if(filters.department===undefined||filters.department===''){const {department,...rest}=filters;return rest;}
    if(!session.isAdmin)throw Object.assign(new Error('FORBIDDEN'),{status:403});
    if(typeof filters.department!=='string'||!/^\d{1,18}$/.test(filters.department)||!auth.departmentUserIds)throw new Error('INVALID_FILTER');
    const {department,...rest}=filters;
    return {...rest,userIds:await auth.departmentUserIds(department)};
  };
  const limit=key=>{const now=Date.now();let r=rates.get(key);if(!r||r.until<now)r={n:0,until:now+60000};r.n++;rates.set(key,r);if(rates.size>10000)for(const[k,v]of rates)if(v.until<now)rates.delete(k);if(r.n>requestsPerMinute)throw Object.assign(new Error('RATE_LIMITED'),{status:429});};
  return async request=>{
    const url=new URL(request.url),path=url.pathname;
    try {
      if(path==='/healthz')return json({status:'ok'});
      if(path==='/readyz'){try{await repository.ready();return json({status:'ready'});}catch{return json({code:'DATABASE_UNAVAILABLE'},503);}}
      if(!path.startsWith('/api/'))return null;
      if(request.headers.get('origin')&&request.headers.get('origin')!==origin)return json({code:'ORIGIN_DENIED'},403);
      if(request.headers.get('sec-fetch-site')==='cross-site')return json({code:'ORIGIN_DENIED'},403);
      if(!['/api/v1/operation-events/batch','/api/v1/operation-events','/api/v1/operation-tasks','/api/v1/operation-statistics','/api/v1/operation-report','/api/v1/operation-events/export'].includes(path))return null;
      const session=auth.authenticate(request); if(!session)return json({code:'AUTH_REQUIRED',message:'身份已过期，请重新进入应用。'},401);
      limit(session.userId);
      if(request.method!=='GET'&&(request.headers.get('origin')!==origin||!equal(request.headers.get('x-csrf-token'),session.csrf)))return json({code:'CSRF_DENIED'},403);
      if(path==='/api/v1/operation-events/batch'&&request.method==='POST'){
        const body=await readJson(request);if(!body||Object.keys(body).some(k=>k!=='events')||!Array.isArray(body.events)||!body.events.length||body.events.length>100)throw new Error('INVALID_BATCH');
        const results=[];
        for(const event of body.events){try{results.push({eventId:event?.eventId,status:await repository.append(session,event)});}catch(e){if(!/^(INVALID_|EVENT_)/.test(e.message))throw e;results.push({eventId:typeof event?.eventId==='string'?event.eventId.slice(0,64):null,status:'rejected',code:e.message});}}
        return json({results});
      }
      const filters=await resolveScope(session,Object.fromEntries(url.searchParams));
      const read={'/api/v1/operation-events':'list','/api/v1/operation-tasks':'listTasks','/api/v1/operation-statistics':'statistics','/api/v1/operation-report':'report'}[path];
      if(read&&request.method==='GET'){const result=await repository[read](session,filters);await recordAdminView(session,filters);return json(result);}
      if(path==='/api/v1/operation-events/export'&&request.method==='POST'){
        const f=await resolveScope(session,await readJson(request)??{});buildFilter(session,f);
        const {total}=await repository.list(session,{...f,page:undefined});
        // The analysis sheet covers the same records as the detail sheet; without dates that is the 180-day retention window.
        const analysis=await repository.report(session,{...f,...exportRange(f),page:undefined},{limit:50});
        const exportEventId=randomUUID();
        await repository.append(session,{eventId:exportEventId,operationId:randomUUID(),version:1,time:new Date().toISOString(),action:'export_records',result:'requested'});
        const iterator=repository.exportRows(session,f,exportEventId)[Symbol.asyncIterator]();
        // Start the query before sending headers so database failures are visible as an error.
        const first=await iterator.next();
        const batches={async *[Symbol.asyncIterator](){try{if(first.done)return;yield first.value;for(let item=await iterator.next();!item.done;item=await iterator.next())yield item.value;}finally{await iterator.return?.();}}};
        return new Response(await recordsWorkbook({session,filters:f,total,analysis,batches}),{headers:{'content-type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','cache-control':'no-store','content-disposition':"attachment; filename*=UTF-8''"+encodeURIComponent('使用统计明细.xlsx')}});
      }
      return json({code:'METHOD_NOT_ALLOWED'},405);
    }catch(e){const status=e.status||(/^(INVALID_|EVENT_)/.test(e.message)?400:503);return json({code:status===503?'RECORDS_UNAVAILABLE':e.message,message:status===503?'记录服务暂不可用，请稍后重试。':'请求未通过检查。'},status);}
  };
}
