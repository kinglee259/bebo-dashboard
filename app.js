import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, DAILY_MIN_POSTS, DAILY_TARGET_POSTS } from './config.js';

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const $ = (id) => document.getElementById(id);
let selectedDay = 'today';
let allGroups = [];
let currentDateKey = '';

function vnDayStart(dayOffset = 0) {
  const now = new Date();
  const vnNow = new Date(now.getTime() + 7 * 3600_000);
  const y = vnNow.getUTCFullYear();
  const m = vnNow.getUTCMonth();
  const d = vnNow.getUTCDate() + dayOffset;
  return new Date(Date.UTC(y, m, d, -7, 0, 0));
}

function vnDateKey(date) {
  const shifted = new Date(date.getTime() + 7 * 3600_000);
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth()+1).padStart(2,'0')}-${String(shifted.getUTCDate()).padStart(2,'0')}`;
}

function formatVnDate(date) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh', weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric'
  }).format(date);
}

function esc(s='') { return String(s).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
function approvalRank(mode){ return mode === 'auto' ? 0 : mode === 'unknown' ? 1 : 2; }

function effectiveWorkflow(group){
  if(group.workflow_status === 'following_approval' && group.workflow_status_since){
    const ageMs = Date.now() - new Date(group.workflow_status_since).getTime();
    if(ageMs >= 48 * 3600_000) return 'review_48h';
  }
  return group.workflow_status || 'active';
}

function workflowState(group){
  const workflow = effectiveWorkflow(group);
  if(workflow === 'review_48h') return {rank:0,label:'Review 48h+',cls:'none',excluded:true};
  if(workflow === 'following_approval'){
    const hours = group.workflow_status_since
      ? Math.max(0, Math.floor((Date.now() - new Date(group.workflow_status_since).getTime()) / 3600_000))
      : null;
    return {rank:1,label:hours === null ? 'Following approval' : `Following approval · ${hours}h`,cls:'under',excluded:true};
  }
  return null;
}

function kpiState(count){
  if(count === 0) return {rank:2,label:'Not posted',cls:'none',excluded:false};
  if(count < DAILY_MIN_POSTS) return {rank:3,label:`Need ${DAILY_MIN_POSTS-count} more`,cls:'under',excluded:false};
  if(count <= DAILY_TARGET_POSTS) return {rank:4,label:'KPI met',cls:'met',excluded:false};
  return {rank:5,label:'Above target',cls:'over',excluded:false};
}

async function loadGroups(){
  const { data, error } = await supabase.from('facebook_groups')
    .select('id,group_code,group_name,group_url,approval_mode,posting_status,workflow_status,workflow_status_since')
    .eq('posting_status','active');
  if(error) throw error;
  allGroups = data || [];
}

async function loadDay(day){
  const offset = day === 'today' ? 0 : -1;
  const start = vnDayStart(offset);
  const end = vnDayStart(offset + 1);
  currentDateKey = vnDateKey(start);
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

  const eligibleGroups = allGroups.filter(g => effectiveWorkflow(g) === 'active');
  const excludedGroups = allGroups.filter(g => effectiveWorkflow(g) !== 'active');
  const eligibleIds = new Set(eligibleGroups.map(g => g.id));

  const eligibleCount = eligibleGroups.length;
  const postCount = validPosts.length;
  const groupsPosted = [...byGroup.keys()].filter(id => eligibleIds.has(id)).length;
  const groupsAtMin = eligibleGroups.filter(g => (byGroup.get(g.id)?.length || 0) >= DAILY_MIN_POSTS).length;
  const postsStillNeeded = eligibleGroups.reduce((sum,g) => sum + Math.max(0, DAILY_MIN_POSTS - (byGroup.get(g.id)?.length || 0)), 0);
  const minGoal = eligibleCount * DAILY_MIN_POSTS;
  const maxGoal = eligibleCount * DAILY_TARGET_POSTS;
  const effectiveProgress = minGoal - postsStillNeeded;

  $('postsCount').textContent = postCount;
  $('postsGoal').textContent = excludedGroups.length
    ? `${minGoal}–${maxGoal} KPI target · ${excludedGroups.length} following/review excluded`
    : `${minGoal}–${maxGoal} KPI target · click to view`;
  $('groupsPosted').textContent = `${groupsPosted}/${eligibleCount}`;
  $('groupsRemaining').textContent = `${Math.max(0,eligibleCount-groupsPosted)} KPI groups not posted`;
  $('groupsAtKpi').textContent = `${groupsAtMin}/${eligibleCount}`;
  $('groupsAtKpiPct').textContent = `${eligibleCount ? Math.round(groupsAtMin/eligibleCount*100) : 0}% of KPI groups`;
  $('postsNeeded').textContent = postsStillNeeded;
  $('postsNeededHint').textContent = postsStillNeeded === 0 ? 'minimum KPI complete' : 'excluding following/review groups';
  $('progressText').textContent = `${effectiveProgress} / ${minGoal}`;
  $('progressBar').style.width = `${Math.min(100, minGoal ? effectiveProgress/minGoal*100 : 0)}%`;
  $('kpiRange').textContent = `${DAILY_MIN_POSTS}–${DAILY_TARGET_POSTS} posts / active KPI group`;

  const rows = allGroups.map(g => {
    const count = byGroup.get(g.id)?.length || 0;
    const state = workflowState(g) || kpiState(count);
    return {...g, count, state};
  }).sort((a,b) => a.state.rank-b.state.rank || approvalRank(a.approval_mode)-approvalRank(b.approval_mode) || a.group_code.localeCompare(b.group_code,undefined,{numeric:true}));

  $('groupRows').innerHTML = rows.map(g => {
    const postCell = g.count > 0
      ? `<a class="post-count-link" href="./posts.html?group=${encodeURIComponent(g.group_code)}&date=${encodeURIComponent(currentDateKey)}" title="View ${g.count} posts">${g.count}</a>`
      : '<strong>0</strong>';
    const kpiCell = g.state.excluded ? '<span class="kpi-excluded">Excluded</span>' : `${DAILY_MIN_POSTS}–${DAILY_TARGET_POSTS}`;
    return `
      <tr>
        <td class="group-cell"><span class="group-code">${esc(g.group_code)}</span><a href="${esc(g.group_url)}" target="_blank" rel="noopener">${esc(g.group_name)}</a></td>
        <td><span class="badge ${esc(g.approval_mode)}">${esc(g.approval_mode)}</span></td>
        <td>${postCell}</td>
        <td>${kpiCell}</td>
        <td class="status ${g.state.cls}">${g.state.label}</td>
      </tr>`;
  }).join('');
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

$('postsCard').addEventListener('click', () => {
  if(currentDateKey) location.href = `./posts.html?date=${encodeURIComponent(currentDateKey)}`;
});
$('refreshBtn').addEventListener('click', refresh);
document.querySelectorAll('.tab').forEach(btn => btn.addEventListener('click', async () => {
  selectedDay = btn.dataset.day;
  document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('active',b===btn));
  await loadDay(selectedDay);
}));

await refresh();