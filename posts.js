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
  return new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Ho_Chi_Minh',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(v));
}
function startOfDateVN(key){
  const [y,m,d]=key.split('-').map(Number);
  return new Date(Date.UTC(y,m-1,d,-7,0,0));
}
function displayStatus(post, group){
  if(post.status === 'approved') return {label:'Approved',cls:'met'};
  if(post.status === 'pending_approval') return {label:'Pending approval',cls:'under'};
  if(post.status === 'rejected') return {label:'Rejected',cls:'none'};
  if(post.status === 'removed') return {label:'Removed',cls:'none'};
  if(post.status === 'submitted' && group?.approval_mode === 'manual') return {label:'Pending approval',cls:'under'};
  if(post.status === 'submitted') return {label:'Submitted',cls:'neutral'};
  return {label:post.status || '—',cls:'neutral'};
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
        .select('id,group_code,group_name,group_url,approval_mode,posting_status')
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
    $('pageTitle').textContent=group ? `${group.group_code} — ${group.group_name}` : `Posts — ${dateKey}`;
    $('pageSubtitle').textContent=group ? `${dateKey} · ${list.length} post${list.length===1?'':'s'} · ${group.approval_mode}` : `${list.length} post${list.length===1?'':'s'}`;

    if(!list.length){
      $('postList').innerHTML='';
      $('emptyState').classList.remove('hidden');
      return;
    }
    $('emptyState').classList.add('hidden');

    const postIds=list.map(p=>p.id);
    const promptDbIds=[...new Set(list.map(p=>p.prompt_id).filter(Boolean))];
    const promptCodes=[...new Set(list.map(p=>p.prompt_code).filter(Boolean))];
    const groupIds=[...new Set(list.map(p=>p.group_id).filter(Boolean))];

    const [promptIdRes,promptCodeRes,metricRes,groupsRes]=await Promise.all([
      promptDbIds.length ? supabase.from('prompts').select('*').in('id',promptDbIds) : Promise.resolve({data:[],error:null}),
      promptCodes.length ? supabase.from('prompts').select('*').in('prompt_id',promptCodes) : Promise.resolve({data:[],error:null}),
      supabase.from('post_metrics').select('*').in('post_history_id',postIds).order('checked_at',{ascending:false}),
      !group && groupIds.length ? supabase.from('facebook_groups').select('id,group_code,group_name,group_url,approval_mode').in('id',groupIds) : Promise.resolve({data:[],error:null})
    ]);

    for(const r of [promptIdRes,promptCodeRes,metricRes,groupsRes]) if(r.error) throw r.error;

    const promptById=new Map([...(promptIdRes.data||[]),...(promptCodeRes.data||[])].map(p=>[p.id,p]));
    const promptByCode=new Map([...(promptIdRes.data||[]),...(promptCodeRes.data||[])].map(p=>[p.prompt_id,p]));
    const groups=new Map((groupsRes.data||[]).map(g=>[g.id,g]));
    const latestMetric=new Map();
    for(const m of metricRes.data||[]) if(!latestMetric.has(m.post_history_id)) latestMetric.set(m.post_history_id,m);

    $('postList').innerHTML=list.map(post=>{
      const prompt=promptById.get(post.prompt_id) || promptByCode.get(post.prompt_code);
      const metric=latestMetric.get(post.id);
      const postGroup=group || groups.get(post.group_id);
      const status=displayStatus(post,postGroup);
      const title=prompt?.title || 'Title not saved yet';
      const promptCode=post.prompt_code || prompt?.prompt_id || '—';

      const image = prompt?.image_url
        ? `<img src="${esc(prompt.image_url)}" alt="" loading="lazy" />`
        : '<div class="post-thumb-empty">NO IMAGE</div>';

      return `
      <article class="post-card content-first-card">
        <div class="content-first-layout">
          <div class="post-thumb">${image}</div>

          <div class="post-main">
            <div class="content-first-head">
              <div>
                <span class="prompt-id">${esc(promptCode)}</span>
                <h2>${esc(title)}</h2>
              </div>
              <span class="status-chip ${status.cls}">${esc(status.label)}</span>
            </div>

            ${prompt?.dna ? `<div class="viral-dna"><span>VIRAL DNA</span><strong>${esc(prompt.dna)}</strong></div>` : ''}

            <div class="compact-subline">
              ${postGroup ? `<a href="${esc(postGroup.group_url||'#')}" target="_blank" rel="noopener">${esc(postGroup.group_code)} · ${esc(postGroup.group_name)}</a>` : ''}
              <span>${esc(fmtTime(post.submitted_at))}</span>
              ${prompt?.category ? `<span>${esc(prompt.category)}</span>` : ''}
            </div>

            <div class="micro-metrics">
              <span>👍 ${fmtNumber(metric?.likes_count)}</span>
              <span>❤️ ${fmtNumber(metric?.reactions_count)}</span>
              <span>💬 ${metric?.comments_is_lower_bound ? '≥' : ''}${fmtNumber(metric?.comments_count)}</span>
              <span>↗ ${fmtNumber(metric?.shares_count)}</span>
              <span>👁 ${metric?.views_is_approx ? '~' : ''}${fmtNumber(metric?.views_count)}</span>
            </div>

            <div class="compact-actions">
              ${post.post_url ? `<a class="text-link" href="${esc(post.post_url)}" target="_blank" rel="noopener">Facebook ↗</a>` : ''}
              ${prompt?.content ? '<details class="inline-details"><summary>Prompt</summary><div class="content-text">'+esc(prompt.content)+'</div></details>' : ''}
              <details class="inline-details">
                <summary>Meta</summary>
                <div class="raw-meta compact-raw-meta">
                  <div><span>Status</span><strong>${esc(status.label)}</strong></div>
                  <div><span>Approval mode</span><strong>${esc(postGroup?.approval_mode || '—')}</strong></div>
                  <div><span>Approved at</span><strong>${esc(fmtTime(post.approved_at))}</strong></div>
                  <div><span>Rejected at</span><strong>${esc(fmtTime(post.rejected_at))}</strong></div>
                  <div><span>Removed at</span><strong>${esc(fmtTime(post.removed_at))}</strong></div>
                  <div><span>Post notes</span><strong>${esc(post.notes || '—')}</strong></div>
                  <div><span>Metric note</span><strong>${esc(metric?.metric_note || '—')}</strong></div>
                </div>
              </details>
            </div>
          </div>
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