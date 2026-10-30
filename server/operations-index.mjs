import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { readFile } from 'node:fs/promises';
import { PgOperationsRepository } from './operations-repository.mjs';
import { createOperationsHandler } from './operations-app.mjs';
import { SECURITY_HEADERS } from '../worker/index.js';

if(!process.env.OPERATIONS_DATABASE_URL)throw new Error('OPERATIONS_DATABASE_URL is required');
const repository=new PgOperationsRepository({connectionString:process.env.OPERATIONS_DATABASE_URL});
await repository.initialize(await readFile(new URL('./operations-schema.sql',import.meta.url),'utf8'));
const secret=process.env.OPERATIONS_SESSION_SECRET_FILE? (await readFile(process.env.OPERATIONS_SESSION_SECRET_FILE,'utf8')).trim():process.env.OPERATIONS_SESSION_SECRET;
const origin=process.env.OPERATIONS_PUBLIC_ORIGIN||'http://127.0.0.1:4175';
const handler=createOperationsHandler({repository,origin,sessionSecret:secret,testMode:process.env.OPERATIONS_TEST_MODE==='1',testSecret:process.env.OPERATIONS_TEST_SECRET});
const server=createServer(async(req,res)=>{
  try{
    if(Number(req.headers['content-length']||0)>256*1024){res.writeHead(413);res.end();return;}
    const body=['GET','HEAD'].includes(req.method)?undefined:Readable.toWeb(req);
    const request=new Request(new URL(req.url,origin),{method:req.method,headers:req.headers,body,...(body?{duplex:'half'}:{})});
    const response=await handler(request)||new Response('Not found',{status:404});
    res.writeHead(response.status,{...SECURITY_HEADERS,...Object.fromEntries(response.headers)});
    if(response.body){const stream=Readable.fromWeb(response.body);stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res);}else res.end();
  }catch{if(!res.headersSent)res.writeHead(503,{'content-type':'application/json',...SECURITY_HEADERS});res.end('{"code":"RECORDS_UNAVAILABLE"}');}
});
server.requestTimeout=15000;server.headersTimeout=10000;
const port=Number(process.env.OPERATIONS_PORT||5180);
const host=process.env.OPERATIONS_HOST||'127.0.0.1';
server.listen(port,host,()=>console.log(`Operation records listening on ${host}:${port}`));
const cleanup=setInterval(()=>repository.cleanupExpired().catch(()=>console.error('Operation retention cleanup failed')),3600000);cleanup.unref();
await repository.cleanupExpired();
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{clearInterval(cleanup);server.close(async()=>{await repository.close();process.exit(0);});});
