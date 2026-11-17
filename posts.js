import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';

const supabase=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const $=id=>document.getElementById(id);
const params=new URLSearchParams(location.search);
let selectedGroup=params.get('group')||'';
let selectedDate=params.get('date')||'';
let allPosts=[];
let groupsById=new Map();
let promptsById=new Map();
let promptsByCode=new Map();
let latestMetric=new Map();

const esc=(s='')=>String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const fmtNumber=v=>v===null||v===undefined?'—':new Intl.NumberFormat('en-US').format(v);
function vnDateStart(key){
  const [y,m,d]=String(key).split('-').map(Number);
  return new Date(Date.UTC(y,m-1,d,-7,0,0));
}
function fmtDateTime(value,isSignal){
  if(isSignal) return 'No time';
  if(!value) return '—';
  return new Intl.DateTimeFormat('en-GB',{
    timeZone:'Asia/Ho_Chi_Minh',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'
  }).format(new Date(value));
}

function render(){
  const list=selectedGroup
    ? allPosts.filter(p=>groupsById.get(p.group_id)?.group_code===selectedGroup)
    : allPosts;

  $('postsCountLabel').textContent=list.length+' post'+(list.length===1?'':'s');
  $('emptyState').classList.toggle('hidden',list.length>0);

  const activeGroup=[...groupsById.values()].find(g=>g.group_code===selectedGroup);
  $('postsCrumbGroup').classList.toggle('hidden',!activeGroup);
  $('postsCrumbGroupName').classList.toggle('hidden',!activeGroup);
  $('postsCrumbGroupName').textContent=activeGroup?.group_code||'';
  const panel=$('postRows')?.closest('.history-panel');
  if(panel){panel.className='history-panel'+(activeGroup?' tier-surface-'+(activeGroup.engagement_tier||'unranked'):'');}

  $('postRows').innerHTML=list.map(post=>{
    const group=groupsById.get(post.group_id);
    const prompt=promptsById.get(post.prompt_id)||promptsByCode.get(post.prompt_code);
    const metric=latestMetric.get(post.id);
    const code=post.prompt_code||prompt?.prompt_id||'—';
    const title=prompt?.title||'Title not saved yet';
    const groupHtml=group
      ? '<a href="'+esc(group.group_url||'#')+'" target="_blank" rel="noopener"><strong>'+esc(group.group_code)+'</strong><span>'+esc(group.group_name)+'</span></a>'
      : '—';
    const tier=group?.engagement_tier||'unranked';
    return '<tr class="history-row tier-row-'+esc(tier)+'">'+
      '<td data-label="Date / Time" class="history-time '+(post.time_is_signal?'signal-time':'')+'">'+esc(fmtDateTime(post.submitted_at,post.time_is_signal))+'</td>'+
      '<td data-label="Prompt" class="history-prompt"><strong>'+esc(code)+'</strong><span>'+esc(title)+'</span></td>'+
      '<td data-label="Group" class="history-group">'+groupHtml+'</td>'+
      '<td data-label="Like" class="history-metric">👍 '+fmtNumber(metric?.likes_count)+'</td>'+
      '<td data-label="Comment" class="history-metric">💬 '+(metric?.comments_is_lower_bound?'≥':'')+fmtNumber(metric?.comments_count)+'</td>'+
    '</tr>';
  }).join('');
}

async function load(){
  try{
    let postsQuery=supabase.from('post_history').select('id,group_id,prompt_id,prompt_code,submitted_at,time_is_signal');
    if(selectedDate){
      const start=vnDateStart(selectedDate);
      const end=new Date(start.getTime()+86400_000);
      postsQuery=postsQuery.gte('submitted_at',start.toISOString()).lt('submitted_at',end.toISOString()).eq('time_is_signal',false);
    }
    postsQuery=postsQuery.order('submitted_at',{ascending:false}).order('id',{ascending:false});

    const [postsRes,groupsRes,promptsRes]=await Promise.all([
      postsQuery,
      supabase.from('facebook_groups').select('id,group_code,group_name,group_url,posting_status,engagement_tier').order('group_code',{ascending:true}),
      supabase.from('prompts').select('id,prompt_id,title')
    ]);
    for(const r of [postsRes,groupsRes,promptsRes]) if(r.error) throw r.error;

    const activeGroups=(groupsRes.data||[]).filter(g=>g.posting_status!=='left');
    const hiddenGroupIds=new Set((groupsRes.data||[]).filter(g=>g.posting_status==='left').map(g=>g.id));
    allPosts=(postsRes.data||[]).filter(p=>p.group_id!==null&&!hiddenGroupIds.has(p.group_id));
    groupsById=new Map(activeGroups.map(g=>[g.id,g]));
    promptsById=new Map((promptsRes.data||[]).map(p=>[p.id,p]));
    promptsByCode=new Map((promptsRes.data||[]).map(p=>[p.prompt_id,p]));

    const postIds=allPosts.map(p=>p.id);
    latestMetric=new Map();
    if(postIds.length){
      const {data,error}=await supabase.from('post_metrics')
        .select('*').in('post_history_id',postIds)
        .order('created_at',{ascending:false});
      if(error) throw error;
      for(const m of data||[]) if(!latestMetric.has(m.post_history_id)) latestMetric.set(m.post_history_id,m);
    }

    $('groupFilter').innerHTML='<option value="">All groups</option>'+
      [...groupsById.values()].map(g=>'<option value="'+esc(g.group_code)+'">'+esc(g.group_code)+' · '+esc(g.group_name)+'</option>').join('');
    if(selectedGroup && ![...groupsById.values()].some(g=>g.group_code===selectedGroup)) selectedGroup='';
    $('groupFilter').value=selectedGroup;
    $('dateFilter').value=selectedDate;
    render();
  }catch(e){
    $('postRows').innerHTML='<tr><td colspan="5">Could not load posts: '+esc(e.message)+'</td></tr>';
  }
}

$('groupFilter').addEventListener('change',()=>{
  selectedGroup=$('groupFilter').value;
  const url=new URL(location.href);
  if(selectedGroup) url.searchParams.set('group',selectedGroup); else url.searchParams.delete('group');
  if(selectedDate) url.searchParams.set('date',selectedDate); else url.searchParams.delete('date');
  history.replaceState(null,'',url);
  render();
});
$('dateFilter').addEventListener('change',async()=>{
  selectedDate=$('dateFilter').value;
  const url=new URL(location.href);
  if(selectedDate) url.searchParams.set('date',selectedDate); else url.searchParams.delete('date');
  if(selectedGroup) url.searchParams.set('group',selectedGroup); else url.searchParams.delete('group');
  history.replaceState(null,'',url);
  await load();
});

await load();
