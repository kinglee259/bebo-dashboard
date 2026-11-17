import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, DAILY_MIN_POSTS, DAILY_TARGET_POSTS } from './config.js';

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const $ = (id) => document.getElementById(id);
let selectedDay = 'today';
let allGroups = [];

function vnDayStart(dayOffset = 0) {
  const now = new Date();
  const vnNow = new Date(now.getTime() + 7 * 3600_000);
  const y = vnNow.getUTCFullYear();
  const m = vnNow.getUTCMonth();
  const d = vnNow.getUTCDate() + dayOffset;
  return new Date(Date.UTC(y, m, d, -7, 0, 0));
}

function formatVnDate(date) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh', weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric'
  }).format(date);
}

function esc(s='') { return String(s).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }

function approvalRank(mode){ return mode === 'auto' ? 0 : mode === 'unknown' ? 1 : 2; }
function kpiState(count){
  if(count === 0) return {rank:0,label:'Not posted',cls:'none'};
  if(count < DAILY_MIN_POSTS) return {rank:1,label:`Need ${DAILY_MIN_POSTS-count} more`,cls:'under'};
  if(count <= DAILY_TARGET_POSTS) return {rank:2,label:'KPI met',cls:'met'};
  return {rank:3,label:'Above target',cls:'over'};
}

async function loadGroups(){
  const { data, error } = await supabase.from('facebook_groups')
    .select('id,group_code,group_name,group_url,approval_mode,posting_status')
    .eq('posting_status','active');
  if(error) throw error;
  allGroups = data || [];
}

async function loadDay(day){
  const offset = day === 'today' ? 0 : -1;
  const start = vnDayStart(offset);
  const end = vnDayStart(offset + 1);
  $('dateLabel').textContent = `${day === 'today' ? 'Today' : 'Yesterday'} · ${formatVnDate(start)}`;

  const { data: posts, error } = await supabase.from('post_history')
    .select('id,group_id,prompt_code,status,submitted_at,time_is_signal')
    .gte('submitted_at', start.toISOString())
    .lt('submitted_at', end.toISOString())
    .eq('time_is_signal', false);
  if(error) throw error;

  const validPosts = (posts || []).filter(p => p.group_id !== null);
  const byGroup = new Map();
  for(const p of validPosts){
    if(!byGroup.has(p.group_id)) byGroup.set(p.group_id, []);
    byGroup.get(p.group_id).push(p);
  }

  const activeCount = allGroups.length;
  const postCount = validPosts.length;
  const groupsPosted = [...byGroup.keys()].length;
  const groupsAtMin = allGroups.filter(g => (byGroup.get(g.id)?.length || 0) >= DAILY_MIN_POSTS).length;
  const minGoal = activeCount * DAILY_MIN_POSTS;
  const maxGoal = activeCount * DAILY_TARGET_POSTS;
  const pending = validPosts.filter(p => p.status === 'pending_approval').length;
  const approved = validPosts.filter(p => p.status === 'approved').length;
  const rejected = validPosts.filter(p => p.status === 'rejected').length;

  $('postsCount').textContent = postCount;
  $('postsGoal').textContent = `${minGoal}–${maxGoal} target range`;
  $('groupsPosted').textContent = `${groupsPosted}/${activeCount}`;
  $('groupsRemaining').textContent = `${Math.max(0,activeCount-groupsPosted)} groups not posted`;
  $('groupsAtKpi').textContent = `${groupsAtMin}/${activeCount}`;
  $('groupsAtKpiPct').textContent = `${activeCount ? Math.round(groupsAtMin/activeCount*100) : 0}% at minimum KPI`;
  $('approvalCount').textContent = `${approved} approved`;
  $('approvalBreakdown').textContent = `${pending} pending · ${rejected} rejected`;
  $('progressText').textContent = `${postCount} / ${minGoal}`;
  $('progressBar').style.width = `${Math.min(100, minGoal ? postCount/minGoal*100 : 0)}%`;
  $('kpiRange').textContent = `${DAILY_MIN_POSTS}–${DAILY_TARGET_POSTS} posts / group`;

  const rows = allGroups.map(g => {
    const count = byGroup.get(g.id)?.length || 0;
    return {...g, count, state:kpiState(count)};
  }).sort((a,b) => a.state.rank-b.state.rank || approvalRank(a.approval_mode)-approvalRank(b.approval_mode) || a.group_code.localeCompare(b.group_code,undefined,{numeric:true}));

  $('groupRows').innerHTML = rows.map(g => `
    <tr>
      <td class="group-cell"><span class="group-code">${esc(g.group_code)}</span><a href="${esc(g.group_url)}" target="_blank" rel="noopener">${esc(g.group_name)}</a></td>
      <td><span class="badge ${esc(g.approval_mode)}">${esc(g.approval_mode)}</span></td>
      <td><strong>${g.count}</strong></td>
      <td>${DAILY_MIN_POSTS}–${DAILY_TARGET_POSTS}</td>
      <td class="status ${g.state.cls}">${g.state.label}</td>
    </tr>`).join('');
}

async function refresh(){
  try{
    $('refreshBtn').disabled = true;
    await loadGroups();
    await loadDay(selectedDay);
  }catch(e){
    alert(`Could not load dashboard: ${e.message}`);
  }finally{
    $('refreshBtn').disabled = false;
  }
}

$('refreshBtn').addEventListener('click', refresh);
document.querySelectorAll('.tab').forEach(btn => btn.addEventListener('click', async () => {
  selectedDay = btn.dataset.day;
  document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('active',b===btn));
  await loadDay(selectedDay);
}));

await refresh();