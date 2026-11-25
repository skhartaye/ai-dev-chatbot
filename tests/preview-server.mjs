import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
const root=resolve('public');
const config=await readFile('netlify.toml','utf8');
const csp=config.match(/Content-Security-Policy = "([^"]+)"/)[1];
const types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.wasm':'application/wasm','.gz':'application/gzip','.png':'image/png'};
createServer(async(req,res)=>{
  try {
    const pathname=new URL(req.url,'http://localhost').pathname;
    const path=resolve(root,'.'+decodeURIComponent(pathname==='/'?'/welcome.html':['/chat','/chat/'].includes(pathname)?'/index.html':pathname));
    if(!path.startsWith(root+sep)) throw new Error('Outside public');
    const bytes=await readFile(path);
    res.writeHead(200,{'Content-Type':types[extname(path)]||'application/octet-stream','Content-Security-Policy':csp,'Cache-Control':'no-store'});res.end(bytes);
  }catch{res.writeHead(404);res.end('Not found');}
}).listen(4173,'127.0.0.1',()=>console.log('Preview at http://127.0.0.1:4173'));
