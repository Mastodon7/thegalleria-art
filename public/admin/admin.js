(function () {
  const statusOptions = ["draft", "pending_review", "approved", "published", "changes_requested", "archived"];
  const planStatusOptions = ["active", "draft", "archived"];
  const billingIntervalOptions = ["monthly", "annual", "both"];
  const billingStatusOptions = ["trial", "active", "past_due", "canceled", "comped", "legacy", "demo", "not_configured"];
  const subscriptionStatusOptions = ["trialing", "active", "past_due", "canceled", "incomplete", "none", "not_configured"];
  const invitationOptions = ["current", "invited", "pending", "accepted", "none"];
  const portfolioPageTypeOptions = ["cover", "artist_statement", "artwork_feature", "gallery_grid", "text_page", "contact_page"];
  const inquiryStatusOptions = ["new", "reviewed", "replied", "archived", "spam"];
  const state = {
    artists: [],
    plans: [],
    galleries: [],
    artwork: [],
    portfolioPages: [],
    media: [],
    inquiries: [],
    invitations: [],
    artistAccounts: [],
    notifications: [],
    billingEvents: [],
    emailLog: [],
    auditLog: [],
    emailStatus: {},
    billingStatus: {},
    artistBilling: [],
    statusHistory: [],
    selectedInquiryId: "",
    selectedReviewId: "",
    selectedUserArtistId: ""
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

  function publicGalleryUrl(gallery) {
    const artist = artistById(gallery?.artistId);
    return gallery?.canonicalPath || `/${artist?.slug || ""}/${gallery?.slug || ""}/`;
  }

  function absoluteUrl(pathname) {
    if (!pathname) {
      return "";
    }
    if (/^https?:\/\//.test(pathname)) {
      return pathname;
    }
    return `${window.location.origin}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
  }

  function previewArtistUrl(artist) {
    return artist?.id ? `/admin/preview/artist/${encodeURIComponent(artist.id)}/` : "";
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

  function planById(id) {
    return state.plans.find((plan) => plan.id === id);
  }

  function billingForArtist(id) {
    return state.artistBilling.find((billing) => billing.artistId === id) || {};
  }

  function formatPlanPrice(plan) {
    if (!plan) {
      return "-";
    }
    return `${plan.currency || "USD"} ${Number(plan.monthlyPrice || 0).toLocaleString()}/mo`;
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
      ...state.artwork.map((record) => ({ type: "artwork", record, artistId: record.artistId, title: record.title })),
      ...state.portfolioPages.map((record) => ({ type: "portfolio-page", record, artistId: record.artistId, title: record.title }))
    ]
      .filter((item) => ["pending_review", "changes_requested", "approved"].includes(item.record.status))
      .sort((left, right) => String(right.record.submittedAt || right.record.updatedAt || "").localeCompare(String(left.record.submittedAt || left.record.updatedAt || "")));
  }

  function reviewItemById(id) {
    return reviewItems().find((item) => `${item.type}:${item.record.id}` === id);
  }

  function userDirectoryRows() {
    const rows = state.artists.map((artist) => {
      const account = accountByArtistId(artist.id);
      const billing = billingForArtist(artist.id);
      return {
        id: artist.id,
        artist,
        account,
        billing,
        email: account?.email || artist.contactEmail || "",
        name: artist.name || "",
        accountStatus: account?.status || "no_account",
        artistStatus: artist.status || "draft",
        billingStatus: artist.billingStatus || billing.status || "not_configured",
        plan: billing.plan || planById(artist.planId),
        invitation: invitationByArtistId(artist.id)
      };
    });

    state.artistAccounts
      .filter((account) => !state.artists.some((artist) => artist.id === account.artistId))
      .forEach((account) => {
        rows.push({
          id: account.id,
          artist: null,
          account,
          billing: {},
          email: account.email || "",
          name: "Unlinked account",
          accountStatus: account.status || "active",
          artistStatus: "unlinked",
          billingStatus: "not_configured",
          plan: null,
          invitation: null
        });
      });

    return rows.sort((left, right) => String(left.name || left.email).localeCompare(String(right.name || right.email)));
  }

  function renderUserFilters() {
    const accountFilter = document.getElementById("users-account-filter");
    const planFilter = document.getElementById("users-plan-filter");
    const billingFilter = document.getElementById("users-billing-filter");
    const rows = userDirectoryRows();

    if (accountFilter) {
      const selected = accountFilter.value;
      const statuses = [...new Set(rows.map((row) => row.accountStatus).filter(Boolean))].sort();
      accountFilter.innerHTML = `
        <option value="">All accounts</option>
        ${statuses.map((status) => `<option value="${attr(status)}"${status === selected ? " selected" : ""}>${escapeHtml(status)}</option>`).join("")}
      `;
    }

    if (planFilter) {
      const selected = planFilter.value;
      planFilter.innerHTML = `
        <option value="">All plans</option>
        ${state.plans.map((plan) => `<option value="${attr(plan.id)}"${plan.id === selected ? " selected" : ""}>${escapeHtml(plan.name)}</option>`).join("")}
        <option value="none"${selected === "none" ? " selected" : ""}>No plan</option>
      `;
    }

    if (billingFilter) {
      const selected = billingFilter.value;
      const statuses = [...new Set(rows.map((row) => row.billingStatus).filter(Boolean))].sort();
      billingFilter.innerHTML = `
        <option value="">All billing states</option>
        ${statuses.map((status) => `<option value="${attr(status)}"${status === selected ? " selected" : ""}>${escapeHtml(status)}</option>`).join("")}
      `;
    }
  }

  function filteredUserRows() {
    const search = String(document.getElementById("users-search")?.value || "").trim().toLowerCase();
    const accountStatus = document.getElementById("users-account-filter")?.value || "";
    const planId = document.getElementById("users-plan-filter")?.value || "";
    const billingStatus = document.getElementById("users-billing-filter")?.value || "";

    return userDirectoryRows().filter((row) => {
      const haystack = [
        row.email,
        row.name,
        row.artist?.slug,
        row.artist?.professionalTitle,
        row.artist?.city,
        row.account?.id
      ].filter(Boolean).join(" ").toLowerCase();
      return (!search || haystack.includes(search)) &&
        (!accountStatus || row.accountStatus === accountStatus) &&
        (!billingStatus || row.billingStatus === billingStatus) &&
        (!planId || (planId === "none" ? !row.plan?.id : row.plan?.id === planId));
    });
  }

  function publicLinkHtml(artist) {
    if (!artist) {
      return '<span class="admin-muted">No artist record</span>';
    }

    if (artist.status === "published") {
      return `<a href="${attr(publicArtistUrl(artist))}" target="_blank" rel="noopener">View Public Page</a>`;
    }

    return `<a href="${attr(previewArtistUrl(artist))}" target="_blank" rel="noopener">Preview</a>`;
  }

  function publicGalleryLinkHtml(gallery) {
    if (!gallery) {
      return '<span class="admin-muted">No gallery record</span>';
    }
    const artist = artistById(gallery.artistId);
    if (gallery.status === "published" && artist?.status === "published") {
      return `<a href="${attr(publicGalleryUrl(gallery))}" target="_blank" rel="noopener">View Public Gallery</a>`;
    }
    return artist ? `<a href="${attr(previewArtistUrl(artist))}" target="_blank" rel="noopener">Preview Artist Page</a>` : '<span class="admin-muted">No public page yet</span>';
  }

  function recentForArtist(items, artistId, predicate) {
    return items
      .filter((item) => predicate(item, artistId))
      .sort((left, right) => String(right.createdAt || right.updatedAt || "").localeCompare(String(left.createdAt || left.updatedAt || "")))
      .slice(0, 5);
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
    state.plans = content.plans || [];
    state.galleries = content.galleries || [];
    state.artwork = content.artwork || [];
    state.portfolioPages = content.portfolioPages || [];
    state.media = content.media || [];
    state.inquiries = content.inquiries || [];
    state.invitations = content.invitations || [];
    state.artistAccounts = content.artistAccounts || [];
    state.notifications = content.notifications || [];
    state.billingEvents = content.billingEvents || [];
    state.emailLog = content.emailLog || [];
    state.auditLog = content.auditLog || [];
    state.emailStatus = content.emailStatus || {};
    state.billingStatus = content.billingStatus || {};
    state.artistBilling = content.artistBilling || [];
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
    const pendingReviewCount = reviewItems().filter((item) => item.record.status === "pending_review").length;
    const newInquiryCount = state.inquiries.filter((inquiry) => inquiry.status === "new").length;
    const publishedArtistCount = state.artists.filter((artist) => artist.status === "published").length;
    const draftPendingArtistCount = state.artists.filter((artist) => ["draft", "pending_review", "changes_requested", "approved"].includes(artist.status)).length;
    const mediaFailureCount = state.media.filter((media) => media.status === "failed").length;
    const overLimitCount = state.artistBilling.filter((entry) => entry.usageEvaluation?.status === "over_limit").length;
    const pendingInvitationCount = state.invitations.filter((invitation) => invitation.status === "pending" || invitation.status === "invited").length;
    setText("artist-count", state.artists.length);
    setText("gallery-count", state.galleries.length);
    setText("artwork-count", state.artwork.length);
    setText("media-count", activeMedia().length);
    setText("new-inquiry-count", newInquiryCount);
    setText("inquiry-count", state.inquiries.length);
    setText("pending-review-count", pendingReviewCount);
    setText("changes-requested-count", reviewItems().filter((item) => item.record.status === "changes_requested").length);
    setText("published-count", publishedArtistCount);
    setText("beta-total-artists", state.artists.length);
    setText("beta-published-artists", publishedArtistCount);
    setText("beta-draft-pending-artists", draftPendingArtistCount);
    setText("beta-pending-reviews", pendingReviewCount);
    setText("beta-new-inquiries", newInquiryCount);
    setText("beta-media-failures", mediaFailureCount);
    setText("beta-over-limits", overLimitCount);
    setText("beta-pending-invitations", pendingInvitationCount);

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

    renderNotifications();
  }

  function renderNotifications() {
    const list = document.getElementById("admin-notifications");
    if (!list) {
      return;
    }

    const notifications = state.notifications
      .filter((notification) => notification.audience === "admin")
      .sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")))
      .slice(0, 8);

    list.innerHTML = notifications.length ? notifications.map((notification) => `
      <article class="inquiry-card ${notification.readAt ? "" : "notification-unread"}">
        <div>
          <h3>${escapeHtml(notification.title)}</h3>
          <p>${escapeHtml(notification.message)}</p>
          <p>${escapeHtml(formatDateTime(notification.createdAt))}</p>
        </div>
        <div>
          ${notification.link ? `<a href="${attr(notification.link)}">Open</a>` : ""}
          <button type="button" data-read-notification="${attr(notification.id)}"${notification.readAt ? " disabled" : ""}>${notification.readAt ? "Read" : "Mark Read"}</button>
        </div>
      </article>
    `).join("") : '<p class="empty-state">No notifications yet.</p>';
  }

  function renderUsers() {
    const table = document.getElementById("users-table");
    if (!table) {
      return;
    }

    renderUserFilters();
    const rows = filteredUserRows();
    if (!state.selectedUserArtistId && rows[0]?.artist?.id) {
      state.selectedUserArtistId = rows[0].artist.id;
    }

    table.innerHTML = rows.length ? rows.map((row) => {
      const invitationStatus = row.invitation?.status || row.artist?.invitationStatus || "none";
      const lastLogin = row.account?.lastLoginAt || row.account?.acceptedAt || row.invitation?.acceptedAt || "";
      const createdAt = row.account?.createdAt || row.artist?.createdAt || "";
      return `
        <tr>
          <td>${escapeHtml(row.email || "No account email")}<br>${row.account?.demo || row.artist?.demo ? '<span class="admin-badge">Demo</span>' : ""}</td>
          <td>${escapeHtml(row.name)}<br><span class="admin-muted">${escapeHtml(row.artist?.slug || "No slug")}</span></td>
          <td>${badge(row.accountStatus)}<br>${badge(row.artistStatus)}</td>
          <td>${escapeHtml(row.plan?.name || "No plan")}<br>${badge(row.billingStatus)}</td>
          <td>${badge(invitationStatus)}</td>
          <td>Last login: ${escapeHtml(formatDateTime(lastLogin) || "Never")}<br>Created: ${escapeHtml(formatDate(createdAt) || "-")}</td>
          <td>${publicLinkHtml(row.artist)}</td>
          <td class="admin-actions">
            <button type="button" data-view-user="${attr(row.artist?.id || "")}"${row.artist ? "" : " disabled"}>Details</button>
            <button type="button" data-support-artist="${attr(row.artist?.id || "")}"${row.artist ? "" : " disabled"}>Enter Artist Portal</button>
          </td>
        </tr>
      `;
    }).join("") : '<tr><td colspan="8">No users match these filters.</td></tr>';

    renderUserDetail(state.selectedUserArtistId || rows[0]?.artist?.id || "");
  }

  function renderUserDetail(artistId) {
    const panel = document.getElementById("user-detail-panel");
    if (!panel) {
      return;
    }

    const row = userDirectoryRows().find((item) => item.artist?.id === artistId) || filteredUserRows().find((item) => item.artist);
    if (!row?.artist) {
      panel.innerHTML = '<p class="empty-state">Select an artist account to view details.</p>';
      return;
    }

    state.selectedUserArtistId = row.artist.id;
    const usage = row.billing.usage || {};
    const evaluation = row.billing.usageEvaluation || {};
    const recentInquiries = recentForArtist(state.inquiries, row.artist.id, (inquiry, id) => inquiry.artistId === id || inquiry.assignedArtistId === id);
    const recentMedia = recentForArtist(state.media, row.artist.id, (media, id) => media.ownerArtistId === id);
    const recentAudit = recentForArtist(state.auditLog, row.artist.id, (event, id) => event.targetId === id || (String(event.action || "").includes("support") && event.targetId === id));
    const invitationStatus = row.invitation?.status || row.artist.invitationStatus || "none";
    const customDomainEligible = Boolean(row.plan?.customDomainEligible);

    panel.innerHTML = `
      <div class="user-detail-grid">
        <article class="inquiry-detail-card">
          <p class="section-kicker">Artist</p>
          <h3>${escapeHtml(row.artist.name)}</h3>
          <p>${escapeHtml(row.artist.professionalTitle || "Artist")}</p>
          <p>${escapeHtml(row.email || row.artist.contactEmail || "No account email")}</p>
          <p>${badge(row.artistStatus)} ${badge(row.accountStatus)}</p>
        </article>
        <article class="inquiry-detail-card">
          <p class="section-kicker">Plan</p>
          <h3>${escapeHtml(row.plan?.name || "No plan")}</h3>
          <p>${badge(row.billingStatus)} ${badge(row.artist.subscriptionStatus || "not_configured")}</p>
          <p>${escapeHtml(formatDate(row.artist.trialEndAt) ? `Trial ends ${formatDate(row.artist.trialEndAt)}` : "No trial end date")}</p>
        </article>
        <article class="inquiry-detail-card">
          <p class="section-kicker">Usage</p>
          <h3>${Number(usage.galleries || 0)} galleries</h3>
          <p>${Number(usage.artwork || 0)} artwork records</p>
          <p>${Number(usage.media || 0)} media files / ${Number(usage.storageMb || 0)} MB</p>
          ${evaluation.warnings?.length ? `<p>${escapeHtml(evaluation.warnings.join(" "))}</p>` : ""}
        </article>
        <article class="inquiry-detail-card">
          <p class="section-kicker">Access</p>
          <h3>${escapeHtml(invitationStatus)}</h3>
          <p>Last login: ${escapeHtml(formatDateTime(row.account?.lastLoginAt) || "Never")}</p>
          <p>Created: ${escapeHtml(formatDate(row.account?.createdAt || row.artist.createdAt) || "-")}</p>
        </article>
        <article class="inquiry-detail-card">
          <p class="section-kicker">Domain Readiness</p>
          <h3>${escapeHtml(row.artist.customDomain || "No custom domain")}</h3>
          <p>${badge(row.artist.domainStatus || "not_configured")} ${badge(row.artist.sslStatus || "not_configured")}</p>
          <p>${customDomainEligible ? "Plan eligible for future custom domain setup." : "Current plan is not custom-domain eligible."}</p>
          <p>Verification token: ${escapeHtml(row.artist.domainVerificationToken || "Not generated")}</p>
          <p class="admin-muted">DNS and Coolify changes are managed manually by The Galleria.Art support.</p>
        </article>
      </div>

      <div class="admin-actions">
        ${publicLinkHtml(row.artist)}
        <button type="button" data-support-artist="${attr(row.artist.id)}">Enter Artist Portal</button>
      </div>

      <div class="inquiry-detail-grid">
        <div class="inquiry-message-block">
          <p class="section-kicker">Recent Inquiries</p>
          ${recentInquiries.length ? recentInquiries.map((inquiry) => `
            <p><strong>${escapeHtml(inquiry.visitorName || "Visitor")}</strong><br>${escapeHtml(messagePreview(inquiry.message, 90))}<br>${escapeHtml(formatDateTime(inquiry.createdAt))}</p>
          `).join("") : '<p class="empty-state">No recent inquiries.</p>'}
        </div>
        <div class="inquiry-message-block">
          <p class="section-kicker">Recent Media</p>
          ${recentMedia.length ? recentMedia.map((media) => `
            <p><strong>${escapeHtml(media.originalFilename || media.publicPath)}</strong><br>${escapeHtml(mediaPath(media, "gallery") || media.publicPath)}<br>${escapeHtml(formatDateTime(media.createdAt || media.uploadedAt))}</p>
          `).join("") : '<p class="empty-state">No recent media.</p>'}
        </div>
        <div class="inquiry-message-block">
          <p class="section-kicker">Recent Audit / Support</p>
          ${recentAudit.length ? recentAudit.map((event) => `
            <p><strong>${escapeHtml(event.action)}</strong><br>${escapeHtml(event.summary || "")}<br>${escapeHtml(formatDateTime(event.createdAt))}</p>
          `).join("") : '<p class="empty-state">No recent support events.</p>'}
        </div>
      </div>
    `;
  }

  function renderSettings() {
    setText("settings-public-contact-email", state.emailStatus.publicContactEmail || "-");
    setText("settings-email-configured", state.emailStatus.configured ? "Configured" : "Not Configured");
    setText("settings-email-mode", `Sending mode: ${state.emailStatus.mode || "log-only"}`);
    setText("settings-billing-configured", state.billingStatus.configured ? "Configured" : "Not Configured");
    setText("settings-billing-mode", `Billing mode: ${state.billingStatus.mode || "disabled"}`);
    setText("settings-default-plan", state.billingStatus.defaultPlanSlug || "-");
    setText("settings-trial-days", `${state.billingStatus.defaultTrialDays || 0} days`);
    setText("settings-stripe-readiness", state.billingStatus.checkoutAvailable ? "Ready for Checkout" : "Not Ready");

    const list = document.getElementById("settings-email-log");
    if (list) {
      const emails = state.emailLog.slice().sort((left, right) =>
        String(right.createdAt || "").localeCompare(String(left.createdAt || ""))
      ).slice(0, 10);
      list.innerHTML = emails.length ? emails.map((email) => `
        <article class="inquiry-card">
          <div>
            <h3>${escapeHtml(email.subject)}</h3>
            <p>${escapeHtml(email.to)} - ${escapeHtml(email.template)} - ${escapeHtml(email.status)}</p>
            <p>${escapeHtml(formatDateTime(email.createdAt))}</p>
          </div>
          <div>
            <button type="button" data-copy-email="${attr(email.bodyText || "")}">Copy</button>
          </div>
        </article>
      `).join("") : '<p class="empty-state">No email events have been recorded yet.</p>';
    }
  }

  function renderBillingSettings() {
    const summary = document.getElementById("stripe-config-summary");
    if (!summary) {
      return;
    }

    const status = state.billingStatus || {};
    const envNames = status.requiredEnvironment || [];
    summary.innerHTML = `
      <article>
        <strong>Mode</strong>
        <span>${escapeHtml(status.mode || "disabled")}</span>
        <p>Set with STRIPE_MODE. Live mode should wait until test Checkout and webhooks are verified.</p>
      </article>
      <article>
        <strong>Publishable Key</strong>
        <span>${status.publishableKeyConfigured ? `Configured (${escapeHtml(status.publishableKeyPreview || "set")})` : "Not configured"}</span>
        <p>Environment: STRIPE_PUBLISHABLE_KEY</p>
      </article>
      <article>
        <strong>Secret Key</strong>
        <span>${status.secretKeyConfigured ? "Configured" : "Not configured"}</span>
        <p>Environment: STRIPE_SECRET_KEY</p>
      </article>
      <article>
        <strong>Webhook Secret</strong>
        <span>${status.webhookSecretConfigured ? "Configured" : "Not configured"}</span>
        <p>Environment: STRIPE_WEBHOOK_SECRET</p>
      </article>
      <article>
        <strong>URLs</strong>
        <span>Success, cancel, and portal return URLs are environment-driven.</span>
        <p>${envNames.map(escapeHtml).join(", ")}</p>
      </article>
      <article>
        <strong>Default Currency</strong>
        <span>${escapeHtml(status.defaultCurrency || "USD")}</span>
        <p>Environment: DEFAULT_CURRENCY</p>
      </article>
    `;

    const checklist = document.getElementById("stripe-readiness-list");
    if (checklist) {
      checklist.innerHTML = (status.checklist || []).map((item) => `
        <article class="${item.complete ? "is-complete" : "is-missing"}">
          <strong>${item.complete ? "Ready" : "Missing"}</strong>
          <span>${escapeHtml(item.label)}</span>
        </article>
      `).join("");
    }

    setText("stripe-webhook-endpoint", status.webhookEndpoint || "-");
    setText("stripe-webhook-events", (status.requiredWebhookEvents || []).join(", ") || "-");

    const table = document.getElementById("billing-events-table");
    if (table) {
      table.innerHTML = state.billingEvents.length ? state.billingEvents.map((event) => {
        const artist = artistById(event.artistId);
        return `
          <tr>
            <td>${escapeHtml(formatDateTime(event.createdAt))}</td>
            <td>${escapeHtml(event.type)}</td>
            <td>${escapeHtml(artist?.name || event.artistId || "-")}</td>
            <td>${badge(event.status || "logged")}</td>
            <td>${escapeHtml(event.message || "-")}</td>
            <td>${escapeHtml(event.error || "-")}</td>
          </tr>
        `;
      }).join("") : '<tr><td colspan="6">No billing events have been recorded yet.</td></tr>';
    }
  }

  function renderPlanForm(plan = {}) {
    const form = document.getElementById("plan-form");
    if (!form) {
      return;
    }

    form.innerHTML = `
      <input name="id" type="hidden" value="${attr(plan.id)}">
      ${field("name", "Plan Name", plan.name)}
      ${field("slug", "Slug", plan.slug)}
      ${field("description", "Description", plan.description)}
      ${field("monthlyPrice", "Monthly Price", plan.monthlyPrice || 0, "number")}
      ${field("annualPrice", "Annual Price", plan.annualPrice || 0, "number")}
      ${field("currency", "Currency", plan.currency || "USD")}
      ${field("artistLimit", "Artist Limit", plan.artistLimit || 1, "number")}
      ${field("galleryLimit", "Gallery Limit", plan.galleryLimit || 1, "number")}
      ${field("artworkLimit", "Artwork Limit", plan.artworkLimit || 12, "number")}
      ${field("mediaLimit", "Media File Limit", plan.mediaLimit || 0, "number")}
      ${field("mediaStorageLimit", "Media Storage Limit MB", plan.mediaStorageLimit || 250, "number")}
      ${checkbox("featuredGalleryEligible", "Featured Gallery Eligible", plan.featuredGalleryEligible)}
      ${checkbox("customDomainEligible", "Custom Domain Eligible", plan.customDomainEligible)}
      ${field("stripeProductId", "Stripe Product ID", plan.stripeProductId)}
      ${field("stripeMonthlyPriceId", "Stripe Monthly Price ID", plan.stripeMonthlyPriceId)}
      ${field("stripeAnnualPriceId", "Stripe Annual Price ID", plan.stripeAnnualPriceId)}
      ${field("stripeTestMonthlyPriceId", "Stripe Test Monthly Price ID", plan.stripeTestMonthlyPriceId)}
      ${field("stripeTestAnnualPriceId", "Stripe Test Annual Price ID", plan.stripeTestAnnualPriceId)}
      ${field("stripeLiveMonthlyPriceId", "Stripe Live Monthly Price ID", plan.stripeLiveMonthlyPriceId)}
      ${field("stripeLiveAnnualPriceId", "Stripe Live Annual Price ID", plan.stripeLiveAnnualPriceId)}
      ${select("billingInterval", "Billing Interval", plan.billingInterval || "monthly", billingIntervalOptions.map((item) => ({ value: item, label: item })))}
      ${select("status", "Status", plan.status || "active", planStatusOptions.map((item) => ({ value: item, label: item })))}
      ${field("displayOrder", "Display Order", plan.displayOrder || 0, "number")}
    `;
  }

  function renderPlans() {
    const table = document.getElementById("plans-table");
    if (!table) {
      return;
    }

    const plans = state.plans.slice().sort((left, right) => Number(left.displayOrder || 0) - Number(right.displayOrder || 0));
    table.innerHTML = plans.length ? plans.map((plan) => `
      <tr>
        <td>${escapeHtml(plan.name)}</td>
        <td>${escapeHtml(plan.slug)}</td>
        <td>${escapeHtml(formatPlanPrice(plan))}</td>
        <td>${plan.annualPrice ? `${escapeHtml(plan.currency || "USD")} ${Number(plan.annualPrice).toLocaleString()}` : "-"}</td>
        <td>${badge(plan.status || "draft")}</td>
        <td>${Number(plan.galleryLimit || 0)} galleries<br>${Number(plan.artworkLimit || 0)} artwork<br>${Number(plan.mediaLimit || 0) || "Unlimited"} media<br>${Number(plan.mediaStorageLimit || 0)} MB</td>
        <td>${plan.stripeProductId ? "Product set" : "No product"}<br>${plan.stripeTestMonthlyPriceId || plan.stripeMonthlyPriceId ? "Test monthly set" : "No test monthly"}<br>${plan.stripeLiveMonthlyPriceId ? "Live monthly set" : "No live monthly"}</td>
        <td>${escapeHtml(plan.displayOrder)}</td>
        <td class="admin-actions">
          <button type="button" data-edit-plan="${attr(plan.id)}">Edit</button>
        </td>
      </tr>
    `).join("") : '<tr><td colspan="9">No plans have been configured yet.</td></tr>';

    renderPlanForm(plans[0] || {});
  }

  function renderAudit() {
    const table = document.getElementById("audit-table");
    if (!table) {
      return;
    }

    const actionFilter = String(document.getElementById("audit-action-filter")?.value || "").toLowerCase();
    const targetFilter = String(document.getElementById("audit-target-filter")?.value || "").toLowerCase();
    const events = state.auditLog
      .filter((event) => !actionFilter || String(event.action || "").toLowerCase().includes(actionFilter))
      .filter((event) => !targetFilter || String(event.targetType || "").toLowerCase().includes(targetFilter))
      .sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")))
      .slice(0, 100);

    table.innerHTML = events.length ? events.map((event) => `
      <tr>
        <td>${escapeHtml(formatDateTime(event.createdAt))}</td>
        <td>${escapeHtml(event.actorType)}<br>${escapeHtml(event.actorId)}</td>
        <td>${escapeHtml(event.action)}</td>
        <td>${escapeHtml(event.targetType)}<br>${escapeHtml(event.targetId)}</td>
        <td>${escapeHtml(event.summary)}</td>
      </tr>
    `).join("") : '<tr><td colspan="5">No audit events match these filters.</td></tr>';
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

    const planOptions = state.plans.map((plan) => ({ value: plan.id, label: plan.name }));
    const publicUrl = artist.id ? absoluteUrl(publicArtistUrl(artist)) : "Saved artists receive a public URL.";
    form.innerHTML = `
      <input name="id" type="hidden" value="${attr(artist.id)}">
      ${field("name", "Name", artist.name)}
      ${field("slug", "Slug", artist.slug)}
      <label>
        <span>Public URL</span>
        <input name="publicUrlDisplay" type="text" value="${attr(publicUrl)}" disabled>
      </label>
      ${field("customUrlLabel", "Custom URL Label", artist.customUrlLabel)}
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
      ${select("planId", "Billing Plan", artist.planId || planOptions[0]?.value || "", planOptions)}
      ${select("billingStatus", "Billing Status", artist.billingStatus || "not_configured", billingStatusOptions.map((item) => ({ value: item, label: item })))}
      ${select("subscriptionStatus", "Subscription Status", artist.subscriptionStatus || "not_configured", subscriptionStatusOptions.map((item) => ({ value: item, label: item })))}
      ${field("trialStartAt", "Trial Start", artist.trialStartAt)}
      ${field("trialEndAt", "Trial End", artist.trialEndAt)}
      ${field("currentPeriodStart", "Current Period Start", artist.currentPeriodStart)}
      ${field("currentPeriodEnd", "Current Period End", artist.currentPeriodEnd)}
      ${checkbox("cancelAtPeriodEnd", "Cancel at Period End", artist.cancelAtPeriodEnd)}
      ${checkbox("ignoreLimits", "Ignore Plan Limits", artist.ignoreLimits)}
      ${field("customGalleryLimit", "Custom Gallery Limit", artist.customGalleryLimit || 0, "number")}
      ${field("customArtworkLimit", "Custom Artwork Limit", artist.customArtworkLimit || 0, "number")}
      ${field("customMediaLimit", "Custom Media Limit", artist.customMediaLimit || 0, "number")}
      ${field("customStorageLimit", "Custom Storage Limit MB", artist.customStorageLimit || 0, "number")}
      ${textarea("limitOverrideNotes", "Limit Override Notes", artist.limitOverrideNotes)}
      ${checkbox("featured", "Featured", artist.featured)}
      ${textarea("shortDescription", "Short Description", artist.shortDescription)}
      ${textarea("bio", "Long Bio / Artist Statement", artist.bio)}
      ${field("seoTitle", "SEO Title", artist.seoTitle)}
      ${textarea("seoDescription", "SEO Description", artist.seoDescription)}
      ${field("socialTitle", "Social Share Title", artist.socialTitle)}
      ${textarea("socialDescription", "Social Share Description", artist.socialDescription)}
      ${imageField("socialImage", "Social Share Image", artist.socialImage || artist.heroImage)}
      ${field("canonicalUrlOverride", "Canonical URL Override", artist.canonicalUrlOverride)}
      ${checkbox("noindex", "Noindex Public Page", artist.noindex)}
      ${field("customDomain", "Custom Domain", artist.customDomain)}
      ${select("domainStatus", "Domain Status", artist.domainStatus || "not_configured", [
        { value: "not_configured", label: "not configured" },
        { value: "pending_verification", label: "pending verification" },
        { value: "verified", label: "verified" },
        { value: "active", label: "active" },
        { value: "error", label: "error" }
      ])}
      ${field("domainVerificationToken", "Verification Token", artist.domainVerificationToken)}
      ${field("domainVerifiedAt", "Verified Date", artist.domainVerifiedAt)}
      ${field("sslStatus", "SSL Status", artist.sslStatus || "not_configured")}
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
      const billing = billingForArtist(artist.id);
      const plan = billing.plan || planById(artist.planId);
      const usage = billing.usage || {};
      const evaluation = billing.usageEvaluation || {};
      const limitStatus = evaluation.status || "ok";
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
        <td>${escapeHtml(plan?.name || "No plan")}<br>${badge(artist.billingStatus || "not_configured")}<br>${badge(limitStatus)}</td>
        <td>${Number(usage.galleries || 0)} galleries (${Number(usage.publishedGalleries || 0)} published)<br>${Number(usage.artwork || 0)} artwork (${Number(usage.publishedArtwork || 0)} published)<br>${Number(usage.media || 0)} media<br>${Number(usage.storageMb || 0)} MB${evaluation.warnings?.length ? `<br><strong>${escapeHtml(evaluation.warnings[0])}</strong>` : ""}</td>
        <td>${escapeHtml(profileCompleteness(artist))}</td>
        <td>${escapeHtml(formatDate(acceptedOrLogin))}</td>
        <td>${publicLinkHtml(artist)}<br><button type="button" data-copy-path="${attr(absoluteUrl(publicArtistUrl(artist)))}">Copy URL</button></td>
        <td>${formatDate(artist.updatedAt)}</td>
        <td class="admin-actions">
          <button type="button" data-edit-artist="${attr(artist.id)}">Edit</button>
          ${publicLinkHtml(artist)}
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
    const publicUrl = gallery.id ? absoluteUrl(publicGalleryUrl(gallery)) : "Saved galleries receive a public URL.";
    form.innerHTML = `
      <input name="id" type="hidden" value="${attr(gallery.id)}">
      ${field("title", "Gallery Title", gallery.title)}
      ${field("slug", "Gallery Slug", gallery.slug)}
      <label>
        <span>Public URL</span>
        <input name="publicUrlDisplay" type="text" value="${attr(publicUrl)}" disabled>
      </label>
      ${field("customUrlLabel", "Custom URL Label", gallery.customUrlLabel)}
      ${select("artistId", "Associated Artist", gallery.artistId || artistOptions[0]?.value || "", artistOptions)}
      ${imageField("coverImage", "Cover Image", gallery.coverImage)}
      ${select("status", "Status", gallery.status || "draft", statusOptions.map((item) => ({ value: item, label: item })))}
      ${checkbox("featured", "Featured", gallery.featured)}
      ${field("displayOrder", "Display Order", gallery.displayOrder || 0, "number")}
      ${textarea("description", "Short Description", gallery.description)}
      ${field("seoTitle", "SEO Title", gallery.seoTitle)}
      ${textarea("seoDescription", "SEO Description", gallery.seoDescription)}
      ${field("socialTitle", "Social Share Title", gallery.socialTitle)}
      ${textarea("socialDescription", "Social Share Description", gallery.socialDescription)}
      ${imageField("socialImage", "Social Share Image", gallery.socialImage || gallery.coverImage)}
      ${field("canonicalUrlOverride", "Canonical URL Override", gallery.canonicalUrlOverride)}
      ${checkbox("noindex", "Noindex Public Gallery", gallery.noindex)}
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
          <td>${publicGalleryLinkHtml(gallery)}<br><button type="button" data-copy-path="${attr(absoluteUrl(publicGalleryUrl(gallery)))}">Copy URL</button></td>
          <td>${formatDate(gallery.updatedAt)}</td>
          <td class="admin-actions">
            <button type="button" data-edit-gallery="${attr(gallery.id)}">Edit</button>
            ${publicGalleryLinkHtml(gallery)}
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

  function renderPortfolioPageFilters() {
    const artistFilter = document.getElementById("portfolio-page-artist-filter");
    const statusFilter = document.getElementById("portfolio-page-status-filter");
    const typeFilter = document.getElementById("portfolio-page-type-filter");
    if (artistFilter) {
      const selected = artistFilter.value;
      artistFilter.innerHTML = `<option value="">All artists</option>${state.artists.map((artist) => `<option value="${attr(artist.id)}"${artist.id === selected ? " selected" : ""}>${escapeHtml(artist.name)}</option>`).join("")}`;
    }
    if (statusFilter) {
      const selected = statusFilter.value;
      statusFilter.innerHTML = `<option value="">All statuses</option>${statusOptions.map((status) => `<option value="${attr(status)}"${status === selected ? " selected" : ""}>${escapeHtml(status)}</option>`).join("")}`;
    }
    if (typeFilter) {
      const selected = typeFilter.value;
      typeFilter.innerHTML = `<option value="">All types</option>${portfolioPageTypeOptions.map((type) => `<option value="${attr(type)}"${type === selected ? " selected" : ""}>${escapeHtml(type.replaceAll("_", " "))}</option>`).join("")}`;
    }
  }

  function filteredPortfolioPages() {
    const search = String(document.getElementById("portfolio-page-search")?.value || "").toLowerCase();
    const artistId = document.getElementById("portfolio-page-artist-filter")?.value || "";
    const status = document.getElementById("portfolio-page-status-filter")?.value || "";
    const pageType = document.getElementById("portfolio-page-type-filter")?.value || "";
    return state.portfolioPages
      .filter((page) => !artistId || page.artistId === artistId)
      .filter((page) => !status || page.status === status)
      .filter((page) => !pageType || page.pageType === pageType)
      .filter((page) => !search || [page.title, page.subtitle, artistById(page.artistId)?.name].filter(Boolean).join(" ").toLowerCase().includes(search))
      .sort((left, right) => Number(left.displayOrder || 0) - Number(right.displayOrder || 0));
  }

  function renderPortfolioPageForm(page = {}) {
    const form = document.getElementById("portfolio-page-form");
    if (!form) {
      return;
    }

    const artistOptions = state.artists.map((artist) => ({ value: artist.id, label: artist.name }));
    const selectedArtistId = page.artistId || artistOptions[0]?.value || "";
    const galleryOptions = state.galleries
      .filter((gallery) => !selectedArtistId || gallery.artistId === selectedArtistId)
      .map((gallery) => ({ value: gallery.id, label: gallery.title }));
    form.innerHTML = `
      <input name="id" type="hidden" value="${attr(page.id)}">
      ${field("title", "Title", page.title)}
      ${field("subtitle", "Subtitle", page.subtitle)}
      ${select("artistId", "Artist", selectedArtistId, artistOptions)}
      ${select("galleryId", "Gallery Optional", page.galleryId || "", [{ value: "", label: "No gallery" }, ...galleryOptions])}
      ${select("pageType", "Page Type", page.pageType || "text_page", portfolioPageTypeOptions.map((type) => ({ value: type, label: type.replaceAll("_", " ") })))}
      ${select("status", "Status", page.status || "draft", statusOptions.map((status) => ({ value: status, label: status })))}
      ${imageField("featuredImage", "Featured / Hero Image", page.featuredImage)}
      ${textarea("bodyContent", "Body Content", page.bodyContent)}
      ${field("artworkIds", "Artwork IDs Comma Separated", (page.artworkIds || []).join(", "))}
      ${field("mediaIds", "Media IDs Comma Separated", (page.mediaIds || []).join(", "))}
      ${field("year", "Year", page.year)}
      ${field("location", "Location", page.location)}
      ${field("medium", "Medium", page.medium)}
      ${field("dimensions", "Dimensions", page.dimensions)}
      ${field("clientInfo", "Client / Commission Info", page.clientInfo)}
      ${field("displayOrder", "Display Order", page.displayOrder || 0, "number")}
      ${field("ctaLabel", "CTA Label", page.ctaLabel)}
      ${field("ctaUrl", "CTA URL", page.ctaUrl)}
      ${field("seoTitle", "SEO Title", page.seoTitle)}
      ${textarea("seoDescription", "SEO Description", page.seoDescription)}
    `;
  }

  function renderPortfolioPages() {
    const table = document.getElementById("portfolio-pages-table");
    if (!table) {
      return;
    }

    renderPortfolioPageFilters();
    const pages = filteredPortfolioPages();
    table.innerHTML = pages.length ? pages.map((page) => {
      const artist = artistById(page.artistId);
      return `
        <tr>
          <td>${escapeHtml(page.title)}<br><span class="admin-muted">${escapeHtml(page.subtitle || "")}</span></td>
          <td>${escapeHtml(artist?.name || "")}</td>
          <td>${escapeHtml((page.pageType || "").replaceAll("_", " "))}</td>
          <td>${badge(page.status || "draft")}</td>
          <td>${escapeHtml(page.displayOrder || 0)}</td>
          <td>${escapeHtml(formatDate(page.updatedAt))}</td>
          <td class="admin-actions">
            <button type="button" data-edit-portfolio-page="${attr(page.id)}">Edit</button>
            ${artist ? `<a href="${attr(previewArtistUrl(artist))}" target="_blank" rel="noopener">Preview</a>` : ""}
            <button type="button" data-archive-portfolio-page="${attr(page.id)}">Archive</button>
          </td>
        </tr>
      `;
    }).join("") : '<tr><td colspan="7">No portfolio pages match these filters.</td></tr>';

    renderPortfolioPageForm(pages[0] || {});
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
    renderUsers();
    renderMediaOwnerSelect();
    renderPlans();
    renderArtists();
    renderGalleries();
    renderArtwork();
    renderPortfolioPages();
    renderMedia();
    renderInquiries();
    renderInvitations();
    renderReview();
    renderSettings();
    renderBillingSettings();
    renderAudit();
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

  async function savePlan(form) {
    const payload = await api("/admin/api/plans", {
      method: "POST",
      body: JSON.stringify(formData(form))
    });

    updateFromPayload(payload);
    showMessage(payload.ok ? "success" : "error", payload.message || "Plan save failed.", payload.errors);
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

  async function markNotificationRead(id) {
    const payload = await api(`/admin/api/notifications/${encodeURIComponent(id)}/read`, {
      method: "POST",
      body: "{}"
    });

    updateFromPayload(payload);
    showMessage(payload.ok ? "success" : "error", payload.message || "Notification update failed.");
  }

  async function startSupport(artistId) {
    if (!artistId) {
      return;
    }

    const note = window.prompt("Optional support note", "") || "";
    const payload = await api(`/admin/api/support/artist/${encodeURIComponent(artistId)}/start`, {
      method: "POST",
      body: JSON.stringify({
        note,
        sourcePage: "/admin/users/",
        returnTo: "/admin/users/"
      })
    });

    if (payload.ok && payload.redirectUrl) {
      window.location.href = payload.redirectUrl;
      return;
    }

    showMessage("error", payload.message || "Support mode could not be started.");
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
      const notificationRead = event.target.closest("[data-read-notification]");
      const copyEmail = event.target.closest("[data-copy-email]");
      const planEdit = event.target.closest("[data-edit-plan]");
      const copyStripeWebhook = event.target.closest("#copy-stripe-webhook-endpoint");
      const userView = event.target.closest("[data-view-user]");
      const supportArtist = event.target.closest("[data-support-artist]");
      const portfolioPageEdit = event.target.closest("[data-edit-portfolio-page]");
      const portfolioPageArchive = event.target.closest("[data-archive-portfolio-page]");

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
      if (notificationRead) {
        markNotificationRead(notificationRead.dataset.readNotification);
      }
      if (copyEmail) {
        copyPath(copyEmail.dataset.copyEmail);
      }
      if (copyStripeWebhook) {
        copyPath(state.billingStatus.webhookEndpoint || "");
      }
      if (planEdit) {
        renderPlanForm(state.plans.find((plan) => plan.id === planEdit.dataset.editPlan) || {});
      }
      if (userView) {
        renderUserDetail(userView.dataset.viewUser);
      }
      if (supportArtist) {
        startSupport(supportArtist.dataset.supportArtist);
      }
      if (portfolioPageEdit) {
        renderPortfolioPageForm(state.portfolioPages.find((page) => page.id === portfolioPageEdit.dataset.editPortfolioPage) || {});
      }
      if (portfolioPageArchive) {
        archive(portfolioPageArchive.dataset.archivePortfolioPage, "/admin/api/portfolio-pages");
      }
      if (event.target.id === "add-artist") {
        renderArtistForm({});
      }
      if (event.target.id === "add-portfolio-page") {
        renderPortfolioPageForm({});
      }
      if (event.target.id === "add-plan") {
        renderPlanForm({});
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
      const auditFilter = event.target.closest("#audit-action-filter, #audit-target-filter");
      const userFilter = event.target.closest("#users-account-filter, #users-plan-filter, #users-billing-filter");
      const portfolioFilter = event.target.closest("#portfolio-page-artist-filter, #portfolio-page-status-filter, #portfolio-page-type-filter");
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
      if (auditFilter) {
        renderAudit();
      }
      if (userFilter) {
        state.selectedUserArtistId = "";
        renderUsers();
      }
      if (portfolioFilter) {
        renderPortfolioPages();
      }
    });

    document.addEventListener("input", (event) => {
      const imageInput = event.target.closest("[data-image-input]");
      const auditFilter = event.target.closest("#audit-action-filter, #audit-target-filter");
      const userSearch = event.target.closest("#users-search");
      const portfolioSearch = event.target.closest("#portfolio-page-search");
      if (imageInput) {
        updateImagePreview(imageInput.dataset.imageInput, imageInput.value);
      }
      if (auditFilter) {
        renderAudit();
      }
      if (userSearch) {
        state.selectedUserArtistId = "";
        renderUsers();
      }
      if (portfolioSearch) {
        renderPortfolioPages();
      }
    });

    const artistForm = document.getElementById("artist-form");
    const galleryForm = document.getElementById("gallery-form");
    const artworkForm = document.getElementById("artwork-form");
    const planForm = document.getElementById("plan-form");
    const portfolioPageForm = document.getElementById("portfolio-page-form");
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

    planForm?.addEventListener("submit", (event) => {
      event.preventDefault();
      savePlan(planForm);
    });

    portfolioPageForm?.addEventListener("submit", (event) => {
      event.preventDefault();
      save("portfolioPage", portfolioPageForm, "/admin/api/portfolio-pages");
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
