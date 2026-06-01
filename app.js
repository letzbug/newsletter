const DATA_URL = 'https://raw.githubusercontent.com/letzbug/signage/bd15a5eddb1f8b2d7201c0db854fe107c97cd09e/data/trainings.json';
const HERO_IMAGE = 'assets/Newsletter_Header.png';
const STORAGE_KEY = 'newsletter_unipop_v3';

let allCourses = [];
let selectedIds = new Set();
let courseImages = {}; // id -> dataURL
let customBlocks = [];

const $ = (id) => document.getElementById(id);
const clean = (v) => (v ?? '').toString().trim();
const esc = (s) => clean(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function first(obj, keys){ for(const k of keys){ if(clean(obj?.[k])) return clean(obj[k]); } return ''; }
function normalizeSpaces(s){ return clean(s).replace(/\s+/g,' '); }
function deepValues(obj){
  const out=[];
  const walk=(x)=>{ if(x==null) return; if(typeof x==='object'){ Object.values(x).forEach(walk); } else out.push(clean(x)); };
  walk(obj); return out;
}
function isUniPopCourse(raw){
  const flat = deepValues(raw).map(v => v.toLowerCase());
  return flat.includes('unipop') || flat.includes('info@unipop.lu') || flat.includes('université populaire') || flat.includes('universite populaire');
}
function parseDate(v){
  const s=clean(v); if(!s) return null;
  let m=s.match(/^(\d{4})-(\d{2})-(\d{2})/); if(m) return new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00`);
  m=s.match(/^(\d{2})[./-](\d{2})[./-](\d{4})/); if(m) return new Date(`${m[3]}-${m[2]}-${m[1]}T00:00:00`);
  const d=new Date(s); return isNaN(d) ? null : d;
}
function formatDate(v){ const d=parseDate(v); return d ? d.toLocaleDateString('fr-FR') : clean(v); }
function collectArray(data){
  if(Array.isArray(data)) return data;
  for(const key of ['data','trainings','cours','items','formations','results']) if(Array.isArray(data?.[key])) return data[key];
  const arrays = Object.values(data || {}).filter(Array.isArray);
  return arrays.sort((a,b)=>b.length-a.length)[0] || [];
}
function getCourseCode(raw){ return first(raw,['coursCode','coursId','codeCours','courseCode','code','idCours','id']) || 'SANS-CODE'; }
function normalizeCourse(raw, index){
  const code = getCourseCode(raw);
  const id = code || `course-${index}`;
  const title = normalizeSpaces(first(raw,['intitule','INTITULE','titre','Titre','title','nom','Nom','libelle','Libelle','name']));
  const category = normalizeSpaces(first(raw,['categorieNom','categorie','catégorie','category','theme','discipline','domaine']));
  const date = first(raw,['date','DEBUT','debut','start','dateDebut','date_debut','begin']);
  const place = normalizeSpaces(first(raw,['site','lieu','location','SALLE','salle','adresse','localisation'])) || 'Université Populaire Belval';
  const trainer = normalizeSpaces(first(raw,['formateur','Formateur','enseignant','trainer','intervenant','nomFormateur']));
  const desc = normalizeSpaces(first(raw,['description','resume','résumé','details','objectif','objectifs'])) || 'Découvrez ce nouveau cours proposé par UniPop.';
  const link = first(raw,['url','lien','link','permalink']) || 'https://www.unipop.lu';
  return { id, code, title: title || code, category, date, place, trainer, desc, link, raw };
}
function save(){ localStorage.setItem(STORAGE_KEY, JSON.stringify({selectedIds:[...selectedIds], courseImages, customBlocks, title:$('newsletterTitle').value, subtitle:$('newsletterSubtitle').value})); }
function load(){
  try{ const s=JSON.parse(localStorage.getItem(STORAGE_KEY)||'{}'); selectedIds=new Set(s.selectedIds||[]); courseImages=s.courseImages||{}; customBlocks=s.customBlocks||[]; if(s.title) $('newsletterTitle').value=s.title; if(s.subtitle) $('newsletterSubtitle').value=s.subtitle; }catch(e){}
}
async function loadCourses(){
  $('jsonStatus').textContent='Chargement du fichier JSON…';
  try{
    const res=await fetch(DATA_URL,{cache:'no-store'});
    if(!res.ok) throw new Error(res.status);
    const data=await res.json();
    const rawCourses=collectArray(data);
    allCourses=rawCourses.filter(isUniPopCourse).map(normalizeCourse).filter(c=>c.title);
    $('jsonStatus').textContent=`Données filtrées depuis la base UniPop`;
    fillCategories(); renderCourses(); renderPreview();
  }catch(err){
    $('jsonStatus').textContent='Erreur de chargement JSON. Vérifie le lien GitHub.';
    console.error(err);
  }
}
function fillCategories(){
  const select=$('categoryFilter'); const current=select.value; select.innerHTML='<option value="">Toutes catégories</option>';
  [...new Set(allCourses.map(c=>c.category).filter(Boolean))].sort().forEach(cat=>{ const o=document.createElement('option'); o.value=cat; o.textContent=cat; select.appendChild(o); });
  select.value=current;
}
function filteredCourses(){
  const q=$('searchInput').value.toLowerCase(); const cat=$('categoryFilter').value; const sort=$('sortSelect').value;
  let rows=allCourses.filter(c=>{
    const hit=[c.code,c.title,c.category,c.date,c.place,c.trainer].join(' ').toLowerCase().includes(q);
    return hit && (!cat || c.category===cat);
  });
  rows.sort((a,b)=>{
    if(sort==='title') return a.title.localeCompare(b.title,'fr');
    if(sort==='category') return a.category.localeCompare(b.category,'fr') || a.title.localeCompare(b.title,'fr');
    return (parseDate(a.date)?.getTime()||9999999999999) - (parseDate(b.date)?.getTime()||9999999999999);
  });
  return rows;
}
function renderCourses(){
  const list=$('coursesList'); list.innerHTML=''; const tpl=$('courseTpl'); const rows=filteredCourses();
  $('courseCount').textContent=`${rows.length} cours disponibles`; $('selectedCount').textContent=`${selectedIds.size} cours sélectionné${selectedIds.size>1?'s':''}`;
  rows.forEach(c=>{
    const node=tpl.content.firstElementChild.cloneNode(true);
    const checked=selectedIds.has(c.id); if(checked) node.classList.add('selected');
    const cb=node.querySelector('.course-check'); cb.checked=checked;
    node.querySelector('.course-code').textContent=c.code;
    node.querySelector('.course-title').textContent=c.title;
    const cat=node.querySelector('.category-badge'); cat.textContent=c.category||'UniPop';
    node.querySelector('.course-meta').textContent=[formatDate(c.date), c.place, c.trainer].filter(Boolean).join(' · ');
    const label=node.querySelector('.image-label'); if(courseImages[c.id]) label.classList.add('has-image');
    cb.addEventListener('change',()=>{ cb.checked ? selectedIds.add(c.id) : selectedIds.delete(c.id); save(); renderCourses(); renderPreview(); });
    node.querySelector('.image-input').addEventListener('change',(e)=>{
      const file=e.target.files?.[0]; if(!file) return;
      const reader=new FileReader(); reader.onload=()=>{ courseImages[c.id]=reader.result; selectedIds.add(c.id); save(); renderCourses(); renderPreview(); }; reader.readAsDataURL(file);
    });
    list.appendChild(node);
  });
}
function addBlock(type){
  const base={id:Date.now().toString(), type, title:'', text:'', button:'Découvrir', url:'https://www.unipop.lu'};
  if(type==='text') Object.assign(base,{title:'À savoir',text:'Votre texte ici…'});
  if(type==='imageText') Object.assign(base,{title:'Focus',text:'Votre texte ici…'});
  if(type==='news') Object.assign(base,{title:'Actualité',text:'Votre actualité ici…'});
  if(type==='event') Object.assign(base,{title:'Événement',text:'Informations pratiques de l’événement…'});
  if(type==='quote') Object.assign(base,{title:'Citation',text:'« Votre citation ici… »'});
  if(type==='button') Object.assign(base,{title:'',text:'',button:'Découvrir le catalogue'});
  customBlocks.push(base); save(); renderBlocksEditor(); renderPreview();
}
function renderBlocksEditor(){
  const el=$('blocksEditor'); el.innerHTML='';
  customBlocks.forEach(block=>{
    const div=document.createElement('div'); div.className='block-editor';
    div.innerHTML=`<header><span>${esc(block.type)}</span><button type="button">Supprimer</button></header>
      <input placeholder="Titre" value="${esc(block.title)}">
      <textarea placeholder="Texte">${esc(block.text)}</textarea>
      ${block.type==='button'?`<input class="button-text" placeholder="Texte du bouton" value="${esc(block.button)}"><input class="button-url" placeholder="Lien" value="${esc(block.url)}">`:''}`;
    div.querySelector('button').onclick=()=>{ customBlocks=customBlocks.filter(b=>b.id!==block.id); save(); renderBlocksEditor(); renderPreview(); };
    div.querySelector('input').oninput=e=>{ block.title=e.target.value; save(); renderPreview(); };
    div.querySelector('textarea').oninput=e=>{ block.text=e.target.value; save(); renderPreview(); };
    const bt=div.querySelector('.button-text'); if(bt) bt.oninput=e=>{ block.button=e.target.value; save(); renderPreview(); };
    const bu=div.querySelector('.button-url'); if(bu) bu.oninput=e=>{ block.url=e.target.value; save(); renderPreview(); };
    el.appendChild(div);
  });
}
function selectedCourses(){ return allCourses.filter(c=>selectedIds.has(c.id)); }
function courseImageHtml(c, forMail=false){
  const img=courseImages[c.id];
  if(img) return `<img src="${img}" alt="${esc(c.title)}" style="width:100%;height:100%;object-fit:cover;display:block;">`;
  return `<span>A</span>`;
}
function buildNewsletterHtml(mailjet=false){
  const title=esc($('newsletterTitle').value || 'Les nouveautés UniPop');
  const subtitle=esc($('newsletterSubtitle').value || 'Découvrez les cours et actualités à ne pas manquer.');
  const courses=selectedCourses();
  const courseBlocks=courses.map(c=> mailjet ? mailCourseBlock(c) : previewCourseBlock(c)).join('');
  const custom=customBlocks.map(b=>mailjet ? mailCustomBlock(b) : previewCustomBlock(b)).join('');
  return `
<div class="mail-container" style="max-width:860px;margin:0 auto;background:#ffffff;font-family:Arial,Helvetica,sans-serif;color:#071746;">
  <div class="mail-hero"><img src="${HERO_IMAGE}" alt="UniPop" style="display:block;width:100%;height:auto;border:0;"></div>
  <div class="mail-title" style="padding:26px 26px 10px;text-align:center;"><h2 style="margin:0;color:#0d1f59;font-size:28px;">${title}</h2><p style="margin:6px 0 0;color:#667085;">${subtitle}</p></div>
  <div class="section-title"><span>À la une</span></div>
  <div class="featured-list">${courseBlocks || '<div class="custom-block"><h3>Aucun cours sélectionné</h3><p>Sélectionnez les cours UniPop à gauche.</p></div>'}</div>
  ${custom}
  <div class="mail-footer"><div class="socials">● ● ●</div><div class="footer-links"><a href="mailto:info@unipop.lu">Contact</a><a href="https://www.unipop.lu">FAQ</a><a href="https://www.unipop.lu">unipop.lu</a></div></div>
</div>`.trim();
}
function previewCourseBlock(c){
  return `<article class="featured-course"><div class="featured-img">${courseImageHtml(c)}</div><div class="featured-content"><div class="preview-code">${esc(c.code)}</div><h3>${esc(c.title)}</h3><div class="mail-badges"><span class="mail-category">${esc(c.category||'UniPop')}</span><span class="mail-new">Nouveau</span></div><div class="course-info">📅 ${esc(formatDate(c.date))}</div><div class="course-info">📍 ${esc(c.place)}</div></div></article>`;
}
function mailCourseBlock(c){
  const img=courseImages[c.id] ? `<img src="${courseImages[c.id]}" alt="${esc(c.title)}" style="width:100%;height:198px;object-fit:cover;display:block;border-radius:9px;">` : `<div style="height:198px;border-radius:9px;background:#0d1f59;color:#ffffff;font-size:56px;font-weight:900;text-align:center;line-height:198px;">A</div>`;
  return `<div style="border:1px solid #e3e8f1;border-radius:12px;padding:14px;margin:0 28px 18px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td width="270" style="vertical-align:middle;padding-right:28px;">${img}</td><td style="vertical-align:middle;">
<h3 style="margin:0 0 10px;color:#0d1f59;font-size:23px;line-height:1.25;">${esc(c.title)}</h3>
<div style="margin:10px 0 18px;"><span style="background:#edf4ff;color:#073684;border-radius:999px;padding:7px 11px;font-size:13px;font-weight:900;text-transform:uppercase;">${esc(c.category||'UniPop')}</span> <span style="background:#fff5d7;color:#9b6600;border-radius:999px;padding:7px 11px;font-size:13px;font-weight:900;">Nouveau</span></div>
<p style="color:#42526d;margin:8px 0;">📅 ${esc(formatDate(c.date))}</p><p style="color:#42526d;margin:8px 0;">📍 ${esc(c.place)}</p>
</td></tr></table></div>`;
}
function previewCustomBlock(b){ if(b.type==='button') return `<div class="custom-block"><a href="${esc(b.url)}" style="display:inline-block;background:#0d1f59;color:white;text-decoration:none;border-radius:10px;padding:13px 18px;font-weight:900;">${esc(b.button)}</a></div>`; return `<div class="custom-block"><h3>${esc(b.title)}</h3><p>${esc(b.text)}</p></div>`; }
function mailCustomBlock(b){ if(b.type==='button') return `<div style="margin:20px 28px;padding:20px;border-radius:12px;background:#f8fbff;border:1px solid #e3e8f1;text-align:center;"><a href="${esc(b.url)}" style="display:inline-block;background:#0d1f59;color:#ffffff;text-decoration:none;border-radius:10px;padding:13px 18px;font-weight:900;">${esc(b.button)}</a></div>`; return `<div style="margin:20px 28px;padding:20px;border-radius:12px;background:#f8fbff;border:1px solid #e3e8f1;"><h3 style="margin:0 0 8px;color:#0d1f59;">${esc(b.title)}</h3><p style="margin:0;color:#344054;line-height:1.5;">${esc(b.text)}</p></div>`; }
function renderPreview(){ $('newsletterPreview').innerHTML=buildNewsletterHtml(false); }

$('searchInput').addEventListener('input',renderCourses);
$('categoryFilter').addEventListener('change',renderCourses);
$('sortSelect').addEventListener('change',renderCourses);
$('clearSelection').addEventListener('click',()=>{ selectedIds.clear(); save(); renderCourses(); renderPreview(); });
document.querySelectorAll('[data-block]').forEach(b=>b.addEventListener('click',()=>addBlock(b.dataset.block)));
$('newsletterTitle').addEventListener('input',()=>{save();renderPreview();});
$('newsletterSubtitle').addEventListener('input',()=>{save();renderPreview();});
$('saveBtn').addEventListener('click',()=>{save(); alert('Enregistré dans ce navigateur.');});
$('exportBtn').addEventListener('click',()=>{ $('exportHtml').value=buildNewsletterHtml(true); $('exportDialog').showModal(); });
$('previewBtn').addEventListener('click',()=>window.scrollTo({top:0,behavior:'smooth'}));
$('closeDialog').addEventListener('click',()=>$('exportDialog').close());
$('copyHtml').addEventListener('click',async()=>{ await navigator.clipboard.writeText($('exportHtml').value); alert('HTML copié.'); });

load(); renderBlocksEditor(); loadCourses();
