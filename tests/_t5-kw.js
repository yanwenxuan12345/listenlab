/* 实机回归：做题模式「划关键词」的交互正确性（自带本地服务 + 自带无头 Chrome）
   用法：node tests/_t5-kw.js
   验证的是自动化桩测不了的东西：真实鼠标事件下，划词不能把选项选成答案、高亮要落在正确位置、刷新后还在
   跑完自动关服务、关浏览器、删临时档案；找不到 Chrome 时跳过（不算失败） */
const {spawn}=require("child_process");
const fs=require("fs"),os=require("os"),path=require("path");

const CHROME=["C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/usr/bin/google-chrome","/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
  .find(p=>{try{return fs.existsSync(p);}catch(e){return false;}});
if(!CHROME){console.log("跳过 _t5：这台机器上没找到 Chrome（实机检查只在有浏览器时跑）");process.exit(0);}

const PORT=Number(process.env.LL_T5_PORT||3779), CDP=Number(process.env.LL_T5_CDP||9224);
const APP_PORTS=[PORT,3777,3778];
const EXISTING_CDP=[CDP,9223];
const ROOT=path.join(__dirname,"..");
const PROF=path.join(ROOT,".chrome-prof-t5");
let srv=null,chr=null,pass=0,fail=0,BASE="";

const w=s=>process.stdout.write(s+"\n");
const ok=(c,m)=>{c?(pass++,w("  ✅ "+m)):(fail++,w("  ❌ "+m));};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function killTree(p){if(!p||p.killed)return;try{if(process.platform==="win32")spawn("taskkill",["/PID",String(p.pid),"/T","/F"],{stdio:"ignore"});else p.kill("SIGKILL");}catch(e){}}
function cleanup(){killTree(chr);killTree(srv);try{fs.rmSync(PROF,{recursive:true,force:true});}catch(e){}}
async function reach(url,ms){
  const t=Date.now();
  while(Date.now()-t<ms){try{const r=await fetch(url);if(r.ok||r.status<500)return true;}catch(e){}await sleep(250);}
  return false;
}
async function alive(url){try{const r=await fetch(url);return r.status<500;}catch(e){return false;}}

(async()=>{
  /* 本地服务：已有在跑的（开发时常驻 3777）就直接用，否则自己起一个 */
  for(const p of APP_PORTS){
    const u="http://127.0.0.1:"+p+"/api/ping";
    if(await alive(u)){BASE="http://127.0.0.1:"+p+"/";break;}
  }
  if(!BASE){
    srv=spawn(process.execPath,["server.js"],{cwd:ROOT,env:Object.assign({},process.env,{PORT:String(PORT)}),stdio:"ignore"});
    if(!await reach("http://127.0.0.1:"+PORT+"/api/ping",15000)){w("本地服务没起来，跳过");return;}
    BASE="http://127.0.0.1:"+PORT+"/";
  }
  /* 无头浏览器：同上，已有 CDP 就直接用（一台机器同时只跑一个更省事），否则自己起 */
  let cdp=0;
  for(const p of EXISTING_CDP){ if(await alive("http://127.0.0.1:"+p+"/json/version")){cdp=p;break;} }
  if(!cdp){
    chr=spawn(CHROME,["--headless=new","--remote-debugging-port="+CDP,"--user-data-dir="+PROF,
      "--no-first-run","--no-default-browser-check","--window-size=1280,900","about:blank"],{stdio:"ignore"});
    if(await reach("http://127.0.0.1:"+CDP+"/json/version",20000))cdp=CDP;
  }
  if(!cdp){w("无头浏览器没起来（这台机器可能不允许再开一个），跳过");return;}

  const t=(await (await fetch("http://127.0.0.1:"+cdp+"/json/new?url=about:blank",{method:"PUT"})).json());
  const ws=new WebSocket(t.webSocketDebuggerUrl);
  await new Promise(r=>ws.addEventListener("open",r));
  let id=0;
  const send=(m,p)=>new Promise((res,rej)=>{const on=ev=>{const d=JSON.parse(ev.data);
    if(d.id===id){ws.removeEventListener("message",on);d.error?rej(new Error(JSON.stringify(d.error))):res(d.result);}};
    ws.addEventListener("message",on);ws.send(JSON.stringify({id,method:m,params:p||{}}));});
  const ev=async e=>{const r=await send("Runtime.evaluate",{expression:e,returnByValue:true,awaitPromise:true});
    if(r.exceptionDetails)throw new Error((r.exceptionDetails.exception||{}).description||"页面里报错了");
    return r.result.value;};
  const mouse=(type,x,y)=>send("Input.dispatchMouseEvent",{type,x,y,button:"left",buttons:type==="mouseReleased"?0:1,clickCount:1});
  const drag=async(a,b)=>{await mouse("mousePressed",a.x,a.y);
    for(let i=1;i<=5;i++){await mouse("mouseMoved",a.x+(b.x-a.x)*i/5,a.y+(b.y-a.y)*i/5);await sleep(14);}
    await mouse("mouseReleased",b.x,b.y);};
  const openApp=async()=>{await send("Page.navigate",{url:BASE});await sleep(2400);
    await ev("window.confirm=()=>true;window.alert=()=>{};speechSynthesis.speak=()=>{};speechSynthesis.cancel=()=>{};1");};

  w("=== _t5 做题模式划关键词（实机） ===");
  await send("Emulation.setDeviceMetricsOverride",{width:1280,height:900,deviceScaleFactor:1,mobile:false});
  await openApp();
  await ev("localStorage.clear();1");
  await openApp();
  await ev("gateShow('create');1");
  for(const c of "123456")await ev(`gateKey('${c}');1`);
  await sleep(700);
  for(const c of "123456")await ev(`gateKey('${c}');1`);
  await sleep(1000);
  await ev("[...document.querySelectorAll('.nav-btn')].find(b=>b.dataset.view==='exam').click();1");
  await ev("startExamWith(allMats().filter(m=>(m.questions||[]).length)[0]);1");
  await sleep(600);

  const state=()=>ev(`({
    marks:[...document.querySelectorAll('#examQs mark.kw')].map(m=>({w:m.textContent,at:m.closest('.opt')?('o'+m.closest('.opt').dataset.o):(m.closest('.stem')?'s':'?')})),
    ans:JSON.stringify(EX.ans)})`);
  /* 取容器里第 n 个单词的坐标（跳过选项字母 A. B.） */
  const wordAt=(sel,n)=>ev(`(() => {
    const box=document.querySelector(${JSON.stringify(sel)});
    if(!box)return {err:"no box"};
    box.scrollIntoView({block:'center'});
    const nodes=[];const walker=document.createTreeWalker(box,NodeFilter.SHOW_TEXT,null);let x;
    while((x=walker.nextNode())){if(x.parentNode.nodeName!=='MARK'&&!(x.parentNode.closest&&x.parentNode.closest('.letter')))nodes.push(x);}
    let seen=0;
    for(const node of nodes){
      for(const m of String(node.nodeValue).matchAll(/[A-Za-z][A-Za-z'-]*/g)){
        if(seen++===${n}){
          const rg=document.createRange();rg.setStart(node,m.index);rg.setEnd(node,m.index+m[0].length);
          const r=rg.getBoundingClientRect();
          return {word:m[0],x:r.left+1,y:r.top+r.height/2,x2:r.right-1};
        }
      }
    }
    return {err:"no word"};
  })()`);

  w("【A】在选项上拖选一个词");
  const a1=await wordAt('.opt[data-q="0"][data-o="1"]',0);
  if(a1.err){ok(false,"取不到选项里的词："+a1.err);}else{
    await drag(a1,{x:a1.x2,y:a1.y});
    await sleep(350);
    const s=await state();
    ok(s.marks.length===1&&s.marks[0].w===a1.word,"划出 1 个高亮「"+a1.word+"」");
    ok(s.marks.length&&s.marks[0].at==="o1","高亮落在选项里，没跑到题干");
    ok(s.ans==="{}","★ 划词不会把选项选成答案（原 bug）");

    w("【B】点选另一个选项后，点高亮的 × 取消");
    const cSel=await ev(`(() => {const o=document.querySelector('.opt[data-q="0"][data-o="2"]');o.scrollIntoView({block:'center'});const r=o.getBoundingClientRect();return {x:Math.round(r.left+8),y:Math.round(r.top+r.height/2)};})()`);
    await mouse("mousePressed",cSel.x,cSel.y);await mouse("mouseReleased",cSel.x,cSel.y);
    await sleep(250);
    ok((await ev("JSON.stringify(EX.ans)"))==='{"0":2}',"点选照常生效");
    const mk=await ev(`(() => {const m=document.querySelector('#examQs mark.kw');if(!m)return {err:true};const r=m.getBoundingClientRect();return {x:r.right-5,y:r.top+r.height/2};})()`);
    if(mk.err){ok(false,"找不到高亮");}else{
      await mouse("mousePressed",mk.x,mk.y);await mouse("mouseReleased",mk.x,mk.y);
      await sleep(300);
      const s2=await state();
      ok(s2.marks.length===0,"点 × 取消了高亮");
      ok(s2.ans==='{"0":2}',"★ 点 × 不会把那个选项选成答案（原 bug）");
      ok(await ev(`(function(){const l=(S.kw&&S.kw[EX.m.id]&&S.kw[EX.m.id]["0"])||[];return l.length===0;})()`),"关键词记录同步删掉");
    }

    w("【C】在题干上划词");
    const a2=await wordAt('.exam-q:nth-child(1) .stem',3);
    await drag(a2,{x:a2.x2,y:a2.y});
    await sleep(350);
    let s3=await state();
    ok(s3.marks.length===1&&s3.marks[0].at==="s","题干划词，高亮落在题干");
    ok(s3.ans==='{"0":2}',"题干划词不改答案");

    w("【D】在选项上划两个词（短语）");
    const a3=await wordAt('.opt[data-q="0"][data-o="3"]',0);
    const a3b=await wordAt('.opt[data-q="0"][data-o="3"]',1);
    await drag(a3,{x:a3b.x2,y:a3b.y});
    await sleep(350);
    s3=await state();
    ok(s3.marks.some(m=>m.at==="o3"&&/\s/.test(m.w)),"短语（带空格）整体高亮，位置正确");
    ok(s3.ans==='{"0":2}',"短语划词不改答案");

    w("【E】重复划同一个词 / 只划一个字母");
    const before=(await state()).marks.length;
    await drag(a3,{x:a3b.x2,y:a3b.y});
    await sleep(320);
    ok((await state()).marks.length===before,"重复划不会重复高亮、也不会把高亮点掉");
    const letter=await ev(`(() => {const n=document.querySelector('.opt[data-q="0"][data-o="1"] span.letter').firstChild;
      const rg=document.createRange();rg.setStart(n,0);rg.setEnd(n,1);const r=rg.getBoundingClientRect();
      return {x:r.left+1,y:r.top+r.height/2,x2:r.right-1};})()`);
    const bl=(await state()).marks.length;
    await drag(letter,{x:letter.x2,y:letter.y});
    await sleep(300);
    ok((await state()).marks.length===bl,"只划一个字母不会生成高亮");

    w("【F】刷新后高亮要还在、位置要对");
    const beforeReload=(await state()).marks;
    await openApp();
    await ev("gateShow('login');1");
    for(const c of "123456")await ev(`gateKey('${c}');1`);
    await sleep(1200);
    await ev("[...document.querySelectorAll('.nav-btn')].find(b=>b.dataset.view==='exam').click();1");
    await ev("startExamWith(allMats().filter(m=>(m.questions||[]).length)[0]);1");
    await sleep(600);
    const afterReload=(await state()).marks;
    ok(afterReload.length===beforeReload.length&&beforeReload.every(m=>afterReload.some(x=>x.w===m.w&&x.at===m.at)),
      "刷新重建后每处高亮都还在、位置也对");

    w("【G】交卷后进入批改态，划词改走翻译");
    await ev("EX.ans={0:0};document.getElementById('examSubmit').click();1");
    await sleep(600);
    ok(await ev("document.getElementById('examQs').classList.contains('graded')"),"已进入批改态");
    ok((await ev("document.querySelectorAll('#examQs mark.kw').length"))===0,"批改态没有残留高亮");
  }
  ws.close();
})().catch(e=>{w("测试崩溃："+(e&&e.message));fail++;}).finally(()=>{
  w("\n结果："+pass+" 通过 / "+fail+" 失败");
  cleanup();
  process.exit(fail?1:0);
});
