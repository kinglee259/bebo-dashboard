import { loadIntelligence, esc, fmt, promptQuote, groupAction, promptAction, signalText } from './intelligence.js';
const $=id=>document.getElementById(id);
try{
  const d=await loadIntelligence();
  const winners=d.prompts.filter(p=>p.wins>0);
  const needMore=d.groups.filter(g=>g.posts<2);
  $('analysisKpis').innerHTML=[
    ['Bài đã theo dõi',d.totals.posts],
    ['Nhóm có dữ liệu',d.totals.groups],
    ['Winner signal',winners.length],
    ['Nhóm cần thêm dữ liệu',needMore.length]
  ].map(([k,v])=>'<article class="analysis-kpi"><span>'+esc(k)+'</span><strong>'+fmt(v)+'</strong></article>').join('');

  $('winnerRows').innerHTML=winners.slice(0,10).map(p=>{
    const quote=promptQuote(p.prompt,96);
    return '<tr><td class="identity-cell"><strong>'+esc(p.promptId)+'</strong><span>'+esc(quote)+'</span></td><td><strong class="result-main">'+fmt(p.comments)+' bình luận · '+fmt(p.shares)+' chia sẻ</strong><span class="result-sub">'+esc(signalText(p))+'</span></td><td>'+p.posts+' lần · '+p.groupsTested+' nhóm</td><td>'+esc(promptAction(p))+'</td></tr>';
  }).join('')||'<tr><td colspan="4" class="analysis-empty">Chưa có bài nào đủ tín hiệu.</td></tr>';

  $('groupRows').innerHTML=d.groups.slice(0,12).map(g=>'<tr><td class="identity-cell"><strong>'+esc(g.group_code)+' · '+esc(g.group_name)+'</strong></td><td><span class="tier-chip tier-'+esc(g.tier)+'">'+esc(g.tier.toUpperCase())+'</span></td><td>'+g.posts+'</td><td>'+g.avgEngagement+'</td><td>'+esc(g.topFamily?.family||'Chưa rõ')+'</td><td>'+esc(groupAction(g))+'</td></tr>').join('');

  const actions=[];
  const top=d.prompts[0];
  const core=d.groups.filter(g=>g.tier==='s'||g.tier==='a');
  const weak=d.groups.filter(g=>g.posts>=2&&g.avgEngagement<5);
  if(top)actions.push('<strong>'+esc(top.promptId)+' · '+esc(promptQuote(top.prompt,96))+'</strong><span>'+esc(promptAction(top))+'.</span>');
  if(core.length)actions.push('<strong>Ưu tiên '+core.slice(0,4).map(g=>esc(g.group_code)+' · '+esc(g.group_name)).join(', ')+'</strong><span>Dùng các bài đã có tín hiệu tốt trước.</span>');
  if(needMore.length)actions.push('<strong>'+needMore.slice(0,4).map(g=>esc(g.group_code)+' · '+esc(g.group_name)).join(', ')+'</strong><span>Mỗi nhóm cần thêm 2–3 bài trước khi kết luận.</span>');
  if(weak.length)actions.push('<strong>'+weak.slice(0,4).map(g=>esc(g.group_code)+' · '+esc(g.group_name)).join(', ')+'</strong><span>Giảm ưu tiên cho tới khi có bài test mới tốt hơn.</span>');
  if(core.length<6)actions.push('<strong>Tìm thêm 5–10 nhóm tương tự nhóm S/A hiện tại</strong><span>Ưu tiên đúng audience và có nhiều bình luận thật, không chỉ nhìn số thành viên.</span>');
  $('nextActions').innerHTML=actions.slice(0,5).map((x,i)=>'<article><b>'+(i+1)+'</b><div>'+x+'</div></article>').join('');
}catch(e){
  document.querySelector('.analysis-main').innerHTML='<section class="analysis-section"><p class="analysis-empty">'+esc(e.message)+'</p></section>';
}