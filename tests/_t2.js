/* 集成测试：轻量 DOM 桩 + 真实 fetch，把整个应用跑起来验证登录门 / 档案隔离 / 连选 / 云同步
   用法：先启动 tests/_mocksync.js，再运行 node tests/_t2.js */
const fs=require('fs'),path=require('path'),crypto=require('crypto');

const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const src=html.match(/<script>([\s\S]*)<\/script>/)[1];

/* ---------- 轻量 DOM 桩 ---------- */
function mkClassList(init){
  const s=new Set(init||[]);
  return {add(...c){c.forEach(x=>s.add(x));},remove(...c){c.forEach(x=>s.delete(x));},
    toggle(c,f){if(f===undefined)f=!s.has(c);f?s.add(c):s.delete(c);return !!f;},
    contains(c){return s.has(c);}};
}
function mkEl(tag){
  const el={tagName:String(tag||"div").toUpperCase(),style:{},dataset:{},kids:[],value:"",
    textContent:"",innerHTML:"",checked:false,disabled:false,type:"",title:"",placeholder:"",
    onclick:null,onchange:null,oninput:null,parentElement:null,
    _cn:"",classList:mkClassList(),
    appendChild(c){if(c){c.parentElement=el;el.kids.push(c);}return c;},
    insertBefore(c){return el.appendChild(c);},
    removeChild(c){el.kids=el.kids.filter(x=>x!==c);return c;},
    addEventListener(t,f){el._h=el._h||{};el._h[t]=f;},
    removeEventListener(){},
    click(){if(el.onclick)el.onclick({target:el,shiftKey:false});},
    focus(){},blur(){},closest(){return null;},
    getAttribute(n){return el.dataset[n]!==undefined?el.dataset[n]:null;},
    setAttribute(n,v){el.dataset[n]=String(v);},
    querySelector(sel){const a=queryAll(el,sel);return a.length?a[0]:null;},
    querySelectorAll(sel){return queryAll(el,sel);}
  };
  Object.defineProperty(el,"className",{
    get(){return el._cn;},
    set(v){el._cn=String(v||"");el.classList=mkClassList(el._cn.split(/\s+/).filter(Boolean));}
  });
  Object.defineProperty(el,"options",{get(){return el.kids;}});
  return el;
}
function selTokens(sel){return String(sel).trim().split(/\s+/).filter(Boolean);}
function matchSimple(el,tok){
  let t=String(tok);
  const attr=t.match(/\[([\w-]+)(?:=["']?([^"'\]]*)["']?)?\]/);
  if(attr){
    const k=attr[1].replace(/^data-/,"");
    const v=attr[2];
    const hasOn=(v===undefined)?(typeof el.dataset[k]!=="undefined"):(el.dataset[k]===v);
    if(!hasOn)return false;
    t=t.replace(attr[0],"");
  }
  if(!t)return true;
  if(t.startsWith("."))return el.classList.contains(t.slice(1));
  if(t.startsWith("#"))return false;
  return el.tagName===t.toUpperCase();
}
function walkAll(el,out){(el.kids||[]).forEach(k=>{out.push(k);walkAll(k,out);});return out;}
/* 把 innerHTML 里的标签解析成真的桩元素，这样 class/data-* 都能查 */
function parseInto(c){
  const h=typeof c.innerHTML==="string"?c.innerHTML:"";
  if(!h||c._parsed===h)return;
  c._parsed=h;
  const re=/<(\w+)([^>]*?)\/?>/g;let m;
  while((m=re.exec(h))){
    const tag=m[1],attrs=m[2];
    if(/^(br|img|input|hr|meta|link)$/i.test(tag)&&!/\/$/.test(attrs)){/* 自闭合也建一个 */ }
    const el=mkEl(tag);
    const ar=/([\w-]+)="([^"]*)"/g;let a;
    while((a=ar.exec(attrs))){
      if(a[1]==="class")el.className=a[2];
      else el.dataset[a[1].replace(/^data-/,"")]=a[2];
    }
    el.classList=mkClassList(String(el.className||"").split(/\s+/).filter(Boolean));
    c.kids.push(el);
  }
}
function queryAll(root,sel){
  const toks=selTokens(sel);
  if(toks.length===1&&toks[0].startsWith("#"))return [byId(toks[0].slice(1))];
  parseInto(root);
  const last=toks[toks.length-1];
  const found=walkAll(root,[]).filter(e=>matchSimple(e,last));
  if(found.length)return found;
  // 退化：innerHTML 里出现了就当成有
  const h=typeof root.innerHTML==="string"?root.innerHTML:"";
  const probe=last.startsWith(".")?last.slice(1):last;
  const n=(probe&&h)?(h.split(probe).length-1):0;
  return n>0?Array.from({length:n},()=>mkEl("div")):[];
}

const REG={};
function byId(id){
  if(!REG[id]){
    const el=mkEl("div");
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
/* 导航按钮（真实 HTML 里是静态的，这里按视图名造出来，让 goto() 能工作） */
const NAV=["home","work","exam","errors","review","words","drill","syn","dash","setting"].map(v=>{
  const b=mkEl("button");b.className="nav-btn";b.dataset.view=v;return b;
});
const doc={
  getElementById:byId,
  createElement:t=>mkEl(t),
  /* markWordIn() 用 TreeWalker 找文本节点；桩里没有文本节点模型，返回空遍历即可（返回 false，不炸） */
  createTreeWalker:()=>({nextNode:()=>null}),
  querySelectorAll(sel){const t=selTokens(sel);
    if(t.length===1&&/^\.nav-btn(\[|$)/.test(t[0]))return NAV.filter(b=>matchSimple(b,t[0]));
    return queryAll({kids:[],innerHTML:""},sel);},
  querySelector(sel){const a=doc.querySelectorAll(sel);return a.length?a[0]:null;},
  addEventListener(){},body:mkEl("body"),documentElement:mkEl("html"),title:"精听实验室"
};

/* ---------- 浏览器全局桩 ---------- */
const store={};
global.localStorage={getItem:k=>(k in store?store[k]:null),setItem:(k,v)=>{store[k]=String(v);},
  removeItem:k=>{delete store[k];},key:i=>Object.keys(store)[i],get length(){return Object.keys(store).length;}};
global.document=doc;
global.NodeFilter={SHOW_TEXT:4};
global.window={crypto:crypto.webcrypto,location:{reload(){}},navigator:{},getComputedStyle:()=>({}),addEventListener(){},
  /* 默认为「没有选区」；需要模拟拖选时在用例里临时替换 */
  getSelection:()=>({isCollapsed:true,rangeCount:0,anchorNode:null,removeAllRanges(){}})};
global.crypto=crypto.webcrypto;
global.navigator={clipboard:undefined};
global.btoa=s=>Buffer.from(s,"binary").toString("base64");
global.atob=s=>Buffer.from(s,"base64").toString("binary");
global.TextEncoder=require("util").TextEncoder;
global.TextDecoder=require("util").TextDecoder;
global.SpeechSynthesisUtterance=class{constructor(t){this.text=t;}};
global.speechSynthesis={getVoices:()=>[],cancel(){},speak(){}};
/* 不要整体替换全局 URL：undici 的 fetch 内部要用它 */
try{global.URL.createObjectURL=()=>"blob:x";}catch(e){Object.defineProperty(global.URL,"createObjectURL",{value:()=>"blob:x",configurable:true});}
try{global.URL.revokeObjectURL=()=>{};}catch(e){}
global.Blob=class{constructor(){}};
global.FileReader=class{};
global.confirm=()=>true;
global.prompt=()=>null;
global.alert=()=>{};

/* ---------- 载入应用 ---------- */
let pass=0,fail=0;
const ok=(c,l,x)=>{if(c){pass++;console.log("  ✅ "+l);}else{fail++;console.log("  ❌ "+l+(x!==undefined?"  →  "+JSON.stringify(x):""));}};

const api={};
const A=new Function("api","with(api){ return (function(){"+src+
  "\n;return {get S(){return S;},set S2(v){S=v;},get ACTIVE(){return ACTIVE;},get EX(){return EX;},get GATE(){return GATE;},get W(){return W;},setW(v){W=v;},"+
  "get WSEL(){return WSEL;},users,blank,gateKey,gateShow,renderGate,lockApp,loginProfile,createProfile,checkWork,"+
  "renderSetting,renderSync,refreshAll,cloudPush,cloudPullNow,syncAfterLogin,syncCfg,setSyncCfg,cloudGet,"+
  "recordWrongPhrase,phraseOf,errCsvRows,renderErrors,allMats,goto,applyLoopUI,playsCount,saveLocal,save,"+
  "renderWrongChips,renderWork,startWork,modBox:()=>document.getElementById(\"modalBox\"),pinId,"+
  "cloudPayload,clozePlan,renderExamHistory,setTab,judgeCur,renderCloze,aiKeySyncOn,mergeAi,"+
  "renderExamResult,openExamReview,examBackToSetup,startExamWith,openExamPicker,bindSelPop,aiTranslateText,"+
  "kwStore,kwTargetOf,kwEntryWord,kwEntryTarget,markWordIn,applyKwMarks,examKwFromSel,examPickOpt};})();}")(api);

(async()=>{
console.log("\n【A】首次启动只出现登录门，不泄露数据");
ok(byId("gate").classList.contains("show"),"登录门默认显示");
ok(byId("appLayout").style.display==="none","主界面默认隐藏");
ok(A.users().length===0,"本机还没有档案");
ok(A.ACTIVE===null,"未登录时没有当前档案");
ok(A.S.wrongWords.length===0,"未登录时数据为空");

console.log("\n【B】建档案：PIN 123456 输两遍");
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
A.gateShow("create");
ok(A.GATE.mode==="create","点「建一个新档案」进入建档流程",A.GATE.mode);
for(const c of "123456")A.gateKey(c);
await sleep(400);
ok(A.GATE.step===2,"第一遍输完进入确认步骤",A.GATE.step);
for(const c of "123456")A.gateKey(c);
await sleep(450);
ok(!!A.ACTIVE,"档案建立并自动登录");
ok(A.users().length===1,"本机档案数 = 1");
ok(!byId("gate").classList.contains("show"),"登录门已关闭");
ok(byId("appLayout").style.display!=="none","主界面已显示");
ok(!!store["listenlab_v2::"+A.ACTIVE.id],"数据写在按 PIN 命名的分区里");
ok(!!store["listenlab_users"],"本机档案索引已写入");

console.log("\n【C】PIN 校验");
let errA="";
A.lockApp();
ok(A.ACTIVE===null,"锁屏后退出档案");
ok(byId("gate").classList.contains("show"),"锁屏后重新出现登录门");
try{A.loginProfile("999999");}catch(e){errA=e.message;}
ok(/PIN 不对/.test(errA),"错误 PIN 被拒绝",errA);
A.loginProfile("123456");
ok(!!A.ACTIVE,"正确 PIN 能登录回来");

console.log("\n【D】重新登录后数据完整");
const m=A.allMats()[0];
A.setW({m:m,i:0,stage:"dict",mode:"practice",playing:false,testLog:[]});
A.recordWrongPhrase({phrase:"in terms of",written:"im terms off",parts:["in","terms","of"],
  sent:m.sentences[0].en,matId:m.id,matTitle:m.title,cause:"chunk"});
A.S.settings.plays=5;A.S.settings.wholeLoop=true;A.save();
ok(A.S.wrongWords.filter(w=>w.phrase).length===1,"短语错题已入库");
ok(A.S.wrongWords.filter(w=>w.phrase)[0].parts.length===3,"短语记下 3 个组成词");
ok(A.S.review.length>=1,"句子同时进了记忆曲线队列");
A.lockApp();A.loginProfile("123456");
ok(A.S.wrongWords.filter(w=>w.phrase).length===1,"重新登录后短语错题还在");
ok(A.S.settings.plays===5,"重新登录后循环次数设置还在",A.S.settings.plays);
ok(A.S.settings.wholeLoop===true,"重新登录后整篇循环设置还在");

console.log("\n【E】两个档案互不串数据");
A.createProfile("888888",null,null);
ok(A.users().length===2,"本机有 2 个档案");
ok(A.S.wrongWords.length===0,"新档案看不到老档案的错题");
A.S.wrongWords.push({id:"x",w:"polluted",cause:"new",date:"2026-01-01",count:1,mastered:false});
A.save();A.lockApp();A.loginProfile("123456");
ok(A.S.wrongWords.filter(w=>w.phrase).length===1,"切回老档案数据仍完整");
ok(A.S.wrongWords.filter(w=>w.w==="polluted").length===0,"老档案没被新档案污染");

console.log("\n【F】听写批改 + 错词连选");
A.goto("work");
A.startWork(m.id);
byId("wsInput").value="totally wrong words here";
A.checkWork();
const chips=byId("wsResult").querySelectorAll(".wchip");
ok(chips.length>=3,"批改后生成了错词芯片",chips.length);
chips[0].click();
ok(A.WSEL.length===1,"单击选中 1 个词",A.WSEL.slice());
chips[2].onclick({target:chips[2],shiftKey:true});
ok(A.WSEL.length===3,"Shift+点第 3 个 = 一次连选 3 个词",A.WSEL.slice());
const before=A.S.wrongWords.filter(w=>w.phrase).length;
byId("wsSelGo").onclick();
const modalHtml=byId("modalBox").innerHTML;
ok(/这几个词连在一起是什么问题/.test(modalHtml),"弹窗标题变成「这几个词连在一起」");
ok(/causeSplit/.test(modalHtml),"多选时提供「拆开记成单词」的选项");
const cbtns=byId("modalBox").querySelectorAll(".cause-btn");
ok(cbtns.length===11,"短语模式列出 11 个错因（9 个单词级 + 意群 / 逻辑）",cbtns.length);
ok(!!cbtns.find(b=>b.dataset.k==="chunk"),"短语模式提供了「意群没跟上」这个错因");
const chunk=cbtns.find(b=>b.dataset.k==="chunk");
chunk.click();
ok(A.S.wrongWords.filter(w=>w.phrase).length===before+1,"连选的词合并成一条短语记录");
const newest=A.S.wrongWords.filter(w=>w.phrase).pop();
ok(newest.cause==="chunk","短语的错因记为意群",newest.cause);
ok(newest.parts.length===3,"短语记录了 3 个组成词",newest.parts);

console.log("\n【G】错题库与 CSV 导出含短语");
const rows=A.errCsvRows();
const phRow=rows.find(r=>r[0]==="短语级");
ok(!!phRow,"CSV 有「短语级」行");
ok(phRow&&/连选 3 个词合并/.test(phRow[3]),"CSV 标明了由几个词合并");
ok(phRow&&phRow[7]&&phRow[7].length>0,"短语带上了来源句");
ok(phRow&&phRow[8]===m.title,"短语带上了来源素材名",phRow&&phRow[8]);
ok(rows[0].length===14,"CSV 仍是 14 列");
A.renderErrors();
ok(true,"错题库渲染不报错");

console.log("\n【H】循环次数与整篇循环");
ok(A.playsCount()===5,"playsCount 读到 5",A.playsCount());
A.applyLoopUI();
ok(/每句 5 遍/.test(byId("wsLoopTag").textContent),"标签显示「每句 5 遍」",byId("wsLoopTag").textContent);
ok(/整篇循环/.test(byId("wsLoopTag").textContent),"标签显示整篇循环");
A.S.settings.plays=99;A.applyLoopUI();
ok(/∞ 遍/.test(byId("wsLoopTag").textContent),"选 ∞ 时显示无限循环",byId("wsLoopTag").textContent);
A.S.settings.plays=3;A.S.settings.wholeLoop=false;A.applyLoopUI();
ok(/每句 3 遍/.test(byId("wsLoopTag").textContent),"切到 3 遍",byId("wsLoopTag").textContent);

console.log("\n【I】云同步 · 通用 REST");
const space="itest"+(+new Date()).toString(36);
A.setSyncCfg({provider:"rest",base:"http://127.0.0.1:8091/kv",suffix:"",space:space,pass:"test-pass-123",auto:false});
ok((await A.cloudPush(true))===true,"上传成功");
const got=await A.cloudGet(A.syncCfg());
ok(!!got&&!!got.blob,"能读回云端数据");
ok(got.blob.indexOf("in terms of")<0,"云端看不到明文短语");
ok(got.blob.indexOf("test-pass-123")<0,"云端看不到同步口令");
const dec=async(blob,pass)=>{
  const o=JSON.parse(blob);
  const base=await crypto.webcrypto.subtle.importKey("raw",new TextEncoder().encode(pass),"PBKDF2",false,["deriveKey"]);
  const key=await crypto.webcrypto.subtle.deriveKey({name:"PBKDF2",salt:new Uint8Array(Buffer.from(o.salt,"base64")),
    iterations:150000,hash:"SHA-256"},base,{name:"AES-GCM",length:256},false,["decrypt"]);
  const pt=await crypto.webcrypto.subtle.decrypt({name:"AES-GCM",iv:new Uint8Array(Buffer.from(o.iv,"base64"))},
    key,new Uint8Array(Buffer.from(o.ct,"base64")));
  return JSON.parse(new TextDecoder().decode(pt));
};
const back=await dec(got.blob,"test-pass-123");
ok(back.wrongWords.filter(w=>w.phrase).length===2,"解密后短语错题完整",back.wrongWords.filter(w=>w.phrase).length);
ok(back.settings.plays===3,"解密后设置完整",back.settings.plays);
ok(back.ai&&back.ai.key==="","上传内容不含 AI Key（设备级配置不上云）");

console.log("\n【J】模拟换设备恢复");
A.S.wrongWords=[];A.S.review=[];A.S.settings.plays=2;A.saveLocal();
ok(A.S.wrongWords.length===0,"本机被清空");
ok((await A.cloudPullNow(false))===true,"从云端拉取成功");
ok(A.S.wrongWords.filter(w=>w.phrase).length===2,"跨设备恢复了短语错题");
ok(A.S.settings.plays===3,"跨设备恢复了循环设置");

console.log("\n【K】口令错误必须拦住");
let blocked="";
try{await dec(got.blob,"totally-wrong");}catch(e){blocked="拦住";}
ok(blocked==="拦住","错误口令解不开云端数据");
A.setSyncCfg({provider:"rest",base:"http://127.0.0.1:8091/kv",space:space,pass:"wrong-pass-here",auto:false});
let pullErr="";
try{
  const g=A.syncCfg();const gb=await A.cloudGet(g);
  await dec(gb.blob,"wrong-pass-here");
}catch(e){pullErr=e.message||"报错";}
ok(pullErr!=="","口令错时拉取会明确报错，不会静默覆盖本机");
A.setSyncCfg({provider:"rest",base:"http://127.0.0.1:8091/kv",space:space,pass:"test-pass-123",auto:false});

console.log("\n【L】Supabase 适配器（本机 PostgREST mock）");
A.setSyncCfg({provider:"supabase",url:"http://127.0.0.1:8092",key:"fake-anon",space:"sb"+(+new Date()).toString(36),pass:"test-pass-123",auto:false});
ok((await A.cloudPush(true))===true,"Supabase 风格上传成功");
const g3=await A.cloudGet(A.syncCfg());
ok(!!g3&&!!g3.blob,"Supabase 风格读回成功");
ok(g3.blob.indexOf("in terms")<0,"写进去的仍是密文");

console.log("\n【M】异常情况不炸");
A.setSyncCfg({provider:"rest",base:"http://127.0.0.1:8091/kv",space:"no-such-space-xyz",pass:"test-pass-123",auto:false});
ok((await A.cloudGet(A.syncCfg()))===null,"空空间返回 null 不报错");
A.setSyncCfg({provider:"supabase",url:"http://127.0.0.1:8092",key:"k",space:"empty",pass:"p",auto:false});
ok((await A.cloudGet(A.syncCfg()))===null,"Supabase 无记录返回 null");
let badErr="";
A.setSyncCfg({provider:"rest",base:"http://127.0.0.1:9/nothing",space:"x",pass:"test-pass-123",auto:false});
try{await A.cloudGet(A.syncCfg());}catch(e){badErr=e.message;}
ok(/网络不可达/.test(badErr),"连不上时给出人话提示",badErr);

console.log("\n【N】考场模拟：做完一篇后能回到选题界面（回归）");
A.goto("exam");
ok(byId("examSetup").style.display!=="none","进考场页显示选题界面");
const em=A.allMats().filter(x=>(x.questions||[]).length)[0];
ok(!!em,"素材库里有带题目的真题素材");
byId("examPassage").value=em.id;
byId("examStart").onclick();
ok(byId("examRun").style.display==="block","开始考试：进入答题界面");
ok(byId("examDone").style.display==="none","答题过程中成绩页是隐藏的");
ok(!!A.EX.m&&!!A.EX.timer,"考试进行中有 EX 状态（视为 inProgress）");
byId("examSubmit").onclick();
ok(byId("examRun").style.display==="block","交卷后显示逐题批改（成绩页在上方、题目带解析）");
ok(byId("examDone").style.display==="block","交卷后显示成绩卡");
ok(byId("examBanner").style.display==="none","交卷后考试横幅（计时/交卷按钮）隐藏");
ok(byId("examQs").classList.contains("graded"),"交卷后题目进入 graded 状态");
ok(A.EX.timer===null,"交卷后计时器被清空（关键：否则会被误判为“还在考试中”）");
A.goto("exam");
ok(byId("examSetup").style.display!=="none","再点「考场模拟」回到选题界面，不再卡成绩页");
ok(byId("examDone").style.display==="none","成绩页已隐藏");
ok(A.EX.m===null,"EX 状态已重置为干净状态");

console.log("\n【O】AI Key 随账号同步（默认开，可关）");
A.S.settings.syncAiKey=true;A.S.ai.key="sk-test-key-123";A.S.ai.base="https://api.deepseek.com";A.S.ai.model="deepseek-chat";
ok(A.aiKeySyncOn()===true,"开关默认读取为开");
let p=A.cloudPayload();
ok(p.ai&&p.ai.key==="sk-test-key-123","开启时上传载荷里带 Key（换设备免重填）");
A.S.settings.syncAiKey=false;
p=A.cloudPayload();
ok(!p.ai||!p.ai.key,"关闭时上传载荷里不带 Key（隐私优先）");
const merged=A.mergeAi({key:"",base:"x",model:"m"},{key:"sk-from-cloud",base:"https://api.deepseek.com",model:"deepseek-chat"});
ok(merged.key==="sk-from-cloud","拉取时云端有 Key 就采用云端");
ok(A.mergeAi({key:"sk-local",base:"x",model:"m"},{key:"",base:"y",model:"n"}).key==="sk-local","云端没 Key 时保留本机 Key");
A.S.settings.syncAiKey=true;A.save();

console.log("\n【P】关键词精听：挖空的必须是考点关键词");
const em2=A.allMats().filter(x=>(x.questions||[]).length)[0];
const plan=A.clozePlan(em2);
const hitIdx=plan.findIndex(pp=>pp.qis.length&&pp.keys.length);
ok(hitIdx>=0,"至少有一句被识别为考点句");
const hit=plan[hitIdx];
const syn=em2.questions[hit.qis[0]].syn[0][0].toLowerCase();
const normFrag=syn.replace(/[^a-z0-9' ]/g," ").replace(/\s+/g," ").trim();
ok(hit.keys.every(k=>normFrag.indexOf(k)>=0),"挖空的词全部来自该题的答案关键片段（"+hit.keys.join(", ")+"）");
ok(hit.keys.every(k=>em2.sentences[hitIdx].en.toLowerCase().indexOf(k)>=0),"挖空的词确实出现在原句里");
const nonHit=plan.filter(pp=>!pp.has||!pp.keys.length).length;
ok(plan.length===em2.sentences.length,"每句都有挖空计划");
ok(nonHit<=1,"几乎每句都有挖空（含非考点句的重点词挖空，无词可挖的 ≤1 句：" +nonHit+"）");
const plain=plan.find(pp=>pp.has&&pp.keys.length&&!pp.qis.length);
ok(!!plain,"非考点句也挖了重点词（不标考题号）");
ok(plain.keys.every(k=>em2.sentences[plan.indexOf(plain)].en.toLowerCase().indexOf(k)>=0),"非考点句挖的词确实在原句里");

console.log("\n【Q】五段式工作台与做题历史");
A.setW({m:em2,i:0,stage:"dict",mode:"practice",playing:false,testLog:[],tab:"free"});
A.setTab("cloze");
ok(byId("wsWrapCloze").style.display==="","切到关键词精听：对应面板显示");
ok(byId("wsWrapFree").style.display==="none","其他面板隐藏");
const plan2=A.clozePlan(em2);
const hit2=plan2.findIndex(pp=>pp.has&&pp.keys.length);
A.setW({m:em2,i:hit2,stage:"dict",mode:"practice",playing:false,testLog:[],tab:"cloze"});
A.renderCloze();
const czHtml=byId("czSent").innerHTML;
ok(czHtml.indexOf("cz-blank")>=0,"考点句渲染出了挖空输入框");
ok(czHtml.indexOf("data-w=")>=0,"挖空带了答案词（用于校验）");
A.S.exam=[{matId:em2.id,date:"2026-09-24",correct:7,total:10,secs:190,wrong:[0,3],ans:{0:1,3:2}}];
A.renderExamHistory();
ok(byId("examHistList").innerHTML.indexOf("70%")>=0,"做题历史渲染出正确率");
ok(byId("examHistList").innerHTML.indexOf("成绩页")>=0,"历史条目提示可打开成绩页");
ok(String(byId("examHistSum").textContent).indexOf("共 1 次")>=0,"做题历史汇总统计正确");
console.log("\n【R】做题历史回看 = 完整成绩页");
const histIdx=A.S.exam.length-1;
A.openExamReview(histIdx);
ok(byId("examDone").style.display==="block","回看：成绩卡显示");
ok(byId("examQs").classList.contains("graded"),"回看：题目处于批改状态");
const allQ=byId("examQs").kids.filter(k=>String(k.className)==="exam-q");
const gradedQs=allQ.slice(-em2.questions.length); /* 桩不会清 kids：取最新一批 */
const rq0=gradedQs[0];
ok(!!rq0&&rq0.innerHTML.indexOf("✓ 正确答案")>=0,"回看：标出正确答案");
ok(!!rq0&&rq0.innerHTML.indexOf("exam-expl")>=0,"回看：带解析");
const rqw=gradedQs[0]; /* 该素材第 1 题真答案是 C(2)，历史里记的 B(1) → 必标“你的选择” */
ok(rqw&&rqw.innerHTML.indexOf("你的选择")>=0,"回看：错题标出当时选的选项");
ok(byId("examBanner").style.display==="none","回看：不显示交卷横幅");
ok(String(byId("examScoreSub").textContent).indexOf("做于")>=0,"回看：成绩卡标注做题日期");
A.examBackToSetup();
ok(byId("examSetup").style.display!=="none","返回选题正常");
ok(A.EX.m===null,"返回后 EX 已重置");

console.log("\n【S】再练一套：按素材库分类挑选");
A.openExamPicker();
ok(A.modBox().innerHTML.indexOf("再练一套")>=0,"选择器弹窗打开");
ok(A.modBox().innerHTML.indexOf("epCats")>=0,"弹窗里有分类按钮区");
ok(byId("epList").innerHTML.indexOf("ep-item")>=0,"分类下列出了可练的套题");
ok(byId("epList").innerHTML.indexOf("句 · ")>=0,"条目带句数/题数信息");

console.log("\n【T】做题模式划关键词：只做标记，绝不改答案（回归）");
ok(!!A.blank().kw&&typeof A.blank().kw==="object","blank() 里声明了 kw 字段（数据结构唯一真源）");
ok(A.kwEntryWord("harmony")==="harmony"&&A.kwEntryTarget("harmony")==="","老数据（纯字符串）能识别：按词处理");
ok(A.kwEntryWord({w:"in harmony",t:"o2"})==="in harmony"&&A.kwEntryTarget({w:"in harmony",t:"o2"})==="o2","新数据（词+位置）能识别");
ok(A.kwTargetOf({closest:s=>s===".opt"?{dataset:{o:"3"}}:null})==="o3","kwTargetOf 能认出「第 4 个选项」");
ok(A.kwTargetOf({closest:()=>null})==="s","kwTargetOf 认不出选项时算作题干");
ok(A.markWordIn(byId("examQs"),"harmony")===false,"桩里没有文本节点时 markWordIn 返回 false（不抛异常）");

/* 进考场（让 #examQs 进入未批改状态），再直接驱动点选逻辑 */
const emT=A.allMats().filter(m=>(m.questions||[]).length)[0];
A.startExamWith(emT);
const mkOpt=o=>{const el=mkEl("div");el.className="opt";el.dataset.q="0";el.dataset.o=String(o);el.classList=mkClassList(["opt"]);return el;};
const optB=mkOpt(1),optC=mkOpt(2);
const plainClick={target:{closest:()=>null}};
A.EX.ans={};

/* ① 模拟「拖选出一段文字后松手」：紧随其后那次 click 不能当点选答案 */
global.window.getSelection=()=>({isCollapsed:false,rangeCount:1,anchorNode:null,removeAllRanges(){}});
byId("examQs")._h.mouseup();
A.examPickOpt(optB,plainClick);
ok(JSON.stringify(A.EX.ans)==="{}","★ 划词后的那次 click 不会把选项选成答案（原 bug：拖选即答题）");

/* ② 划词时间窗过去后，正常点选照常有效 */
await sleep(450);
A.examPickOpt(optC,plainClick);
ok(JSON.stringify(A.EX.ans)==='{"0":2}',"过了划词时间窗后，正常点选照常生效",A.EX.ans);

/* ③ 点在高亮词的「×」上：取消高亮，但不改答案 */
A.examPickOpt(optB,{target:{closest:s=>s==="mark.kw"?{dataset:{}}:null}});
ok(JSON.stringify(A.EX.ans)==='{"0":2}',"★ 点高亮词不会把那个选项选成答案（原 bug）");

/* ④ 没有选区的普通点击（真实点选）依然有效 */
global.window.getSelection=()=>({isCollapsed:true,rangeCount:0,anchorNode:null,removeAllRanges(){}});
byId("examQs")._h.mouseup();
await sleep(450);
A.examPickOpt(optB,plainClick);
ok(JSON.stringify(A.EX.ans)==='{"0":1}',"没有选区时，点选照常生效",A.EX.ans);

/* ⑤ 交卷后的批改态：划词不再标关键词、点选也无效 */
byId("examQs").classList.add("graded");
ok(A.examKwFromSel()===false,"批改态调用 examKwFromSel 直接返回 false（改走划词翻译）");
A.EX.ans={};
A.examPickOpt(optC,plainClick);
ok(JSON.stringify(A.EX.ans)==="{}","批改态点选项不会改答案（只回看）");
A.examBackToSetup();

console.log("\n结果："+pass+" 通过 / "+fail+" 失败");
process.exit(fail?1:0);
})().catch(e=>{console.error("测试崩溃：",e);process.exit(1);});
