import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});
const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const groupCode = params.get('group');
const dateKey = params.get('date');

function esc(s=''){ return String(s ?? '').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
function fmtNumber(v){ return v === null || v === undefined ? '—' : new Intl.NumberFormat('en-US').format(v); }
function fmtTime(v){
  if(!v) return '—';
  return new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Ho_Chi_Minh',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(new Date(v));
}
function startOfDateVN(key){
  const [y,m,d]=key.split('-').map(Number);
  return new Date(Date.UTC(y,m-1,d,-7,0,0));
}
function statusClass(s){
  if(s==='approved') return 'met';
  if(s==='rejected'||s==='removed') return 'none';
  if(s==='pending_approval') return 'under';
  return 'neutral';
}

async function load(){
  if(!dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)){
    $('pageTitle').textContent='Invalid date';
    $('emptyState').classList.remove('hidden');
    return;
  }
  $('refreshBtn').disabled=true;
  try{
    const start=startOfDateVN(dateKey);
    const end=new Date(start.getTime()+86400000);
    let group=null;

    if(groupCode){
      const {data,error}=await supabase.from('facebook_groups')
        .select('id,group_code,group_name,group_url,approval_mode,posting_status,member_count,target_fit,join_status,source,notes,discovered_at,joined_at,created_at,updated_at')
        .eq('group_code',groupCode).maybeSingle();
      if(error) throw error;
      group=data;
      if(!group) throw new Error('Group not found');
    }

    let q=supabase.from('post_history')
      .select('*')
      .gte('submitted_at',start.toISOString())
      .lt('submitted_at',end.toISOString())
      .eq('time_is_signal',false)
      .order('submitted_at',{ascending:true});
    if(group) q=q.eq('group_id',group.id);
    const {data:posts,error:postErr}=await q;
    if(postErr) throw postErr;

    const list=(posts||[]).filter(p=>p.group_id!==null);
    $('pageTitle').textContent=group ? `${group.group_code} — ${group.group_name}` : `All posts — ${dateKey}`;
    $('pageSubtitle').textContent=group ? `${dateKey} · ${list.length} post${list.length===1?'':'s'} · approval: ${group.approval_mode}` : `${dateKey} · ${list.length} post${list.length===1?'':'s'}`;

    if(!list.length){
      $('postList').innerHTML='';
      $('emptyState').classList.remove('hidden');
      return;
    }
    $('emptyState').classList.add('hidden');

    const postIds=list.map(p=>p.id);
    const promptDbIds=[...new Set(list.map(p=>p.prompt_id).filter(Boolean))];
    const groupIds=[...new Set(list.map(p=>p.group_id).filter(Boolean))];

    const [promptRes,metricRes,groupsRes]=await Promise.all([
      promptDbIds.length ? supabase.from('prompts').select('*').in('id',promptDbIds) : Promise.resolve({data:[],error:null}),
      supabase.from('post_metrics').select('*').in('post_history_id',postIds).order('checked_at',{ascending:false}),
      !group && groupIds.length ? supabase.from('facebook_groups').select('id,group_code,group_name,group_url,approval_mode').in('id',groupIds) : Promise.resolve({data:[],error:null})
    ]);
    if(promptRes.error) throw promptRes.error;
    if(metricRes.error) throw metricRes.error;
    if(groupsRes.error) throw groupsRes.error;

    const prompts=new Map((promptRes.data||[]).map(p=>[p.id,p]));
    const groups=new Map((groupsRes.data||[]).map(g=>[g.id,g]));
    const latestMetric=new Map();
    for(const m of metricRes.data||[]){
      if(!latestMetric.has(m.post_history_id)) latestMetric.set(m.post_history_id,m);
    }

    $('postList').innerHTML=list.map(post=>{
      const prompt=prompts.get(post.prompt_id);
      const metric=latestMetric.get(post.id);
      const postGroup=group || groups.get(post.group_id);
      const title=prompt?.title || 'No title saved';
      const promptCode=post.prompt_code || prompt?.prompt_id || '—';
      return `
      <article class="post-card">
        <div class="post-card-head">
          <div>
            <div class="prompt-id">${esc(promptCode)}</div>
            <h2>${esc(title)}</h2>
            ${postGroup ? `<div class="post-group"><a href="${esc(postGroup.group_url||'#')}" target="_blank" rel="noopener">${esc(postGroup.group_code)} · ${esc(postGroup.group_name)}</a></div>` : ''}
          </div>
          <span class="status-chip ${statusClass(post.status)}">${esc(post.status)}</span>
        </div>

        <div class="metric-grid">
          <div><span>Likes</span><strong>${fmtNumber(metric?.likes_count)}</strong></div>
          <div><span>Reactions</span><strong>${fmtNumber(metric?.reactions_count)}</strong></div>
          <div><span>Comments</span><strong>${metric?.comments_is_lower_bound ? '≥' : ''}${fmtNumber(metric?.comments_count)}</strong></div>
          <div><span>Shares</span><strong>${fmtNumber(metric?.shares_count)}</strong></div>
          <div><span>Views</span><strong>${metric?.views_is_approx ? '~' : ''}${fmtNumber(metric?.views_count)}</strong></div>
        </div>

        <div class="meta-grid">
          <div><span>Posted</span><strong>${esc(fmtTime(post.submitted_at))}</strong></div>
          <div><span>Metric checked</span><strong>${esc(fmtTime(metric?.checked_at))}</strong></div>
          <div><span>Category</span><strong>${esc(prompt?.category || '—')}</strong></div>
          <div><span>DNA</span><strong>${esc(prompt?.dna || '—')}</strong></div>
          <div><span>Approval time</span><strong>${esc(fmtTime(post.approved_at))}</strong></div>
          <div><span>Mapping</span><strong>${esc(post.group_mapping_status || '—')}</strong></div>
        </div>

        ${prompt?.content ? `<details class="details-block"><summary>Prompt content</summary><div class="content-text">${esc(prompt.content)}</div></details>` : ''}
        <details class="details-block">
          <summary>All metadata</summary>
          <div class="raw-meta">
            <div><span>Post history ID</span><strong>${post.id}</strong></div>
            <div><span>Prompt DB ID</span><strong>${post.prompt_id ?? '—'}</strong></div>
            <div><span>Prompt status</span><strong>${esc(prompt?.status || '—')}</strong></div>
            <div><span>Approved at</span><strong>${esc(fmtTime(post.approved_at))}</strong></div>
            <div><span>Rejected at</span><strong>${esc(fmtTime(post.rejected_at))}</strong></div>
            <div><span>Removed at</span><strong>${esc(fmtTime(post.removed_at))}</strong></div>
            <div><span>Time is signal</span><strong>${post.time_is_signal ? 'yes' : 'no'}</strong></div>
            <div><span>Post notes</span><strong>${esc(post.notes || '—')}</strong></div>
            <div><span>Metric note</span><strong>${esc(metric?.metric_note || '—')}</strong></div>
            <div><span>Created</span><strong>${esc(fmtTime(post.created_at))}</strong></div>
            <div><span>Updated</span><strong>${esc(fmtTime(post.updated_at))}</strong></div>
          </div>
        </details>

        <div class="post-actions">
          ${post.post_url ? `<a class="secondary action-link" href="${esc(post.post_url)}" target="_blank" rel="noopener">Open Facebook Post ↗</a>` : '<span class="muted">No Facebook post URL saved</span>'}
        </div>
      </article>`;
    }).join('');
  }catch(e){
    $('postList').innerHTML=`<div class="empty-state">Could not load posts: ${esc(e.message)}</div>`;
  }finally{
    $('refreshBtn').disabled=false;
  }
}
$('refreshBtn').addEventListener('click',load);
await load();