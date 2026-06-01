const DATA_URL = 'https://raw.githubusercontent.com/letzbug/signage/bd15a5eddb1f8b2d7201c0db854fe107c97cd09e/data/trainings.json';
const STORAGE_KEY = 'unipop_newsletter_builder_v1';
let allCourses = [];
let selectedIds = new Set();
let customBlocks = [];

const $ = (id) => document.getElementById(id);

function clean(v){ return (v ?? '').toString().trim(); }
function first(obj, keys){ for(const k of keys){ if(clean(obj?.[k])) return clean(obj[k]); } return ''; }
function normalizeDate(v){
  const s = clean(v); if(!s) return '';
  const m = s.match(/(\d{4})-(\d{2})-(\d{2})/); if(m) return `${m[3]}.${m[2]}.${m[1]}`;
  const d = new Date(s); if(!isNaN(d)) return d.toLocaleDateString('fr-FR');
  return s;
}
function dateValue(v){ const d = new Date(v); return isNaN(d) ? null : d; }
function flattenData(data){
  if(Array.isArray(data)) return data;
  for(const key of ['trainings','formations','cours','data','items','results']){
    if(Array.isArray(data?.[key])) return data[key];
  }
  return [];
}
function mapCourse(item, index){
  const title = first(item, ['titre','title','intitule','intituleCours','INITULE','nom','name','coursNom','formationTitre']) || `Cours ${index+1}`;
  const category = first(item, ['categorieNom','categorie','category','domaine','theme','famille','type']) || 'Autres';
  const start = first(item, ['debut','DEBUT','dateDebut','startDate','date','premiereSeance','firstDate']);
  const end = first(item, ['fin','FIN','dateFin','endDate']);
  const trainer = first(item, ['formateur','formateurNom','trainer','enseignant','intervenant','nomFormateur']);
  const location = first(item, ['site','lieu','location','SALLE','salle','commune','place']);
  const url = first(item, ['url','link','permalink','detailsUrl','registrationUrl']) || $('catalogUrl')?.value || 'https://www.unipop.lu';
  const desc = first(item, ['description','resume','summary','texte','contenu']) || `Découvrez ce cours ${category.toLowerCase()} proposé par UniPop.`;
  const id = first(item, ['id','uuid','code','trainingId','reference']) || btoa(unescape(encodeURIComponent(title + start + category))).slice(0,20);
  return { id, title, category, start, end, trainer, location, url, desc, raw:item };
}
function isNewCourse(course){
  const since = $('sinceDate').value;
  if(!since) return false;
  const d = dateValue(course.start || course.raw?.dateCreation || course.raw?.createdAt || course.raw?.modifiedAt);
  return d && d >= new Date(since + 'T00:00:00');
}
async function loadCourses(){
  $('jsonStatus').textContent = 'Chargement du fichier JSON…';
  try{
    const res = await fetch(DATA_URL, {cache:'no-store'});
    if(!res.ok) throw new Error(res.status + ' ' + res.statusText);
    const data = await res.json();
    allCourses = flattenData(data).map(mapCourse).filter(c => c.title);
    $('jsonStatus').textContent = `JSON chargé depuis GitHub.`;
    buildCategories(); renderCourses(); renderPreview();
  }catch(err){
    $('jsonStatus').textContent = 'Impossible de charger le JSON. Ouvre la page via GitHub Pages ou vérifie le lien.';
    console.error(err);
  }
}
function buildCategories(){
  const cats = [...new Set(allCourses.map(c=>c.category).filter(Boolean))].sort();
  $('categoryFilter').innerHTML = '<option value="">Toutes les catégories</option>' + cats.map(c=>`<option>${escapeHtml(c)}</option>`).join('');
}
function filteredCourses(){
  const q = $('searchInput').value.toLowerCase();
  const cat = $('categoryFilter').value;
  const mode = $('newFilter').value;
  return allCourses.filter(c=>{
    const blob = `${c.title} ${c.category} ${c.trainer} ${c.location} ${c.desc}`.toLowerCase();
    if(q && !blob.includes(q)) return false;
    if(cat && c.category !== cat) return false;
    if(mode === 'new' && !isNewCourse(c)) return false;
    if(mode === 'selected' && !selectedIds.has(c.id)) return false;
    return true;
  }).slice(0,300);
}
function renderCourses(){
  const list = $('coursesList');
  const items = filteredCourses();
  $('courseCount').textContent = `${items.length}`;
  list.innerHTML = items.map(c=>`
    <label class="course-item">
      <input type="checkbox" data-id="${escapeAttr(c.id)}" ${selectedIds.has(c.id)?'checked':''} />
      <span>
        <span class="course-title">${escapeHtml(c.title)}</span>
        <span class="course-meta">${escapeHtml([normalizeDate(c.start), c.location, c.trainer].filter(Boolean).join(' · '))}</span>
      </span>
      <span class="tag">${escapeHtml(c.category)}${isNewCourse(c)?'<span class="tag new-badge">Nouveau</span>':''}</span>
    </label>`).join('') || '<div class="course-item">Aucun cours trouvé.</div>';
  list.querySelectorAll('input[type="checkbox"]').forEach(cb=>{
    cb.addEventListener('change', e=>{ e.target.checked ? selectedIds.add(e.target.dataset.id) : selectedIds.delete(e.target.dataset.id); saveState(); renderPreview(); });
  });
}
function addBlock(type){
  const defaults = {
    text:{title:'Actualité UniPop', text:'Ajoutez ici votre texte.', url:''},
    imageText:{title:'Focus', text:'Ajoutez ici un bloc image + texte.', image:'', url:''},
    news:{title:'Inscriptions ouvertes', text:'Les inscriptions sont ouvertes pour les prochains cours.', url:'https://www.unipop.lu'},
    event:{title:'Événement à venir', text:'Découvrez notre prochain événement UniPop.', url:''},
    quote:{title:'Citation', text:'Rien de plus précieux que d’enrichir ses connaissances, peu importe l’âge !', url:''},
    button:{title:'Découvrir le catalogue', text:'Consultez notre catalogue complet.', url:'https://www.unipop.lu'}
  };
  customBlocks.push({id:Date.now().toString(), type, ...defaults[type]});
  renderBlocksEditor(); renderPreview(); saveState();
}
function renderBlocksEditor(){
  $('blocksEditor').innerHTML = customBlocks.map((b,i)=>`
    <div class="block-editor" data-id="${b.id}">
      <header>Bloc ${i+1}: ${escapeHtml(b.type)} <button data-remove="${b.id}">Supprimer</button></header>
      <input data-field="title" value="${escapeAttr(b.title)}" placeholder="Titre" />
      <textarea data-field="text" placeholder="Texte">${escapeHtml(b.text)}</textarea>
      <input data-field="image" value="${escapeAttr(b.image||'')}" placeholder="URL image optionnelle" />
      <input data-field="url" value="${escapeAttr(b.url||'')}" placeholder="URL bouton optionnelle" />
    </div>`).join('');
  $('blocksEditor').querySelectorAll('[data-remove]').forEach(btn=>btn.onclick=()=>{ customBlocks=customBlocks.filter(b=>b.id!==btn.dataset.remove); renderBlocksEditor(); renderPreview(); saveState(); });
  $('blocksEditor').querySelectorAll('input,textarea').forEach(el=>el.oninput=()=>{ const box=el.closest('.block-editor'); const b=customBlocks.find(x=>x.id===box.dataset.id); b[el.dataset.field]=el.value; renderPreview(); saveState(); });
}
function selectedCourses(){ return allCourses.filter(c=>selectedIds.has(c.id)).slice(0,12); }
function renderPreview(){ $('newsletterPreview').innerHTML = buildNewsletterHtml(false); }
function buildNewsletterHtml(mailSafe=true){
  const title = clean($('newsletterTitle').value) || 'Les nouveautés UniPop';
  const subtitle = clean($('newsletterSubtitle').value) || '';
  const hero = clean($('heroImage').value);
  const courses = selectedCourses();
  const catalog = clean($('catalogUrl').value) || 'https://www.unipop.lu';
  const style = mailSafe ? inlineMailStyles() : '';
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${style}</head><body class="mail-body">
  <div class="mail-container">
    <div class="mail-hero">${hero?`<img src="${escapeAttr(hero)}" alt="UniPop">`:''}</div>
    <div class="mail-title"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(subtitle)}</p></div>
    ${courses.length?`<div class="section-title">À la une</div><div class="cards">${courses.map(courseCard).join('')}</div>`:''}
    ${customBlocks.map(customBlockHtml).join('')}
    <div class="cta-line"><div><strong>Inscriptions ouvertes</strong><br><span>Consultez le catalogue complet sur unipop.lu</span></div><a class="cta-button" href="${escapeAttr(catalog)}">Découvrir le catalogue</a></div>
    <div class="mail-footer"><div class="socials">● ● ●</div><div class="footer-links"><span>Contact</span><span>FAQ</span><span>unipop.lu</span></div></div>
  </div></body></html>`;
}
function courseCard(c){
  return `<div class="course-card"><div class="fake-img">${escapeHtml((c.category||'U').slice(0,1))}</div><div class="course-card-content"><h3>${escapeHtml(c.title)}</h3><p>${escapeHtml(c.desc.slice(0,160))}</p><p><strong>${escapeHtml(normalizeDate(c.start))}</strong>${c.location?' · '+escapeHtml(c.location):''}</p><a class="mail-link" href="${escapeAttr(c.url)}">En savoir plus →</a></div></div>`;
}
function customBlockHtml(b){
  const img = b.image ? `<img src="${escapeAttr(b.image)}" alt="" style="max-width:100%;border-radius:12px;margin-bottom:12px;">` : '';
  const link = b.url ? `<br><a class="mail-link" href="${escapeAttr(b.url)}">En savoir plus →</a>` : '';
  return `<div class="custom-block">${img}<h3>${escapeHtml(b.title)}</h3><p>${escapeHtml(b.text).replace(/\n/g,'<br>')}</p>${link}</div>`;
}
function inlineMailStyles(){ return `<style>${document.querySelector('style')?.textContent || ''}</style>`; }
function exportHtml(){ $('exportHtml').value = buildNewsletterHtml(true); $('exportDialog').showModal(); }
function saveState(){ localStorage.setItem(STORAGE_KEY, JSON.stringify({selectedIds:[...selectedIds], customBlocks, title:$('newsletterTitle').value, subtitle:$('newsletterSubtitle').value, hero:$('heroImage').value, catalog:$('catalogUrl').value, since:$('sinceDate').value})); }
function loadState(){
  const s = JSON.parse(localStorage.getItem(STORAGE_KEY)||'{}'); selectedIds = new Set(s.selectedIds||[]); customBlocks = s.customBlocks||[];
  $('newsletterTitle').value = s.title || $('newsletterTitle').value; $('newsletterSubtitle').value = s.subtitle || $('newsletterSubtitle').value; $('heroImage').value = s.hero || $('heroImage').value; $('catalogUrl').value = s.catalog || $('catalogUrl').value;
  if(s.since) $('sinceDate').value = s.since; else { const d = new Date(); d.setDate(d.getDate()-14); $('sinceDate').value = d.toISOString().slice(0,10); }
}
function escapeHtml(s){ return clean(s).replace(/[&<>"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m])); }
function escapeAttr(s){ return escapeHtml(s); }

document.addEventListener('DOMContentLoaded',()=>{
  loadState(); renderBlocksEditor();
  ['searchInput','categoryFilter','newFilter','sinceDate'].forEach(id=>$(id).addEventListener('input',()=>{renderCourses(); renderPreview(); saveState();}));
  ['newsletterTitle','newsletterSubtitle','heroImage','catalogUrl'].forEach(id=>$(id).addEventListener('input',()=>{renderPreview(); saveState();}));
  document.querySelectorAll('[data-block]').forEach(btn=>btn.onclick=()=>addBlock(btn.dataset.block));
  $('refreshBtn').onclick=loadCourses; $('saveBtn').onclick=()=>{saveState(); alert('Newsletter enregistré dans ce navigateur.');}; $('exportBtn').onclick=exportHtml;
  $('closeDialog').onclick=()=>$('exportDialog').close(); $('copyHtml').onclick=()=>navigator.clipboard.writeText($('exportHtml').value).then(()=>alert('HTML copié.'));
  $('downloadHtml').onclick=()=>{ const blob=new Blob([$('exportHtml').value],{type:'text/html'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='newsletter-mailjet.html'; a.click(); URL.revokeObjectURL(a.href); };
  loadCourses();
});
