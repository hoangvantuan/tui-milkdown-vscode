import { copySvgAsPng } from './svg-to-png';

let scale = 1;
let translateX = 0;
let translateY = 0;
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let dragStartTX = 0;
let dragStartTY = 0;
let currentTarget: HTMLElement | null = null;

const MIN_SCALE = 0.5;
const MAX_SCALE = 4;
const SCALE_STEP = 0.25;

function getElements() {
  return {
    overlay: document.getElementById('lightbox-overlay'),
    image: document.getElementById('lightbox-image') as HTMLImageElement | null,
    svgWrapper: document.getElementById('lightbox-svg'),
    caption: document.getElementById('lightbox-caption'),
    content: document.querySelector('.lightbox-content') as HTMLElement | null,
    zoomIn: document.getElementById('lightbox-zoom-in'),
    zoomOut: document.getElementById('lightbox-zoom-out'),
    zoomLevel: document.getElementById('lightbox-zoom-level'),
    close: document.getElementById('lightbox-close'),
    copy: document.getElementById('lightbox-copy'),
    backdrop: document.querySelector('.lightbox-backdrop'),
  };
}

function setCopyButtonVisibility(visible: boolean) {
  const { copy } = getElements();
  if (!copy) return;
  copy.classList.toggle('hidden', !visible);
  copy.classList.remove('is-copied');
}


function applyTransform() {
  const { zoomLevel } = getElements();
  if (currentTarget) {
    currentTarget.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
  }
  if (zoomLevel) zoomLevel.textContent = `${Math.round(scale * 100)}%`;
}

function setScale(newScale: number) {
  scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, newScale));
  if (scale <= 1) { translateX = 0; translateY = 0; }
  applyTransform();
  updateCursor();
}

function updateCursor() {
  if (!currentTarget) return;
  if (scale > 1) {
    currentTarget.classList.add('grabbable');
  } else {
    currentTarget.classList.remove('grabbable', 'grabbing');
  }
}

function resetState() {
  scale = 1;
  translateX = 0;
  translateY = 0;
  isDragging = false;
  if (currentTarget) {
    currentTarget.style.transform = '';
    currentTarget.classList.remove('grabbable', 'grabbing');
  }
}

function closeLightbox() {
  const { overlay, image, svgWrapper } = getElements();
  overlay?.classList.remove('active');
  resetState();
  if (svgWrapper) {
    svgWrapper.innerHTML = '';
    svgWrapper.classList.add('hidden');
  }
  image?.classList.remove('hidden');
  currentTarget = null;
  setCopyButtonVisibility(false);
  applyTransform();
}

function isActive(): boolean {
  return document.getElementById('lightbox-overlay')?.classList.contains('active') ?? false;
}

function setCaption(text: string) {
  const { caption } = getElements();
  if (!caption) return;
  if (text) {
    caption.textContent = text;
    caption.classList.remove('hidden');
  } else {
    caption.classList.add('hidden');
  }
}

export function openLightbox(src: string, alt: string): void {
  const { overlay, image, svgWrapper } = getElements();
  if (!overlay || !image) return;

  resetState();
  svgWrapper?.classList.add('hidden');
  image.classList.remove('hidden');
  image.src = src;
  currentTarget = image;
  setCopyButtonVisibility(false);

  setCaption(alt);
  overlay.classList.add('active');
  applyTransform();
}

export function openMermaidLightbox(svgMarkup: string, caption: string): void {
  const { overlay, image, svgWrapper } = getElements();
  if (!overlay || !svgWrapper) return;

  resetState();
  image?.classList.add('hidden');
  svgWrapper.innerHTML = svgMarkup;

  const svg = svgWrapper.querySelector('svg');
  if (svg) {
    svg.removeAttribute('width');
    svg.removeAttribute('height');
    svg.style.maxWidth = 'none';
    svg.style.maxHeight = 'none';
    svg.style.width = 'auto';
    svg.style.height = 'auto';
    svg.style.overflow = 'visible';
    if (!svg.getAttribute('preserveAspectRatio')) {
      svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    }
  }

  svgWrapper.classList.remove('hidden');
  currentTarget = svgWrapper;
  setCopyButtonVisibility(true);

  setCaption(caption);
  overlay.classList.add('active');
  applyTransform();
}

let initialized = false;

export function initLightbox(): void {
  if (initialized) return;
  initialized = true;
  const { close, backdrop, zoomIn, zoomOut, content, copy } = getElements();

  close?.addEventListener('click', closeLightbox);
  backdrop?.addEventListener('click', closeLightbox);
  zoomIn?.addEventListener('click', () => setScale(scale + SCALE_STEP));
  zoomOut?.addEventListener('click', () => setScale(scale - SCALE_STEP));
  copy?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!copy) return;
    void copySvgAsPng(copy, () => {
      const { svgWrapper } = getElements();
      const svgEl = svgWrapper?.querySelector('svg');
      return svgEl ? svgEl.outerHTML : null;
    });
  });
  setCopyButtonVisibility(false);

  document.addEventListener('keydown', (e) => {
    if (!isActive()) return;
    if (e.key === 'Escape') closeLightbox();
    if (e.key === '+' || e.key === '=') setScale(scale + SCALE_STEP);
    if (e.key === '-') setScale(scale - SCALE_STEP);
    if (e.key === '0') setScale(1);
  });

  document.getElementById('lightbox-overlay')?.addEventListener('wheel', (e) => {
    if (!isActive()) return;
    e.preventDefault();
    setScale(scale + (e.deltaY < 0 ? SCALE_STEP : -SCALE_STEP));
  }, { passive: false });

  content?.addEventListener('mousedown', (e) => {
    if (!currentTarget || scale <= 1) return;
    const target = e.target as HTMLElement;
    if (!currentTarget.contains(target) && target !== currentTarget) return;
    isDragging = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    dragStartTX = translateX;
    dragStartTY = translateY;
    currentTarget.classList.add('grabbing');
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    translateX = dragStartTX + (e.clientX - dragStartX);
    translateY = dragStartTY + (e.clientY - dragStartY);
    applyTransform();
  });

  document.addEventListener('mouseup', () => {
    if (!isDragging) return;
    isDragging = false;
    currentTarget?.classList.remove('grabbing');
  });
}
