(function () {
  const state = {
    account: {},
    artist: {},
    plans: [],
    billing: {},
    galleries: [],
    artwork: [],
    media: [],
    inquiries: [],
    notifications: [],
    statusHistory: [],
    selectedInquiryId: ""
  };
  const inquiryStatusOptions = ["new", "reviewed", "replied", "archived"];

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

  function artworkById(id) {
    return state.artwork.find((artwork) => artwork.id === id);
  }

  function reviewRecords() {
    return [
      { type: "artist", record: state.artist, title: state.artist.name || "Artist profile" },
      ...state.galleries.map((record) => ({ type: "gallery", record, title: record.title })),
      ...state.artwork.map((record) => ({ type: "artwork", record, title: record.title }))
    ];
  }

  function reviewRecordsByStatus(statuses) {
    return reviewRecords().filter((item) => statuses.includes(item.record.status));
  }

  function statusHistoryFor(type, id) {
    return state.statusHistory
      .filter((entry) => entry.recordType === type && entry.recordId === id)
      .sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")));
  }

  function reviewButton(type, record) {
    const disabled = ["pending_review", "approved", "archived"].includes(record.status);
    const label = record.status === "pending_review" ? "Submitted" : record.status === "approved" ? "Approved" : "Submit";
    return `<button type="button" data-submit-review-type="${attr(type)}" data-submit-review-id="${attr(record.id)}"${disabled ? " disabled" : ""}>${label}</button>`;
  }

  function reviewNoteHtml(record) {
    return record.adminReviewNote ? `<p class="review-note">${escapeHtml(record.adminReviewNote)}</p>` : "";
  }

  function mediaVariant(item, preferred) {
    return item?.variants?.[preferred] || item?.variants?.gallery || item?.variants?.large || item?.variants?.thumbnail || null;
  }

  function mediaPath(item, preferred = "gallery") {
    return mediaVariant(item, preferred)?.path || item?.publicPath || "";
  }

  function activeMedia() {
    return state.media.filter((item) => item.status === "ready" || item.status === "referenced" || (!item.status && item.publicPath));
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

  function sortedInquiries() {
    return state.inquiries.slice().sort((left, right) =>
      String(right.createdAt || "").localeCompare(String(left.createdAt || ""))
    );
  }

  function inquiryRelated(inquiry) {
    const gallery = galleryById(inquiry.galleryId);
    const artwork = artworkById(inquiry.artworkId);
    return {
      gallery: gallery?.title || "",
      artwork: artwork?.title || ""
    };
  }

  function inquiryRelatedHtml(inquiry) {
    const related = inquiryRelated(inquiry);
    const parts = [related.gallery, related.artwork].filter(Boolean);
    return parts.length ? parts.map(escapeHtml).join("<br>") : "General artist inquiry";
  }

  function mailtoForInquiry(inquiry) {
    const related = inquiryRelated(inquiry);
    const subject = encodeURIComponent(["The Galleria.Art Inquiry", state.artist.name, related.artwork || related.gallery].filter(Boolean).join(" - "));
    const body = encodeURIComponent(`Hello ${inquiry.visitorName || ""},\n\nThank you for your inquiry about ${[state.artist.name, related.artwork || related.gallery].filter(Boolean).join(" / ")}.\n\n`);
    return `mailto:${encodeURIComponent(inquiry.visitorEmail)}?subject=${subject}&body=${body}`;
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

  async function uploadApi(path, formData) {
    return new Promise((resolve, reject) => {
      const request = new XMLHttpRequest();
      const status = document.getElementById("artist-media-upload-status");
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
          window.location.href = "/artist/login/";
          reject(new Error("Artist login required"));
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
    state.account = content.account || {};
    state.artist = content.artist || {};
    state.plans = content.plans || [];
    state.billing = content.billing || {};
    state.galleries = content.galleries || [];
    state.artwork = content.artwork || [];
    state.media = content.media || [];
    state.inquiries = content.inquiries || [];
    state.notifications = content.notifications || [];
    state.statusHistory = content.statusHistory || [];
    if (state.selectedInquiryId && !state.inquiries.some((inquiry) => inquiry.id === state.selectedInquiryId)) {
      state.selectedInquiryId = "";
    }
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
    const media = activeMedia();
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
              <option value="${attr(mediaPath(item, "gallery"))}"${mediaPath(item, "gallery") === value ? " selected" : ""}>${escapeHtml(item.originalFilename || mediaPath(item, "gallery"))}</option>
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
    const pending = reviewRecordsByStatus(["pending_review"]);
    const changes = reviewRecordsByStatus(["changes_requested"]);
    const published = reviewRecordsByStatus(["published"]);
    setText("artist-name", state.artist.name);
    setText("artist-summary", `${state.artist.professionalTitle || ""}${state.account.demo ? " - Demo account" : ""}`);
    setText("artist-gallery-count", state.galleries.length);
    setText("artist-artwork-count", state.artwork.length);
    setText("artist-profile-status", state.artist.status || "-");
    setText("artist-invitation-status", state.artist.invitationStatus || "-");
    setText("artist-new-inquiry-count", state.inquiries.filter((inquiry) => inquiry.status === "new").length);
    setText("artist-pending-review-count", pending.length);
    setText("artist-changes-requested-count", changes.length);
    setText("artist-published-count", published.length);

    const statusPanel = document.getElementById("artist-review-status");
    if (statusPanel) {
      const priorityItems = [...changes, ...pending, ...reviewRecordsByStatus(["approved"])].slice(0, 5);
      statusPanel.innerHTML = `
        <div class="review-status-actions">
          <a href="/artist/preview/" target="_blank" rel="noopener">Private Preview</a>
          ${reviewButton("artist", state.artist)}
        </div>
        ${state.artist.adminReviewNote ? `<div class="review-note-block"><strong>Profile feedback</strong>${reviewNoteHtml(state.artist)}</div>` : ""}
        <div class="status-summary-grid">
          ${priorityItems.length ? priorityItems.map((item) => `
            <article>
              <strong>${escapeHtml(item.title)}</strong>
              <span>${escapeHtml(item.type)} ${badge(item.record.status)}</span>
              ${reviewNoteHtml(item.record)}
            </article>
          `).join("") : '<p class="empty-state">No records are waiting on review changes.</p>'}
        </div>
      `;
    }

    const notificationList = document.getElementById("artist-notifications");
    if (notificationList) {
      const notifications = state.notifications
        .slice()
        .sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")))
        .slice(0, 8);
      notificationList.innerHTML = notifications.length ? notifications.map((notification) => `
        <article class="inquiry-card ${notification.readAt ? "" : "notification-unread"}">
          <div>
            <h3>${escapeHtml(notification.title)}</h3>
            <p>${escapeHtml(notification.message)}</p>
            <p>${escapeHtml(formatDateTime(notification.createdAt))}</p>
          </div>
          <div>
            ${notification.link ? `<a href="${attr(notification.link)}">Open</a>` : ""}
            <button type="button" data-artist-read-notification="${attr(notification.id)}"${notification.readAt ? " disabled" : ""}>${notification.readAt ? "Read" : "Mark Read"}</button>
          </div>
        </article>
      `).join("") : '<p class="empty-state">No notifications yet.</p>';
    }

    const inquiryList = document.getElementById("artist-recent-inquiries");
    if (inquiryList) {
      const recent = sortedInquiries().slice(0, 5);
      inquiryList.innerHTML = recent.length ? recent.map((inquiry) => `
        <article class="inquiry-card">
          <div>
            <h3>${escapeHtml(inquiry.visitorName)}</h3>
            <p>${inquiryRelatedHtml(inquiry)}</p>
            <p>${escapeHtml(messagePreview(inquiry.message, 110))}</p>
          </div>
          <div>
            ${badge(inquiry.status || "new")}
            <a href="/artist/inquiries/">Open</a>
          </div>
        </article>
      `).join("") : '<p class="empty-state">No collector inquiries have been routed to this artist yet.</p>';
    }

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

    const checklist = document.getElementById("artist-onboarding-checklist");
    if (checklist) {
      const hasProfile = Boolean(state.artist.name && state.artist.professionalTitle && state.artist.contactEmail && state.artist.shortDescription);
      const hasHeroImage = Boolean(state.artist.heroImage);
      const hasGallery = state.galleries.length > 0;
      const hasArtwork = state.artwork.some((artwork) => artwork.image && artwork.title);
      const canPreview = Boolean(state.artist.id);
      const submitted = ["pending", "accepted", "current"].includes(state.artist.invitationStatus) && hasProfile && hasGallery && hasArtwork;
      const items = [
        { label: "Complete profile", done: hasProfile, href: "/artist/profile/" },
        { label: "Add hero image", done: hasHeroImage, href: "/artist/profile/" },
        { label: "Create first gallery", done: hasGallery, href: "/artist/galleries/" },
        { label: "Upload artwork", done: hasArtwork, href: "/artist/artwork/" },
        { label: "Preview public page", done: canPreview, href: "/artist/preview/" },
        { label: "Submit for review", done: submitted, href: "/artist/profile/" }
      ];

      checklist.innerHTML = items.map((item) => `
        <a class="onboarding-checklist-item ${item.done ? "complete" : ""}" href="${attr(item.href)}">
          <span aria-hidden="true">${item.done ? "Done" : "Open"}</span>
          <strong>${escapeHtml(item.label)}</strong>
        </a>
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

  function renderProfileReview() {
    const panel = document.getElementById("artist-profile-review");
    if (!panel) {
      return;
    }

    const history = statusHistoryFor("artist", state.artist.id);
    panel.innerHTML = `
      <div class="review-status-actions">
        ${badge(state.artist.status || "draft")}
        <a href="/artist/preview/" target="_blank" rel="noopener">Private Preview</a>
        ${reviewButton("artist", state.artist)}
      </div>
      ${state.artist.adminReviewNote ? `<div class="review-note-block"><strong>Admin feedback</strong>${reviewNoteHtml(state.artist)}</div>` : ""}
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

  function usageLine(label, value, limit) {
    const cap = Number(limit || 0);
    const current = Number(value || 0);
    return `<p><strong>${escapeHtml(label)}</strong> ${current.toLocaleString()}${cap ? ` / ${cap.toLocaleString()}` : ""}</p>`;
  }

  function renderBilling() {
    const panel = document.getElementById("artist-billing-panel");
    if (!panel) {
      return;
    }

    const billing = state.billing || {};
    const plan = billing.plan || {};
    const usage = billing.usage || {};
    const provider = billing.providerStatus || {};
    panel.innerHTML = `
      <div class="status-summary-grid">
        <article>
          <strong>${escapeHtml(plan.name || "No plan assigned")}</strong>
          <span>${escapeHtml(billing.billingStatus || "not_configured")} / ${escapeHtml(billing.subscriptionStatus || "not_configured")}</span>
          <p>${escapeHtml(plan.description || "The Galleria.Art will assign a plan as billing is prepared.")}</p>
        </article>
        <article>
          <strong>Usage</strong>
          ${usageLine("Galleries", usage.galleries, plan.galleryLimit)}
          ${usageLine("Artwork", usage.artwork, plan.artworkLimit)}
          ${usageLine("Media Files", usage.media)}
          ${usageLine("Media Storage MB", usage.storageMb, plan.mediaStorageLimit)}
        </article>
        <article>
          <strong>Billing</strong>
          <p>${provider.configured ? `Billing provider is in ${escapeHtml(provider.mode)} mode.` : "Billing is not yet enabled. Account access is currently managed by The Galleria.Art."}</p>
          ${billing.trialEndAt ? `<p>Trial ends ${escapeHtml(formatDate(billing.trialEndAt))}</p>` : ""}
          ${billing.cancelAtPeriodEnd ? "<p>Cancellation is scheduled at period end.</p>" : ""}
        </article>
      </div>
      ${billing.warnings?.length ? `<div class="review-note-block"><strong>Usage notices</strong>${billing.warnings.map((warning) => `<p>${escapeHtml(warning)}</p>`).join("")}</div>` : ""}
      <div class="review-status-actions">
        <button type="button" disabled>Change Plan</button>
        <a href="/contact/">Contact About Billing</a>
      </div>
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
            ${reviewButton("gallery", gallery)}
          </td>
        </tr>
        ${gallery.adminReviewNote ? `
          <tr class="review-feedback-row">
            <td colspan="7">${reviewNoteHtml(gallery)}</td>
          </tr>
        ` : ""}
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
          ${reviewButton("artwork", artwork)}
        </td>
      </tr>
      ${artwork.adminReviewNote ? `
        <tr class="review-feedback-row">
          <td colspan="6">${reviewNoteHtml(artwork)}</td>
        </tr>
      ` : ""}
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
        <img src="${attr(mediaPath(item, "thumbnail"))}" alt="">
        <div>
          <h3>${escapeHtml(item.originalFilename || mediaPath(item, "gallery"))}</h3>
          <p>${escapeHtml(mediaPath(item, "gallery"))}</p>
          <p>Variants: ${["thumbnail", "gallery", "large"].filter((key) => item.variants?.[key]).join(", ") || "referenced"}</p>
          <p>Uploaded ${formatDate(item.createdAt || item.uploadedAt)} - ${badge(item.status || "referenced")}</p>
          ${item.errorMessage ? `<p>${escapeHtml(item.errorMessage)}</p>` : ""}
        </div>
      </article>
    `).join("");
  }

  function renderInquiries() {
    const table = document.getElementById("artist-inquiries-table");
    if (!table) {
      return;
    }

    const inquiries = sortedInquiries();
    if (!state.selectedInquiryId && inquiries[0]) {
      state.selectedInquiryId = inquiries[0].id;
    }

    table.innerHTML = inquiries.length ? inquiries.map((inquiry) => `
      <tr>
        <td>${escapeHtml(inquiry.visitorName)}</td>
        <td>${inquiryRelatedHtml(inquiry)}</td>
        <td>${badge(inquiry.status || "new")}</td>
        <td>${escapeHtml(formatDate(inquiry.createdAt))}</td>
        <td>${escapeHtml(messagePreview(inquiry.message))}</td>
        <td class="admin-actions">
          <button type="button" data-artist-view-inquiry="${attr(inquiry.id)}">View</button>
          <a href="${mailtoForInquiry(inquiry)}">Reply</a>
        </td>
      </tr>
    `).join("") : '<tr><td colspan="6">No inquiries have been routed to this artist yet.</td></tr>';

    renderInquiryDetail(state.selectedInquiryId);
  }

  function renderInquiryDetail(id) {
    const detail = document.getElementById("artist-inquiry-detail");
    if (!detail) {
      return;
    }

    const inquiry = state.inquiries.find((item) => item.id === id) || sortedInquiries()[0];
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
          <h3>${escapeHtml(related.artwork || related.gallery || state.artist.name)}</h3>
          ${related.gallery && related.artwork ? `<p>${escapeHtml(related.gallery)}</p>` : ""}
          ${inquiry.sourceUrl ? `<p><a href="${attr(inquiry.sourceUrl)}">${escapeHtml(inquiry.sourceUrl)}</a></p>` : ""}
        </div>
      </div>
      <div class="inquiry-message-block">
        <p class="section-kicker">Message</p>
        <p>${escapeHtml(inquiry.message)}</p>
      </div>
      <form class="admin-record-form" id="artist-inquiry-detail-form" data-inquiry-id="${attr(inquiry.id)}">
        ${select("status", "Status", inquiry.status || "new", inquiryStatusOptions.map((status) => ({ value: status, label: status })))}
      </form>
      <div class="admin-actions">
        <button class="admin-primary-action" type="submit" form="artist-inquiry-detail-form">Save Status</button>
        <a href="${mailtoForInquiry(inquiry)}">Reply by Email</a>
      </div>
      <p class="admin-muted">Created ${escapeHtml(formatDateTime(inquiry.createdAt))}. Updated ${escapeHtml(formatDateTime(inquiry.updatedAt))}.</p>
    `;
  }

  function renderAll() {
    renderDashboard();
    renderProfileForm();
    renderProfileReview();
    renderBilling();
    renderGalleries();
    renderArtwork();
    renderMedia();
    renderInquiries();
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

  async function uploadMedia(form) {
    const payload = await uploadApi("/artist/api/media/upload", new FormData(form));
    if (payload.content) {
      applyContent(payload.content);
      renderAll();
    }
    showMessage(payload.ok ? "success" : "error", payload.message || "Upload failed.");
    if (payload.ok) {
      form.reset();
    }
  }

  async function saveInquiry(form) {
    const id = form.dataset.inquiryId;
    const payload = await api(`/artist/api/inquiries/${encodeURIComponent(id)}`, {
      method: "POST",
      body: JSON.stringify(formData(form))
    });
    if (payload.content) {
      applyContent(payload.content);
      renderAll();
    }
    showMessage(payload.ok ? "success" : "error", payload.message || "Inquiry update failed.");
  }

  async function submitForReview(type, id) {
    const note = window.prompt("Optional note for the admin", "") || "";
    const payload = await api(`/artist/api/review/${encodeURIComponent(type)}/${encodeURIComponent(id)}/submit`, {
      method: "POST",
      body: JSON.stringify({ note })
    });
    if (payload.content) {
      applyContent(payload.content);
      renderAll();
    }
    showMessage(payload.ok ? "success" : "error", payload.message || "Submit for review failed.");
  }

  async function markNotificationRead(id) {
    const payload = await api(`/artist/api/notifications/${encodeURIComponent(id)}/read`, {
      method: "POST",
      body: "{}"
    });
    if (payload.content) {
      applyContent(payload.content);
      renderAll();
    }
    showMessage(payload.ok ? "success" : "error", payload.message || "Notification update failed.");
  }

  function bindEvents() {
    document.addEventListener("click", (event) => {
      const galleryEdit = event.target.closest("[data-artist-edit-gallery]");
      const artworkEdit = event.target.closest("[data-artist-edit-artwork]");
      const inquiryView = event.target.closest("[data-artist-view-inquiry]");
      const reviewSubmit = event.target.closest("[data-submit-review-type]");
      const notificationRead = event.target.closest("[data-artist-read-notification]");

      if (galleryEdit) {
        renderGalleryForm(state.galleries.find((gallery) => gallery.id === galleryEdit.dataset.artistEditGallery));
      }

      if (artworkEdit) {
        renderArtworkForm(state.artwork.find((artwork) => artwork.id === artworkEdit.dataset.artistEditArtwork));
      }

      if (inquiryView) {
        renderInquiryDetail(inquiryView.dataset.artistViewInquiry);
      }

      if (reviewSubmit) {
        submitForReview(reviewSubmit.dataset.submitReviewType, reviewSubmit.dataset.submitReviewId);
      }

      if (notificationRead) {
        markNotificationRead(notificationRead.dataset.artistReadNotification);
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
    const mediaUploadForm = document.getElementById("artist-media-upload-form");

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

    mediaUploadForm?.addEventListener("submit", (event) => {
      event.preventDefault();
      uploadMedia(mediaUploadForm);
    });

    document.addEventListener("submit", (event) => {
      const inquiryForm = event.target.closest("#artist-inquiry-detail-form");
      if (inquiryForm) {
        event.preventDefault();
        saveInquiry(inquiryForm);
      }
    });
  }

  bindEvents();
  loadContent()
    .then(renderAll)
    .catch(() => {
      showMessage("error", "Unable to load artist portal content.");
    });
}());
