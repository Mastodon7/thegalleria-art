(function () {
  const lightbox = document.getElementById("dynamic-lightbox");
  const image = document.getElementById("dynamic-lightbox-image");
  const title = document.getElementById("dynamic-lightbox-title");
  const meta = document.getElementById("dynamic-lightbox-meta");
  const close = document.querySelector(".dynamic-lightbox-close");
  const prev = document.querySelector(".dynamic-lightbox-prev");
  const next = document.querySelector(".dynamic-lightbox-next");
  const triggers = [...document.querySelectorAll(".dynamic-lightbox-trigger")];
  let current = 0;

  function render() {
    const trigger = triggers[current];
    image.src = trigger.dataset.src;
    image.alt = trigger.dataset.title || "Artwork";
    title.textContent = trigger.dataset.title || "";
    meta.textContent = trigger.dataset.meta || "";
  }

  function open(index) {
    current = index;
    render();
    lightbox.hidden = false;
    lightbox.classList.add("open");
    document.body.style.overflow = "hidden";
    close.focus();
  }

  function closeLightbox() {
    lightbox.classList.remove("open");
    lightbox.hidden = true;
    document.body.style.overflow = "";
    image.removeAttribute("src");
  }

  function move(direction) {
    current = (current + direction + triggers.length) % triggers.length;
    render();
  }

  triggers.forEach((trigger, index) => {
    trigger.addEventListener("click", () => open(index));
  });

  close?.addEventListener("click", closeLightbox);
  prev?.addEventListener("click", () => move(-1));
  next?.addEventListener("click", () => move(1));
  lightbox?.addEventListener("click", (event) => {
    if (!event.target.closest("figure, button")) {
      closeLightbox();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (!lightbox || !lightbox.classList.contains("open")) {
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      closeLightbox();
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      move(1);
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      move(-1);
    }
  });
}());
