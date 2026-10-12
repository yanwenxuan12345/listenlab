/* 核心逻辑单测：PIN 分区 / AES 加密往返 / 连选短语 / 云端适配器
   用法：node tests/_t1.js */
const fs=require('fs'),path=require('path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const src=html.match(/<script>([\s\S]*)<\/script>/)[1];

function grab(name){
  // 用花括号配平来切函数体，避免模板字符串里的 } 把正则带偏
  const re=new RegExp('\\n((?:async )?function '+name+'\\s*\\()');
  const m=re.exec(src);
  if(!m)throw new Error('找不到函数 '+name);
  const start=m.index+1;
  let i=src.indexOf('{',start+1),depth=0;
  for(let j=i;j<src.length;j++){
    const c=src[j];
    if(c==='{')depth++;
    else if(c==='}'){depth--;if(depth===0)return src.slice(start,j+1);}
  }
  throw new Error('函数 '+name+' 括号不配平');
}
function grabVar(decl){
  const m=src.match(new RegExp('(?:^|\\n)('+decl.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+')','m'));
  return m?m[1]:'';
}

let pass=0,fail=0;
function ok(cond,label,extra){
  if(cond){pass++;console.log('  ✅ '+label);}
  else{fail++;console.log('  ❌ '+label+(extra!==undefined?'  →  '+JSON.stringify(extra):''));}
}

/* ---- 浏览器环境的桩 ---- */
const store={};
global.localStorage={getItem:k=>(k in store?store[k]:null),setItem:(k,v)=>{store[k]=String(v);},removeItem:k=>{delete store[k];}};
global.window={crypto:{subtle:require('crypto').webcrypto.subtle}};
global.crypto=require('crypto').webcrypto;
global.btoa=s=>Buffer.from(s,'binary').toString('base64');
global.atob=s=>Buffer.from(s,'base64').toString('binary');
global.TextEncoder=require('util').TextEncoder;
global.TextDecoder=require('util').TextDecoder;
global.fetch=async()=>{throw new Error('no network in test');};

const code=[
  'const USERS_KEY="listenlab_users";const DEV_AI="listenlab_ai";const SYNC_CFG="listenlab_sync";const SESSION_KEY="listenlab_session";const LEGACY_KEY="listenlab_v2";const KEY_PREFIX="listenlab_v2::";',
  grab('pinId'),grab('users'),grab('setUsers'),grab('keyOf'),
  grab('loadDeviceAi'),grab('saveDeviceAi'),grab('blank'),
  grab('syncCfg'),grab('setSyncCfg'),grab('newSpace'),
  grab('cryptoOk'),grab('b64'),grab('unb64'),grab('deriveKey'),grab('seal'),grab('unseal'),
  grab('restUrl'),grab('sbH'),
  'let SYNC_PASS_MEM="";',
  grab('phraseOf'),
  'global.__x={pinId,users,setUsers,keyOf,blank,seal,unseal,syncCfg,setSyncCfg,newSpace,phraseOf,restUrl,sbH,deriveKey,cryptoOk};'
].join('\n');

const f=new Function(code);
f();
const X=global.__x;

console.log('\n【1】PIN 分区键');
ok(X.pinId('123456')===X.pinId('123456'),'同一个 PIN 得到同一个分区 ID');
ok(X.pinId('123456')!==X.pinId('123457'),'不同 PIN 分区不冲突');
ok(/^[0-9a-f]{16}$/.test(X.pinId('123456')),'分区 ID 是 16 位十六进制',X.pinId('123456'));
ok(X.pinId('123456')!==X.pinId(' 123456'),'前后空格不会被吃掉（不匹配）');

console.log('\n【2】AES-GCM 加密往返');
(async()=>{
  const data={settings:{plays:3},wrongWords:[{w:'in terms of',phrase:true,cause:'chunk'}],_updated:1234567890};
  const blob=await X.seal(data,'my-pass-123');
  ok(typeof blob==='string'&&blob.length>80,'密文是字符串且非空');
  ok(!blob.includes('in terms of'),'密文里看不到明文内容');
  ok(!blob.includes('my-pass-123'),'密文里不含口令');
  const back=await X.unseal(blob,'my-pass-123');
  ok(JSON.stringify(back)===JSON.stringify(data),'正确口令能完整还原');
  let err='';
  try{await X.unseal(blob,'wrong-pass');}catch(e){err=e.message;}
  ok(/口令不对/.test(err),'错误口令会明确报错',err);
  let err2='';
  try{await X.unseal('{"not":"ours"}','x');}catch(e){err2=e.message;}
  ok(/格式/.test(err2),'非本应用的数据会报格式错误',err2);
  const blob2=await X.seal(data,'my-pass-123');
  ok(blob2!==blob,'每次加密的 salt/iv 不同（同一份数据密文不同）');

  console.log('\n【3】短语连选');
  const wrongList=[
    {correct:'in',written:'im'},
    {correct:'terms',written:''},
    {correct:'of',written:'off'},
    {correct:'funding',written:'funding'}
  ];
  const p=X.phraseOf(wrongList,[0,1,2]);
  ok(p.text==='in terms of','选中 0/1/2 拼成短语 "in terms of"',p.text);
  ok(p.written==='im off','写错的部分按顺序拼起来（空的自动跳过）',p.written);
  ok(p.parts.length===3,'短语记录了 3 个组成词');
  const p2=X.phraseOf(wrongList,[2,0,1]);
  ok(p2.text==='in terms of','乱序选中也按原文顺序拼',p2.text);
  const p3=X.phraseOf(wrongList,[1]);
  ok(p3.text==='terms','单选就是一个词',p3.text);
  const p4=X.phraseOf(wrongList,[]);
  ok(p4.text==='','空选返回空串',p4.text);

  console.log('\n【4】云同步配置与地址拼装');
  ok(X.syncCfg()===null,'没配置时 syncCfg 返回 null');
  X.setSyncCfg({provider:'rest',space:'abc',base:'https://kvdb.io/XYZ',auto:true});
  ok(X.syncCfg().space==='abc','配置能存能读');
  ok(X.restUrl({base:'https://kvdb.io/XYZ/',space:'abc'})==='https://kvdb.io/XYZ/abc','地址去掉了多余的斜杠');
  ok(X.restUrl({base:'https://x.firebaseio.com/',space:'ll',suffix:'.json'})==='https://x.firebaseio.com/ll.json','Firebase 风格后缀正确');
  const h=X.sbH({key:'K'},{});ok(h.apikey==='K'&&h.Authorization==='Bearer K','Supabase 请求头带 apikey 和 Bearer');
  const sp=X.newSpace();
  ok(/^[0-9a-f]{32}$/.test(sp),'随机空间 ID 是 32 位十六进制',sp);
  ok(X.newSpace()!==X.newSpace(),'两次生成的空间 ID 不同');
  ok(X.cryptoOk()===true,'能检测到加密能力可用');

  console.log('\n【5】存档结构');
  const b=X.blank();
  ok(b.settings.plays===2,'新档案默认每句播 2 遍');
  ok(b.settings.wholeLoop===false,'新档案默认不整篇循环');
  ok(Array.isArray(b.wrongWords)&&Array.isArray(b.review)&&Array.isArray(b.mats),'数据结构完整');
  ok(b._updated===0,'新档案带 _updated 字段（云同步用）');

  console.log('\n结果：'+pass+' 通过 / '+fail+' 失败');
  process.exit(fail?1:0);
})();
