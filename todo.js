import { DAILY_MIN_POSTS } from './config.js';
import { supabase, loadIntelligence, esc, fmt, promptQuote } from './intelligence.js';

const $ = id => document.getElementById(id);
const VN_TZ='Asia/Ho_Chi_Minh';

function vnDateKey(date=new Date()){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:VN_TZ,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
  const x=Object.fromEntries(parts.map(p=>[p.type,p.value]));
  return `${x.year}-${x.month}-${x.day}`;
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
function lineageKey(prompt={}){
  return prompt?.root_prompt_id||prompt?.id||prompt?.prompt_id||'';
}
function tierStars(tier){
  return tier==='s'?'★★★':tier==='a'?'★★':tier==='b'?'★':'';
}
function groupRef(g){
  if(!g)return null;
  return {
    id:g.id,
    code:g.group_code||'',
    name:g.group_name||'',
    url:g.group_url||'',
    tier:g.engagement_tier||g.tier||''
  };
}
function groupLink(g,{showStars=true}={}){
  if(!g)return'';
  const label=esc(g.name||g.group_name||'Group');
  const stars=showStars&&tierStars(g.tier||g.engagement_tier)?` <span class="todo-group-stars">${esc(tierStars(g.tier||g.engagement_tier))}</span>`:'';
  const url=g.url||g.group_url||'';
  return url
    ? `<a class="todo-group-link" href="${esc(url)}" target="_blank" rel="noopener">${label}${stars}</a>`
    : `<span class="todo-group-link no-link">${label}${stars}</span>`;
}
function statusBadge(status){
  const map={
    done:['✓ Done','done'],
    progress:['In Progress','progress'],
    suggested:['Suggested','suggested']
  };
  const [label,cls]=map[status]||map.suggested;
  return `<span class="todo-status todo-status-${cls}">${label}</span>`;
}
function card(task={}) {
  return {
    ...task,
    kind:task.kind||'default',
    status:task.status||'suggested',
    title:task.title||'Chưa có nội dung',
    where:task.where||'',
    why:task.why||'',
    meta:task.meta||''
  };
}
function renderCard(task={}) {
  const kind=task.kind||'default';
  const status=task.status||'suggested';
  const headlineText=task.promptQuote||task.title||'Chưa có nội dung';
  const promptId=task.promptId||'';
  const dna=task.dnaLabel?`<div class="todo-dna-line">${esc(task.dnaLabel)}</div>`:'';
  const coverage=Array.isArray(task.groupCoverage)&&task.groupCoverage.length
    ? `<div class="todo-coverage"><div class="todo-coverage-list">${task.groupCoverage.map(item=>`<div class="todo-coverage-row">${groupLink(item.group,{showStars:false})}<span class="todo-coverage-status ${item.covered?'is-covered':''}" aria-label="${item.covered?'Đã có bài':'Chưa có bài'}">${item.covered?'✓':'-'}</span></div>`).join('')}</div></div>`
    : '';
  const posted=Array.isArray(task.postedGroups)&&task.postedGroups.length
    ? `<div class="todo-posted"><span>ĐÃ POST</span><div class="todo-posted-list">${task.postedGroups.map(item=>{
        const metric=item.metrics?`<em>${esc(item.metrics)}</em>`:'';
        const state=item.postStatus?`<small>${esc(item.postStatus)}</small>`:'';
        return `<div class="todo-posted-row">${groupLink(item.group)}<div>${state}${metric}</div></div>`;
      }).join('')}</div></div>`
    : '';
  const suggested=Array.isArray(task.whereGroups)&&task.whereGroups.length
    ? `<div class="todo-where todo-where-groups"><span>ĐỀ XUẤT</span><div class="todo-group-list">${task.whereGroups.map(g=>groupLink(g)).join('')}</div></div>`
    : '';
  const source=task.sourceGroup
    ? `<div class="todo-why-source">${groupLink(task.sourceGroup,{showStars:false})}${task.sourceMetrics?`<span>${esc(task.sourceMetrics)}</span>`:''}</div>`
    : '';
  return `<article class="todo-card todo-card-${esc(kind)} todo-card-state-${esc(status)}">
    <div class="todo-card-top todo-card-top-compact">
      <div class="todo-headline-wrap">
        <div class="todo-headline">${promptId?`<strong>${esc(promptId)}</strong><span>—</span>`:''}<p>${esc(headlineText)}</p></div>
        ${dna}
      </div>
      ${statusBadge(status)}
    </div>
    ${coverage}
    ${posted}
    ${suggested}
    <div class="todo-why"><span>WHY</span>${source}<p>${esc(task.why||'')}</p></div>
  </article>`;
}
function empty(text){return `<div class="todo-empty">${esc(text)}</div>`;}
const CACHE_KEY='bebo.todo.snapshot.v4';
let syncHadError=false;
let syncFailedSections=new Set();

function renderError(id,message){
  syncHadError=true;
  const sectionById={todoKpi:'kpi',todoCross:'cross',todoData:'data',todoDiscovery:'discovery'};
  const section=sectionById[id];
  if(section)syncFailedSections.add(section);
  const el=$(id);
  if(el)el.innerHTML=empty(`Không tải được block này: ${message}`);
}
function postPromptCode(p){return p.prompt?.prompt_id||p.prompt_code||'';}
function safeQuote(prompt,n=105){
  const text=String(prompt?.content||prompt?.title||'').trim();
  if(!text)return'Chưa có nội dung';
  return text.length>n?text.slice(0,n-1).trim()+'…':text;
}
function readSnapshot(){
  try{
    const value=JSON.parse(localStorage.getItem(CACHE_KEY)||'null');
    return value&&value.version===4&&value.sections?value:null;
  }catch(_error){return null;}
}
function formatSyncTime(iso){
  if(!iso)return'Chưa sync';
  try{
    return 'Last sync · '+new Intl.DateTimeFormat('vi-VN',{
      timeZone:VN_TZ,day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'
    }).format(new Date(iso));
  }catch(_error){return'Last sync';}
}
function updateSyncMeta(snapshot,message=''){
  const el=$('todoSyncMeta');
  if(!el)return;
  if(message){el.textContent=message;return;}
  if(!snapshot){el.textContent='Chưa sync';return;}
  const stale=snapshot.date&&snapshot.date!==vnDateKey();
  el.textContent=(stale?'Snapshot cũ · ':'')+formatSyncTime(snapshot.syncedAt);
}
function renderSnapshot(snapshot){
  if(!snapshot)return false;
  const ids={todoKpi:'kpi',todoCross:'cross',todoData:'data',todoDiscovery:'discovery'};
  for(const [id,key] of Object.entries(ids)){
    const el=$(id);
    const tasks=Array.isArray(snapshot.sections?.[key])?snapshot.sections[key]:[];
    if(el)el.innerHTML=tasks.length?tasks.map(renderCard).join(''):empty('Snapshot chưa có dữ liệu cho block này.');
  }
  updateSyncMeta(snapshot);
  return true;
}
function renderCachedSnapshot(){
  const snapshot=readSnapshot();
  if(renderSnapshot(snapshot))return;
  const message='Chưa có snapshot. Bấm Sync Todo để tải dữ liệu mới.';
  ['todoKpi','todoCross','todoData','todoDiscovery'].forEach(id=>{
    const el=$(id);if(el)el.innerHTML=empty(message);
  });
  updateSyncMeta(null);
}

async function syncTodo(){
  const btn=$('syncTodoBtn');
  const cached=readSnapshot();
  syncHadError=false;
  syncFailedSections=new Set();
  if(btn){btn.disabled=true;btn.classList.add('is-syncing');btn.textContent='↻ Updating…';}
  updateSyncMeta(cached,'Đang sync…');
  try{
  const [d,groupRes]=await Promise.all([
    loadIntelligence(),
    supabase.from('facebook_groups')
      .select('id,group_code,group_name,group_url,posting_status,workflow_status,workflow_status_since,posts_count,posts_count_date,engagement_tier,approval_mode,target_fit')
      .eq('posting_status','active')
  ]);
  if(groupRes.error)throw groupRes.error;

  const today=vnDateKey();
  const groups=groupRes.data||[];
  const eligible=groups.filter(g=>effectiveWorkflow(g)==='active');
  const insightById=new Map(d.groups.map(g=>[g.id,g]));
  const postsByGroup=new Map();
  const todayPostsByGroup=new Map();

  for(const p of d.posts.filter(p=>p.group_id)){
    if(!postsByGroup.has(p.group_id))postsByGroup.set(p.group_id,[]);
    postsByGroup.get(p.group_id).push(p);
    if(p.submitted_at&&vnDateKey(new Date(p.submitted_at))===today){
      if(!todayPostsByGroup.has(p.group_id))todayPostsByGroup.set(p.group_id,[]);
      todayPostsByGroup.get(p.group_id).push(p);
    }
  }

  // post_history is the single source of truth for actual posts.
  const groupCountToday=g=>(todayPostsByGroup.get(g.id)||[]).length;

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

  let kpiTasks=[],crossTasks=[],dataTasks=[],discovery=[];
  try{
    // 01 Today: one card per viral prompt lineage. Every active KPI group stays visible.
    // Coverage is per group: ✓ means this lineage has already been posted there; - means not yet.
    const lineageMap=new Map();
    for(const p of d.prompts){
      const key=lineageKey(p.prompt);
      if(!key)continue;
      if(!lineageMap.has(key))lineageMap.set(key,{key,members:[],posts:[]});
      lineageMap.get(key).members.push(p);
    }
    for(const post of d.posts){
      const key=lineageKey(post.prompt);
      if(!key)continue;
      if(!lineageMap.has(key))lineageMap.set(key,{key,members:[],posts:[]});
      lineageMap.get(key).posts.push(post);
    }

    const quoteCandidates=[...lineageMap.values()]
      .map(item=>{
        const rootMember=item.members.find(p=>String(p.prompt?.id)===String(item.key));
        const p=rootMember||item.members.sort((a,b)=>(b.wins-a.wins)||(b.bestEngagement-a.bestEngagement))[0];
        if(!p)return null;
        const posts=item.posts;
        const winPosts=posts.filter(x=>x.isWin).sort((a,b)=>b.engagement-a.engagement);
        const best=winPosts[0]||null;
        const coveredGroupIds=new Set(posts.filter(x=>x.group_id).map(x=>x.group_id));
        return {p,posts,winPosts,best,coveredGroupIds};
      })
      .filter(x=>x?.best)
      .sort((a,b)=>(b.best.engagement-a.best.engagement)||(b.winPosts.length-a.winPosts.length));

    kpiTasks=[];
    for(const item of quoteCandidates){
      const p=item.p;
      const best=item.best;
      const family=p.family||best.family||'';
      const rankedGroups=eligible
        .filter(g=>g.id!==best.group_id)
        .map(g=>{
          const gi=insightById.get(g.id);
          let score=tierScore(g.engagement_tier)*10;
          if(gi?.topFamily?.family&&gi.topFamily.family===family)score+=22;
          if(groupCountToday(g)<DAILY_MIN_POSTS)score+=2;
          return {g,score,covered:item.coveredGroupIds.has(g.id)};
        })
        .sort((a,b)=>b.score-a.score||String(a.g.group_code).localeCompare(String(b.g.group_code)))
        .slice(0,6);

      const groupCoverage=rankedGroups.map(x=>({group:groupRef(x.g),covered:x.covered}));
      const openCount=groupCoverage.filter(x=>!x.covered).length;

      kpiTasks.push(card({
        kind:'kpi',
        status:openCount?'suggested':'done',
        title:'',
        promptId:p.promptId,
        dnaLabel:dnaIds(p.prompt?.dna).join(' · ')||String(p.prompt?.dna||'').trim(),
        promptQuote:safeQuote(p.prompt,180),
        groupCoverage,
        sourceGroup:groupRef(best.group),
        sourceMetrics:`${fmt(best.likes)} likes · ${fmt(best.comments)} comments · ${fmt(best.shares)} shares`,
        why:openCount
          ? `Viral lineage này còn ${openCount} group chưa cover. Danh sách giữ nguyên ưu tiên theo tier/fit hiện tại; ✓ chỉ đánh dấu group đã có bài.`
          : 'Viral lineage này đã có bài ở toàn bộ group active hiện tại.',
      }));
      if(kpiTasks.length>=8)break;
    }

    // Explore only after proven viral lineages.
    const newTests=d.prompts
      .filter(p=>p.wins===0)
      .slice(0,2)
      .map(p=>{
        const key=lineageKey(p.prompt);
        const posts=lineageMap.get(key)?.posts||[];
        const coveredGroupIds=new Set(posts.filter(x=>x.group_id).map(x=>x.group_id));
        const groupCoverage=eligible
          .map(g=>({g,score:tierScore(g.engagement_tier),covered:coveredGroupIds.has(g.id)}))
          .sort((a,b)=>b.score-a.score||String(a.g.group_code).localeCompare(String(b.g.group_code)))
          .slice(0,6)
          .map(x=>({group:groupRef(x.g),covered:x.covered}));
        return card({
          kind:'kpi',status:groupCoverage.some(x=>!x.covered)?'suggested':'done',
          title:'',
          promptId:p.promptId,
          dnaLabel:dnaIds(p.prompt?.dna).join(' · ')||String(p.prompt?.dna||'').trim(),
          promptQuote:safeQuote(p.prompt,180),
          groupCoverage,
          why:'Quote mới/chưa có winner. Group vẫn được xếp theo tier để test sau các viral lineage ở trên.',
        });
      });

    kpiTasks.push(...newTests);
    $('todoKpi').innerHTML=kpiTasks.length?kpiTasks.map(renderCard).join(''):empty('Chưa có quote winner hoặc quote test phù hợp. Sync lại sau khi có thêm dữ liệu.');
  }catch(e){renderError('todoKpi',e.message);}

  try{
    // 02 Cross-group: DNA with >=2 tested groups is retained as Done instead of disappearing.
    const conceptMap=new Map();
    for(const p of d.posts){
      for(const dna of dnaIds(p.prompt?.dna)){
        if(!conceptMap.has(dna))conceptMap.set(dna,{dna,posts:0,wins:0,groups:new Set(),families:new Map(),best:null,groupPosts:new Map()});
        const c=conceptMap.get(dna);
        c.posts++;if(p.group_id)c.groups.add(p.group_id);if(p.isWin)c.wins++;
        c.families.set(p.family,(c.families.get(p.family)||0)+1);
        if(p.group_id){
          if(!c.groupPosts.has(p.group_id))c.groupPosts.set(p.group_id,[]);
          c.groupPosts.get(p.group_id).push(p);
        }
        if(!c.best||p.engagement>c.best.engagement)c.best=p;
      }
    }

    crossTasks=[];
    const crossCandidates=[...conceptMap.values()]
      .filter(c=>c.wins>0&&c.best)
      .sort((a,b)=>(b.wins-a.wins)||(b.best.engagement-a.best.engagement));

    for(const c of crossCandidates){
      const best=c.best;
      const family=[...c.families.entries()].sort((a,b)=>b[1]-a[1])[0]?.[0]||best.family;
      const done=c.groups.size>=2;

      if(done){
        const tested=[...c.groups].map(id=>groups.find(g=>g.id===id)||insightById.get(id)).filter(Boolean);
        crossTasks.push(card({
          kind:'cross',status:'done',
          kicker:`${c.dna} · cross-group`,
          title:`${postPromptCode(best)} · ${safeQuote(best.prompt,105)}`,
          whereGroups:tested.slice(0,3).map(groupRef),
          why:`DNA này đã được ghi nhận ở ${c.groups.size} group nên cross-group test được xem là đã thực hiện. Best signal: ${fmt(best.comments)} comments · ${fmt(best.shares)} shares.`,
          meta:family||''
        }));
      }else{
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
          kind:'cross',status:'suggested',
          kicker:`${c.dna} · cross-group`,
          title:`${postPromptCode(best)} · ${safeQuote(best.prompt,105)}`,
          whereGroups:[groupRef(target)],
          sourceGroup:groupRef(source),
          sourceMetrics:`${fmt(best.comments)} comments · ${fmt(best.shares)} shares`,
          why:`Concept này hiện mới phủ ${c.groups.size} group; nên tiếp tục cross-group ở target phù hợp.`,
          meta:family||''
        }));
      }
      if(crossTasks.length>=8)break;
    }
    $('todoCross').innerHTML=crossTasks.length?crossTasks.map(renderCard).join(''):empty('Chưa có DNA winner nào để theo dõi cross-group.');
  }catch(e){renderError('todoCross',e.message);}

  try{
    // 03 Data coverage: 0 = Suggested, 1 = In Progress, >=2 = Done.
    dataTasks=eligible
      .map(g=>({g,n:(postsByGroup.get(g.id)||[]).length,gi:insightById.get(g.id)}))
      .sort((a,b)=>{
        const state=n=>n>=2?2:n===1?1:0;
        return state(a.n)-state(b.n)||(a.n-b.n)||(tierScore(b.g.engagement_tier)-tierScore(a.g.engagement_tier));
      })
      .map(({g,n,gi})=>{
        const status=n>=2?'done':n===1?'progress':'suggested';
        const p=status==='done'?null:bestPromptForGroup(g);
        return card({
          kind:'data',status,
          kicker:status==='done'?`DATA · ${n} bài`:status==='progress'?'DATA · 1/2':'DATA · 0/2',
          title:status==='done'
            ? `${g.group_code} · đủ dữ liệu tối thiểu`
            : p?`${p.promptId} · ${safeQuote(p.prompt,95)}`:`${g.group_code} cần thêm bài test`,
          whereGroups:[groupRef(g)],
          why:status==='done'
            ? `Đã ghi nhận ${n} bài, đạt ngưỡng tối thiểu 2 bài để bắt đầu đánh giá group.`
            : status==='progress'
              ? `Đã có 1 bài. Cần ít nhất thêm 1 bài khác trước khi kết luận. ${gi?.topFamily?.family?`Tín hiệu hiện tại nghiêng về ${gi.topFamily.family}.`:''}`
              : 'Chưa có dữ liệu performance. Nên test 2–3 content khác DNA trước khi xếp tier.'
        });
      });
    $('todoData').innerHTML=dataTasks.length?dataTasks.map(renderCard).join(''):empty('Không có group active để đánh giá data coverage.');
  }catch(e){renderError('todoData',e.message);}

  try{
    // 04 Discovery stays Suggested unless the DB contains explicit task-completion evidence.
    // Current schema does not link a discovered group to a specific discovery recommendation, so do not fake Done.
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
    discovery=[...familyWins.values()]
      .sort((a,b)=>(b.wins-a.wins)||(b.comments-a.comments))
      .slice(0,3)
      .map(x=>{
        const source=x.best.group;
        return card({
          kind:'discovery',status:'suggested',
          kicker:'DISCOVERY',
          title:`Tìm thêm 5 group · ${familyKeyword[x.family]||familyKeyword['Khác']}`,
          where:'US audience · women 40+ · comment thật',
          sourceGroup:groupRef(source),
          why:`${x.family} đang có ${x.wins} winner signal. DNA nổi bật: ${[...x.dnas].slice(0,3).join(', ')||'chưa gắn DNA'}. Dùng group nguồn làm mẫu audience. Chưa đánh dấu Done tự động vì DB chưa liên kết group mới với recommendation cụ thể.`
        });
      });
    $('todoDiscovery').innerHTML=discovery.length?discovery.map(renderCard).join(''):empty('Chưa có winner đủ rõ để định hướng tìm group mới.');
  }catch(e){renderError('todoDiscovery',e.message);}

    const freshSections={
      kpi:kpiTasks,
      cross:crossTasks,
      data:dataTasks,
      discovery
    };
    const mergedSections={};
    for(const key of ['kpi','cross','data','discovery']){
      mergedSections[key]=syncFailedSections.has(key)
        ? (Array.isArray(cached?.sections?.[key])?cached.sections[key]:[])
        : freshSections[key];
    }
    const snapshot={
      version:4,
      syncedAt:new Date().toISOString(),
      date:today,
      sections:mergedSections
    };
    localStorage.setItem(CACHE_KEY,JSON.stringify(snapshot));
    if(syncHadError){
      renderSnapshot(snapshot);
      updateSyncMeta(snapshot,'Partial sync · đã giữ dữ liệu cũ cho block lỗi');
    }else{
      updateSyncMeta(snapshot);
    }
  }catch(e){
    console.error('Sync Todo failed:',e);
    if(cached){
      renderSnapshot(cached);
      updateSyncMeta(cached,'Sync failed · đang giữ snapshot cũ');
    }else{
      ['todoKpi','todoCross','todoData','todoDiscovery'].forEach(id=>{
        const el=$(id);if(el)el.innerHTML=empty('Sync failed: '+e.message);
      });
      updateSyncMeta(null,'Sync failed');
    }
  }finally{
    if(btn){btn.disabled=false;btn.classList.remove('is-syncing');btn.textContent='↻ Sync Todo';}
  }
}

renderCachedSnapshot();
$('syncTodoBtn')?.addEventListener('click',syncTodo);
