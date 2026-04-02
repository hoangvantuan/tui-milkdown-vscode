let scale = 1;
let translateX = 0;
let translateY = 0;
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let dragStartTX = 0;
let dragStartTY = 0;

const MIN_SCALE = 0.5;
const MAX_SCALE = 4;
const SCALE_STEP = 0.25;

function getElements() {
  return {
    overlay: document.getElementById('lightbox-overlay'),
    image: document.getElementById('lightbox-image') as HTMLImageElement | null,
    caption: document.getElementById('lightbox-caption'),
    zoomIn: document.getElementById('lightbox-zoom-in'),
    zoomOut: document.getElementById('lightbox-zoom-out'),
    zoomLevel: document.getElementById('lightbox-zoom-level'),
    close: document.getElementById('lightbox-close'),
    backdrop: document.querySelector('.lightbox-backdrop'),
  };
}

function applyTransform() {
  const { image, zoomLevel } = getElements();
  if (!image) return;
  image.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
  if (zoomLevel) zoomLevel.textContent = `${Math.round(scale * 100)}%`;
}

function setScale(newScale: number) {
  scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, newScale));
  if (scale <= 1) { translateX = 0; translateY = 0; }
  applyTransform();
}

function closeLightbox() {
  const { overlay } = getElements();
  overlay?.classList.remove('active');
  scale = 1;
  translateX = 0;
  translateY = 0;
  isDragging = false;
  applyTransform();
}

function isActive(): boolean {
  return document.getElementById('lightbox-overlay')?.classList.contains('active') ?? false;
}

export function openLightbox(src: string, alt: string): void {
  const { overlay, image, caption } = getElements();
  if (!overlay || !image) return;

  scale = 1;
  translateX = 0;
  translateY = 0;
  image.src = src;
  image.style.transform = '';

  if (caption) {
    if (alt) {
      caption.textContent = alt;
      caption.classList.remove('hidden');
    } else {
      caption.classList.add('hidden');
    }
  }

  overlay.classList.add('active');
  applyTransform();
}

let initialized = false;

export function initLightbox(): void {
  if (initialized) return;
  initialized = true;
  const { close, backdrop, zoomIn, zoomOut, image } = getElements();

  close?.addEventListener('click', closeLightbox);
  backdrop?.addEventListener('click', closeLightbox);
  zoomIn?.addEventListener('click', () => setScale(scale + SCALE_STEP));
  zoomOut?.addEventListener('click', () => setScale(scale - SCALE_STEP));

  document.addEventListener('keydown', (e) => {
    if (!isActive()) return;
    if (e.key === 'Escape') closeLightbox();
    if (e.key === '+' || e.key === '=') setScale(scale + SCALE_STEP);
    if (e.key === '-') setScale(scale - SCALE_STEP);
  });

  document.getElementById('lightbox-overlay')?.addEventListener('wheel', (e) => {
    if (!isActive()) return;
    e.preventDefault();
    setScale(scale + (e.deltaY < 0 ? SCALE_STEP : -SCALE_STEP));
  }, { passive: false });

  image?.addEventListener('mousedown', (e) => {
    if (scale <= 1) return;
    isDragging = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    dragStartTX = translateX;
    dragStartTY = translateY;
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    translateX = dragStartTX + (e.clientX - dragStartX);
    translateY = dragStartTY + (e.clientY - dragStartY);
    applyTransform();
  });

  document.addEventListener('mouseup', () => { isDragging = false; });
}
