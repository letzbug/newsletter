const DATA_URL = 'https://raw.githubusercontent.com/letzbug/signage/bd15a5eddb1f8b2d7201c0db854fe107c97cd09e/data/trainings.json';
const HERO_IMAGE = 'assets/Newsletter_Header.png';
const UNIPOP_CATALOG_URL = 'https://www.unipop.lu/?organizerName=UniPop';
const STORAGE_KEY = 'newsletter_unipop_v5';

let allCourses = [];
let selectedIds = new Set();
let courseImages = {};
let courseLinks = {};
let customBlocks = [];

const $ = (id) => document.getElementById(id);
const clean = (value) => (value ?? '').toString().trim();
const esc = (value) => clean(value).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));

function first(obj, keys) {
  for (const key of keys) {
    if (clean(obj?.[key])) return clean(obj[key]);
  }
  return '';
}

function normalizeSpaces(value) {
  return clean(value).replace(/\s+/g, ' ');
}

function strictUniPopMarker(raw) {
  let found = false;
  const walk = (node) => {
    if (found || node == null) return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (typeof node === 'object') {
      for (const [key, value] of Object.entries(node)) {
        const k = key.toLowerCase();
        const v = clean(value).toLowerCase();
        if ((k === 'code' && v === 'unipop') ||
            (k === 'mail' && v === 'info@unipop.lu') ||
            (k === 'nom' && v === 'unipop')) {
          found = true;
          return;
        }
        if (typeof value === 'object') walk(value);
      }
    }
  };
  walk(raw);
  return found;
}

function collectArrays(data) {
  const arrays = [];
  const walk = (node) => {
    if (Array.isArray(node)) {
      arrays.push(node);
      node.forEach(walk);
      return;
    }
    if (node && typeof node === 'object') Object.values(node).forEach(walk);
  };
  walk(data);
  return arrays
    .filter(arr => arr.length && arr.some(item => item && typeof item === 'object'))
    .sort((a, b) => b.length - a.length);
}

function parseDate(value) {
  const s = clean(value);
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00`);
  m = s.match(/^(\d{2})[./-](\d{2})[./-](\d{4})/);
  if (m) return new Date(`${m[3]}-${m[2]}-${m[1]}T00:00:00`);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toInputDate(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function formatDate(value) {
  const d = parseDate(value);
  return d ? d.toLocaleDateString('fr-FR') : clean(value);
}

function getCourseCode(raw) {
  return first(raw, ['coursCode', 'coursId', 'codeCours', 'courseCode', 'idCours']) || 'SANS-CODE';
}

function normalizeCourse(raw, index) {
  const code = getCourseCode(raw);
  const id = code !== 'SANS-CODE' ? code : `course-${index}`;
  const title = normalizeSpaces(first(raw, ['intitule', 'INTITULE', 'titre', 'Titre', 'title', 'libelle', 'Libelle', 'name'])) || code;
  const category = normalizeSpaces(first(raw, ['categorieNom', 'categorie', 'catégorie', 'category', 'theme', 'discipline', 'domaine']));
  const date = first(raw, ['date', 'DEBUT', 'debut', 'start', 'dateDebut', 'date_debut', 'begin']);
  const place = normalizeSpaces(first(raw, ['site', 'lieu', 'location', 'SALLE', 'salle', 'adresse', 'localisation'])) || 'Université Populaire Belval';
  const trainer = normalizeSpaces(first(raw, ['formateur', 'Formateur', 'enseignant', 'trainer', 'intervenant', 'nomFormateur']));
  const description = normalizeSpaces(first(raw, ['description', 'resume', 'résumé', 'details', 'objectif', 'objectifs', 'contenu', 'presentation'])) || 'Découvrez ce nouveau cours proposé par UniPop.';
  const link = first(raw, ['url', 'lien', 'link', 'permalink']) || '';
  return { id, code, title, category, date, place, trainer, description, link, raw };
}

function isNewCourse(course) {
  const sinceValue = $('newSince')?.value;
  const since = sinceValue ? parseDate(sinceValue) : new Date();
  const courseDate = parseDate(course.date);
  if (!since || !courseDate) return false;
  since.setHours(0, 0, 0, 0);
  courseDate.setHours(0, 0, 0, 0);
  return courseDate >= since;
}

function saveState() {
  const payload = {
    selectedIds: Array.from(selectedIds),
    courseImages,
    courseLinks,
    customBlocks,
    title: $('newsletterTitle').value,
    subtitle: $('newsletterSubtitle').value,
    newSince: $('newSince').value,
    newFilter: $('newFilter').value
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

function loadState() {
  $('newSince').value = toInputDate(new Date());
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    selectedIds = new Set(saved.selectedIds || []);
    courseImages = saved.courseImages || {};
    courseLinks = saved.courseLinks || {};
    customBlocks = saved.customBlocks || [];
    if (saved.title) $('newsletterTitle').value = saved.title;
    if (saved.subtitle) $('newsletterSubtitle').value = saved.subtitle;
    if (saved.newSince) $('newSince').value = saved.newSince;
    if (saved.newFilter) $('newFilter').value = saved.newFilter;
  } catch (error) {
    console.warn('Local storage could not be loaded', error);
  }
}

async function loadCourses() {
  $('jsonStatus').textContent = 'Chargement du fichier JSON…';
  try {
    const response = await fetch(DATA_URL, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const arrays = collectArrays(data);
    const rawCourses = arrays[0] || [];
    allCourses = rawCourses
      .filter(strictUniPopMarker)
      .map(normalizeCourse)
      .filter(course => course.title && course.code !== 'SANS-CODE');

    $('jsonStatus').textContent = 'UniPop uniquement';
    fillCategories();
    renderCourses();
    renderPreview();
  } catch (error) {
    $('jsonStatus').textContent = 'Erreur de chargement JSON. Vérifie le lien GitHub ou ouvre la page via GitHub Pages.';
    console.error(error);
  }
}

function fillCategories() {
  const select = $('categoryFilter');
  const current = select.value;
  select.innerHTML = '<option value="">Toutes catégories</option>';
  Array.from(new Set(allCourses.map(c => c.category).filter(Boolean))).sort().forEach(category => {
    const option = document.createElement('option');
    option.value = category;
    option.textContent = category;
    select.appendChild(option);
  });
  select.value = current;
}

function filteredCourses() {
  const query = $('searchInput').value.toLowerCase();
  const category = $('categoryFilter').value;
  const newOnly = $('newFilter').value === 'new';
  const sort = $('sortSelect').value;
  const rows = allCourses.filter(course => {
    const rawText = JSON.stringify(course.raw || {});
    const haystack = [course.code, course.title, course.category, course.date, course.place, course.trainer, course.description, rawText].join(' ').toLowerCase();
    return haystack.includes(query) && (!category || course.category === category) && (!newOnly || isNewCourse(course));
  });
  rows.sort((a, b) => {
    if (sort === 'title') return a.title.localeCompare(b.title, 'fr');
    if (sort === 'category') return a.category.localeCompare(b.category, 'fr') || a.title.localeCompare(b.title, 'fr');
    return (parseDate(a.date)?.getTime() || 9999999999999) - (parseDate(b.date)?.getTime() || 9999999999999);
  });
  return rows;
}

function renderCourses() {
  const list = $('coursesList');
  const template = $('courseTemplate');
  const rows = filteredCourses();
  list.innerHTML = '';

  $('courseCount').textContent = `${rows.length} cours trouvé${rows.length > 1 ? 's' : ''}`;
  $('selectedCount').textContent = `${selectedIds.size} cours sélectionné${selectedIds.size > 1 ? 's' : ''}`;

  rows.forEach(course => {
    const node = template.content.firstElementChild.cloneNode(true);
    const checkbox = node.querySelector('.course-checkbox');
    const imageLabel = node.querySelector('.course-image-label');
    const imageInput = node.querySelector('.course-image-input');
    const linkInput = node.querySelector('.course-link-input');
    const newBadge = node.querySelector('.course-new');

    checkbox.checked = selectedIds.has(course.id);
    if (checkbox.checked) node.classList.add('selected');
    if (courseImages[course.id]) imageLabel.classList.add('has-image');
    if (!isNewCourse(course)) newBadge.classList.add('hidden');

    node.querySelector('.course-code').textContent = course.code;
    node.querySelector('.course-title').textContent = course.title;
    node.querySelector('.course-category').textContent = course.category || 'UniPop';
    node.querySelector('.course-meta').textContent = [formatDate(course.date), course.place, course.trainer].filter(Boolean).join(' · ');
    linkInput.value = courseLinks[course.id] || course.link || '';

    checkbox.addEventListener('change', () => {
      if (checkbox.checked) selectedIds.add(course.id);
      else selectedIds.delete(course.id);
      saveState();
      renderCourses();
      renderPreview();
    });

    node.querySelector('.course-text').addEventListener('click', () => {
      selectedIds.add(course.id);
      saveState();
      renderCourses();
      renderPreview();
    });

    linkInput.addEventListener('input', (event) => {
      courseLinks[course.id] = event.target.value;
      saveState();
      renderPreview();
    });

    imageInput.addEventListener('change', (event) => {
      const file = event.target.files && event.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        courseImages[course.id] = reader.result;
        selectedIds.add(course.id);
        saveState();
        renderCourses();
        renderPreview();
      };
      reader.readAsDataURL(file);
    });

    list.appendChild(node);
  });
}

function addBlock(type) {
  const block = { id: Date.now().toString(), type, title: '', text: '', button: 'Découvrir', url: UNIPOP_CATALOG_URL };
  if (type === 'text') Object.assign(block, { title: 'À savoir', text: 'Votre texte ici…' });
  if (type === 'imageText') Object.assign(block, { title: 'Focus', text: 'Votre texte ici…' });
  if (type === 'news') Object.assign(block, { title: 'Actualité', text: 'Votre actualité ici…' });
  if (type === 'event') Object.assign(block, { title: 'Événement', text: 'Informations pratiques de l’événement…' });
  if (type === 'quote') Object.assign(block, { title: 'Citation', text: '« Votre citation ici… »' });
  if (type === 'button') Object.assign(block, { title: '', text: '', button: 'Découvrir le catalogue' });
  customBlocks.push(block);
  saveState();
  renderBlocksEditor();
  renderPreview();
}

function renderBlocksEditor() {
  const editor = $('blocksEditor');
  editor.innerHTML = '';
  customBlocks.forEach(block => {
    const div = document.createElement('div');
    div.className = 'block-editor';
    div.innerHTML = `
      <header><span>${esc(block.type)}</span><button type="button">Supprimer</button></header>
      <input placeholder="Titre" value="${esc(block.title)}">
      <textarea placeholder="Texte">${esc(block.text)}</textarea>
      ${block.type === 'button' ? `<input class="button-text" placeholder="Texte du bouton" value="${esc(block.button)}"><input class="button-url" placeholder="Lien" value="${esc(block.url)}">` : ''}
    `;
    div.querySelector('button').addEventListener('click', () => {
      customBlocks = customBlocks.filter(item => item.id !== block.id);
      saveState();
      renderBlocksEditor();
      renderPreview();
    });
    div.querySelector('input').addEventListener('input', e => { block.title = e.target.value; saveState(); renderPreview(); });
    div.querySelector('textarea').addEventListener('input', e => { block.text = e.target.value; saveState(); renderPreview(); });
    const buttonText = div.querySelector('.button-text');
    const buttonUrl = div.querySelector('.button-url');
    if (buttonText) buttonText.addEventListener('input', e => { block.button = e.target.value; saveState(); renderPreview(); });
    if (buttonUrl) buttonUrl.addEventListener('input', e => { block.url = e.target.value; saveState(); renderPreview(); });
    editor.appendChild(div);
  });
}

function selectedCourses() {
  return allCourses.filter(course => selectedIds.has(course.id));
}

function courseUrl(course) {
  return UNIPOP_CATALOG_URL;
}

function truncateText(value, maxLength) {
  const text = normalizeSpaces(value);
  if (text.length <= maxLength) return text;
  const cut = text.slice(0, maxLength + 1);
  const lastSpace = cut.lastIndexOf(' ');
  const trimmed = (lastSpace > 40 ? cut.slice(0, lastSpace) : text.slice(0, maxLength)).trim();
  return trimmed.replace(/[.,;:!?-]+$/, '') + '…';
}

function previewImage(course) {
  const image = courseImages[course.id];
  if (image) return `<img src="${image}" alt="${esc(course.title)}">`;
  return '<span>A</span>';
}

function buildNewsletterHtml(mailjet = false) {
  const title = esc($('newsletterTitle').value || 'Les nouveautés UniPop');
  const subtitle = esc($('newsletterSubtitle').value || 'Découvrez nos prochains cours et actualités.');
  const courses = selectedCourses();
  const courseHtml = courses.map(course => mailjet ? mailCourse(course) : previewCourse(course)).join('');
  const customHtml = customBlocks.map(block => mailjet ? mailCustomBlock(block) : previewCustomBlock(block)).join('');

  return `
<div class="mail-container" style="max-width:860px;margin:0 auto;background:#ffffff;font-family:Arial,Helvetica,sans-serif;color:#071746;">
  <div class="mail-hero"><img src="${HERO_IMAGE}" alt="UniPop" style="display:block;width:100%;height:auto;border:0;"></div>
  <div class="mail-title" style="padding:26px 26px 10px;text-align:center;"><h2 style="margin:0;color:#0d1f59;font-size:28px;line-height:1.2;">${title}</h2><p style="margin:6px 0 0;color:#667085;">${subtitle}</p></div>
  <div class="section-title"><span>À la une</span></div>
  <div class="featured-list">${courseHtml || '<div class="custom-block"><h3>Aucun cours sélectionné</h3><p>Sélectionnez les cours UniPop à gauche.</p></div>'}</div>
  ${customHtml}
  <div class="add-placeholder">＋ Ajoutez d’autres blocs à votre newsletter</div>
  <div class="mail-footer">
  <div class="socials">
    <a href="https://www.facebook.com/unipop.lu" target="_blank" rel="noopener" aria-label="Facebook" style="text-decoration:none;margin:0 10px;display:inline-block;">
      <img src="https://cdn-icons-png.flaticon.com/512/733/733547.png" alt="Facebook" width="42" height="42" style="display:inline-block;border:0;outline:none;text-decoration:none;border-radius:50%;">
    </a>
    <a href="https://www.instagram.com/unipop_luxembourg/" target="_blank" rel="noopener" aria-label="Instagram" style="text-decoration:none;margin:0 10px;display:inline-block;">
      <img src="https://cdn-icons-png.flaticon.com/512/2111/2111463.png" alt="Instagram" width="42" height="42" style="display:inline-block;border:0;outline:none;text-decoration:none;border-radius:50%;">
    </a>
    <a href="https://www.linkedin.com/company/unipop-luxembourg/" target="_blank" rel="noopener" aria-label="LinkedIn" style="text-decoration:none;margin:0 10px;display:inline-block;">
      <img src="https://cdn-icons-png.flaticon.com/512/3536/3536505.png" alt="LinkedIn" width="42" height="42" style="display:inline-block;border:0;outline:none;text-decoration:none;border-radius:50%;">
    </a>
  </div>
  <div class="footer-links"><a href="mailto:info@unipop.lu">Contact</a><a href="https://www.unipop.lu">FAQ</a><a href="https://www.unipop.lu">unipop.lu</a></div>
</div>
</div>`.trim();
}

function previewCourse(course) {
  const newBadge = isNewCourse(course) ? '<span class="mail-new">Nouveau</span>' : '';
  return `
<article class="featured-course">
  <a class="featured-img" href="${esc(courseUrl(course))}" target="_blank" rel="noopener">${previewImage(course)}</a>
  <div class="featured-content">
    <div class="featured-code-row">${newBadge}</div>
    <h3>${esc(truncateText(course.title, 82))}</h3>
    <div class="mail-badges"><span class="mail-category">${esc(course.category || 'UniPop')}</span></div>
    <p class="course-desc">${esc(truncateText(course.description, 170))}</p>
    <div class="course-info">📅 ${esc(formatDate(course.date))}</div>
    <div class="course-info">📍 ${esc(course.place)}</div>
    <a class="more-link" href="${esc(courseUrl(course))}" target="_blank" rel="noopener">En savoir plus →</a>
  </div>
</article>`;
}

function mailCourse(course) {
  const url = esc(courseUrl(course));
  const newBadge = isNewCourse(course) ? `<span style="background:#fff5d7;color:#9b6600;border-radius:999px;padding:6px 9px;font-size:11px;font-weight:900;">Nouveau</span>` : '';
  const image = courseImages[course.id]
    ? `<img src="${courseImages[course.id]}" alt="${esc(course.title)}" style="width:100%;height:160px;object-fit:cover;display:block;border-radius:9px;border:0;">`
    : `<div style="height:160px;border-radius:9px;background:#0d1f59;color:#ffffff;font-size:56px;font-weight:900;text-align:center;line-height:160px;">A</div>`;
  return `
<div style="display:inline-block;width:30.8%;vertical-align:top;border:1px solid #e3e8f1;border-radius:12px;margin:0 1% 18px;background:#ffffff;overflow:hidden;">
  <a href="${url}" target="_blank" style="text-decoration:none;display:block;">${image}</a>
  <div style="padding:14px;">
    <h3 style="margin:0 0 10px;color:#0d1f59;font-size:18px;line-height:1.18;">${esc(truncateText(course.title, 82))}</h3>
    <div style="margin:0 0 10px;"><span style="background:#edf4ff;color:#073684;border-radius:999px;padding:6px 9px;font-size:11px;font-weight:900;text-transform:uppercase;">${esc(course.category || 'UniPop')}</span> ${newBadge}</div>
    <p style="color:#111827;font-size:14px;line-height:1.35;margin:0 0 12px;">${esc(truncateText(course.description, 170))}</p>
    <p style="color:#42526d;font-size:13px;margin:4px 0;">📅 ${esc(formatDate(course.date))}</p>
    <p style="color:#42526d;font-size:13px;margin:4px 0;">📍 ${esc(course.place)}</p>
    <p style="margin:16px 0 0;"><a href="${url}" target="_blank" style="color:#0d1f59;font-weight:900;text-decoration:none;">En savoir plus →</a></p>
  </div>
</div>`;
}

function previewCustomBlock(block) {
  if (block.type === 'button') {
    return `<div class="custom-block"><a href="${esc(block.url)}" style="display:inline-block;background:#0d1f59;color:white;text-decoration:none;border-radius:10px;padding:13px 18px;font-weight:900;">${esc(block.button)}</a></div>`;
  }
  return `<div class="custom-block"><h3>${esc(block.title)}</h3><p>${esc(block.text)}</p></div>`;
}

function mailCustomBlock(block) {
  if (block.type === 'button') {
    return `<div style="margin:20px 28px;padding:20px;border-radius:12px;background:#f8fbff;border:1px solid #e3e8f1;text-align:center;"><a href="${esc(block.url)}" style="display:inline-block;background:#0d1f59;color:#ffffff;text-decoration:none;border-radius:10px;padding:13px 18px;font-weight:900;">${esc(block.button)}</a></div>`;
  }
  return `<div style="margin:20px 28px;padding:20px;border-radius:12px;background:#f8fbff;border:1px solid #e3e8f1;"><h3 style="margin:0 0 8px;color:#0d1f59;">${esc(block.title)}</h3><p style="margin:0;color:#344054;line-height:1.5;">${esc(block.text)}</p></div>`;
}

function renderPreview() {
  $('newsletterPreview').innerHTML = buildNewsletterHtml(false);
}

function updateFiltersAndPreview() {
  saveState();
  renderCourses();
  renderPreview();
}

$('searchInput').addEventListener('input', renderCourses);
$('categoryFilter').addEventListener('change', renderCourses);
$('newFilter').addEventListener('change', updateFiltersAndPreview);
$('newSince').addEventListener('change', updateFiltersAndPreview);
$('sortSelect').addEventListener('change', renderCourses);
$('clearSelection').addEventListener('click', () => { selectedIds.clear(); saveState(); renderCourses(); renderPreview(); });
document.querySelectorAll('[data-block]').forEach(button => button.addEventListener('click', () => addBlock(button.dataset.block)));
$('newsletterTitle').addEventListener('input', () => { saveState(); renderPreview(); });
$('newsletterSubtitle').addEventListener('input', () => { saveState(); renderPreview(); });
$('saveBtn').addEventListener('click', () => { saveState(); alert('Enregistré dans ce navigateur.'); });
$('exportBtn').addEventListener('click', () => { $('exportHtml').value = buildNewsletterHtml(true); $('exportDialog').showModal(); });
$('previewBtn').addEventListener('click', () => {
  renderCourses();
  renderBlocksEditor();
  renderPreview();

  const preview = $('newsletterPreview');
  if (preview) {
    preview.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
});
$('closeDialog').addEventListener('click', () => $('exportDialog').close());
$('copyHtml').addEventListener('click', async () => { await navigator.clipboard.writeText($('exportHtml').value); alert('HTML copié.'); });

loadState();
renderBlocksEditor();
renderPreview();
loadCourses();
