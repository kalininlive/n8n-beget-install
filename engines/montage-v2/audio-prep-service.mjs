#!/usr/bin/env node
import http from 'node:http';
import { processDirectory } from './audio-prep.mjs';

const PORT = Number(process.env.AUDIO_PREP_PORT || 3387);
const LIMIT = 5 * 1024 * 1024;

const server = http.createServer(async (req, res) => {
  const send = (code, value) => { res.writeHead(code, {'content-type':'application/json; charset=utf-8'}); res.end(JSON.stringify(value)); };
  if (req.method !== 'POST' || req.url !== '/audio-prep') return send(404,{ok:false,error:'not found'});
  const auth=String(req.headers.authorization || '');
  const match=auth.match(/^Bearer\s+(.+)$/i);
  if (!match) return send(401,{ok:false,error:'Auphonic API credential is required'});
  let body='';
  req.setEncoding('utf8');
  req.on('data',chunk=>{ body+=chunk; if(body.length>LIMIT){ req.destroy(); } });
  req.on('end',async()=>{
    if(body.length>LIMIT) return;
    try {
      const input=JSON.parse(body);
      const result=await processDirectory(input,match[1]);
      send(200,result);
    } catch(e) {
      send(500,{ok:false,error:String(e?.message || e).slice(0,600)});
    }
  });
});

server.listen(PORT,'0.0.0.0',()=>process.stdout.write(`audio-prep listening on ${PORT}\n`));
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
process.on('SIGINT',()=>server.close(()=>process.exit(0)));
