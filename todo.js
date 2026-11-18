import { DAILY_MIN_POSTS } from './config.js';
import { supabase, loadIntelligence, esc, fmt, promptQuote } from './intelligence.js';

const $=id=>document.getElementById(id);
const VN_TZ='Asia/Ho_Chi_Minh';

function vnDateKey(){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:VN_TZ,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const x=Object.fromEntries(parts.map(p=>[p.type,p.value]));
  return `${x.year}-${x.month}-${x.day}`;
}
function formatToday(){
  return new Intl.DateTimeFormat('en-GB',{timeZone:VN_TZ,weekday:'short',day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date());
}
function effectiveWorkflow(g){
  if(g.workflow_status==='following_approval'&&g.workflow_status_since){
    if(Date.now()-new Date(g.workflow_status_since).getTime()>=48*3600_000)return'review_48h';
  }
  return g.workflow_status||'active';
}
function dnaIds(dna=''){
  return [...new Set(String(dna).match(/DNA-\d+/gi)||[])].map(x=>x.toUpperCase());
}
function shortGroup(name='',limit=3){
  const words=String(name).trim().split(/\s+/).filter(Boolean);
  return words.slice(0,limit).join(' ')+(words.length>limit?'...':'');
}
function tierScore(tier){return tier==='s'?30:tier==='a'?24:tier==='b'?16:tier==='c'?4:8;}
function testedGroupIds(promptRow){return promptRow?.groups instanceof Set?promptRow.groups:new Set();}
function card({kind='default',kicker,title,where,why,meta=''}) {
  return `<article class="todo-card todo-card-${esc(kind)}">
    <div class="todo-card-top"><span class="todo-kicker">${esc(kicker)}</span>${meta?`<span class="todo-meta">${esc(meta)}</span>`:''}</div>
    <strong class="todo-card-title">${esc(title)}</strong>
    ${where?`<div class="todo-where"><span>WHERE</span><b>${esc(where)}</b></div>`:''}
    <div class="todo-why"><span>WHY</span><p>${esc(why)}</p></div>
  </article>`;
}
function empty(text){return `<div class="todo-empty">${esc(text)}</div>`;}

try{
  const [d,groupRes]=await Promise.all([
    loadIntelligence(),
    supabase.from('facebook_groups')
      .select('id,group_code,group_name,group_url,posting_status,workflow_status,workflow_status_since,posts_count,posts_count_date,engagement_tier,approval_mode,target_fit')
      .eq('posting_status','active')
  ]);
  if(groupRes.error)throw groupRes.error;

  const today=vnDateKey();
  $('todoDate').textContent=formatToday();

  const groups=groupRes.data||[];
  const eligible=groups.filter(g=>effectiveWorkflow(g)==='active');
  const insightById=new Map(d.groups.map(g=>[g.id,g]));
  const postsByGroup=new Map();
  for(const p of d.posts.filter(p=>p.group_id)){
    if(!postsByGroup.has(p.group_id))postsByGroup.set(p.group_id,[]);
    postsByGroup.get(p.group_id).push(p);
  }

  const groupCountToday=g=>g.posts_count_date===today?Number(g.posts_count||0):0;
  const promptCandidates=d.prompts.filter(p=>p.wins>0).sort((a,b)=>(b.wins-a.wins)||(b.bestEngagement-a.bestEngagement));

  function promptFitScore(p,g){
    if(testedGroupIds(p).has(g.id))return -9999;
    const gi=insightById.get(g.id);
    let score=p.wins*30+p.bestEngagement*.15;
    if(gi?.topFamily?.family&&p.family===gi.topFamily.family)score+=55;
    score+=tierScore(g.engagement_tier);
    if(p.groupsTested<2)score+=12;
    return score;
  }
  function bestPromptForGroup(g){
    return promptCandidates.map(p=>({p,score:promptFitScore(p,g)})).filter(x=>x.score>-1000).sort((a,b)=>b.score-a.score)[0]?.p||null;
  }

  const kpiTasks=eligible
    .map(g=>({g,count:groupCountToday(g)}))
    .filter(x=>x.count<DAILY_MIN_POSTS)
    .sort((a,b)=>(a.count-b.count)||(tierScore(b.g.engagement_tier)-tierScore(a.g.engagement_tier)))
    .slice(0,8)
    .map(({g,count})=>{
      const p=bestPromptForGroup(g);
      const remaining=DAILY_MIN_POSTS-count;
      const dna=p?dnaIds(p.prompt?.dna).join(' + '):'';
      return card({
        kind:'kpi',
        kicker:`KPI · còn ${remaining}`,
        title:p?`${p.promptId} · ${promptQuote(p.prompt,105)}`:`${g.group_code} cần thêm content`,
        where:`${g.group_code} - ${shortGroup(g.group_name)}`,
        why:p?`Còn thiếu ${remaining} bài để đạt KPI. ${dna||'Concept này'} đang có tín hiệu và chưa thấy test ở group này.`:`Còn thiếu ${remaining} bài để đạt KPI; chưa có winner đủ rõ để auto-suggest content.`,
        meta:g.approval_mode||''
      });
    });
  $('todoKpi').innerHTML=kpiTasks.join('')||empty('KPI hôm nay đã đủ cho các group đang active.');

  const conceptMap=new Map();
  for(const p of d.posts){
    for(const dna of dnaIds(p.prompt?.dna)){
      if(!conceptMap.has(dna))conceptMap.set(dna,{dna,posts:0,wins:0,groups:new Set(),families:new Map(),best:null});
      const c=conceptMap.get(dna);
      c.posts++;if(p.group_id)c.groups.add(p.group_id);if(p.isWin)c.wins++;
      c.families.set(p.family,(c.families.get(p.family)||0)+1);
      if(!c.best||p.engagement>c.best.engagement)c.best=p;
    }
  }
  const crossCandidates=[...conceptMap.values()]
    .filter(c=>c.wins>0&&c.groups.size<3&&c.best)
    .sort((a,b)=>(b.wins-a.wins)||(b.best.engagement-a.best.engagement));

  const crossTasks=[];
  for(const c of crossCandidates){
    const best=c.best;
    const family=[...c.families.entries()].sort((a,b)=>b[1]-a[1])[0]?.[0]||best.family;
    const targets=eligible
      .filter(g=>!c.groups.has(g.id))
      .map(g=>{
        const gi=insightById.get(g.id);
        let score=tierScore(g.engagement_tier);
        if(gi?.topFamily?.family===family)score+=70;
        if(groupCountToday(g)<DAILY_MIN_POSTS)score+=15;
        return {g,score};
      })
      .sort((a,b)=>b.score-a.score);
    const target=targets[0]?.g;
    if(!target)continue;
    const source=best.group;
    crossTasks.push(card({
      kind:'cross',
      kicker:`${c.dna} · cross-group`,
      title:`${best.prompt?.prompt_id||best.prompt_code} · ${promptQuote(best.prompt,105)}`,
      where:`${target.group_code} - ${shortGroup(target.group_name)}`,
      why:`Concept đã thắng ở ${source?`${source.group_code} - ${shortGroup(source.group_name)}`:'group trước'} với ${fmt(best.comments)} comments · ${fmt(best.shares)} shares, nhưng mới phủ ${c.groups.size} group.`,
      meta:family||''
    }));
    if(crossTasks.length>=5)break;
  }
  $('todoCross').innerHTML=crossTasks.join('')||empty('Chưa có DNA winner nào cần cross-group thêm.');

  const dataTasks=eligible
    .map(g=>({g,n:(postsByGroup.get(g.id)||[]).length,gi:insightById.get(g.id)}))
    .filter(x=>x.n<2)
    .sort((a,b)=>a.n-b.n)
    .slice(0,6)
    .map(({g,n,gi})=>{
      const p=bestPromptForGroup(g);
      return card({
        kind:'data',
        kicker:`DATA · ${n} bài`,
        title:p?`${p.promptId} · ${promptQuote(p.prompt,95)}`:`${g.group_code} cần thêm bài test`,
        where:`${g.group_code} - ${shortGroup(g.group_name)}`,
        why:n===0?'Group chưa có dữ liệu performance. Nên test 2–3 content khác DNA trước khi xếp tier.':`Mới có ${n} bài; chưa đủ để kết luận. ${gi?.topFamily?.family?`Tín hiệu hiện tại nghiêng về ${gi.topFamily.family}.`:''}`
      });
    });
  $('todoData').innerHTML=dataTasks.join('')||empty('Các group active đều đã có tối thiểu 2 bài dữ liệu.');

  const familyWins=new Map();
  for(const p of d.posts.filter(p=>p.isWin)){
    const f=p.family||'Khác';
    if(!familyWins.has(f))familyWins.set(f,{family:f,wins:0,comments:0,shares:0,dnas:new Set(),best:p});
    const x=familyWins.get(f);x.wins++;x.comments+=p.comments;x.shares+=p.shares;
    dnaIds(p.prompt?.dna).forEach(id=>x.dnas.add(id));
    if(p.engagement>x.best.engagement)x.best=p;
  }
  const familyKeyword={
    'Gia đình':'Mom / Motherhood / Family',
    'Phụ nữ':'Women 40+ / Women Life / Everyday Women',
    'Tình cảm':'Women Relationships / Love / Dating 40+',
    'Đời sống':'Everyday Life / Grocery / Cost of Living',
    'Cảm xúc':'Self Love / Women Feelings / Emotional Support',
    'Công việc':'Women at Work / Workplace Life',
    'Hoài niệm':'Nostalgia / Childhood Memories / Old-Fashioned Life',
    'Khác':'Women 40+ / Everyday Life'
  };
  const discovery=[...familyWins.values()]
    .sort((a,b)=>(b.wins-a.wins)||(b.comments-a.comments))
    .slice(0,3)
    .map(x=>{
      const source=x.best.group;
      return card({
        kind:'discovery',
        kicker:'DISCOVERY',
        title:`Tìm thêm 5 group · ${familyKeyword[x.family]||familyKeyword['Khác']}`,
        where:'US audience · women 40+ · comment thật',
        why:`${x.family} đang có ${x.wins} winner signal. DNA nổi bật: ${[...x.dnas].slice(0,3).join(', ')||'chưa gắn DNA'}. Dùng ${source?`${source.group_code} - ${shortGroup(source.group_name)}`:'group đang thắng'} làm mẫu audience, không chỉ nhìn member count.`
      });
    });
  $('todoDiscovery').innerHTML=discovery.join('')||empty('Chưa có winner đủ rõ để định hướng tìm group mới.');

  $('todoPriorityCount').textContent=kpiTasks.length+crossTasks.length;
  $('todoCrossCount').textContent=crossTasks.length;
  $('todoDataCount').textContent=dataTasks.length;
  $('todoDiscoveryCount').textContent=discovery.length;
}catch(e){
  document.querySelector('.todo-main').innerHTML=`<section class="todo-section"><div class="todo-empty">${esc(e.message)}</div></section>`;
}
