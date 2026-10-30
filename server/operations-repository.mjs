import pg from 'pg';
import { OPERATION_LABELS, OPERATION_RESULTS } from '../src/operationLog.js';

const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const fields = ['eventId','operationId','version','time','action','result','taskId','marker','format','inputName','outputName'];
const formats = ['xlsx','csv','txt','md','docx','pptx','html'];
export function validateEvent(event, now = Date.now()) {
  if (!event || typeof event !== 'object' || Array.isArray(event) || Object.keys(event).some(k => !fields.includes(k))) throw new Error('INVALID_EVENT');
  if (!uuid.test(event.eventId) || !uuid.test(event.operationId) || event.version !== 1 || !Object.hasOwn(OPERATION_LABELS,event.action) || !Object.hasOwn(OPERATION_RESULTS,event.result)) throw new Error('INVALID_EVENT');
  const time = Date.parse(event.time);
  if (typeof event.time !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(event.time) || !Number.isFinite(time) || time < now - 180*86400000 || time > now + 300000) throw new Error('EVENT_TIME_OUT_OF_RANGE');
  if (event.taskId !== undefined && (typeof event.taskId !== 'string' || !(/^[a-f0-9]{8}$/i.test(event.taskId) || uuid.test(event.taskId)))) throw new Error('INVALID_TASK');
  if (event.marker !== undefined && (typeof event.marker !== 'string'||!/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/.test(event.marker))) throw new Error('INVALID_MARKER');
  if (event.format !== undefined && !formats.includes(event.format)) throw new Error('INVALID_FORMAT');
  const result = {};
  for (const key of fields) if (event[key] !== undefined) result[key] = event[key];
  result.time = new Date(time).toISOString();
  for (const key of ['inputName','outputName']) if (event[key] !== undefined) {
    if (event.action.includes('credential') || typeof event[key] !== 'string' || event[key].length > 512) throw new Error('INVALID_FILENAME');
    result[key] = event[key].split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f]/g,'');
  }
  return result;
}

export function buildFilter(session, filters = {}) {
  if(!filters||typeof filters!=='object'||Array.isArray(filters)||Object.keys(filters).some(k=>!['from','to','user','format','result','action','query','page'].includes(k)))throw new Error('INVALID_FILTER');
  const values = []; const clauses = ["occurred_at >= now() - interval '180 days'"];
  const add = (sql,value) => { values.push(value); clauses.push(sql.replace('?',`$${values.length}`)); };
  if (!session.isAdmin) {
    if (filters.user && filters.user !== session.userId) throw Object.assign(new Error('FORBIDDEN'),{status:403});
    add('owner_user_id = ?',session.userId);
  } else if (filters.user) { if (typeof filters.user !== 'string' || filters.user.length > 128) throw new Error('INVALID_FILTER'); add('owner_user_id = ?',filters.user); }
  for (const key of ['from','to']) if (filters[key]) {
    const date=new Date(`${filters[key]}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(filters[key]) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0,10) !== filters[key]) throw new Error('INVALID_DATE');
    add(key === 'from' ? "occurred_at >= (?::date::timestamp AT TIME ZONE 'Asia/Shanghai')" : "occurred_at < ((?::date + 1)::timestamp AT TIME ZONE 'Asia/Shanghai')",filters[key]);
  }
  if (filters.from && filters.to && filters.from > filters.to) throw new Error('INVALID_DATE_RANGE');
  for (const [key, allowed] of [['action',Object.keys(OPERATION_LABELS)],['result',Object.keys(OPERATION_RESULTS)],['format',formats]]) if (filters[key]) {
    if (!allowed.includes(filters[key])) throw new Error('INVALID_FILTER');
    add(`${key} = ?`,filters[key]);
  }
  if (filters.query) {
    if (typeof filters.query !== 'string' || filters.query.length > 512) throw new Error('INVALID_QUERY');
    add("strpos(lower(concat_ws(' ',input_name,output_name,task_id,marker)),lower(?)) > 0",filters.query.trim());
  }
  const page = filters.page === undefined ? 1 : Number(filters.page);
  if (!Number.isSafeInteger(page) || page < 1 || page > 10000000) throw new Error('INVALID_PAGE');
  return { sql:clauses.join(' AND '),values,page };
}
const columns = `event_id AS "eventId", event_id AS id, operation_id AS "operationId", owner_user_id AS "userId", user_name AS "userName", occurred_at AS time, received_at AS "receivedAt", action,result,task_id AS "taskId",marker,format,input_name AS "inputName",output_name AS "outputName",version`;
const business = "action IN ('import_protect','import_restore','inspect_protect','inspect_restore','download_protect','download_restore','protect','restore')";
const aggregates = `count(DISTINCT owner_user_id) FILTER (WHERE ${business})::int AS users,
 count(DISTINCT (owner_user_id,task_id)) FILTER (WHERE action='protect' AND result='success' AND task_id IS NOT NULL)::int AS protected,
 count(DISTINCT (owner_user_id,task_id)) FILTER (WHERE action='restore' AND result IN ('success','partial','missing') AND task_id IS NOT NULL)::int AS restored,
 count(*) FILTER (WHERE result='failed')::int AS failed,
 count(*) FILTER (WHERE action IN ('import_protect','import_restore'))::int AS imports,
 count(*) FILTER (WHERE action IN ('download_protect','download_restore') AND result='requested')::int AS downloads`;

export class PgOperationsRepository {
  constructor({connectionString}) { this.pool = new pg.Pool({connectionString,max:5,connectionTimeoutMillis:5000,statement_timeout:30000}); }
  async initialize(schema) {
    const c=await this.pool.connect();
    try { await c.query('BEGIN'); await c.query("SELECT pg_advisory_xact_lock(64382199)"); await c.query(schema); const {rows}=await c.query('SELECT max(version) AS version FROM operation_schema_versions');if(rows[0].version!==1)throw new Error('Unsupported operations schema version');await c.query('COMMIT'); }
    catch(e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
  }
  async append(session,event) {
    const e=validateEvent(event);
    const {rowCount}=await this.pool.query(`INSERT INTO operation_events(owner_user_id,user_name,event_id,operation_id,version,occurred_at,action,result,task_id,marker,format,input_name,output_name,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT DO NOTHING`,[session.userId,session.userName,e.eventId,e.operationId,e.version,e.time,e.action,e.result,e.taskId,e.marker,e.format,e.inputName,e.outputName,JSON.stringify(e)]);
    if(rowCount) return 'accepted';
    const {rows}=await this.pool.query('SELECT payload=$3::jsonb AS matches FROM operation_events WHERE owner_user_id=$1 AND event_id=$2',[session.userId,e.eventId,JSON.stringify(e)]);
    if(!rows[0]?.matches) throw new Error('EVENT_CONFLICT');
    return 'duplicate';
  }
  async list(session,filters={}) {
    const f=buildFilter(session,filters);
    const {rows:[{total}]}=await this.pool.query(`SELECT count(*)::int AS total FROM operation_events WHERE ${f.sql}`,f.values);
    const {rows}=await this.pool.query(`SELECT ${columns} FROM operation_events WHERE ${f.sql} ORDER BY occurred_at DESC,event_id DESC LIMIT 10 OFFSET $${f.values.length+1}`,[...f.values,(f.page-1)*10]);
    return {records:rows,total,page:f.page,pageSize:10};
  }
  async statistics(session,filters={}) {
    const f=buildFilter(session,filters);
    const {rows:[totals]}=await this.pool.query(`SELECT ${aggregates} FROM operation_events WHERE ${f.sql}`,f.values);
    const {rows:users}=await this.pool.query(`SELECT owner_user_id AS "userId",max(user_name) AS "userName",${aggregates} FROM operation_events WHERE ${f.sql} GROUP BY owner_user_id ORDER BY owner_user_id`,f.values);
    return {totals,users};
  }
  async *exportRows(session,filters={},excludeEventId) {
    const f=buildFilter(session,filters);
    if(excludeEventId) { f.values.push(excludeEventId); f.sql+=` AND event_id <> $${f.values.length}::uuid`; }
    const c=await this.pool.connect();let transaction=false;
    try {
      await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      transaction=true;
      await c.query(`DECLARE export_cursor NO SCROLL CURSOR FOR SELECT ${columns} FROM operation_events WHERE ${f.sql} ORDER BY occurred_at DESC,event_id DESC`,f.values);
      while(true) { const {rows}=await c.query('FETCH 1000 FROM export_cursor'); if(!rows.length) break; yield rows; }
      await c.query('COMMIT');
      transaction=false;
    } finally { try{if(transaction)await c.query('ROLLBACK');}finally{c.release();} }
  }
  async cleanupExpired() { return (await this.pool.query("DELETE FROM operation_events WHERE occurred_at < now() - interval '180 days'")).rowCount; }
  async ready() { await this.pool.query('SELECT 1'); }
  async close() { await this.pool.end(); }
}
