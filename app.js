import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, DAILY_MIN_POSTS, DAILY_TARGET_POSTS } from './config.js';

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const $ = (id) => document.getElementById(id);
let selectedDay = 'today';
let allGroups = [];
let currentDateKey = '';
const NEW_GROUP_DAILY_TARGET = 5;

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
function approvalRank(mode){ return mode === 'auto' ? 0 : mode === 'manual' ? 1 : 2; }
function tierRank(tier){ return tier === 's' ? 0 : tier === 'a' ? 1 : tier === 'b' ? 2 : tier === 'c' ? 3 : 4; }

function showToast(message, type='ok'){
  let el = document.getElementById('toast');
  if(!el){
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.className = `toast show ${type}`;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.className = 'toast', 2200);
}

function approvalSelect(group){
  return `<select class="approval-select ${esc(group.approval_mode)}" data-action="approval" data-group-id="${group.id}" data-current="${esc(group.approval_mode)}" aria-label="Approval mode for ${esc(group.group_name)}">
    <option value="auto" ${group.approval_mode==='auto'?'selected':''}>Auto</option>
    <option value="manual" ${group.approval_mode==='manual'?'selected':''}>Manual</option>
    <option value="unknown" ${group.approval_mode==='unknown'?'selected':''}>Unknown</option>
  </select>`;
}

async function updateApproval(selectEl){
  const groupId = Number(selectEl.dataset.groupId);
  const previous = selectEl.dataset.current;
  const next = selectEl.value;
  if(!groupId || next === previous) return;

  selectEl.disabled = true;
  const nowIso = new Date().toISOString();
  const patch = {approval_mode: next, updated_at: nowIso};
  if(next === 'manual'){
    patch.workflow_status = 'following_approval';
    patch.workflow_status_since = nowIso;
  }else{
    patch.workflow_status = 'active';
    patch.workflow_status_since = null;
  }

  const { data, error } = await supabase.from('facebook_groups')
    .update(patch)
    .eq('id', groupId)
    .select('id,approval_mode')
    .single();

  if(error || !data){
    selectEl.value = previous;
    selectEl.disabled = false;
    showToast(error?.message || 'Could not update approval', 'error');
    return;
  }

  selectEl.dataset.current = next;
  selectEl.className = `approval-select ${next}`;
  selectEl.disabled = false;
  showToast('Approval updated');
  await refresh();
}

function effectiveWorkflow(group){
  if(group.workflow_status === 'following_approval' && group.workflow_status_since){
    const ageMs = Date.now() - new Date(group.workflow_status_since).getTime();
    if(ageMs >= 48 * 3600_000) return 'review_48h';
  }
  return group.workflow_status || 'active';
}

function workflowState(group){
  const workflow = effectiveWorkflow(group);
  if(workflow === 'review_48h') return {rank:0,label:'Review',tip:'48h+ waiting approval',cls:'review',excluded:true};
  if(workflow === 'following_approval'){
    const hoursLeft = group.workflow_status_since
      ? Math.max(0, Math.ceil((48 * 3600_000 - (Date.now() - new Date(group.workflow_status_since).getTime())) / 3600_000))
      : null;
    return {rank:1,label:'Following',tip:hoursLeft === null ? 'Waiting approval' : `${hoursLeft}h left`,cls:'waiting',excluded:true};
  }
  return null;
}

function kpiState(count){
  if(count === 0) return {rank:2,label:'Not posted',cls:'idle',excluded:false};
  if(count < DAILY_MIN_POSTS) return {rank:3,label:`${DAILY_MIN_POSTS-count} more`,cls:'more',excluded:false};
  if(count <= DAILY_TARGET_POSTS) return {rank:4,label:'KPI met',cls:'met',excluded:false};
  return {rank:5,label:'Above',cls:'over',excluded:false};
}

function engagementStar(group){
  const tier=group.engagement_tier;
  if(tier==='s') return '<span class="group-tier tier-s" title="S · breakout" aria-label="S tier">★★★</span>';
  if(tier==='a') return '<span class="group-tier tier-a" title="A · strong engagement" aria-label="A tier">★★</span>';
  if(tier==='b') return '<span class="group-tier tier-b" title="B · light engagement" aria-label="B tier">★</span>';
  if(tier==='c') return '<span class="group-tier tier-c" title="C · tested, weak" aria-label="C tier">--</span>';
  return '<span class="group-tier tier-unranked" title="Chưa xếp hạng" aria-label="Chưa xếp hạng">◌</span>';
}

async function loadGroups(){
  const { data, error } = await supabase.from('facebook_groups')
    .select('id,group_code,group_name,group_url,approval_mode,posting_status,workflow_status,workflow_status_since,engagement_tier,created_at')
    .in('posting_status',['active','paused']);
  if(error) throw error;
  allGroups = data || [];
}

async function loadDay(day){
  const offset = day === 'today' ? 0 : day === 'yesterday' ? -1 : -2;
  const start = vnDayStart(offset);
  const end = vnDayStart(offset + 1);
  currentDateKey = vnDateKey(start);
  $('dateLabel').textContent = formatVnDate(start);

  const previousStart = vnDayStart(offset - 1);
  const [postsRes, previousPostsRes, pendingRes] = await Promise.all([
    supabase.from('post_history')
      .select('id,group_id,prompt_code,status,submitted_at,time_is_signal')
      .gte('submitted_at', start.toISOString())
      .lt('submitted_at', end.toISOString()),
    supabase.from('post_history')
      .select('id,group_id,status,submitted_at')
      .gte('submitted_at', previousStart.toISOString())
      .lt('submitted_at', start.toISOString()),
    supabase.from('post_history')
      .select('id,group_id,prompt_code,status,submitted_at')
      .eq('status','pending_approval')
      .order('submitted_at',{ascending:true})
  ]);
  if(postsRes.error) throw postsRes.error;
  if(previousPostsRes.error) throw previousPostsRes.error;
  if(pendingRes.error) throw pendingRes.error;

  const posts = postsRes.data || [];
  const previousPosts = (previousPostsRes.data || []).filter(p => p.group_id !== null);
  const previousPostIds = previousPosts.map(p => p.id);
  let previousMetrics = [];
  if(previousPostIds.length){
    const metricsRes = await supabase.from('post_metrics')
      .select('post_history_id,checked_at')
      .in('post_history_id', previousPostIds)
      .gte('checked_at', start.toISOString())
      .lt('checked_at', end.toISOString());
    if(metricsRes.error) throw metricsRes.error;
    previousMetrics = metricsRes.data || [];
  }
  const previousUpdatedIds = new Set(previousMetrics.map(m => m.post_history_id));

  const validPosts = posts.filter(p => p.group_id !== null);
  const byGroup = new Map();
  for(const p of validPosts){
    if(!byGroup.has(p.group_id)) byGroup.set(p.group_id, []);
    byGroup.get(p.group_id).push(p);
  }

  const activeGroups = allGroups.filter(g => g.posting_status === 'active');
  const pausedGroups = allGroups.filter(g => g.posting_status === 'paused');
  const activeGroupIds = new Set(activeGroups.map(g => g.id));
  const pendingPosts = (pendingRes.data || []).filter(p => p.group_id === null || activeGroupIds.has(p.group_id));
  const metricsPreviousPosts = previousPosts.filter(p => activeGroupIds.has(p.group_id) && p.status !== 'pending_approval');
  const previousUpdatedCount = metricsPreviousPosts.filter(p => previousUpdatedIds.has(p.id)).length;
  const eligibleGroups = activeGroups.filter(g => effectiveWorkflow(g) === 'active');
  const excludedGroups = activeGroups.filter(g => effectiveWorkflow(g) !== 'active');
  const eligibleIds = new Set(eligibleGroups.map(g => g.id));

  const countFor = (g) => byGroup.get(g.id)?.length || 0;
  const eligibleCount = eligibleGroups.length;
  const postCount = validPosts.length;
  const groupsPosted = eligibleGroups.filter(g => countFor(g) > 0).length;
  const groupsAtMin = eligibleGroups.filter(g => countFor(g) >= DAILY_MIN_POSTS).length;
  const postsStillNeeded = eligibleGroups.reduce((sum,g) => sum + Math.max(0, DAILY_MIN_POSTS - countFor(g)), 0);
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
  $('kpiRange').textContent = `${DAILY_TARGET_POSTS} posts / active KPI group`;

  // Growth panel: groups added to the DB during the selected VN day.
  const newGroups = activeGroups
    .filter(g => {
      if(!g.created_at) return false;
      const created = new Date(g.created_at);
      return created >= start && created < end;
    })
    .sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
  const newGroupCount = newGroups.length;
  const newGroupRemaining = Math.max(0, NEW_GROUP_DAILY_TARGET - newGroupCount);
  $('newGroupProgressText').textContent = `${newGroupCount} / ${NEW_GROUP_DAILY_TARGET}`;
  $('newGroupProgressBar').style.width = `${Math.min(100, newGroupCount / NEW_GROUP_DAILY_TARGET * 100)}%`;

  const growthGroupRow = g => `
    <article class="growth-group-row">
      <div>
        <strong>${esc(g.group_code)}</strong>
        <a href="${esc(g.group_url)}" target="_blank" rel="noopener">${esc(g.group_name)}</a>
      </div>
      ${engagementStar(g)}
    </article>`;

  $('newGroupsList').innerHTML = newGroups.length
    ? newGroups.map(growthGroupRow).join('')
    : '<div class="growth-empty">Không có group mới trong ngày này.</div>';

  const pendingAttention = pendingPosts.map(p => {
    const g = activeGroups.find(x => x.id === p.group_id);
    return {
      g,
      priority:-1,
      text:`Pending approval · ${p.prompt_code || 'Post'} · cần check`,
      label:g ? `${g.group_code} · ${g.group_name}` : (p.prompt_code || 'Post pending')
    };
  });

  const attention = [...pendingAttention, ...newGroups
    .map(g => {
      const count = countFor(g);
      const workflow = effectiveWorkflow(g);
      if(workflow !== 'active') return {g,priority:0,text:workflow==='review_48h'?'Đã chờ duyệt 48h+ · cần review':'Đang chờ duyệt · chưa cần đăng lại'};
      if(count === 0) return {g,priority:1,text:'Chưa có bài test trong ngày'};
      if(!g.engagement_tier) return {g,priority:2,text:`${count} bài · chưa đủ dữ liệu để xếp tier`};
      if(count < DAILY_MIN_POSTS) return {g,priority:3,text:`${count}/${DAILY_MIN_POSTS} bài KPI hôm nay`};
      return null;
    })
    .filter(Boolean)]
    .sort((a,b)=>a.priority-b.priority)
    .slice(0,3);

  $('growthAttention').innerHTML = attention.length
    ? attention.map(item => `<article class="growth-attention-row ${item.priority<0?'is-warning':''}"><div><strong>${esc(item.label || (item.g ? item.g.group_code+' · '+item.g.group_name : 'Pending approval'))}</strong><span>${esc(item.text)}</span></div></article>`).join('')
    : '<div class="growth-empty">Không có group mới nào cần xử lý thêm.</div>';

  const testedNewCount = newGroups.filter(g => countFor(g) > 0).length;
  const checklistItems = [
    {
      done: postsStillNeeded === 0,
      label: 'Đăng đủ KPI group hôm nay',
      detail: postsStillNeeded === 0 ? 'Đã hoàn thành' : `Còn ${postsStillNeeded} bài`
    },
    {
      done: metricsPreviousPosts.length === 0 || previousUpdatedCount === metricsPreviousPosts.length,
      label: 'Cập nhật số liệu các post hôm qua',
      detail: metricsPreviousPosts.length === 0
        ? 'Hôm qua không có post'
        : `${previousUpdatedCount}/${metricsPreviousPosts.length} post đã cập nhật hôm nay`
    },
    {
      done: pendingPosts.length === 0,
      label: 'Check post đang Pending approval',
      detail: pendingPosts.length === 0 ? 'Không còn post chờ duyệt' : `${pendingPosts.length} post cần follow`
    },
    {
      done: newGroupCount >= NEW_GROUP_DAILY_TARGET,
      label: 'Tìm đủ 5 group mới',
      detail: `${Math.min(newGroupCount, NEW_GROUP_DAILY_TARGET)}/${NEW_GROUP_DAILY_TARGET}`
    },
    {
      done: testedNewCount >= 2,
      label: 'Test ít nhất 2 group mới',
      detail: `${Math.min(testedNewCount, 2)}/2`
    },
    {
      done: excludedGroups.length === 0,
      label: 'Xử lý group đang Following / Review',
      detail: excludedGroups.length === 0 ? 'Không còn group chờ xử lý' : `${excludedGroups.length} group đang chờ`
    }
  ];

  $('growthChecklist').innerHTML = checklistItems.map(item => `
    <article class="growth-check-item ${item.done?'is-done':'is-pending'}">
      <span class="growth-check-mark" aria-hidden="true">${item.done?'✓':'-'}</span>
      <div><strong>${esc(item.label)}</strong><small>${esc(item.detail)}</small></div>
    </article>`
  ).join('');

  const pendingCountByGroup = new Map();
  for(const p of pendingPosts){
    if(p.group_id) pendingCountByGroup.set(p.group_id,(pendingCountByGroup.get(p.group_id)||0)+1);
  }

  const rows = activeGroups.map(g => {
    const count = countFor(g);
    const state = workflowState(g) || kpiState(count);
    const pendingCount = pendingCountByGroup.get(g.id) || 0;
    return {...g, count, state, pendingCount};
  }).sort((a,b) =>
    tierRank(a.engagement_tier) - tierRank(b.engagement_tier) ||
    approvalRank(a.approval_mode) - approvalRank(b.approval_mode) ||
    a.group_name.localeCompare(b.group_name, 'en', {sensitivity:'base'})
  );

  const rowHtml = (g) => {
    const postCell = g.count > 0
      ? `<a class="post-count-link" href="./posts.html?group=${encodeURIComponent(g.group_code)}&date=${encodeURIComponent(currentDateKey)}" title="View ${g.count} posts">${g.count}</a>`
      : '<strong>0</strong>';
    return `
      <tr class="${g.pendingCount?'home-group-pending':''}">
        <td class="group-cell" data-label="Group"><a class="group-code group-posts-link" href="./posts.html?group=${encodeURIComponent(g.group_code)}&date=${encodeURIComponent(currentDateKey)}" title="View report for ${esc(g.group_code)}">${esc(g.group_code)}</a><a class="group-name-link" href="${esc(g.group_url)}" target="_blank" rel="noopener">${esc(g.group_name)}</a>${engagementStar(g)}${g.pendingCount?`<span class="home-pending-badge">${g.pendingCount} pending</span>`:''}</td>
        <td data-label="Approval">${approvalSelect(g)}</td>
        <td data-label="Posts">${postCell}</td>
        <td data-label="Status" class="status ${g.state.cls} ${g.state.tip ? 'status-tip-target' : ''}" ${g.state.tip ? `data-tip="${esc(g.state.tip)}" tabindex="0"` : ''}><span class="status-label">${g.state.label}</span></td>
      </tr>`;
  };
  const priority=rows.filter(g=>g.engagement_tier==='s'||g.engagement_tier==='a');
  const signal=rows.filter(g=>g.engagement_tier==='b');
  const follow=rows.filter(g=>g.engagement_tier==='c'||!g.engagement_tier);
  $('priorityRows').innerHTML=priority.map(rowHtml).join('');
  $('signalRows').innerHTML=signal.map(rowHtml).join('');
  $('followRows').innerHTML=follow.map(rowHtml).join('');

  const pausedHtml = pausedGroups
    .sort((a,b) =>
      tierRank(a.engagement_tier) - tierRank(b.engagement_tier) ||
      a.group_name.localeCompare(b.group_name, 'en', {sensitivity:'base'})
    )
    .map(g => `
      <tr class="paused-group-row">
        <td class="group-cell" data-label="Group">
          <a class="group-code group-posts-link" href="./posts.html?group=${encodeURIComponent(g.group_code)}&date=${encodeURIComponent(currentDateKey)}" title="View posts for ${esc(g.group_code)}">${esc(g.group_code)}</a>
          <a class="group-name-link paused-group-name" href="${esc(g.group_url)}" target="_blank" rel="noopener">${esc(g.group_name)}</a>
          ${engagementStar(g)}
        </td>
        <td data-label="Approval"><span class="paused-muted">${esc(g.approval_mode || '—')}</span></td>
        <td data-label="Posts"><span class="paused-muted">—</span></td>
        <td data-label="Status" class="status paused"><span class="status-label">Paused</span></td>
        <td data-label="Action"><span class="paused-follow">Follow sau</span></td>
      </tr>`
    ).join('');
  $('pausedRows').innerHTML = pausedHtml || '<tr><td colspan="5" class="paused-empty">Không có group đang tạm dừng.</td></tr>';
}

async function refresh(){
  try{
    await loadGroups();
    await loadDay(selectedDay);
  }catch(e){
    alert(`Could not load dashboard: ${e.message}`);
  }
}

$('postsCard').addEventListener('click', () => {
  if(currentDateKey) location.href = `./posts.html?date=${encodeURIComponent(currentDateKey)}`;
});
$('groupsPanel').addEventListener('change', (e) => {
  const approval = e.target.closest('[data-action="approval"]');
  if(approval) updateApproval(approval);
});
document.querySelectorAll('.tab').forEach(btn => btn.addEventListener('click', async () => {
  selectedDay = btn.dataset.day;
  document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('active',b===btn));
  await loadDay(selectedDay);
}));

await refresh();