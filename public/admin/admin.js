(function () {
  const statusOptions = ["draft", "published", "archived"];
  const invitationOptions = ["current", "invited", "pending", "none"];
  const state = {
    artists: [],
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

  function yesNo(value) {
    return value ? "Yes" : "No";
  }

  function badge(value) {
    return `<span class="admin-badge status-${escapeHtml(value)}">${escapeHtml(value)}</span>`;
  }

  function activeMedia() {
    return state.media.filter((media) => media.status !== "archived");
  }

  function publicArtistUrl(artist) {
    return artist?.canonicalPath || `/${artist?.slug || ""}/`;
  }

  function formatDate(value) {
    if (!value) {
      return "";
    }

    return new Date(value).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric"
    });
  }

  function formatBytes(value) {
    const bytes = Number(value || 0);

    if (bytes >= 1024 * 1024) {
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }

    if (bytes >= 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    }

    return `${bytes} B`;
  }

  function artistById(id) {
    return state.artists.find((artist) => artist.id === id);
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

  function messageElement() {
    let element = document.getElementById("admin-message");

    if (!element) {
      const main = document.querySelector(".admin-dashboard");
      element = document.createElement("div");
      element.id = "admin-message";
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
      showMessage("error", payload.message || "Unauthorized access. Please log in again.");
      window.location.href = "/admin/login/";
      throw new Error("Unauthorized");
    }

    return payload;
  }

  async function uploadApi(path, formData) {
    const response = await fetch(path, {
      method: "POST",
      credentials: "same-origin",
      body: formData
    });
    const payload = await response.json();

    if (response.status === 401) {
      showMessage("error", payload.message || "Unauthorized access. Please log in again.");
      window.location.href = "/admin/login/";
      throw new Error("Unauthorized");
    }

    return payload;
  }

  function applyContent(content) {
    state.artists = content.artists || [];
    state.galleries = content.galleries || [];
    state.artwork = content.artwork || [];
    state.media = content.media || [];
  }

  async function loadContent() {
    const payload = await api("/admin/api/content");
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

  function imageField(name, label, value) {
    const media = activeMedia();
    return `
      <div class="admin-image-field">
        <label>
          <span>${label}</span>
          <input name="${name}" type="text" value="${attr(value)}" data-image-input="${name}">
        </label>
        <label>
          <span>Choose Uploaded Image</span>
          <select data-media-select="${name}">
            <option value="">Select uploaded image</option>
            ${media.map((item) => `
              <option value="${attr(item.publicPath)}"${item.publicPath === value ? " selected" : ""}>${escapeHtml(item.originalFilename)}</option>
            `).join("")}
          </select>
        </label>
        <div class="admin-image-preview" data-image-preview="${name}">
          ${value ? `<img src="${attr(value)}" alt="">` : "<span>No image selected</span>"}
        </div>
      </div>
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

  function checkbox(name, label, value) {
    return `
      <label class="admin-checkbox">
        <input name="${name}" type="checkbox"${value ? " checked" : ""}>
        <span>${label}</span>
      </label>
    `;
  }

  function formData(form) {
    const data = {};
    [...form.elements].forEach((element) => {
      if (!element.name) {
        return;
      }

      if (element.type === "checkbox") {
        data[element.name] = element.checked;
        return;
      }

      data[element.name] = element.value;
    });
    return data;
  }

  function updateImagePreview(name, value) {
    const preview = document.querySelector(`[data-image-preview="${name}"]`);
    if (!preview) {
      return;
    }

    preview.innerHTML = value ? `<img src="${attr(value)}" alt="">` : "<span>No image selected</span>";
  }

  function renderDashboard() {
    setText("artist-count", state.artists.length);
    setText("gallery-count", state.galleries.length);
    setText("artwork-count", state.artwork.length);
    setText("media-count", activeMedia().length);
    setText("published-count", state.artists.filter((artist) => artist.status === "published").length);
  }

  function renderArtistForm(artist = {}) {
    const form = document.getElementById("artist-form");
    if (!form) {
      return;
    }

    form.innerHTML = `
      <input name="id" type="hidden" value="${attr(artist.id)}">
      ${field("name", "Name", artist.name)}
      ${field("slug", "Slug", artist.slug)}
      ${field("professionalTitle", "Professional Title", artist.professionalTitle)}
      ${field("city", "City", artist.city)}
      ${field("region", "State / Region", artist.region)}
      ${field("country", "Country", artist.country)}
      ${field("medium", "Medium", artist.medium)}
      ${field("category", "Category", artist.category)}
      ${imageField("heroImage", "Hero Image", artist.heroImage)}
      ${field("contactEmail", "Contact Email", artist.contactEmail, "email")}
      ${field("website", "Website", artist.website)}
      ${field("socialLinks", "Instagram / Social Link", (artist.socialLinks || []).join(", "))}
      ${select("status", "Status", artist.status || "draft", statusOptions.map((item) => ({ value: item, label: item })))}
      ${select("invitationStatus", "Invitation Status", artist.invitationStatus || "none", invitationOptions.map((item) => ({ value: item, label: item })))}
      ${checkbox("featured", "Featured", artist.featured)}
      ${textarea("shortDescription", "Short Description", artist.shortDescription)}
      ${textarea("bio", "Long Bio / Artist Statement", artist.bio)}
    `;
  }

  function renderArtists() {
    const table = document.getElementById("artists-table");
    if (!table) {
      return;
    }

    table.innerHTML = state.artists.map((artist) => `
      <tr>
        <td>${escapeHtml(artist.name)}</td>
        <td>${escapeHtml(artist.slug)}</td>
        <td>${escapeHtml(artist.professionalTitle)}</td>
        <td>${escapeHtml([artist.city, artist.region].filter(Boolean).join(", "))}</td>
        <td>${badge(artist.status)}</td>
        <td>${yesNo(artist.featured)}</td>
        <td>${artist.status === "published" ? `<a href="${publicArtistUrl(artist)}">${publicArtistUrl(artist)}</a>` : "Not public"}</td>
        <td>${formatDate(artist.updatedAt)}</td>
        <td class="admin-actions">
          <button type="button" data-edit-artist="${attr(artist.id)}">Edit</button>
          <a href="${publicArtistUrl(artist)}">View Public Page</a>
          <button type="button" data-archive-artist="${attr(artist.id)}"${artist.protected ? " disabled title=\"Seed record is protected\"" : ""}>Archive</button>
        </td>
      </tr>
    `).join("");

    renderArtistForm(state.artists[0] || {});
  }

  function renderGalleryForm(gallery = {}) {
    const form = document.getElementById("gallery-form");
    if (!form) {
      return;
    }

    const artistOptions = state.artists.map((artist) => ({ value: artist.id, label: artist.name }));
    form.innerHTML = `
      <input name="id" type="hidden" value="${attr(gallery.id)}">
      ${field("title", "Gallery Title", gallery.title)}
      ${field("slug", "Gallery Slug", gallery.slug)}
      ${select("artistId", "Associated Artist", gallery.artistId || artistOptions[0]?.value || "", artistOptions)}
      ${imageField("coverImage", "Cover Image", gallery.coverImage)}
      ${select("status", "Status", gallery.status || "draft", statusOptions.map((item) => ({ value: item, label: item })))}
      ${checkbox("featured", "Featured", gallery.featured)}
      ${field("displayOrder", "Display Order", gallery.displayOrder || 0, "number")}
      ${textarea("description", "Short Description", gallery.description)}
    `;
  }

  function renderGalleries() {
    const table = document.getElementById("galleries-table");
    if (!table) {
      return;
    }

    table.innerHTML = state.galleries.map((gallery) => {
      const artist = artistById(gallery.artistId);
      return `
        <tr>
          <td>${escapeHtml(gallery.title)}</td>
          <td>${escapeHtml(gallery.slug)}</td>
          <td>${escapeHtml(artist?.name)}</td>
          <td>${badge(gallery.status)}</td>
          <td>${yesNo(gallery.featured)}</td>
          <td>${escapeHtml(gallery.displayOrder)}</td>
          <td>${gallery.status === "published" && artist ? `<a href="${publicArtistUrl(artist)}">${publicArtistUrl(artist)}</a>` : "Not public"}</td>
          <td>${formatDate(gallery.updatedAt)}</td>
          <td class="admin-actions">
            <button type="button" data-edit-gallery="${attr(gallery.id)}">Edit</button>
            ${artist ? `<a href="${publicArtistUrl(artist)}">View Public Gallery</a>` : ""}
            <button type="button" data-archive-gallery="${attr(gallery.id)}"${gallery.protected ? " disabled title=\"Seed record is protected\"" : ""}>Archive</button>
          </td>
        </tr>
      `;
    }).join("");

    renderGalleryForm(state.galleries[0] || {});
  }

  function renderArtworkForm(artwork = {}) {
    const form = document.getElementById("artwork-form");
    if (!form) {
      return;
    }

    const artistOptions = state.artists.map((artist) => ({ value: artist.id, label: artist.name }));
    const galleryOptions = state.galleries.map((gallery) => {
      const artist = artistById(gallery.artistId);
      return { value: gallery.id, label: `${gallery.title}${artist ? ` - ${artist.name}` : ""}` };
    });

    form.innerHTML = `
      <input name="id" type="hidden" value="${attr(artwork.id)}">
      ${field("title", "Artwork Title", artwork.title)}
      ${select("artistId", "Artist", artwork.artistId || artistOptions[0]?.value || "", artistOptions)}
      ${select("galleryId", "Gallery", artwork.galleryId || galleryOptions[0]?.value || "", galleryOptions)}
      ${imageField("image", "Artwork Image", artwork.image)}
      ${field("alt", "Alt Text", artwork.alt)}
      ${field("year", "Year", artwork.year)}
      ${field("location", "Location", artwork.location)}
      ${field("medium", "Medium", artwork.medium)}
      ${field("dimensions", "Dimensions", artwork.dimensions)}
      ${field("displayOrder", "Display Order", artwork.displayOrder || 0, "number")}
      ${select("status", "Status", artwork.status || "draft", statusOptions.map((item) => ({ value: item, label: item })))}
      ${textarea("description", "Short Description", artwork.description)}
    `;
  }

  function renderArtwork() {
    const table = document.getElementById("artwork-table");
    if (!table) {
      return;
    }

    table.innerHTML = state.artwork.map((artwork) => {
      const artist = artistById(artwork.artistId);
      const gallery = galleryById(artwork.galleryId);
      return `
        <tr>
          <td>${escapeHtml(artwork.title)}</td>
          <td>${escapeHtml(artist?.name)}</td>
          <td>${escapeHtml(gallery?.title)}</td>
          <td>${escapeHtml(artwork.year)}</td>
          <td>${escapeHtml(artwork.location)}</td>
          <td>${escapeHtml(artwork.displayOrder)}</td>
          <td>${badge(artwork.status)}</td>
          <td>${formatDate(artwork.updatedAt)}</td>
          <td class="admin-actions">
            <button type="button" data-edit-artwork="${attr(artwork.id)}">Edit</button>
            <button type="button" data-archive-artwork="${attr(artwork.id)}"${artwork.protected ? " disabled title=\"Seed record is protected\"" : ""}>Archive</button>
          </td>
        </tr>
      `;
    }).join("");

    renderArtworkForm(state.artwork[0] || {});
  }

  function renderMedia() {
    const grid = document.getElementById("media-grid");
    if (!grid) {
      return;
    }

    const media = state.media.slice().sort((left, right) => String(right.uploadedAt || "").localeCompare(String(left.uploadedAt || "")));
    if (!media.length) {
      grid.innerHTML = '<p class="empty-state">No uploaded images yet.</p>';
      return;
    }

    grid.innerHTML = media.map((item) => `
      <article class="admin-media-card ${item.status === "archived" ? "archived" : ""}">
        <img src="${attr(item.publicPath)}" alt="${attr(item.originalFilename)}">
        <div>
          <h3>${escapeHtml(item.originalFilename)}</h3>
          <p>${escapeHtml(item.publicPath)}</p>
          <p>${escapeHtml(item.mimeType)} · ${formatBytes(item.size)}${item.width && item.height ? ` · ${item.width}x${item.height}` : ""}</p>
          <p>Uploaded ${formatDate(item.uploadedAt)} · ${badge(item.status)}</p>
        </div>
        <div class="admin-actions">
          <button type="button" data-copy-path="${attr(item.publicPath)}">Copy Path</button>
          <button type="button" data-archive-media="${attr(item.id)}"${item.status === "archived" ? " disabled" : ""}>Archive</button>
        </div>
      </article>
    `).join("");
  }

  function renderAll() {
    renderDashboard();
    renderArtists();
    renderGalleries();
    renderArtwork();
    renderMedia();
  }

  function updateFromPayload(payload) {
    if (payload.content) {
      applyContent(payload.content);
      renderAll();
    }
  }

  async function save(resource, form, endpoint) {
    const payload = await api(endpoint, {
      method: "POST",
      body: JSON.stringify(formData(form))
    });

    updateFromPayload(payload);
    showMessage(payload.ok ? "success" : "error", payload.message || "Save failed.", payload.errors);
  }

  async function archive(id, endpoint) {
    if (!window.confirm("Archive this record? It will no longer appear publicly.")) {
      return;
    }

    const payload = await api(`${endpoint}/${encodeURIComponent(id)}/archive`, { method: "POST", body: "{}" });
    updateFromPayload(payload);
    showMessage(payload.ok ? "success" : "error", payload.message || "Archive failed.");
  }

  async function uploadMedia(form) {
    const payload = await uploadApi("/admin/api/media/upload", new FormData(form));
    updateFromPayload(payload);
    showMessage(payload.ok ? "success" : "error", payload.message || "Upload failed.");
    if (payload.ok) {
      form.reset();
    }
  }

  async function copyPath(value) {
    try {
      await navigator.clipboard.writeText(value);
      showMessage("success", "Image path copied.");
    } catch (error) {
      window.prompt("Copy image path", value);
    }
  }

  function bindEvents() {
    document.addEventListener("click", (event) => {
      const artistEdit = event.target.closest("[data-edit-artist]");
      const galleryEdit = event.target.closest("[data-edit-gallery]");
      const artworkEdit = event.target.closest("[data-edit-artwork]");
      const artistArchive = event.target.closest("[data-archive-artist]");
      const galleryArchive = event.target.closest("[data-archive-gallery]");
      const artworkArchive = event.target.closest("[data-archive-artwork]");
      const mediaArchive = event.target.closest("[data-archive-media]");
      const copyButton = event.target.closest("[data-copy-path]");

      if (artistEdit) {
        renderArtistForm(state.artists.find((artist) => artist.id === artistEdit.dataset.editArtist) || {});
      }
      if (galleryEdit) {
        renderGalleryForm(state.galleries.find((gallery) => gallery.id === galleryEdit.dataset.editGallery) || {});
      }
      if (artworkEdit) {
        renderArtworkForm(state.artwork.find((artwork) => artwork.id === artworkEdit.dataset.editArtwork) || {});
      }
      if (artistArchive) {
        archive(artistArchive.dataset.archiveArtist, "/admin/api/artists");
      }
      if (galleryArchive) {
        archive(galleryArchive.dataset.archiveGallery, "/admin/api/galleries");
      }
      if (artworkArchive) {
        archive(artworkArchive.dataset.archiveArtwork, "/admin/api/artwork");
      }
      if (mediaArchive) {
        archive(mediaArchive.dataset.archiveMedia, "/admin/api/media");
      }
      if (copyButton) {
        copyPath(copyButton.dataset.copyPath);
      }
      if (event.target.id === "add-artist") {
        renderArtistForm({});
      }
      if (event.target.id === "add-gallery") {
        renderGalleryForm({});
      }
      if (event.target.id === "add-artwork") {
        renderArtworkForm({});
      }
    });

    document.addEventListener("change", (event) => {
      const mediaSelect = event.target.closest("[data-media-select]");
      if (mediaSelect?.value) {
        const input = document.querySelector(`[name="${mediaSelect.dataset.mediaSelect}"]`);
        if (input) {
          input.value = mediaSelect.value;
          updateImagePreview(mediaSelect.dataset.mediaSelect, mediaSelect.value);
        }
      }
    });

    document.addEventListener("input", (event) => {
      const imageInput = event.target.closest("[data-image-input]");
      if (imageInput) {
        updateImagePreview(imageInput.dataset.imageInput, imageInput.value);
      }
    });

    const artistForm = document.getElementById("artist-form");
    const galleryForm = document.getElementById("gallery-form");
    const artworkForm = document.getElementById("artwork-form");
    const mediaUploadForm = document.getElementById("media-upload-form");

    artistForm?.addEventListener("submit", (event) => {
      event.preventDefault();
      save("artist", artistForm, "/admin/api/artists");
    });

    galleryForm?.addEventListener("submit", (event) => {
      event.preventDefault();
      save("gallery", galleryForm, "/admin/api/galleries");
    });

    artworkForm?.addEventListener("submit", (event) => {
      event.preventDefault();
      save("artwork", artworkForm, "/admin/api/artwork");
    });

    mediaUploadForm?.addEventListener("submit", (event) => {
      event.preventDefault();
      uploadMedia(mediaUploadForm);
    });
  }

  bindEvents();
  loadContent()
    .then(renderAll)
    .catch(() => {
      showMessage("error", "Unable to load admin content.");
    });
}());
