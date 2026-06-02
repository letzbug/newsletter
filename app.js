const DATA_URL = 'https://raw.githubusercontent.com/letzbug/signage/bd15a5eddb1f8b2d7201c0db854fe107c97cd09e/data/trainings.json';
const HERO_IMAGE = 'https://raw.githubusercontent.com/letzbug/newsletter/d6518bf5a169afb92a3e92af307c2ab0a60d200f/assets/Newsletter_Header.png';
const UNIPOP_CATALOG_URL = 'https://www.unipop.lu/?organizerName=UniPop';
const STORAGE_KEY = 'newsletter_unipop_v6_mailjet_preview';

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

function absoluteUrl(path) {
  const p = clean(path);
  if (!p) return '';
  if (/^(https?:|data:|mailto:)/i.test(p)) return p;
  try {
    return new URL(p, window.location.href).href;
  } catch (e) {
    return p;
  }
}

function ensureExternalUrl(url) {
  const u = clean(url);
  if (!u) return '';
  if (/^(https?:|mailto:|tel:)/i.test(u)) return u;
  if (/^www\./i.test(u)) return 'https://' + u;
  return u;
}

function mailjetImageUrl(value) {
  const u = clean(value);
  if (!u) return '';

  // Mailjet/Outlook should not receive base64 images.
  // Images must be public HTTPS URLs, for example GitHub raw links or GitHub Pages links.
  if (/^data:image\//i.test(u)) return '';

  const fixed = ensureExternalUrl(u);

  // Automatically convert GitHub "blob" links into raw image links.
  // Example:
  // https://github.com/user/repo/blob/main/assets/photo.jpg
  // becomes:
  // https://raw.githubusercontent.com/user/repo/main/assets/photo.jpg
  const githubBlob = fixed.match(/^https?:\/\/github\.com\/([^\/]+)\/([^\/]+)\/blob\/([^\/]+)\/(.+)$/i);
  if (githubBlob) {
    return `https://raw.githubusercontent.com/${githubBlob[1]}/${githubBlob[2]}/${githubBlob[3]}/${githubBlob[4]}`;
  }

  return /^https?:\/\//i.test(fixed) ? fixed : '';
}

function youtubeVideoId(url) {
  const u = clean(url);
  if (!u) return '';

  try {
    const parsed = new URL(u);
    const host = parsed.hostname.replace(/^www\./i, '').toLowerCase();

    if (host === 'youtu.be') {
      return clean(parsed.pathname.split('/').filter(Boolean)[0] || '');
    }

    if (host.endsWith('youtube.com')) {
      if (parsed.searchParams.get('v')) return clean(parsed.searchParams.get('v'));

      const parts = parsed.pathname.split('/').filter(Boolean);
      const knownPrefixes = ['embed', 'shorts', 'live'];
      if (knownPrefixes.includes(parts[0]) && parts[1]) return clean(parts[1]);
    }
  } catch (e) {
    // Fallback regex below
  }

  const match = u.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/i);
  return match ? clean(match[1]) : '';
}

function youtubeThumbnail(url) {
  const id = youtubeVideoId(url);
  return id ? `https://img.youtube.com/vi/${id}/hqdefault.jpg` : '';
}


function isMp4Video(value) {
  return /\.mp4(\?.*)?$/i.test(clean(value));
}

function localAssetVideoUrl(value) {
  const v = clean(value);
  if (!v) return '';
  if (/^https?:\/\//i.test(v)) return v;
  if (v.includes('/')) return v;
  return `assets/videos/${v}`;
}

function localAssetImageUrl(value) {
  const v = clean(value);
  if (!v) return '';
  if (/^https?:\/\//i.test(v)) return v;
  if (v.includes('/')) return v;
  return `assets/images/${v}`;
}

function matchingPosterForVideo(value) {
  const v = clean(value);
  if (!v || !isMp4Video(v)) return '';
  const filename = v.split('/').pop().replace(/\.mp4(\?.*)?$/i, '.jpg');
  return `assets/images/${filename}`;
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
    Object.keys(courseImages).forEach(id => {
      courseImages[id] = mailjetImageUrl(courseImages[id]);
      if (!courseImages[id]) delete courseImages[id];
    });
    courseLinks = saved.courseLinks || {};
    customBlocks = (saved.customBlocks || []).map(block => normalizeBlock(block || {}));
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
    const imageUrlInput = node.querySelector('.course-image-url-input');
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
    if (imageUrlInput) imageUrlInput.value = courseImages[course.id] || '';

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

    if (imageUrlInput) {
      imageUrlInput.addEventListener('input', (event) => {
        const url = mailjetImageUrl(event.target.value);
        if (url) {
          courseImages[course.id] = url;
          selectedIds.add(course.id);
        } else {
          delete courseImages[course.id];
        }
        saveState();
        renderCourses();
        renderPreview();
      });
    }

    list.appendChild(node);
  });
}

function defaultBlockTypeLabel(type) {
  const labels = {
    text: 'Texte',
    imageText: 'Média + Texte',
    news: 'Actualité',
    event: 'Événement',
    quote: 'Citation',
    button: 'Bouton'
  };
  return labels[type] || type;
}

function normalizeBlock(block) {
  block.url = block.url || '';
  block.image = mailjetImageUrl(block.image || '');
  block.video = ensureExternalUrl(block.video || '');
  block.imageWidth = block.imageWidth || '100';
  block.imagePosition = block.imagePosition || 'top';
  block.clickable = block.clickable !== false;
  return block;
}

function addBlock(type) {
  const block = normalizeBlock({
    id: Date.now().toString(),
    type,
    title: '',
    text: '',
    button: 'Découvrir',
    url: '',
    image: '',
    video: '',
    imageWidth: '100',
    imagePosition: 'top',
    clickable: true
  });

  if (type === 'text') Object.assign(block, { title: 'À savoir', text: 'Votre texte ici…' });
  if (type === 'imageText') Object.assign(block, { title: 'La photo du mois', text: 'Votre texte ici…' });
  if (type === 'news') Object.assign(block, { title: 'Actualité', text: 'Votre actualité ici…' });
  if (type === 'event') Object.assign(block, { title: 'Événement', text: 'Informations pratiques de l’événement…' });
  if (type === 'quote') Object.assign(block, { title: 'Citation', text: '« Votre citation ici… »' });
  if (type === 'button') Object.assign(block, { title: '', text: '', button: 'Découvrir le catalogue', url: UNIPOP_CATALOG_URL });

  customBlocks.push(block);
  saveState();
  renderBlocksEditor();
  renderPreview();
}

function renderBlocksEditor() {
  const editor = $('blocksEditor');
  editor.innerHTML = '';

  customBlocks = customBlocks.map(normalizeBlock);

  customBlocks.forEach(block => {
    const div = document.createElement('div');
    div.className = 'block-editor';

    const isButton = block.type === 'button';
    const isContentBlock = !isButton;

    div.innerHTML = `
      <header><span>${esc(defaultBlockTypeLabel(block.type))}</span><button type="button">Supprimer</button></header>

      ${!isButton ? `<input class="block-title-input" placeholder="Titre" value="${esc(block.title)}">` : ''}

      ${!isButton ? `<textarea class="block-text-input" placeholder="Texte">${esc(block.text)}</textarea>` : ''}

      ${isContentBlock ? `
        <div class="media-editor-fields">
          <label>Lien du bloc entier
            <input class="block-url-input" type="url" placeholder="https://... (vide = pas de lien)" value="${esc(block.url || '')}">
          </label>

          <label>Image en ligne
            <input class="media-image-url-input" type="url" placeholder="https://raw.githubusercontent.com/.../photo.jpg" value="${esc(block.image || '')}">
          </label>

          <label>Vidéo YouTube / Vimeo / UniPop
            <input class="media-video-input" type="text" placeholder="video.mp4 ou https://youtube.com/..." value="${esc(block.video || '')}">
          </label>

          <div class="media-grid-options">
            <label>Largeur image
              <select class="media-width-input">
                <option value="25" ${String(block.imageWidth)==='25'?'selected':''}>25%</option>
                <option value="33" ${String(block.imageWidth)==='33'?'selected':''}>33%</option>
                <option value="50" ${String(block.imageWidth)==='50'?'selected':''}>50%</option>
                <option value="75" ${String(block.imageWidth)==='75'?'selected':''}>75%</option>
                <option value="100" ${String(block.imageWidth)==='100'?'selected':''}>100%</option>
              </select>
            </label>

            <label>Position image
              <select class="media-position-input">
                <option value="top" ${block.imagePosition==='top'?'selected':''}>En haut</option>
                <option value="left" ${block.imagePosition==='left'?'selected':''}>À gauche</option>
                <option value="right" ${block.imagePosition==='right'?'selected':''}>À droite</option>
              </select>
            </label>
          </div>

          <label class="block-checkbox-label">
            <input class="block-clickable-input" type="checkbox" ${block.clickable !== false ? 'checked' : ''}>
            Bloc entier cliquable si un lien est indiqué
          </label>

          <p class="media-help">Vidéo locale : mets seulement le nom du fichier MP4 placé dans assets/videos/. Exemple : unipop-tour.mp4. Image optionnelle : nom dans assets/images/ ou URL HTTPS.</p>
        </div>
      ` : ''}

      ${isButton ? `<input class="button-text" placeholder="Texte du bouton" value="${esc(block.button)}"><input class="button-url" placeholder="Lien" value="${esc(block.url)}">` : ''}
    `;

    div.querySelector('button').addEventListener('click', () => {
      customBlocks = customBlocks.filter(item => item.id !== block.id);
      saveState();
      renderBlocksEditor();
      renderPreview();
    });

    const titleInput = div.querySelector('.block-title-input');
    const textInput = div.querySelector('.block-text-input');
    const blockUrlInput = div.querySelector('.block-url-input');
    const mediaImageUrlInput = div.querySelector('.media-image-url-input');
    const mediaVideoInput = div.querySelector('.media-video-input');
    const mediaWidthInput = div.querySelector('.media-width-input');
    const mediaPositionInput = div.querySelector('.media-position-input');
    const blockClickableInput = div.querySelector('.block-clickable-input');

    if (titleInput) titleInput.addEventListener('input', e => { block.title = e.target.value; saveState(); renderPreview(); });
    if (textInput) textInput.addEventListener('input', e => { block.text = e.target.value; saveState(); renderPreview(); });
    if (blockUrlInput) blockUrlInput.addEventListener('input', e => { block.url = ensureExternalUrl(e.target.value); saveState(); renderPreview(); });
    if (mediaImageUrlInput) mediaImageUrlInput.addEventListener('input', e => { block.image = mailjetImageUrl(e.target.value); saveState(); renderPreview(); });
    if (mediaVideoInput) mediaVideoInput.addEventListener('input', e => { block.video = ensureExternalUrl(e.target.value); saveState(); renderPreview(); });
    if (mediaWidthInput) mediaWidthInput.addEventListener('change', e => { block.imageWidth = e.target.value; saveState(); renderPreview(); });
    if (mediaPositionInput) mediaPositionInput.addEventListener('change', e => { block.imagePosition = e.target.value; saveState(); renderPreview(); });
    if (blockClickableInput) blockClickableInput.addEventListener('change', e => { block.clickable = e.target.checked; saveState(); renderPreview(); });

    const buttonText = div.querySelector('.button-text');
    const buttonUrl = div.querySelector('.button-url');

    if (buttonText) buttonText.addEventListener('input', e => { block.button = e.target.value; saveState(); renderPreview(); });
    if (buttonUrl) buttonUrl.addEventListener('input', e => { block.url = ensureExternalUrl(e.target.value); saveState(); renderPreview(); });

    editor.appendChild(div);
  });
}

function selectedCourses() {
  return allCourses.filter(course => selectedIds.has(course.id));
}

function courseUrl(course) {
  const customLink = (courseLinks[course.id] || '').trim();

  if (customLink !== '') {
    if (customLink.startsWith('http://') || customLink.startsWith('https://')) {
      return customLink;
    }
    return 'https://' + customLink;
  }

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
  const image = mailjetImageUrl(courseImages[course.id]);
  if (image) return `<img src="${esc(image)}" alt="${esc(course.title)}" style="display:block;width:100%;height:160px;object-fit:cover;border:0;">`;
  return `<div style="height:160px;background:#0d1f59;color:#ffffff;font-size:56px;font-weight:900;text-align:center;line-height:160px;">A</div>`;
}

/*
  IMPORTANT:
  From now on, the builder preview uses the exact same HTML as Mailjet export.
  There is no separate "pretty web preview" anymore.
  What you see in the preview is the HTML that gets copied into Mailjet.
*/

function buildNewsletterHtml(mailjetExport = false) {
  const title = esc($('newsletterTitle').value || 'Les nouveautés UniPop');
  const subtitle = esc($('newsletterSubtitle').value || 'Découvrez nos prochains cours et actualités.');
  const hero = absoluteUrl(HERO_IMAGE);
  const courses = selectedCourses();

  return `
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse;background:#eef2f7;margin:0;padding:0;">
  <tr>
    <td align="center" style="padding:18px 10px;">
      <table role="presentation" width="760" cellspacing="0" cellpadding="0" border="0" style="width:760px;max-width:760px;border-collapse:separate;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 18px 45px rgba(7,23,70,0.14);font-family:Arial,Helvetica,sans-serif;color:#071746;">
        <tr>
          <td style="padding:0;">
            <img src="${hero}" alt="UniPop" width="760" style="display:block;width:760px;max-width:760px;height:auto;border:0;outline:none;text-decoration:none;">
          </td>
        </tr>

        <tr>
          <td align="center" style="padding:26px 28px 12px;text-align:center;">
            <h2 style="margin:0;color:#0d1f59;font-size:28px;line-height:1.2;font-weight:900;font-family:Arial,Helvetica,sans-serif;">${title}</h2>
            <p style="margin:7px 0 0;color:#667085;font-size:15px;line-height:1.4;font-family:Arial,Helvetica,sans-serif;">${subtitle}</p>
          </td>
        </tr>

        <tr>
          <td style="padding:12px 28px 18px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;width:100%;">
              <tr>
                <td style="height:1px;background:#55b9b8;line-height:1px;font-size:1px;">&nbsp;</td>
                <td width="126" align="center" style="width:126px;text-align:center;color:#071746;font-size:18px;font-weight:900;text-transform:uppercase;letter-spacing:.04em;font-family:Arial,Helvetica,sans-serif;white-space:nowrap;">À LA UNE</td>
                <td style="height:1px;background:#55b9b8;line-height:1px;font-size:1px;">&nbsp;</td>
              </tr>
            </table>
          </td>
        </tr>

        ${courses.length ? mailjetCourseRows(courses) : emptyCoursesHtml()}
        ${mailjetCustomBlocks(mailjetExport)}

        ${mailjetFooter()}
      </table>
    </td>
  </tr>
</table>`.trim();
}

function mailjetCourseRows(courses) {
  let html = '';
  for (let i = 0; i < courses.length; i += 3) {
    const row = courses.slice(i, i + 3);
    html += `
        <tr>
          <td style="padding:0 28px 26px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:separate;width:100%;">
              <tr>
                ${row.map(course => `
                <td width="33.333%" valign="top" style="width:33.333%;padding:0 8px 0 0;vertical-align:top;">
                  ${mailjetCourseCard(course)}
                </td>`).join('')}
                ${Array.from({length: 3 - row.length}).map(() => `
                <td width="33.333%" valign="top" style="width:33.333%;padding:0 8px 0 0;vertical-align:top;">&nbsp;</td>`).join('')}
              </tr>
            </table>
          </td>
        </tr>`;
  }
  return html;
}

function mailjetCourseCard(course) {
  const url = esc(courseUrl(course));
  const category = esc(course.category || 'UniPop');
  const imageUrl = mailjetImageUrl(courseImages[course.id]);
  const image = imageUrl
    ? `<img src="${esc(imageUrl)}" alt="${esc(course.title)}" width="218" style="display:block;width:100%;height:160px;object-fit:cover;border:0;outline:none;text-decoration:none;border-radius:12px 12px 0 0;">`
    : `<div style="height:160px;background:#0d1f59;color:#ffffff;font-size:56px;font-weight:900;text-align:center;line-height:160px;border-radius:12px 12px 0 0;font-family:Arial,Helvetica,sans-serif;">A</div>`;

  return `
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:separate;background:#ffffff;border:1px solid #e3e8f1;border-radius:12px;overflow:hidden;box-shadow:0 14px 28px rgba(7,23,70,0.16);">
  <tr>
    <td style="padding:0;">
      <a href="${url}" target="_blank" style="text-decoration:none;display:block;">${image}</a>
    </td>
  </tr>
  <tr>
    <td style="padding:16px 14px 14px;font-family:Arial,Helvetica,sans-serif;">
      <h3 style="margin:0 0 12px;color:#0d1f59;font-size:18px;line-height:1.18;font-weight:900;font-family:Arial,Helvetica,sans-serif;">${esc(truncateText(course.title, 72))}</h3>

      <div style="margin:0 0 12px;">
        <span style="display:inline-block;background:#edf4ff;color:#073684;border-radius:999px;padding:7px 10px;font-size:11px;line-height:1.15;font-weight:900;text-transform:uppercase;font-family:Arial,Helvetica,sans-serif;">${category}</span>
      </div>

      <p style="margin:0 0 12px;color:#111827;font-size:14px;line-height:1.38;font-family:Arial,Helvetica,sans-serif;">${esc(truncateText(course.description, 155))}</p>

      <p style="margin:4px 0;color:#42526d;font-size:13px;line-height:1.3;font-family:Arial,Helvetica,sans-serif;">🗓️ ${esc(formatDate(course.date))}</p>
      <p style="margin:4px 0 0;color:#42526d;font-size:13px;line-height:1.3;font-family:Arial,Helvetica,sans-serif;">📍 ${esc(course.place)}</p>

      <p style="margin:18px 0 0;">
        <a href="${url}" target="_blank" style="color:#0d1f59;font-weight:900;text-decoration:none;font-size:16px;font-family:Arial,Helvetica,sans-serif;">En savoir plus →</a>
      </p>
    </td>
  </tr>
</table>`;
}

function emptyCoursesHtml() {
  return `
        <tr>
          <td style="padding:0 28px 26px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f8fbff;border:1px solid #e3e8f1;border-radius:12px;">
              <tr>
                <td style="padding:20px;font-family:Arial,Helvetica,sans-serif;">
                  <h3 style="margin:0 0 8px;color:#0d1f59;">Aucun cours sélectionné</h3>
                  <p style="margin:0;color:#344054;">Sélectionnez les cours UniPop à gauche.</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>`;
}

function blockTargetUrl(block) {
  const url = ensureExternalUrl(block.url || '');
  if (url) return url;
  const video = ensureExternalUrl(block.video || '');
  if (video) return video;
  return '';
}

function contentBlockMediaHtml(block, compact = false, mailjetExport = false) {
  const title = esc(block.title || defaultBlockTypeLabel(block.type));
  const rawVideo = clean(block.video || '');
  const videoUrl = ensureExternalUrl(rawVideo);
  const youtubeId = youtubeVideoId(videoUrl);
  const uploadedImageRaw = clean(block.image || '');
  const uploadedImage = mailjetImageUrl(uploadedImageRaw) || localAssetImageUrl(uploadedImageRaw);
  const youtubeImage = youtubeThumbnail(videoUrl);
  const localPoster = matchingPosterForVideo(rawVideo);
  const thumbnail = uploadedImage || youtubeImage || localPoster;

  // Builder/Aperçu: YouTube iframe or local/remote MP4 video plays inside the newsletter preview.
  if (videoUrl && !mailjetExport) {
    if (youtubeId) {
      return `
        <iframe
          src="https://www.youtube.com/embed/${esc(youtubeId)}?rel=0&modestbranding=1"
          width="620"
          height="360"
          frameborder="0"
          style="display:block;width:100%;max-width:620px;height:360px;border:0;border-radius:12px;margin:0 auto ${compact ? '0' : '16px'};background:#000;"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowfullscreen>
        </iframe>`;
    }

    const src = esc(localAssetVideoUrl(videoUrl));
    const posterAttr = thumbnail ? ` poster="${esc(localAssetImageUrl(thumbnail))}"` : '';
    return `
      <video controls preload="metadata"${posterAttr}
        style="display:block;width:100%;max-width:620px;height:auto;border:0;border-radius:12px;margin:0 auto ${compact ? '0' : '16px'};background:#000;">
        <source src="${src}" type="video/mp4">
        Votre navigateur ne peut pas lire cette vidéo.
      </video>`;
  }

  // Mailjet export: no iframe/video tag. Use image + play button because email clients block real video.
  if (videoUrl) {
    const videoHref = esc(/^https?:\/\//i.test(videoUrl) ? videoUrl : absoluteUrl(localAssetVideoUrl(videoUrl)));
    const thumbSrc = thumbnail ? esc(localAssetImageUrl(thumbnail)) : '';

    if (thumbSrc) {
      return `
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse;">
          <tr>
            <td align="center" style="padding:0 0 ${compact ? '0' : '12px'};">
              <a href="${videoHref}" target="_blank" style="display:block;text-decoration:none;color:inherit;position:relative;">
                <img src="${thumbSrc}" alt="${title}" width="620" style="display:block;width:100%;max-width:620px;height:auto;border:0;outline:none;text-decoration:none;border-radius:12px;margin:0 auto;">
              </a>
              <div style="margin-top:-66px;margin-bottom:${compact ? '0' : '24px'};text-align:center;line-height:0;">
                <a href="${videoHref}" target="_blank" style="display:inline-block;width:58px;height:58px;line-height:58px;border-radius:50%;background:#0d1f59;color:#ffffff;text-decoration:none;font-size:26px;font-weight:900;font-family:Arial,Helvetica,sans-serif;box-shadow:0 8px 18px rgba(7,23,70,0.28);">▶</a>
              </div>
            </td>
          </tr>
        </table>`;
    }

    return `
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse;background:#0d1f59;border-radius:12px;">
        <tr>
          <td align="center" style="padding:40px 20px;color:#ffffff;font-size:46px;font-weight:900;font-family:Arial,Helvetica,sans-serif;">
            <a href="${videoHref}" target="_blank" style="color:#ffffff;text-decoration:none;display:block;">▶<br><span style="font-size:15px;line-height:1.4;">Voir la vidéo</span></a>
          </td>
        </tr>
      </table>`;
  }

  if (thumbnail) {
    return `<img src="${esc(localAssetImageUrl(thumbnail))}" alt="${title}" width="620" style="display:block;width:100%;max-width:620px;height:auto;border:0;outline:none;text-decoration:none;border-radius:12px;margin:0 auto ${compact ? '0' : '16px'};">`;
  }

  return '';
}

function mailjetContentBlock(block, mailjetExport = false) {
  block = normalizeBlock(block);

  const title = esc(block.title || defaultBlockTypeLabel(block.type));
  const text = esc(block.text || '');
  const imageWidth = Math.max(25, Math.min(100, parseInt(block.imageWidth || '100', 10) || 100));
  const position = ['top', 'left', 'right'].includes(block.imagePosition) ? block.imagePosition : 'top';
  const target = (block.clickable !== false && !clean(block.video || '')) ? blockTargetUrl(block) : '';
  const media = contentBlockMediaHtml(block, position !== 'top', mailjetExport);

  const titleHtml = title ? `<h3 style="margin:0 0 8px;color:#0d1f59;font-size:${block.type === 'quote' ? '20px' : '18px'};line-height:1.2;font-weight:900;font-family:Arial,Helvetica,sans-serif;">${title}</h3>` : '';
  const textHtml = text ? `<p style="margin:0;color:#344054;font-size:15px;line-height:1.5;font-family:Arial,Helvetica,sans-serif;">${text}</p>` : '';

  let innerHtml = '';

  if (media && position === 'left' && imageWidth < 100) {
    innerHtml = `
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse;">
        <tr>
          <td width="${imageWidth}%" valign="top" style="width:${imageWidth}%;padding:0 18px 0 0;vertical-align:top;">${media}</td>
          <td valign="top" style="vertical-align:top;font-family:Arial,Helvetica,sans-serif;">${titleHtml}${textHtml}</td>
        </tr>
      </table>`;
  } else if (media && position === 'right' && imageWidth < 100) {
    innerHtml = `
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse;">
        <tr>
          <td valign="top" style="vertical-align:top;font-family:Arial,Helvetica,sans-serif;padding:0 18px 0 0;">${titleHtml}${textHtml}</td>
          <td width="${imageWidth}%" valign="top" style="width:${imageWidth}%;vertical-align:top;">${media}</td>
        </tr>
      </table>`;
  } else {
    const mediaWrapper = media ? `<div style="width:${imageWidth}%;max-width:620px;margin:0 auto 16px;text-align:center;">${media}</div>` : '';
    innerHtml = `${mediaWrapper}${titleHtml}${textHtml}`;
  }

  const blockTable = `
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f8fbff;border:1px solid #e3e8f1;border-radius:12px;box-shadow:0 10px 22px rgba(7,23,70,0.08);width:100%;border-collapse:separate;">
              <tr>
                <td style="padding:20px;font-family:Arial,Helvetica,sans-serif;">
                  ${innerHtml}
                </td>
              </tr>
            </table>`;

  const wrapped = target
    ? `<a href="${esc(target)}" target="_blank" style="display:block;text-decoration:none;color:inherit;">${blockTable}</a>`
    : blockTable;

  return `
        <tr>
          <td style="padding:0 28px 26px;">
            ${wrapped}
          </td>
        </tr>`;
}

function mailjetCustomBlocks(mailjetExport = false) {
  return customBlocks.map(block => {
    block = normalizeBlock(block);

    if (block.type === 'button') {
      return `
        <tr>
          <td align="center" style="padding:0 28px 26px;">
            <a href="${esc(ensureExternalUrl(block.url || UNIPOP_CATALOG_URL))}" target="_blank" style="display:inline-block;background:#0d1f59;color:#ffffff;text-decoration:none;border-radius:10px;padding:13px 18px;font-weight:900;font-family:Arial,Helvetica,sans-serif;">${esc(block.button || 'Découvrir')}</a>
          </td>
        </tr>`;
    }

    return mailjetContentBlock(block, mailjetExport);
  }).join('');
}

function mailjetFooter() {
  return `
        <tr>
          <td style="padding:0;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#55b9b8;border-collapse:collapse;width:100%;">
              <tr>
                <td align="center" style="padding:24px 28px 14px;text-align:center;">
                  <a href="https://www.facebook.com/unipopluxembourg/" target="_blank" rel="noopener" style="text-decoration:none;margin:0 10px;display:inline-block;">
                    <img src="https://cdn-icons-png.flaticon.com/512/733/733547.png" alt="Facebook" width="42" height="42" style="display:inline-block;border:0;outline:none;text-decoration:none;border-radius:50%;">
                  </a>
                  <a href="https://www.instagram.com/unipopluxembourg/" target="_blank" rel="noopener" style="text-decoration:none;margin:0 10px;display:inline-block;">
                    <img src="https://cdn-icons-png.flaticon.com/512/2111/2111463.png" alt="Instagram" width="42" height="42" style="display:inline-block;border:0;outline:none;text-decoration:none;border-radius:50%;">
                  </a>
                  <a href="https://lu.linkedin.com/company/universit%C3%A9-populaire-luxembourg" target="_blank" rel="noopener" style="text-decoration:none;margin:0 10px;display:inline-block;">
                    <img src="https://cdn-icons-png.flaticon.com/512/3536/3536505.png" alt="LinkedIn" width="42" height="42" style="display:inline-block;border:0;outline:none;text-decoration:none;border-radius:50%;">
                  </a>
                </td>
              </tr>
              <tr>
                <td style="padding:0 28px 24px;">
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;width:100%;">
                    <tr>
                      <td align="left" style="font-family:Arial,Helvetica,sans-serif;">
                        <a href="mailto:info@unipop.lu" style="color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;">Contact</a>
                      </td>
                      <td align="center" style="font-family:Arial,Helvetica,sans-serif;">
                        <a href="https://www.unipop.lu" style="color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;">FAQ</a>
                      </td>
                      <td align="right" style="font-family:Arial,Helvetica,sans-serif;">
                        <a href="https://www.unipop.lu" style="color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;">unipop.lu</a>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>`;
}

function renderPreview() {
  $('newsletterPreview').innerHTML = buildNewsletterHtml();
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
$('exportBtn').addEventListener('click', () => {
  const html = buildNewsletterHtml(true);
  if (/data:image\//i.test(html)) {
    alert('Attention : une image Base64 est encore présente. Utilise uniquement des URLs publiques HTTPS pour Mailjet.');
  }
  if (html.includes('[PERMALINK]')) {
    alert('Attention : le placeholder [PERMALINK] est encore présent.');
  }
  $('exportHtml').value = html;
  $('exportDialog').showModal();
});

$('previewBtn').addEventListener('click', () => {
  renderCourses();
  renderBlocksEditor();
  renderPreview();

  const previewHtml = buildNewsletterHtml(false);
  const previewWindow = window.open('', 'newsletterPreviewWindow', 'width=1000,height=900,scrollbars=yes,resizable=yes');

  if (!previewWindow) {
    alert('La fenêtre d’aperçu a été bloquée. Autorise les pop-ups pour cette page.');
    return;
  }

  previewWindow.document.open();
  previewWindow.document.write(`
<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>Aperçu Newsletter Mailjet</title>
<style>
  html, body {
    margin:0;
    padding:0;
    background:#eef2f7;
    font-family:Arial,Helvetica,sans-serif;
  }
</style>
</head>
<body>
${previewHtml}
</body>
</html>`);
  previewWindow.document.close();
});

$('closeDialog').addEventListener('click', () => $('exportDialog').close());
$('copyHtml').addEventListener('click', async () => { await navigator.clipboard.writeText($('exportHtml').value); alert('HTML copié.'); });

loadState();
renderBlocksEditor();
renderPreview();
loadCourses();
