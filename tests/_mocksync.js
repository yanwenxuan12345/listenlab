/* 本地模拟云端：同时模拟 Supabase(PostgREST) 和通用 REST 两种接口，用来端到端验证同步代码 */
const http=require('http');
const ROOT=require('path').join(__dirname,'..');

const db=new Map();          // supabase 风格：space -> {payload, updated_at}
const kv=new Map();          // rest 风格：space -> blob

function cors(res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,POST,PUT,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','apikey,authorization,content-type,prefer,accept');
  res.setHeader('Access-Control-Max-Age','600');
}
function body(req){
  return new Promise(r=>{let b='';req.on('data',c=>b+=c);req.on('end',()=>r(b));});
}

// 通用 REST：GET/PUT /kv/:space
const restSrv=http.createServer(async(req,res)=>{
  cors(res);
  if(req.method==='OPTIONS'){res.writeHead(204);return res.end();}
  const m=req.url.match(/^\/kv\/([^/?]+)/);
  if(!m){res.writeHead(404);return res.end('nope');}
  const space=decodeURIComponent(m[1]);
  if(req.method==='GET'){
    if(!kv.has(space)){res.writeHead(404);return res.end('not found');}
    res.writeHead(200,{'Content-Type':'text/plain;charset=utf-8'});
    return res.end(kv.get(space));
  }
  if(req.method==='PUT'){
    kv.set(space,await body(req));
    res.writeHead(200);return res.end('ok');
  }
  res.writeHead(405);res.end();
});

// Supabase / PostgREST：GET ?space=eq.X&select=...  POST upsert
const sbSrv=http.createServer(async(req,res)=>{
  cors(res);
  if(req.method==='OPTIONS'){res.writeHead(204);return res.end();}
  if(!req.url.startsWith('/rest/v1/ll_kv')){res.writeHead(404);return res.end('no table');}
  if(req.method==='GET'){
    const q=new URL('http://x'+req.url).searchParams.get('space')||'';
    const space=q.replace(/^eq\./,'');
    const row=db.get(space);
    res.writeHead(200,{'Content-Type':'application/json'});
    return res.end(JSON.stringify(row?[{payload:row.payload,updated_at:row.updated_at}]:[]));
  }
  if(req.method==='POST'){
    const pref=String(req.headers.prefer||'');
    const arr=JSON.parse(await body(req));
    arr.forEach(o=>db.set(o.space,{payload:o.payload,updated_at:o.updated_at}));
    res.writeHead(pref.includes('return=minimal')?201:200,{'Content-Type':'application/json'});
    return res.end('[]');
  }
  res.writeHead(405);res.end();
});

const webSrv=http.createServer(async(req,res)=>{
  const fs=require('fs'),path=require('path');
  let p=decodeURIComponent(req.url.split('?')[0]);
  if(p==='/'||p==='/index.html')p='/index.html';
  const f=path.join(ROOT,p);
  if(!fs.existsSync(f)){res.writeHead(404);return res.end('404');}
  res.writeHead(200,{'Content-Type':p.endsWith('.html')?'text/html;charset=utf-8':'application/octet-stream'});
  res.end(fs.readFileSync(f));
});

restSrv.listen(8091,()=>console.log('rest  mock  http://127.0.0.1:8091/kv/<space>'));
sbSrv.listen(8092,()=>console.log('supabase mock  http://127.0.0.1:8092/rest/v1/ll_kv'));
webSrv.listen(8090,()=>console.log('page   http://127.0.0.1:8090/index.html'));
