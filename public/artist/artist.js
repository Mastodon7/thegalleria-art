(function () {
  const state = {
    account: {},
    artist: {},
    galleries: [],
    artwork: [],
    media: []
  };

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function attr(value) {
    return escapeHtml(value);
  }

  function badge(value) {
    return `<span class="admin-badge status-${escapeHtml(value)}">${escapeHtml(value)}</span>`;
  }

  function publicArtistUrl() {
    return state.artist.canonicalPath || `/${state.artist.slug || ""}/`;
  }

  function galleryById(id) {
    return state.galleries.find((gallery) => gallery.id === id);
  }

  function setText(id, value) {
    const element = document.getElementById(id);
    if (element) {
      element.textContent = value;
    }
  }

  function setPublicLinks() {
    document.querySelectorAll("#artist-public-view").forEach((link) => {
      link.href = publicArtistUrl();
    });
  }

  function messageElement() {
    let element = document.getElementById("artist-message");

    if (!element) {
      const main = document.querySelector(".admin-dashboard");
      element = document.createElement("div");
      element.id = "artist-message";
      element.className = "admin-message";
      element.hidden = true;
      main?.prepend(element);
    }

    return element;
  }

  function showMessage(type, message, errors) {
    const element = messageElement();
    element.className = `admin-message ${type}`;
    element.hidden = false;
    element.innerHTML = `
      <strong>${escapeHtml(message)}</strong>
      ${errors?.length ? `<ul>${errors.map((error) => `<li>${escapeHtml(error)}</li>`).join("")}</ul>` : ""}
    `;
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {})
      },
      ...options
    });
    const payload = await response.json();

    if (response.status === 401) {
      window.location.href = "/artist/login/";
      throw new Error("Artist login required");
    }

    return payload;
  }

  function applyContent(content) {
    state.account = content.account || {};
    state.artist = content.artist || {};
    state.galleries = content.galleries || [];
    state.artwork = content.artwork || [];
    state.media = content.media || [];
    setPublicLinks();
  }

  async function loadContent() {
    const payload = await api("/artist/api/content");
    applyContent(payload.content || {});
  }

  function field(name, label, value, type = "text") {
    return `
      <label>
        <span>${label}</span>
        <input name="${name}" type="${type}" value="${attr(value)}">
      </label>
    `;
  }

  function textarea(name, label, value) {
    return `
      <label class="admin-field-wide">
        <span>${label}</span>
        <textarea name="${name}">${escapeHtml(value)}</textarea>
      </label>
    `;
  }

  function select(name, label, value, options) {
    return `
      <label>
        <span>${label}</span>
        <select name="${name}">
          ${options.map((option) => `
            <option value="${attr(option.value)}"${option.value === value ? " selected" : ""}>${escapeHtml(option.label)}</option>
          `).join("")}
        </select>
      </label>
    `;
  }

  function imageField(name, label, value) {
    const media = state.media.filter((item) => item.status !== "archived");
    return `
      <div class="admin-image-field">
        <label>
          <span>${label}</span>
          <input name="${name}" type="text" value="${attr(value)}" data-artist-image-input="${name}">
        </label>
        <label>
          <span>Choose Referenced Image</span>
          <select data-artist-media-select="${name}">
            <option value="">Select image</option>
            ${media.map((item) => `
              <option value="${attr(item.publicPath)}"${item.publicPath === value ? " selected" : ""}>${escapeHtml(item.originalFilename || item.publicPath)}</option>
            `).join("")}
          </select>
        </label>
        <div class="admin-image-preview" data-artist-image-preview="${name}">
          ${value ? `<img src="${attr(value)}" alt="">` : "<span>No image selected</span>"}
        </div>
      </div>
    `;
  }

  function formData(form) {
    const data = {};
    [...form.elements].forEach((element) => {
      if (element.name) {
        data[element.name] = element.value;
      }
    });
    return data;
  }

  function updateImagePreview(name, value) {
    const preview = document.querySelector(`[data-artist-image-preview="${name}"]`);
    if (preview) {
      preview.innerHTML = value ? `<img src="${attr(value)}" alt="">` : "<span>No image selected</span>";
    }
  }

  function renderDashboard() {
    setText("artist-name", state.artist.name);
    setText("artist-summary", `${state.artist.professionalTitle || ""}${state.account.demo ? " - Demo account" : ""}`);
    setText("artist-gallery-count", state.galleries.length);
    setText("artist-artwork-count", state.artwork.length);
    setText("artist-profile-status", state.artist.status || "-");
    setText("artist-invitation-status", state.artist.invitationStatus || "-");

    const list = document.getElementById("artist-recent-list");
    if (list) {
      list.innerHTML = state.artwork.slice(0, 6).map((artwork) => `
        <article class="artist-recent-item">
          <img src="${attr(artwork.image)}" alt="">
          <div>
            <h3>${escapeHtml(artwork.title)}</h3>
            <p>${escapeHtml(galleryById(artwork.galleryId)?.title || "")} - ${badge(artwork.status)}</p>
          </div>
        </article>
      `).join("");
    }
  }

  function renderProfileForm() {
    const form = document.getElementById("artist-profile-form");
    if (!form) {
      return;
    }

    form.innerHTML = `
      ${field("name", "Name", state.artist.name)}
      ${field("professionalTitle", "Professional Title", state.artist.professionalTitle)}
      ${field("city", "City", state.artist.city)}
      ${field("region", "State / Region", state.artist.region)}
      ${field("country", "Country", state.artist.country)}
      ${field("medium", "Medium", state.artist.medium)}
      ${field("category", "Category", state.artist.category)}
      ${imageField("heroImage", "Hero Image", state.artist.heroImage)}
      ${field("contactEmail", "Contact Email", state.artist.contactEmail, "email")}
      ${field("website", "Website", state.artist.website)}
      ${field("socialLinks", "Instagram / Social Link", (state.artist.socialLinks || []).join(", "))}
      ${textarea("shortDescription", "Short Description", state.artist.shortDescription)}
      ${textarea("bio", "Long Bio / Artist Statement", state.artist.bio)}
    `;
  }

  function renderGalleryForm(gallery = state.galleries[0] || {}) {
    const form = document.getElementById("artist-gallery-form");
    if (!form) {
      return;
    }

    form.dataset.galleryId = gallery.id || "";
    form.innerHTML = `
      ${field("title", "Gallery Title", gallery.title)}
      ${field("slugDisplay", "Slug", gallery.slug)}
      ${imageField("coverImage", "Cover Image", gallery.coverImage)}
      ${field("displayOrder", "Display Order", gallery.displayOrder || 0, "number")}
      ${textarea("description", "Description", gallery.description)}
    `;
    form.querySelector('[name="slugDisplay"]')?.setAttribute("disabled", "disabled");
  }

  function renderGalleries() {
    const table = document.getElementById("artist-galleries-table");
    if (!table) {
      return;
    }

    table.innerHTML = state.galleries.map((gallery) => {
      const count = state.artwork.filter((artwork) => artwork.galleryId === gallery.id).length;
      return `
        <tr>
          <td>${escapeHtml(gallery.title)}</td>
          <td>${escapeHtml(gallery.slug)}</td>
          <td>${badge(gallery.status)}</td>
          <td>${gallery.featured ? "Yes" : "No"}</td>
          <td>${count}</td>
          <td>${gallery.status === "published" ? `<a href="${publicArtistUrl()}">${publicArtistUrl()}</a>` : "Not public"}</td>
          <td class="admin-actions">
            <button type="button" data-artist-edit-gallery="${attr(gallery.id)}">Edit</button>
          </td>
        </tr>
      `;
    }).join("");

    renderGalleryForm();
  }

  function renderArtworkForm(artwork = state.artwork[0] || {}) {
    const form = document.getElementById("artist-artwork-form");
    if (!form) {
      return;
    }

    const galleryOptions = state.galleries.map((gallery) => ({ value: gallery.id, label: gallery.title }));
    form.dataset.artworkId = artwork.id || "";
    form.innerHTML = `
      ${field("title", "Artwork Title", artwork.title)}
      ${select("galleryId", "Gallery", artwork.galleryId || galleryOptions[0]?.value || "", galleryOptions)}
      ${imageField("image", "Artwork Image", artwork.image)}
      ${field("alt", "Alt Text", artwork.alt)}
      ${field("year", "Year", artwork.year)}
      ${field("location", "Location", artwork.location)}
      ${field("medium", "Medium", artwork.medium)}
      ${field("dimensions", "Dimensions", artwork.dimensions)}
      ${field("displayOrder", "Display Order", artwork.displayOrder || 0, "number")}
      ${textarea("description", "Short Description", artwork.description)}
    `;
  }

  function renderArtwork() {
    const table = document.getElementById("artist-artwork-table");
    if (!table) {
      return;
    }

    table.innerHTML = state.artwork.map((artwork) => `
      <tr>
        <td><img class="artist-thumb" src="${attr(artwork.image)}" alt=""></td>
        <td>${escapeHtml(artwork.title)}</td>
        <td>${escapeHtml(galleryById(artwork.galleryId)?.title || "")}</td>
        <td>${badge(artwork.status)}</td>
        <td>${escapeHtml(artwork.displayOrder)}</td>
        <td class="admin-actions">
          <button type="button" data-artist-edit-artwork="${attr(artwork.id)}">Edit</button>
        </td>
      </tr>
    `).join("");

    renderArtworkForm();
  }

  function renderMedia() {
    const grid = document.getElementById("artist-media-grid");
    if (!grid) {
      return;
    }

    if (!state.media.length) {
      grid.innerHTML = '<p class="empty-state">No images are attached to this artist profile yet.</p>';
      return;
    }

    grid.innerHTML = state.media.map((item) => `
      <article class="admin-media-card">
        <img src="${attr(item.publicPath)}" alt="">
        <div>
          <h3>${escapeHtml(item.originalFilename || item.publicPath)}</h3>
          <p>${escapeHtml(item.publicPath)}</p>
          <p>${escapeHtml(item.status || "referenced")}</p>
        </div>
      </article>
    `).join("");
  }

  function renderAll() {
    renderDashboard();
    renderProfileForm();
    renderGalleries();
    renderArtwork();
    renderMedia();
  }

  async function saveProfile(form) {
    const payload = await api("/artist/api/profile", {
      method: "POST",
      body: JSON.stringify(formData(form))
    });
    if (payload.content) {
      applyContent(payload.content);
      renderAll();
    }
    showMessage(payload.ok ? "success" : "error", payload.message || "Save failed.", payload.errors);
  }

  async function saveGallery(form) {
    const id = form.dataset.galleryId;
    const payload = await api(`/artist/api/galleries/${encodeURIComponent(id)}`, {
      method: "POST",
      body: JSON.stringify(formData(form))
    });
    if (payload.content) {
      applyContent(payload.content);
      renderAll();
    }
    showMessage(payload.ok ? "success" : "error", payload.message || "Save failed.", payload.errors);
  }

  async function saveArtwork(form) {
    const id = form.dataset.artworkId;
    const payload = await api(`/artist/api/artwork/${encodeURIComponent(id)}`, {
      method: "POST",
      body: JSON.stringify(formData(form))
    });
    if (payload.content) {
      applyContent(payload.content);
      renderAll();
    }
    showMessage(payload.ok ? "success" : "error", payload.message || "Save failed.", payload.errors);
  }

  function bindEvents() {
    document.addEventListener("click", (event) => {
      const galleryEdit = event.target.closest("[data-artist-edit-gallery]");
      const artworkEdit = event.target.closest("[data-artist-edit-artwork]");

      if (galleryEdit) {
        renderGalleryForm(state.galleries.find((gallery) => gallery.id === galleryEdit.dataset.artistEditGallery));
      }

      if (artworkEdit) {
        renderArtworkForm(state.artwork.find((artwork) => artwork.id === artworkEdit.dataset.artistEditArtwork));
      }
    });

    document.addEventListener("change", (event) => {
      const mediaSelect = event.target.closest("[data-artist-media-select]");
      if (mediaSelect?.value) {
        const input = document.querySelector(`[name="${mediaSelect.dataset.artistMediaSelect}"]`);
        if (input) {
          input.value = mediaSelect.value;
          updateImagePreview(mediaSelect.dataset.artistMediaSelect, mediaSelect.value);
        }
      }
    });

    document.addEventListener("input", (event) => {
      const imageInput = event.target.closest("[data-artist-image-input]");
      if (imageInput) {
        updateImagePreview(imageInput.dataset.artistImageInput, imageInput.value);
      }
    });

    const profileForm = document.getElementById("artist-profile-form");
    const galleryForm = document.getElementById("artist-gallery-form");
    const artworkForm = document.getElementById("artist-artwork-form");

    profileForm?.addEventListener("submit", (event) => {
      event.preventDefault();
      saveProfile(profileForm);
    });

    galleryForm?.addEventListener("submit", (event) => {
      event.preventDefault();
      saveGallery(galleryForm);
    });

    artworkForm?.addEventListener("submit", (event) => {
      event.preventDefault();
      saveArtwork(artworkForm);
    });
  }

  bindEvents();
  loadContent()
    .then(renderAll)
    .catch(() => {
      showMessage("error", "Unable to load artist portal content.");
    });
}());
