/* 真题素材数据完整性测试 */
const fs=require("fs");
let pass=0,fail=0;const ok=(c,m)=>{c?pass++:(fail++,console.log("  ❌ "+m));};
const code=fs.readFileSync(__dirname+"/../mats-cet4.js","utf8");
const w={};new Function("window",code)(w);
const mats=w.LL_MATS_CET4;
ok(Array.isArray(mats)&&mats.length===80,"80 篇素材（10 套 × 8 篇），实际 "+(mats&&mats.length));
const groups=new Set(mats.map(m=>m.group));
ok(groups.size===6,"6 个考次分组（2023.12-2026.06），实际 "+[...groups].join(","));
/* 每个考次（两套的考次为 16 篇，单套的为 8 篇）篇型齐全、题目数对得上 */
let setBad=[];
for(const g of groups){
  const ms=mats.filter(m=>m.group===g);
  if(ms.length!==8&&ms.length!==16)setBad.push(g+" 篇数异常("+ms.length+")");
  const kinds=new Set(ms.map(m=>m.type));
  if(kinds.size<3)setBad.push(g+" 篇型不全");
  const per=ms.map(m=>m.questions.length).reduce((a,b)=>a+b,0);
  if(per!==25*(ms.length/8))setBad.push(g+" 题目数 "+per);
}
ok(setBad.length===0,"考次结构（每套 8 篇 / 25 题）："+(setBad.join("；")||"全部正常"));
let bad=[];
const TERM=/[.?!\u2026][\u201d\u2019"')]{0,2}$/;
for(const m of mats){
  if(!m.sentences.length)bad.push(m.id+" 无句子");
  if(!m.questions.length)bad.push(m.id+" 无题目");
  for(const [si,s] of m.sentences.entries()){
    const t=String(s.en||"").trim();
    if(t.length<2)bad.push(m.id+" 句子"+si+" 为空");
    // 超过 6 个字符却没有句末标点的，视为被切断的残句
    else if(t.length>=6&&!TERM.test(t))bad.push(m.id+" 句子"+si+" 残句");
    // 题干预告句不应混进原文
    if(/^Questions?\s*\d/.test(t))bad.push(m.id+" 句子"+si+" 混入题干播报");
    if(/^Section [ABC]$/.test(t))bad.push(m.id+" 句子"+si+" 混入 Section 标记");
  }
  for(const [qi,q] of m.questions.entries()){
    if(q.opts.length!==4)bad.push(m.id+" Q"+qi+" 选项数="+q.opts.length);
    if(q.answer<0||q.answer>3)bad.push(m.id+" Q"+qi+" 答案越界");
    if(!q.expl)bad.push(m.id+" Q"+qi+" 缺解析");
    if(!q.q)bad.push(m.id+" Q"+qi+" 缺题干");
    if(q.opts.some(o=>/[\u4e00-\u9fa5]/.test(o)))bad.push(m.id+" Q"+qi+" 选项混入中文");
  }
}
ok(bad.length===0,"素材完整性："+(bad.slice(0,5).join("；")||"全部正常"));
/* 翻译覆盖率：允许对话短句缺翻译，但整体覆盖率要够 */
const tot=mats.reduce((a,m)=>a+m.sentences.length,0);
const zh=mats.reduce((a,m)=>a+m.sentences.filter(s=>s.zh).length,0);
ok(zh/tot>0.97,"中文翻译覆盖率 "+(100*zh/tot).toFixed(1)+"%（"+zh+"/"+tot+"）");
/* 2024.12 对话应带说话人标记 */
const c2412=mats.filter(m=>m.group==="2024年12月 CET-4"&&m.type==="长对话");
ok(c2412.every(m=>m.sentences.every(s=>s.spk)),"2024.12 长对话全部带 M/W 说话人标记");
/* 答案分布抽查（不应全同一个字母） */
for(const g of groups){
  const answers=mats.filter(m=>m.group===g).flatMap(m=>m.questions.map(q=>"ABCD"[q.answer]));
  const dist={};answers.forEach(a=>dist[a]=(dist[a]||0)+1);
  ok(Object.keys(dist).length===4,g+" 答案 ABCD 均有出现："+JSON.stringify(dist));
}
/* 每题分值区间检查：问号结尾的题干应占多数 */
const qTotal=mats.reduce((a,m)=>a+m.questions.length,0);
ok(qTotal===250,"题目总数 250，实际 "+qTotal);
console.log(`结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail?1:0);
