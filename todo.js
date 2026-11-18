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
function statusBadge(status){
  const map={
    done:['✓ Done','done'],
    progress:['In Progress','progress'],
    suggested:['Suggested','suggested']
  };
  const [label,cls]=map[status]||map.suggested;
  return `<span class="todo-status todo-status-${cls}">${label}</span>`;
}
function card({kind='default',status='suggested',kicker,title,where,why,meta=''}) {
  return {kind,status,kicker,title:title||'Chưa có nội dung',where,why,meta};
}
function renderCard(task={}) {
  const kind=task.kind||'default';
  const status=task.status||'suggested';
  const title=task.title||'Chưa có nội dung';
  return `<article class="todo-card todo-card-${esc(kind)} todo-card-state-${esc(status)}">
    <div class="todo-card-top">
      <div class="todo-card-tags">${statusBadge(status)}<span class="todo-kicker">${esc(task.kicker||'')}</span></div>
      ${task.meta?`<span class="todo-meta">${esc(task.meta)}</span>`:''}
    </div>
    <strong class="todo-card-title">${esc(title)}</strong>
    ${task.where?`<div class="todo-where"><span>WHERE</span><b>${esc(task.where)}</b></div>`:''}
    <div class="todo-why"><span>WHY</span><p>${esc(task.why||'')}</p></div>
  </article>`;
}
function empty(text){return `<div class="todo-empty">${esc(text)}</div>`;}
const CACHE_KEY='bebo.todo.snapshot.v2';
let syncHadError=false;

function renderError(id,message){
  syncHadError=true;
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
    return value&&value.version===2&&value.sections?value:null;
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
    if(!p.time_is_signal&&p.submitted_at&&vnDateKey(new Date(p.submitted_at))===today){
      if(!todayPostsByGroup.has(p.group_id))todayPostsByGroup.set(p.group_id,[]);
      todayPostsByGroup.get(p.group_id).push(p);
    }
  }

  // Use the stronger of the explicit Home counter and actual post_history rows.
  // This avoids marking a group incomplete when one source has already been updated.
  const groupCountToday=g=>{
    const manual=g.posts_count_date===today?Number(g.posts_count||0):0;
    const history=(todayPostsByGroup.get(g.id)||[]).length;
    return Math.max(manual,history);
  };

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
    // 01 KPI: keep every active KPI group visible so F5 can turn the same row into In Progress / ✓ Done.
    kpiTasks=eligible
      .map(g=>({g,count:groupCountToday(g)}))
      .sort((a,b)=>{
        const state=n=>n>=DAILY_MIN_POSTS?2:n>0?1:0;
        return state(a.count)-state(b.count)||(a.count-b.count)||(tierScore(b.g.engagement_tier)-tierScore(a.g.engagement_tier));
      })
      .map(({g,count})=>{
        const p=bestPromptForGroup(g);
        const remaining=Math.max(0,DAILY_MIN_POSTS-count);
        const status=count>=DAILY_MIN_POSTS?'done':count>0?'progress':'suggested';
        const dna=p?dnaIds(p.prompt?.dna).join(' + '):'';
        const title=status==='done'
          ? `${g.group_code} · KPI hôm nay đã đủ`
          : p?`${p.promptId} · ${safeQuote(p.prompt,105)}`:`${g.group_code} cần thêm content`;
        const why=status==='done'
          ? `Đã ghi nhận ${count}/${DAILY_MIN_POSTS} bài hôm nay từ dữ liệu hiện có.`
          : p
            ? `Đã ghi nhận ${count}/${DAILY_MIN_POSTS}. Còn ${remaining} bài; ${dna||'concept này'} có tín hiệu và chưa thấy test ở group này.`
            : `Đã ghi nhận ${count}/${DAILY_MIN_POSTS}. Còn ${remaining} bài; chưa có winner đủ rõ để auto-suggest content.`;
        return card({
          kind:'kpi',status,
          kicker:status==='done'?'KPI hoàn thành':`KPI · còn ${remaining}`,
          title,
          where:`${g.group_code} - ${shortGroup(g.group_name)}`,
          why,
          meta:g.approval_mode||''
        });
      });
    $('todoKpi').innerHTML=kpiTasks.length?kpiTasks.map(renderCard).join(''):empty('Không có group active trong KPI.');
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
          where:tested.slice(0,3).map(g=>`${g.group_code} - ${shortGroup(g.group_name)}`).join(' · '),
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
          where:`${target.group_code} - ${shortGroup(target.group_name)}`,
          why:`Concept đã thắng ở ${source?`${source.group_code} - ${shortGroup(source.group_name)}`:'group trước'} với ${fmt(best.comments)} comments · ${fmt(best.shares)} shares, nhưng hiện mới phủ ${c.groups.size} group.`,
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
      .map(g=>({g,n:(postsByGroup.get(g.id)||[]).filter(p=>!p.time_is_signal).length,gi:insightById.get(g.id)}))
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
          where:`${g.group_code} - ${shortGroup(g.group_name)}`,
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
          why:`${x.family} đang có ${x.wins} winner signal. DNA nổi bật: ${[...x.dnas].slice(0,3).join(', ')||'chưa gắn DNA'}. Dùng ${source?`${source.group_code} - ${shortGroup(source.group_name)}`:'group đang thắng'} làm mẫu audience. Chưa đánh dấu Done tự động vì DB chưa liên kết group mới với recommendation cụ thể.`
        });
      });
    $('todoDiscovery').innerHTML=discovery.length?discovery.map(renderCard).join(''):empty('Chưa có winner đủ rõ để định hướng tìm group mới.');
  }catch(e){renderError('todoDiscovery',e.message);}

    if(syncHadError)throw new Error('Một hoặc nhiều block không sync được.');
    const snapshot={
      version:2,
      syncedAt:new Date().toISOString(),
      date:today,
      sections:{
        kpi:kpiTasks,
        cross:crossTasks,
        data:dataTasks,
        discovery
      }
    };
    localStorage.setItem(CACHE_KEY,JSON.stringify(snapshot));
    updateSyncMeta(snapshot);
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
