/* 端到端测试：账号同步（server.js + 客户端整合）
   用法：node tests/_t3.js
   它自己会拉起 server.js（独立数据目录），跑完自动关掉 */
const fs=require('fs'),path=require('path'),crypto=require('crypto'),os=require('os');
const {spawn}=require('child_process');

const PORT=8129;
const BASE='http://127.0.0.1:'+PORT;
const TMP=fs.mkdtempSync(path.join(os.tmpdir(),'ll-t3-'));
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const src=html.match(/<script>([\s\S]*)<\/script>/)[1];

let pass=0,fail=0;
const ok=(c,l,x)=>{if(c){pass++;console.log('  ✅ '+l);}else{fail++;console.log('  ❌ '+l+(x!==undefined?'  →  '+JSON.stringify(x):''));}};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

/* ============ 轻量 DOM 桩（与 _t2 同源，裁剪版） ============ */
function mkClassList(init){
  const s=new Set(init||[]);
  return {add(...c){c.forEach(x=>s.add(x));},remove(...c){c.forEach(x=>s.delete(x));},
    toggle(c,f){if(f===undefined)f=!s.has(c);f?s.add(c):s.delete(c);return !!f;},contains(c){return s.has(c);}};
}
function mkEl(tag){
  const el={tagName:String(tag||'div').toUpperCase(),style:{},dataset:{},kids:[],value:'',
    textContent:'',innerHTML:'',checked:false,disabled:false,type:'',title:'',placeholder:'',
    onclick:null,onchange:null,oninput:null,parentElement:null,_cn:'',classList:mkClassList(),
    appendChild(c){if(c){c.parentElement=el;el.kids.push(c);}return c;},
    insertBefore(c){return el.appendChild(c);},
    removeChild(c){el.kids=el.kids.filter(x=>x!==c);return c;},
    addEventListener(t,f){el._h=el._h||{};el._h[t]=f;},removeEventListener(){},
    click(){if(el.onclick)el.onclick({target:el,shiftKey:false});},
    focus(){},blur(){},closest(){return null;},
    getAttribute(n){return el.dataset[n]!==undefined?el.dataset[n]:null;},
    setAttribute(n,v){el.dataset[n]=String(v);},
    querySelector(sel){const a=queryAll(el,sel);return a.length?a[0]:null;},
    querySelectorAll(sel){return queryAll(el,sel);}};
  Object.defineProperty(el,'className',{get(){return el._cn;},
    set(v){el._cn=String(v||'');el.classList=mkClassList(el._cn.split(/\s+/).filter(Boolean));}});
  Object.defineProperty(el,'options',{get(){return el.kids;}});
  return el;
}
function selTokens(sel){return String(sel).trim().split(/\s+/).filter(Boolean);}
function matchSimple(el,tok){
  let t=String(tok);
  const attr=t.match(/\[([\w-]+)(?:=["']?([^"'\]]*)["']?)?\]/);
  if(attr){const k=attr[1].replace(/^data-/,'');const v=attr[2];
    const hasOn=(v===undefined)?(typeof el.dataset[k]!=='undefined'):(el.dataset[k]===v);
    if(!hasOn)return false;t=t.replace(attr[0],'');}
  if(!t)return true;
  if(t.startsWith('.'))return el.classList.contains(t.slice(1));
  if(t.startsWith('#'))return false;
  return el.tagName===t.toUpperCase();
}
function walkAll(el,out){(el.kids||[]).forEach(k=>{out.push(k);walkAll(k,out);});return out;}
function parseInto(c){
  const h=typeof c.innerHTML==='string'?c.innerHTML:'';
  if(!h||c._parsed===h)return;c._parsed=h;
  const re=/<(\w+)([^>]*?)\/?>/g;let m;
  while((m=re.exec(h))){
    const tag=m[1],attrs=m[2],el=mkEl(tag);
    const ar=/([\w-]+)="([^"]*)"/g;let a;
    while((a=ar.exec(attrs))){if(a[1]==='class')el.className=a[2];else el.dataset[a[1].replace(/^data-/,'')]=a[2];}
    el.classList=mkClassList(String(el.className||'').split(/\s+/).filter(Boolean));
    c.kids.push(el);
  }
}
function queryAll(root,sel){
  const toks=selTokens(sel);
  if(toks.length===1&&toks[0].startsWith('#'))return [byId(toks[0].slice(1))];
  parseInto(root);
  const last=toks[toks.length-1];
  const found=walkAll(root,[]).filter(e=>matchSimple(e,last));
  if(found.length)return found;
  const h=typeof root.innerHTML==='string'?root.innerHTML:'';
  const probe=last.startsWith('.')?last.slice(1):last;
  const n=(probe&&h)?(h.split(probe).length-1):0;
  return n>0?Array.from({length:n},()=>mkEl('div')):[];
}
const REG={};
function byId(id){
  if(!REG[id]){
    const el=mkEl('div');
    const m=new RegExp('id="'+id+'"').exec(html);
    if(m){
      const seg=html.slice(Math.max(0,m.index-280),m.index);
      const cm=[...seg.matchAll(/class="([^"]*)"/g)].pop();
      if(cm)el.classList=mkClassList(cm[1].split(/\s+/).filter(Boolean));
    }
    REG[id]=el;
  }
  return REG[id];
}
const NAV=['home','work','exam','errors','review','words','drill','syn','dash','setting'].map(v=>{
  const b=mkEl('button');b.className='nav-btn';b.dataset.view=v;return b;});
const doc={
  getElementById:byId,
  createElement:t=>mkEl(t),
  querySelectorAll(sel){const t=selTokens(sel);
    if(t.length===1&&/^\.nav-btn(\[|$)/.test(t[0]))return NAV.filter(b=>matchSimple(b,t[0]));
    return queryAll({kids:[],innerHTML:''},sel);},
  querySelector(sel){const a=doc.querySelectorAll(sel);return a.length?a[0]:null;},
  addEventListener(){},body:mkEl('body'),documentElement:mkEl('html'),title:'精听实验室'
};

/* ---------- 浏览器全局 ---------- */
global.document=doc;
global.window={crypto:crypto.webcrypto,location:{reload(){}},navigator:{},getComputedStyle:()=>({}),addEventListener(){}};
global.crypto=crypto.webcrypto;
global.navigator={clipboard:undefined};
global.location={protocol:'http:',origin:BASE,host:BASE.replace('http://',''),href:BASE+'/'};
global.btoa=s=>Buffer.from(s,'binary').toString('base64');
global.atob=s=>Buffer.from(s,'base64').toString('binary');
global.TextEncoder=require('util').TextEncoder;
global.TextDecoder=require('util').TextDecoder;
global.SpeechSynthesisUtterance=class{constructor(t){this.text=t;}};
global.speechSynthesis={getVoices:()=>[],cancel(){},speak(){}};
try{global.URL.createObjectURL=()=>'blob:x';}catch(e){Object.defineProperty(global.URL,'createObjectURL',{value:()=>'blob:x',configurable:true});}
try{global.URL.revokeObjectURL=()=>{};}catch(e){}
global.Blob=class{constructor(){}};
global.FileReader=class{};
global.confirm=()=>true;
global.alert=()=>{};

/* 每个「设备」一份独立 localStorage：用它模拟换电脑 */
function newStore(){return {};}
function useStore(st){
  global.localStorage={getItem:k=>(k in st?st[k]:null),setItem:(k,v)=>{st[k]=String(v);},
    removeItem:k=>{delete st[k];},key:i=>Object.keys(st)[i],get length(){return Object.keys(st).length;}};
  return st;
}
function buildApp(){
  const api={};
  return new Function('api','with(api){ return (function(){'+src+
    '\n;return {get S(){return S;},set S2(v){S=v;},get ACTIVE(){return ACTIVE;},'+
    'users,blank,save,saveLocal,acct,setAcct,acctEnter,acctPush,acctPull,acctAfterLogin,acctLogout,'+
    'acctBound,acctId,apiBase,scheduleAcctPush,renderAcct,refreshAll,renderSetting,createProfile,'+
    'loginProfile,gateShow,renderGate,blank,cloudPayload,pinId};})();}')(api);
}
/* 把 localStorage 里的东西全清掉 = 换了一台干净电脑 */
function wipe(st){Object.keys(st).forEach(k=>{delete st[k];});}

/* ============ 服务端 API 测试 ============ */
async function j(method,p,body,token){
  const h={'Content-Type':'application/json'};
  if(token)h.Authorization='Bearer '+token;
  const r=await fetch(BASE+p,{method,headers:h,body:body?JSON.stringify(body):undefined});
  let data=null;try{data=await r.json();}catch(e){}
  return {status:r.status,data:data};
}
function startServer(){
  return new Promise((resolve,reject)=>{
    const cp=spawn(process.execPath,['server.js'],{
      cwd:path.join(__dirname,'..'),
      env:Object.assign({},process.env,{PORT:String(PORT),LL_DATA:TMP}),
      stdio:['ignore','pipe','pipe']});
    let out='';
    cp.stdout.on('data',d=>{out+=d.toString();});
    cp.stderr.on('data',d=>{out+=d.toString();});
    cp.on('error',reject);
    const t0=Date.now();
    (function poll(){
      fetch(BASE+'/api/ping').then(r=>r.json()).then(j=>{
        if(j&&j.ok)resolve(cp);else throw new Error('bad');
      }).catch(()=>{
        if(Date.now()-t0>15000)return reject(new Error('服务没起来：'+out));
        setTimeout(poll,250);
      });
    })();
  });
}

(async function main(){
  console.log('\n【A】服务端接口（真实起 server.js）');
  let cp=null;
  try{
    cp=await startServer();
    ok(true,'服务启动成功 · 数据目录独立（'+TMP+'）');

    const ping=await j('GET','/api/ping');
    ok(ping.data&&ping.data.ok===true,'/api/ping 正常');

    const idx=await fetch(BASE+'/');
    const idxTxt=await idx.text();
    ok(idx.status===200&&idxTxt.includes('精听实验室'),'首页由 Node 服务托管（200，含站点标题）');

    const st=await fetch(BASE+'/data/store.json');
    ok(st.status===404,'数据文件不能从网页直接下载（404）');

    const reg=await j('POST','/api/register',{user:'Taisir',pass:'abc123456'});
    ok(reg.data&&reg.data.ok===true&&!!reg.data.token,'注册成功并返回令牌');
    const tk=reg.data.token;

    const dup=await j('POST','/api/register',{user:'taisir',pass:'abc123456'});
    ok(dup.status===409,'重复注册被拦住（且账号名大小写不敏感）');

    const bad=await j('POST','/api/login',{user:'taisir',pass:'nope123456'});
    ok(bad.status===401&&/密码/.test(bad.data.error),'密码错误给出人话提示');

    const shortU=await j('POST','/api/register',{user:'ab',pass:'abc123456'});
    ok(shortU.status===400,'账号名太短被拒绝');
    const shortP=await j('POST','/api/register',{user:'someoneelse',pass:'123'});
    ok(shortP.status===400,'密码太短被拒绝');

    const noTk=await j('GET','/api/data');
    ok(noTk.status===401,'没令牌读不到数据');
    const badTk=await j('GET','/api/data',null,'deadbeef');
    ok(badTk.status===401,'乱令牌读不到数据');

    const put=await j('PUT','/api/data',{data:{wrongWords:[{id:'w1'},{id:'w2'}],days:{}},updated:1790100000000},tk);
    ok(put.data&&put.data.ok===true,'上传数据成功');
    const got=await j('GET','/api/data',null,tk);
    ok(got.data&&got.data.data&&got.data.data.wrongWords.length===2,'读回的数据和上传一致');

    const login=await j('POST','/api/login',{user:'TAISIR',pass:'abc123456'});
    ok(login.data&&login.data.ok===true&&login.data.data&&login.data.data.wrongWords.length===2,
      '换设备登录立刻拿到同一份数据');

    /* 令牌三条路都要通（线上反向代理可能吞掉 Authorization 头） */
    const qTok=login.data.token;
    const viaQ=await fetch(BASE+'/api/data?token='+encodeURIComponent(qTok));
    const viaQj=await viaQ.json();
    ok(viaQ.status===200&&viaQj.ok===true,'令牌走查询串也能读数据');
    const viaX=await fetch(BASE+'/api/data',{headers:{'X-LL-Token':qTok}});
    const viaXj=await viaX.json();
    ok(viaX.status===200&&viaXj.ok===true,'令牌走 X-LL-Token 头也能读数据');
    const viaB=await j('PUT','/api/data',{token:qTok,data:{wrongWords:[{id:'w1'},{id:'w2'}]},updated:1790100000001});
    ok(viaB.status===200&&viaB.data.ok===true,'令牌走请求体也能写数据');

    /* 真实线上场景：网关用自己的 JWT 覆盖 Authorization 头 —— 此时查询串/请求体里的令牌必须仍然生效 */
    const FAKE='Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.gateway-fake';
    const gwRead=await fetch(BASE+'/api/data?token='+encodeURIComponent(qTok),{headers:{Authorization:FAKE}});
    const gwReadJ=await gwRead.json();
    ok(gwRead.status===200&&gwReadJ.ok===true,'Authorization 被网关换成别的令牌时，查询串里的令牌仍生效');
    const gwWrite=await fetch(BASE+'/api/data',{method:'PUT',
      headers:{'Content-Type':'application/json',Authorization:FAKE},
      body:JSON.stringify({token:qTok,data:{wrongWords:[{id:'w1'}]},updated:1790100000003})});
    const gwWriteJ=await gwWrite.json();
    ok(gwWrite.status===200&&gwWriteJ.ok===true,'Authorization 被占时，请求体里的令牌仍生效');
    const gwWho=await fetch(BASE+'/api/whoami?token='+encodeURIComponent(qTok),{headers:{Authorization:FAKE}});
    const gwWhoJ=await gwWho.json();
    ok(gwWhoJ.authed===true&&gwWhoJ.viaCandidate>=1,'自检能指出实际生效的是第几个令牌来源');
    const who=await j('GET','/api/whoami');
    ok(who.data&&who.data.ok===true&&!!who.data.seen,'/api/whoami 能报告服务端收到的令牌来源');
    const whoHdr=await fetch(BASE+'/api/whoami',{headers:{Authorization:'Bearer '+qTok}});
    const whoHdrJ=await whoHdr.json();
    ok(whoHdrJ.seen&&whoHdrJ.seen.header&&whoHdrJ.authed===true,'带 Authorization 头时自检显示已认证');

    const chg=await j('POST','/api/passwd',{pass:'abc123456',newPass:'newpass888'},tk);
    ok(chg.data&&chg.data.ok===true,'可以修改密码');
    const oldTk=await j('GET','/api/data',null,tk);
    ok(oldTk.status===401,'改密码后旧令牌失效（更安全）');
    const newLogin=await j('POST','/api/login',{user:'taisir',pass:'newpass888'});
    ok(newLogin.data&&newLogin.data.ok===true,'新密码能登录');

    const lo=await j('POST','/api/logout',null,newLogin.data.token);
    ok(lo.data&&lo.data.ok===true,'退出登录');
    const afterOut=await j('GET','/api/data',null,newLogin.data.token);
    ok(afterOut.status===401,'退出后令牌失效');
  }catch(e){
    ok(false,'服务端测试异常：'+e.message);
  }

  /* ============ 客户端整合：账号登录 + 自动上传 + 换电脑恢复 ============ */
  console.log('\n【B】客户端整合（DOM 桩跑整个应用，真实打服务）');
  try{
    const stA=newStore();              /* 电脑 A */
    useStore(stA);
    const A1=buildApp();

    ok(A1.apiBase()===BASE,'客户端能认出服务器地址');
    ok(A1.acct()===null,'初始未登录账号');
    ok(A1.renderAcct&&(A1.renderAcct(),true),'renderAcct 不报错');

    /* 建本机档案 + 写点数据 */
    A1.createProfile('123456','我的档案',null);
    A1.S.wrongWords.push({id:'x1',word:'similar',cause:'liaison',sent:'a b'});
    A1.S.wrongWords.push({id:'x2',word:'because your',phrase:true,parts:['because','your'],cause:'chunk'});
    A1.S.days['2026-09-23']={dict:3,correct:2,total:5,secs:120};
    A1.save();

    /* 但本机档案 id 不是账号档案 id → 应该拒绝串味上传 */
    const notBound=A1.acctBound();
    ok(notBound===false,'未登录账号时 acctBound 为假');

    /* 用账号登录（会自动注册） */
    const how=await A1.acctEnter('taisir2','pass123456',true);
    ok(A1.ACTIVE&&A1.ACTIVE.name==='taisir2','账号登录后当前档案切到账号档案');
    ok(A1.acct()&&A1.acct().user==='taisir2','登录态已记住');
    ok(A1.acctBound()===true,'账号与当前档案已绑定');
    ok(how==='cloud'||how==='local','登录时明确了用哪一份数据：'+how);

    /* 登录门里点完账号登录会走 enterApp()，那里会写下 30 天免登录会话：这里照样写一份 */
    stA['listenlab_session']=JSON.stringify({id:A1.ACTIVE.id,exp:Date.now()+30*86400000});

    /* 账号档案里写数据 → 自动上传 */
    A1.S.wrongWords.push({id:'a1',word:'harmony',cause:'new'});
    A1.S.wrongWords.push({id:'a2',word:'operate in',phrase:true,parts:['operate','in'],cause:'chunk'});
    A1.S.settings.plays=3;
    A1.save();
    const pushed=await A1.acctPush(false);
    ok(pushed===true,'手动上传成功');

    const cloud1=await j('GET','/api/data',null,A1.acct().token);
    ok(cloud1.data.data.wrongWords.length===2,'服务器上存着 2 条错题');
    ok(cloud1.data.data.ai===undefined||!cloud1.data.data.ai.key,'云端不含 AI Key（留在设备上）');
    ok(cloud1.data.data.settings.plays===3,'设置项一起同步过去了');

    /* 断电重启：同一台电脑重开页面，登录态应自动感知并校验） */
    useStore(stA);
    const A1b=buildApp();
    ok(A1b.acct()&&A1b.acct().user==='taisir2','重开页面仍是已登录状态');
    A1b.S2=A1b.blank();                 /* 模拟内存数据丢了 */
    await A1b.acctAfterLogin();         /* 开机自动对齐 */
    ok(A1b.S.wrongWords.length===2,'开机后自动从账号恢复了数据');

    /* —— 换电脑：全新 localStorage —— */
    const stB=newStore();
    useStore(stB);
    const B=buildApp();
    ok(B.users().length===0,'新电脑一开始没有任何档案');

    const howB=await B.acctEnter('taisir2','pass123456',false);
    ok(howB==='cloud','新电脑以云端那份为准');
    ok(B.S.wrongWords.length===2,'新电脑登录后错题全在（2 条）');
    ok(B.S.settings.plays===3,'设置也一起回来了');
    ok(B.users().length===1&&B.ACTIVE.name==='taisir2','新电脑自动建好了对应档案');

    /* 新电脑继续用 → 改动回传，老电脑能看到 */
    B.S.wrongWords.push({id:'b1',word:'scanned',cause:'loss'});
    B.save();
    await B.acctPush(false);
    const cloud2=await j('GET','/api/data',null,B.acct().token);
    ok(cloud2.data.data.wrongWords.length===3,'新电脑的改动已回传');

    /* 老电脑再开机 → 应该拉到 3 条 */
    useStore(stA);
    const A1c=buildApp();
    ok(A1c.S.wrongWords.length===2,'老电脑本机还是 2 条（尚未同步）');
    await A1c.acctAfterLogin();
    ok(A1c.S.wrongWords.length===3,'老电脑开机后自动对齐到 3 条');

    /* 密码错：不改变本机数据 */
    const stC=newStore();
    useStore(stC);
    const C=buildApp();
    let errMsg='';
    try{await C.acctEnter('taisir2','wrongpass',false);}catch(e){errMsg=e.message;}
    ok(/密码/.test(errMsg),'密码错时抛出人话错误：'+errMsg);
    ok(C.acct()===null,'密码错不会留下登录态');
    ok(C.users().length===0,'密码错不会在本机建出空档案');

    /* 没登录时自动上传不炸 */
    const stD=newStore();
    useStore(stD);
    const D=buildApp();
    let threw=false;
    try{D.scheduleAcctPush();D.createProfile('654321','张三',null);D.save();}catch(e){threw=true;}
    ok(threw===false,'未登录账号时保存数据不会报错');

    /* 退出账号 */
    useStore(stB);
    const E=buildApp();
    let outErr='';
    try{await E.acctLogout();}catch(e){outErr=e.message;}
    ok(outErr===''&&E.acct()===null,'退出账号正常');

    /* 账号档案与 PIN 档案互不干扰 */
    useStore(stA);
    const F=buildApp();
    ok(F.users().length>=2,'本机既有 PIN 档案，也有账号档案');
    const pinF=F.users().find(u=>u.name==='我的档案');
    ok(!!pinF,'原来的 PIN 档案还在，没有被账号覆盖');
  }catch(e){
    ok(false,'客户端整合异常：'+e.message+'\n'+(e.stack||''));
  }

  console.log('\n结果：'+pass+' 通过 / '+fail+' 失败');
  if(cp){try{cp.kill();}catch(e){}}
  try{fs.rmSync(TMP,{recursive:true,force:true});}catch(e){}
  process.exit(fail?1:0);
})();
