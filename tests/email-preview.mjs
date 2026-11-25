import {createServer} from 'node:http';
import {emails,renderEmail} from '../supabase/templates/build.mjs';
createServer((req,res)=>{
  const name=new URL(req.url,'http://localhost').searchParams.get('template')||'magic-link';
  if(!emails[name]){res.writeHead(404);res.end();return;}
  res.writeHead(200,{'Content-Type':'text/html;charset=utf-8','Cache-Control':'no-store'});res.end(renderEmail(emails[name],{preview:true}));
}).listen(4175,'127.0.0.1',()=>console.log('Email preview at http://127.0.0.1:4175'));
