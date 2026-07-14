(function () {
  const statusOptions = ["draft", "pending_review", "approved", "published", "changes_requested", "archived"];
  const invitationOptions = ["current", "invited", "pending", "accepted", "none"];
  const inquiryStatusOptions = ["new", "reviewed", "replied", "archived", "spam"];
  const state = {
    artists: [],
    galleries: [],
    artwork: [],
    media: [],
    inquiries: [],
    invitations: [],
    artistAccounts: [],
    statusHistory: [],
    selectedInquiryId: "",
    selectedReviewId: ""
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
    return state.media.filter((media) => media.status === "ready" || (!media.status && media.publicPath));
  }

  function mediaVariant(item, preferred) {
    return item?.variants?.[preferred] || item?.variants?.gallery || item?.variants?.large || item?.variants?.thumbnail || null;
  }

  function mediaPath(item, preferred = "gallery") {
    return mediaVariant(item, preferred)?.path || item?.publicPath || "";
  }

  function mediaDimensions(item) {
    const variant = mediaVariant(item, "large");
    const width = item.originalWidth || item.width || variant?.width;
    const height = item.originalHeight || item.height || variant?.height;
    return width && height ? `${width}x${height}` : "";
  }

  function mediaOwnerName(item) {
    return artistById(item.ownerArtistId)?.name || (item.ownerArtistId ? "Unknown artist" : "Admin / shared");
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

  function formatDateTime(value) {
    if (!value) {
      return "";
    }

    return new Date(value).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    });
  }

  function messagePreview(value, length = 120) {
    const message = String(value || "").replace(/\s+/g, " ").trim();
    return message.length > length ? `${message.slice(0, length - 1)}...` : message;
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

  function artworkById(id) {
    return state.artwork.find((artwork) => artwork.id === id);
  }

  function accountByArtistId(id) {
    return state.artistAccounts.find((account) => account.artistId === id);
  }

  function invitationByArtistId(id) {
    return sortedInvitations().find((invitation) => invitation.artistId === id);
  }

  function profileCompleteness(artist) {
    const checks = [
      artist.name,
      artist.professionalTitle,
      artist.contactEmail,
      artist.shortDescription,
      artist.heroImage
    ];
    const complete = checks.filter(Boolean).length;
    return `${complete}/${checks.length}`;
  }

  function sortedInquiries() {
    return state.inquiries.slice().sort((left, right) =>
      String(right.createdAt || "").localeCompare(String(left.createdAt || ""))
    );
  }

  function inquiryRelated(inquiry) {
    const artist = artistById(inquiry.artistId || inquiry.assignedArtistId);
    const gallery = galleryById(inquiry.galleryId);
    const artwork = artworkById(inquiry.artworkId);
    return {
      artist: artist?.name || "",
      gallery: gallery?.title || "",
      artwork: artwork?.title || ""
    };
  }

  function inquiryRelatedHtml(inquiry) {
    const related = inquiryRelated(inquiry);
    const parts = [related.artist, related.gallery, related.artwork].filter(Boolean);
    return parts.length ? parts.map(escapeHtml).join("<br>") : "General inquiry";
  }

  function mailtoForInquiry(inquiry) {
    const related = inquiryRelated(inquiry);
    const subject = encodeURIComponent(["The Galleria.Art Inquiry", related.artist, related.artwork || related.gallery].filter(Boolean).join(" - "));
    const body = encodeURIComponent(`Hello ${inquiry.visitorName || ""},\n\nThank you for your inquiry about ${[related.artist, related.artwork || related.gallery].filter(Boolean).join(" / ") || "The Galleria.Art"}.\n\n`);
    return `mailto:${encodeURIComponent(inquiry.visitorEmail)}?subject=${subject}&body=${body}`;
  }

  function sortedInvitations() {
    return state.invitations.slice().sort((left, right) =>
      String(right.createdAt || "").localeCompare(String(left.createdAt || ""))
    );
  }

  function invitationLink(invitation) {
    return invitation.token ? `${window.location.origin}/invite/${encodeURIComponent(invitation.token)}` : "";
  }

  function reviewItems() {
    return [
      ...state.artists.map((record) => ({ type: "artist", record, artistId: record.id, title: record.name })),
      ...state.galleries.map((record) => ({ type: "gallery", record, artistId: record.artistId, title: record.title })),
      ...state.artwork.map((record) => ({ type: "artwork", record, artistId: record.artistId, title: record.title }))
    ]
      .filter((item) => ["pending_review", "changes_requested", "approved"].includes(item.record.status))
      .sort((left, right) => String(right.record.submittedAt || right.record.updatedAt || "").localeCompare(String(left.record.submittedAt || left.record.updatedAt || "")));
  }

  function reviewItemById(id) {
    return reviewItems().find((item) => `${item.type}:${item.record.id}` === id);
  }

  function statusHistoryFor(type, id) {
    return state.statusHistory
      .filter((entry) => entry.recordType === type && entry.recordId === id)
      .sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")));
  }

  function previewUrlFor(item) {
    const artistId = item.type === "artist" ? item.record.id : item.record.artistId;
    return `/admin/preview/artist/${encodeURIComponent(artistId)}/`;
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
    return new Promise((resolve, reject) => {
      const request = new XMLHttpRequest();
      const status = document.getElementById("media-upload-status");
      const label = status?.querySelector("span");
      const progress = status?.querySelector("progress");

      if (status) {
        status.hidden = false;
      }
      if (label) {
        label.textContent = "Uploading";
      }
      if (progress) {
        progress.removeAttribute("value");
      }

      request.open("POST", path);
      request.withCredentials = true;

      request.upload.addEventListener("progress", (event) => {
        if (progress && event.lengthComputable) {
          progress.value = Math.round((event.loaded / event.total) * 100);
        }
      });

      request.upload.addEventListener("load", () => {
        if (label) {
          label.textContent = "Processing image...";
        }
        if (progress) {
          progress.removeAttribute("value");
        }
      });

      request.addEventListener("load", () => {
        let payload;
        try {
          payload = JSON.parse(request.responseText || "{}");
        } catch (error) {
          reject(new Error("Upload response was not readable."));
          return;
        }

        if (request.status === 401) {
          showMessage("error", payload.message || "Unauthorized access. Please log in again.");
          window.location.href = "/admin/login/";
          reject(new Error("Unauthorized"));
          return;
        }

        if (label) {
          label.textContent = payload.ok ? "Ready" : "Failed";
        }
        if (progress) {
          progress.value = 100;
        }
        resolve(payload);
      });

      request.addEventListener("error", () => reject(new Error("Upload failed.")));
      request.send(formData);
    });
  }

  function applyContent(content) {
    state.artists = content.artists || [];
    state.galleries = content.galleries || [];
    state.artwork = content.artwork || [];
    state.media = content.media || [];
    state.inquiries = content.inquiries || [];
    state.invitations = content.invitations || [];
    state.artistAccounts = content.artistAccounts || [];
    state.statusHistory = content.statusHistory || [];
    if (state.selectedInquiryId && !state.inquiries.some((inquiry) => inquiry.id === state.selectedInquiryId)) {
      state.selectedInquiryId = "";
    }
    if (state.selectedReviewId && !reviewItemById(state.selectedReviewId)) {
      state.selectedReviewId = "";
    }
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
              <option value="${attr(mediaPath(item, "gallery"))}"${mediaPath(item, "gallery") === value ? " selected" : ""}>${escapeHtml(item.originalFilename)}</option>
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
    setText("new-inquiry-count", state.inquiries.filter((inquiry) => inquiry.status === "new").length);
    setText("inquiry-count", state.inquiries.length);
    setText("pending-review-count", reviewItems().filter((item) => item.record.status === "pending_review").length);
    setText("changes-requested-count", reviewItems().filter((item) => item.record.status === "changes_requested").length);
    setText("published-count", state.artists.filter((artist) => artist.status === "published").length);

    const recentList = document.getElementById("admin-recent-inquiries");
    if (recentList) {
      const recent = sortedInquiries().slice(0, 5);
      recentList.innerHTML = recent.length ? recent.map((inquiry) => `
        <article class="inquiry-card">
          <div>
            <h3>${escapeHtml(inquiry.visitorName)}</h3>
            <p>${inquiryRelatedHtml(inquiry)}</p>
            <p>${escapeHtml(messagePreview(inquiry.message, 110))}</p>
          </div>
          <div>
            ${badge(inquiry.status || "new")}
            <a href="/admin/inquiries/">Open</a>
          </div>
        </article>
      `).join("") : '<p class="empty-state">No inquiries have been received yet.</p>';
    }

    const reviewList = document.getElementById("admin-recent-review");
    if (reviewList) {
      const recent = reviewItems().slice(0, 5);
      reviewList.innerHTML = recent.length ? recent.map((item) => `
        <article class="inquiry-card">
          <div>
            <h3>${escapeHtml(item.title)}</h3>
            <p>${escapeHtml(item.type)} - ${escapeHtml(artistById(item.artistId)?.name || "")}</p>
          </div>
          <div>
            ${badge(item.record.status)}
            <a href="/admin/review/">Open</a>
          </div>
        </article>
      `).join("") : '<p class="empty-state">No review submissions yet.</p>';
    }
  }

  function renderMediaOwnerSelect() {
    const selectElement = document.getElementById("media-owner-select");
    if (!selectElement) {
      return;
    }

    const selected = selectElement.value;
    selectElement.innerHTML = `
      <option value="">Admin / shared</option>
      ${state.artists.map((artist) => `
        <option value="${attr(artist.id)}"${artist.id === selected ? " selected" : ""}>${escapeHtml(artist.name)}</option>
      `).join("")}
    `;
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

    table.innerHTML = state.artists.map((artist) => {
      const account = accountByArtistId(artist.id);
      const invitation = invitationByArtistId(artist.id);
      const acceptedOrLogin = account?.lastLoginAt || account?.acceptedAt || invitation?.acceptedAt || "";
      return `
        <tr>
          <td>${escapeHtml(artist.name)}${artist.demo ? " <span class=\"admin-badge\">Demo</span>" : ""}</td>
        <td>${escapeHtml(artist.slug)}</td>
        <td>${escapeHtml(artist.professionalTitle)}</td>
        <td>${escapeHtml([artist.city, artist.region].filter(Boolean).join(", "))}</td>
        <td>${badge(artist.status)}</td>
        <td>${yesNo(artist.featured)}</td>
        <td>${account ? badge(account.status || "active") : badge(invitation?.status || artist.invitationStatus || "none")}</td>
        <td>${escapeHtml(profileCompleteness(artist))}</td>
        <td>${escapeHtml(formatDate(acceptedOrLogin))}</td>
        <td>${artist.status === "published" ? `<a href="${publicArtistUrl(artist)}">${publicArtistUrl(artist)}</a>` : "Not public"}</td>
        <td>${formatDate(artist.updatedAt)}</td>
        <td class="admin-actions">
          <button type="button" data-edit-artist="${attr(artist.id)}">Edit</button>
          <a href="${publicArtistUrl(artist)}">View Public Page</a>
          <button type="button" data-archive-artist="${attr(artist.id)}"${artist.protected ? " disabled title=\"Seed record is protected\"" : ""}>Archive</button>
        </td>
      </tr>
      `;
    }).join("");

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

    const media = state.media.slice().sort((left, right) => String(right.createdAt || right.uploadedAt || "").localeCompare(String(left.createdAt || left.uploadedAt || "")));
    if (!media.length) {
      grid.innerHTML = '<p class="empty-state">No uploaded images yet.</p>';
      return;
    }

    grid.innerHTML = media.map((item) => `
      <article class="admin-media-card ${item.status === "archived" ? "archived" : ""}">
        <img src="${attr(mediaPath(item, "thumbnail"))}" alt="${attr(item.originalFilename)}">
        <div>
          <h3>${escapeHtml(item.originalFilename)}</h3>
          <p>${escapeHtml(mediaPath(item, "gallery") || item.publicPath)}</p>
          <p>${escapeHtml(item.mimeType)} - ${formatBytes(item.originalSize || item.size)}${mediaDimensions(item) ? ` - ${mediaDimensions(item)}` : ""}</p>
          <p>Variants: ${["thumbnail", "gallery", "large"].filter((key) => item.variants?.[key]).join(", ") || "legacy"}</p>
          <p>Owner: ${escapeHtml(mediaOwnerName(item))}</p>
          <p>Uploaded ${formatDate(item.createdAt || item.uploadedAt)} - ${badge(item.status || "ready")}</p>
          ${item.errorMessage ? `<p>${escapeHtml(item.errorMessage)}</p>` : ""}
        </div>
        <div class="admin-actions">
          <button type="button" data-copy-path="${attr(mediaPath(item, "gallery"))}"${activeMedia().includes(item) ? "" : " disabled"}>Copy Gallery Path</button>
          <button type="button" data-copy-path="${attr(mediaPath(item, "large"))}"${activeMedia().includes(item) ? "" : " disabled"}>Copy Large Path</button>
          <button type="button" data-archive-media="${attr(item.id)}"${item.status === "archived" ? " disabled" : ""}>Archive</button>
        </div>
      </article>
    `).join("");
  }

  function renderInquiryFilters() {
    const statusFilter = document.getElementById("inquiry-status-filter");
    const artistFilter = document.getElementById("inquiry-artist-filter");

    if (statusFilter) {
      const selected = statusFilter.value;
      statusFilter.innerHTML = `
        <option value="">All statuses</option>
        ${inquiryStatusOptions.map((status) => `<option value="${attr(status)}"${status === selected ? " selected" : ""}>${escapeHtml(status)}</option>`).join("")}
      `;
    }

    if (artistFilter) {
      const selected = artistFilter.value;
      artistFilter.innerHTML = `
        <option value="">All artists</option>
        ${state.artists.map((artist) => `<option value="${attr(artist.id)}"${artist.id === selected ? " selected" : ""}>${escapeHtml(artist.name)}</option>`).join("")}
      `;
    }
  }

  function filteredInquiries() {
    const status = document.getElementById("inquiry-status-filter")?.value || "";
    const artistId = document.getElementById("inquiry-artist-filter")?.value || "";
    return sortedInquiries().filter((inquiry) =>
      (!status || inquiry.status === status) &&
      (!artistId || inquiry.artistId === artistId || inquiry.assignedArtistId === artistId)
    );
  }

  function renderInquiries() {
    renderInquiryFilters();

    const table = document.getElementById("inquiries-table");
    if (!table) {
      return;
    }

    const inquiries = filteredInquiries();
    if (!state.selectedInquiryId && inquiries[0]) {
      state.selectedInquiryId = inquiries[0].id;
    }

    table.innerHTML = inquiries.length ? inquiries.map((inquiry) => `
      <tr>
        <td>${escapeHtml(inquiry.visitorName)}<br><a href="mailto:${attr(inquiry.visitorEmail)}">${escapeHtml(inquiry.visitorEmail)}</a></td>
        <td>${inquiryRelatedHtml(inquiry)}</td>
        <td>${badge(inquiry.status || "new")}</td>
        <td>${escapeHtml(formatDate(inquiry.createdAt))}</td>
        <td>${inquiry.sourceUrl ? `<a href="${attr(inquiry.sourceUrl)}">${escapeHtml(inquiry.sourceUrl)}</a>` : ""}</td>
        <td>${escapeHtml(messagePreview(inquiry.message))}</td>
        <td class="admin-actions">
          <button type="button" data-view-inquiry="${attr(inquiry.id)}">View</button>
          <a href="${mailtoForInquiry(inquiry)}">Reply</a>
          <button type="button" data-archive-inquiry="${attr(inquiry.id)}"${inquiry.status === "archived" ? " disabled" : ""}>Archive</button>
        </td>
      </tr>
    `).join("") : '<tr><td colspan="7">No inquiries match these filters.</td></tr>';

    renderInquiryDetail(state.selectedInquiryId);
  }

  function renderInquiryDetail(id) {
    const detail = document.getElementById("inquiry-detail");
    if (!detail) {
      return;
    }

    const inquiry = state.inquiries.find((item) => item.id === id) || filteredInquiries()[0];
    if (!inquiry) {
      detail.innerHTML = '<p class="empty-state">Select an inquiry to review details.</p>';
      return;
    }

    state.selectedInquiryId = inquiry.id;
    const related = inquiryRelated(inquiry);
    detail.innerHTML = `
      <div class="inquiry-detail-grid">
        <div class="inquiry-detail-card">
          <p class="section-kicker">Visitor</p>
          <h3>${escapeHtml(inquiry.visitorName)}</h3>
          <p><a href="mailto:${attr(inquiry.visitorEmail)}">${escapeHtml(inquiry.visitorEmail)}</a></p>
          ${inquiry.visitorPhone ? `<p>${escapeHtml(inquiry.visitorPhone)}</p>` : ""}
          ${inquiry.preferredContactMethod ? `<p>Prefers ${escapeHtml(inquiry.preferredContactMethod)}</p>` : ""}
        </div>
        <div class="inquiry-detail-card">
          <p class="section-kicker">Context</p>
          <h3>${escapeHtml(related.artist || "The Galleria.Art")}</h3>
          ${related.gallery ? `<p>${escapeHtml(related.gallery)}</p>` : ""}
          ${related.artwork ? `<p>${escapeHtml(related.artwork)}</p>` : ""}
          ${inquiry.sourceUrl ? `<p><a href="${attr(inquiry.sourceUrl)}">${escapeHtml(inquiry.sourceUrl)}</a></p>` : ""}
        </div>
      </div>
      <div class="inquiry-message-block">
        <p class="section-kicker">Message</p>
        <p>${escapeHtml(inquiry.message)}</p>
      </div>
      <form class="admin-record-form" id="inquiry-detail-form" data-inquiry-id="${attr(inquiry.id)}">
        ${select("status", "Status", inquiry.status || "new", inquiryStatusOptions.map((status) => ({ value: status, label: status })))}
        ${textarea("internalNotes", "Internal Notes", inquiry.internalNotes)}
      </form>
      <div class="admin-actions">
        <button class="admin-primary-action" type="submit" form="inquiry-detail-form">Save Inquiry</button>
        <a href="${mailtoForInquiry(inquiry)}">Reply by Email</a>
      </div>
      <p class="admin-muted">Created ${escapeHtml(formatDateTime(inquiry.createdAt))}. Updated ${escapeHtml(formatDateTime(inquiry.updatedAt))}.</p>
    `;
  }

  function renderInvitations() {
    const table = document.getElementById("invitations-table");
    if (!table) {
      return;
    }

    const invitations = sortedInvitations();
    table.innerHTML = invitations.length ? invitations.map((invitation) => {
      const artist = artistById(invitation.artistId);
      const link = invitationLink(invitation);
      return `
        <tr>
          <td>${escapeHtml(invitation.email)}</td>
          <td>${artist ? escapeHtml(artist.name) : "Not linked yet"}</td>
          <td>${badge(invitation.status || "pending")}</td>
          <td>${escapeHtml(formatDate(invitation.createdAt))}</td>
          <td>${escapeHtml(formatDate(invitation.expiresAt))}</td>
          <td>${escapeHtml(formatDate(invitation.acceptedAt))}</td>
          <td>${escapeHtml(messagePreview(invitation.notes, 90))}</td>
          <td class="admin-actions">
            <button type="button" data-copy-invitation="${attr(link)}"${link ? "" : " disabled"}>Copy Link</button>
            <button type="button" data-revoke-invitation="${attr(invitation.id)}"${invitation.status === "pending" ? "" : " disabled"}>Revoke</button>
          </td>
        </tr>
      `;
    }).join("") : '<tr><td colspan="8">No invitations have been created yet.</td></tr>';
  }

  function renderReview() {
    const table = document.getElementById("review-table");
    if (!table) {
      return;
    }

    const items = reviewItems();
    if (!state.selectedReviewId && items[0]) {
      state.selectedReviewId = `${items[0].type}:${items[0].record.id}`;
    }

    table.innerHTML = items.length ? items.map((item) => {
      const id = `${item.type}:${item.record.id}`;
      return `
        <tr>
          <td>${escapeHtml(item.type)}</td>
          <td>${escapeHtml(artistById(item.artistId)?.name || "")}</td>
          <td>${escapeHtml(item.title)}</td>
          <td>${badge(item.record.status)}</td>
          <td>${escapeHtml(formatDate(item.record.submittedAt || item.record.updatedAt))}</td>
          <td><a href="${attr(previewUrlFor(item))}" target="_blank" rel="noopener">Preview</a></td>
          <td class="admin-actions">
            <button type="button" data-view-review="${attr(id)}">Review</button>
          </td>
        </tr>
      `;
    }).join("") : '<tr><td colspan="7">No records are waiting for review.</td></tr>';

    renderReviewDetail(state.selectedReviewId);
  }

  function renderReviewDetail(id) {
    const detail = document.getElementById("review-detail");
    if (!detail) {
      return;
    }

    const item = reviewItemById(id) || reviewItems()[0];
    if (!item) {
      detail.innerHTML = '<p class="empty-state">Select a record to review.</p>';
      return;
    }

    state.selectedReviewId = `${item.type}:${item.record.id}`;
    const artist = artistById(item.artistId);
    const history = statusHistoryFor(item.type, item.record.id);
    detail.innerHTML = `
      <div class="inquiry-detail-grid">
        <div class="inquiry-detail-card">
          <p class="section-kicker">${escapeHtml(item.type)}</p>
          <h3>${escapeHtml(item.title)}</h3>
          <p>${escapeHtml(artist?.name || "")}</p>
          <p>${badge(item.record.status)}</p>
        </div>
        <div class="inquiry-detail-card">
          <p class="section-kicker">Preview</p>
          <h3>Private Preview</h3>
          <p><a href="${attr(previewUrlFor(item))}" target="_blank" rel="noopener">Open preview page</a></p>
          <p class="admin-muted">Only logged-in admins can open this preview.</p>
        </div>
      </div>
      <div class="inquiry-message-block">
        <p class="section-kicker">Artist Notes</p>
        <p>${escapeHtml(item.record.artistReviewNote || "No artist note was submitted.")}</p>
      </div>
      <form class="admin-record-form" id="review-action-form" data-review-type="${attr(item.type)}" data-review-id="${attr(item.record.id)}">
        ${select("action", "Review Action", item.record.status === "approved" ? "published" : "approved", [
          { value: "approved", label: "approved" },
          { value: "published", label: "published" },
          { value: "changes_requested", label: "changes requested" },
          { value: "archived", label: "archived" }
        ])}
        ${textarea("note", "Admin Notes / Requested Changes", item.record.adminReviewNote || "")}
      </form>
      <div class="admin-actions">
        <button class="admin-primary-action" type="submit" form="review-action-form">Save Review Action</button>
      </div>
      <div class="status-history-list">
        <p class="section-kicker">Status History</p>
        ${history.length ? history.map((entry) => `
          <article>
            <strong>${escapeHtml(entry.previousStatus || "none")} -> ${escapeHtml(entry.newStatus)}</strong>
            <span>${escapeHtml(formatDateTime(entry.createdAt))} by ${escapeHtml(entry.changedBy)}</span>
            ${entry.note ? `<p>${escapeHtml(entry.note)}</p>` : ""}
          </article>
        `).join("") : '<p class="empty-state">No status history yet.</p>'}
      </div>
    `;
  }

  function renderAll() {
    renderDashboard();
    renderMediaOwnerSelect();
    renderArtists();
    renderGalleries();
    renderArtwork();
    renderMedia();
    renderInquiries();
    renderInvitations();
    renderReview();
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

  async function saveInquiry(form) {
    const id = form.dataset.inquiryId;
    const payload = await api(`/admin/api/inquiries/${encodeURIComponent(id)}`, {
      method: "POST",
      body: JSON.stringify(formData(form))
    });

    updateFromPayload(payload);
    showMessage(payload.ok ? "success" : "error", payload.message || "Inquiry update failed.");
  }

  async function saveReviewAction(form) {
    const type = form.dataset.reviewType;
    const id = form.dataset.reviewId;
    const payload = await api(`/admin/api/review/${encodeURIComponent(type)}/${encodeURIComponent(id)}`, {
      method: "POST",
      body: JSON.stringify(formData(form))
    });

    updateFromPayload(payload);
    showMessage(payload.ok ? "success" : "error", payload.message || "Review update failed.");
  }

  async function archiveInquiry(id) {
    const payload = await api(`/admin/api/inquiries/${encodeURIComponent(id)}`, {
      method: "POST",
      body: JSON.stringify({ status: "archived", internalNotes: state.inquiries.find((inquiry) => inquiry.id === id)?.internalNotes || "" })
    });

    updateFromPayload(payload);
    showMessage(payload.ok ? "success" : "error", payload.message || "Archive failed.");
  }

  async function createInvitation(form) {
    const payload = await api("/admin/api/invitations", {
      method: "POST",
      body: JSON.stringify(formData(form))
    });

    updateFromPayload(payload);
    showMessage(payload.ok ? "success" : "error", payload.message || "Invitation creation failed.", payload.errors);

    const createdMessage = document.getElementById("invitation-created-message");
    if (createdMessage && payload.ok) {
      createdMessage.hidden = false;
      createdMessage.innerHTML = `
        <strong>Invitation link created.</strong>
        <span>${escapeHtml(payload.invitationUrl)}</span>
        <button type="button" data-copy-invitation="${attr(payload.invitationUrl)}">Copy Link</button>
      `;
      form.reset();
    }
  }

  async function revokeInvitation(id) {
    if (!window.confirm("Revoke this invitation? The link will stop working.")) {
      return;
    }

    const payload = await api(`/admin/api/invitations/${encodeURIComponent(id)}/revoke`, {
      method: "POST",
      body: "{}"
    });

    updateFromPayload(payload);
    showMessage(payload.ok ? "success" : "error", payload.message || "Invitation revoke failed.");
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
      const inviteCopy = event.target.closest("[data-copy-invitation]");
      const inviteRevoke = event.target.closest("[data-revoke-invitation]");
      const inquiryView = event.target.closest("[data-view-inquiry]");
      const inquiryArchive = event.target.closest("[data-archive-inquiry]");
      const reviewView = event.target.closest("[data-view-review]");

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
      if (inviteCopy) {
        copyPath(inviteCopy.dataset.copyInvitation);
      }
      if (inviteRevoke) {
        revokeInvitation(inviteRevoke.dataset.revokeInvitation);
      }
      if (inquiryView) {
        renderInquiryDetail(inquiryView.dataset.viewInquiry);
      }
      if (inquiryArchive) {
        archiveInquiry(inquiryArchive.dataset.archiveInquiry);
      }
      if (reviewView) {
        renderReviewDetail(reviewView.dataset.viewReview);
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
      const inquiryFilter = event.target.closest("#inquiry-status-filter, #inquiry-artist-filter");
      if (mediaSelect?.value) {
        const input = document.querySelector(`[name="${mediaSelect.dataset.mediaSelect}"]`);
        if (input) {
          input.value = mediaSelect.value;
          updateImagePreview(mediaSelect.dataset.mediaSelect, mediaSelect.value);
        }
      }
      if (inquiryFilter) {
        state.selectedInquiryId = "";
        renderInquiries();
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
    const invitationForm = document.getElementById("invitation-form");

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

    invitationForm?.addEventListener("submit", (event) => {
      event.preventDefault();
      createInvitation(invitationForm);
    });

    document.addEventListener("submit", (event) => {
      const inquiryForm = event.target.closest("#inquiry-detail-form");
      if (inquiryForm) {
        event.preventDefault();
        saveInquiry(inquiryForm);
      }

      const reviewForm = event.target.closest("#review-action-form");
      if (reviewForm) {
        event.preventDefault();
        saveReviewAction(reviewForm);
      }
    });
  }

  bindEvents();
  loadContent()
    .then(renderAll)
    .catch(() => {
      showMessage("error", "Unable to load admin content.");
    });
}());
