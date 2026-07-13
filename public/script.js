const slides = [...document.querySelectorAll(".slide")];
const dots = document.getElementById("dots");
const counter = document.getElementById("counter");
const auto = document.getElementById("auto");
const prev = document.getElementById("prev");
const next = document.getElementById("next");

let current = 0;
let timer = null;

slides.forEach((slide, index) => {
  const button = document.createElement("button");
  button.textContent = index + 1;
  button.title = slide.dataset.title;
  button.onclick = () => show(index);
  dots.appendChild(button);
});

function show(index) {
  current = (index + slides.length) % slides.length;
  slides.forEach((slide, slideIndex) => {
    slide.classList.toggle("active", slideIndex === current);
  });
  [...dots.children].forEach((button, buttonIndex) => {
    button.classList.toggle("active", buttonIndex === current);
  });
  counter.textContent = `${current + 1} / ${slides.length}`;
}

function startAuto() {
  timer = setInterval(() => show(current + 1), 7000);
  auto.textContent = "Pause";
  auto.setAttribute("aria-pressed", "true");
}

function stopAuto() {
  clearInterval(timer);
  timer = null;
  auto.textContent = "Auto";
  auto.setAttribute("aria-pressed", "false");
}

prev.onclick = () => show(current - 1);
next.onclick = () => show(current + 1);
auto.onclick = () => {
  if (timer) {
    stopAuto();
  } else {
    startAuto();
  }
};

const lightbox = document.getElementById("lightbox");
const lightboxImage = document.getElementById("lightbox-image");
const lightboxCaption = document.getElementById("lightbox-caption");
const lightboxClose = document.getElementById("lightbox-close");
const lightboxPrev = document.getElementById("lightbox-prev");
const lightboxNext = document.getElementById("lightbox-next");
const artworkTriggers = [...document.querySelectorAll(".artwork-trigger")];
const copyTriggers = [...document.querySelectorAll(".lightbox-copy-trigger")];
const artworks = artworkTriggers.map((trigger) => ({
  src: trigger.dataset.lightboxSrc,
  title: trigger.dataset.lightboxTitle,
  alt: trigger.querySelector("img")?.alt || trigger.dataset.lightboxTitle || "Artwork"
}));

let lightboxIndex = 0;
let lastFocusedElement = null;
let resumeAutoAfterLightbox = false;
let storedPortfolioIndex = 0;

function isLightboxOpen() {
  return lightbox.classList.contains("open");
}

function renderLightbox() {
  const artwork = artworks[lightboxIndex];
  lightboxImage.src = artwork.src;
  lightboxImage.alt = artwork.alt;
  lightboxCaption.textContent = artwork.title;
}

function openLightbox(index) {
  lightboxIndex = index;
  storedPortfolioIndex = current;
  lastFocusedElement = document.activeElement;
  resumeAutoAfterLightbox = Boolean(timer);

  if (timer) {
    stopAuto();
  }

  renderLightbox();
  lightbox.hidden = false;
  lightbox.classList.add("open");
  document.body.style.overflow = "hidden";
  lightboxClose.focus();
}

function closeLightbox() {
  lightbox.classList.remove("open");
  lightbox.hidden = true;
  document.body.style.overflow = "";
  lightboxImage.removeAttribute("src");
  show(storedPortfolioIndex);

  if (resumeAutoAfterLightbox) {
    startAuto();
  }

  if (lastFocusedElement) {
    lastFocusedElement.focus();
  }
}

function moveLightbox(direction) {
  lightboxIndex = (lightboxIndex + direction + artworks.length) % artworks.length;
  renderLightbox();
}

artworkTriggers.forEach((trigger, index) => {
  trigger.addEventListener("click", () => openLightbox(index));
});

copyTriggers.forEach((trigger) => {
  trigger.addEventListener("click", () => {
    const artworkIndex = artworks.findIndex((artwork) => artwork.src === trigger.dataset.lightboxSrc);
    if (artworkIndex >= 0) {
      openLightbox(artworkIndex);
    }
  });
});

lightboxClose.addEventListener("click", closeLightbox);
lightboxPrev.addEventListener("click", () => moveLightbox(-1));
lightboxNext.addEventListener("click", () => moveLightbox(1));
lightbox.addEventListener("click", (event) => {
  if (!event.target.closest(".lightbox img, .lightbox-button")) {
    closeLightbox();
  }
});

document.addEventListener("keydown", (event) => {
  if (isLightboxOpen()) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeLightbox();
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      moveLightbox(1);
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      moveLightbox(-1);
    }
    return;
  }

  if (event.key === "ArrowRight") {
    event.preventDefault();
    show(current + 1);
  }
  if (event.key === "ArrowLeft") {
    event.preventDefault();
    show(current - 1);
  }
});

show(0);
