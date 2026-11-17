import { loadIntelligence, esc, groupAction } from './intelligence.js';
const $=id=>document.getElementById(id);
try{
  const d=await loadIntelligence();
  $('fitRows').innerHTML=d.groups.map(g=>'<tr><td class="identity-cell"><strong>'+esc(g.group_code)+' · '+esc(g.group_name)+'</strong></td><td><span class="tier-chip tier-'+esc(g.tier)+'">'+esc(g.tier.toUpperCase())+'</span></td><td>'+g.posts+'</td><td>'+g.avgEngagement+'</td><td>'+esc(g.topFamily?.family||'Chưa rõ')+'</td><td>'+esc(groupAction(g))+'</td></tr>').join('');

  const core=d.groups.filter(g=>g.tier==='s'||g.tier==='a').slice(0,6);
  $('priorityGroups').innerHTML=core.map(g=>'<article><div><strong>'+esc(g.group_code)+' · '+esc(g.group_name)+'</strong><span>'+g.posts+' bài · trung bình '+g.avgEngagement+' · hợp '+esc(g.topFamily?.family||'chưa rõ')+'</span></div><b>'+esc(groupAction(g))+'</b></article>').join('')||'<p class="analysis-empty">Chưa có nhóm S/A.</p>';

  $('similarGroups').innerHTML=core.slice(0,4).map(g=>'<article><div><strong>'+esc(g.group_code)+' · '+esc(g.group_name)+'</strong><span>Dùng audience, chủ đề và kiểu tương tác của nhóm này làm mẫu khi tìm thêm.</span></div></article>').join('');
  if(core.length<6)$('similarGroups').insertAdjacentHTML('beforeend','<article><div><strong>Nên tìm thêm 5–10 nhóm</strong><span>Ưu tiên nữ U40+, đúng chủ đề và có bình luận thật; không chỉ nhìn số thành viên.</span></div></article>');
}catch(e){document.querySelector('.analysis-main').innerHTML='<section class="analysis-section"><p class="analysis-empty">'+esc(e.message)+'</p></section>';}