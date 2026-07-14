(function () {
  const data = window.GalleriaData || { artists: [] };
  const artists = data.artists || [];
  const galleries = artists.flatMap((artist) => (artist.galleries || []).map((gallery) => ({ ...gallery, artist })));
  const artworks = galleries.flatMap((gallery) => (gallery.artworks || []).map((artwork) => ({ ...artwork, gallery, artist: gallery.artist })));

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function yesNo(value) {
    return value ? "Yes" : "No";
  }

  function badge(value) {
    return `<span class="admin-badge">${escapeHtml(value)}</span>`;
  }

  function publicArtistUrl(artist) {
    return artist.canonicalPath || `/${artist.slug}/`;
  }

  function setText(id, value) {
    const element = document.getElementById(id);
    if (element) {
      element.textContent = value;
    }
  }

  function renderDashboard() {
    setText("artist-count", artists.length);
    setText("gallery-count", galleries.length);
    setText("artwork-count", artworks.length);
    setText("published-count", artists.filter((artist) => artist.status === "published").length);
  }

  function renderArtists() {
    const table = document.getElementById("artists-table");
    if (!table) {
      return;
    }

    table.innerHTML = artists.map((artist) => `
      <tr>
        <td>${escapeHtml(artist.name)}</td>
        <td>${escapeHtml(artist.slug)}</td>
        <td>${escapeHtml(artist.professionalTitle)}</td>
        <td>${escapeHtml([artist.city, artist.region].filter(Boolean).join(", "))}</td>
        <td>${escapeHtml(artist.medium)}</td>
        <td>${badge(artist.status)}</td>
        <td>${yesNo(artist.featured)}</td>
        <td class="admin-actions">
          <button type="button" disabled>Edit</button>
          <a href="${publicArtistUrl(artist)}">View Public Page</a>
        </td>
      </tr>
    `).join("");

    const artist = artists[0] || {};
    const form = document.getElementById("artist-form");
    if (form) {
      form.innerHTML = [
        ["name", "Name", artist.name],
        ["slug", "Slug", artist.slug],
        ["professionalTitle", "Professional Title", artist.professionalTitle],
        ["city", "City", artist.city],
        ["region", "State / Region", artist.region],
        ["country", "Country", artist.country],
        ["medium", "Medium", artist.medium],
        ["category", "Category", artist.category],
        ["heroImage", "Hero Image", artist.heroImage],
        ["contactEmail", "Contact Email", artist.contactEmail],
        ["website", "Website", artist.website],
        ["socialLinks", "Instagram / Social Link", (artist.socialLinks || []).join(", ")],
        ["status", "Published Status", artist.status],
        ["featured", "Featured Status", yesNo(artist.featured)],
        ["invitationStatus", "Invitation Status", artist.invitationStatus]
      ].map(([name, label, value]) => `
        <label>
          <span>${label}</span>
          <input name="${name}" value="${escapeHtml(value)}" readonly>
        </label>
      `).join("") + `
        <label class="admin-field-wide">
          <span>Short Description</span>
          <textarea name="shortDescription" readonly>${escapeHtml(artist.shortDescription)}</textarea>
        </label>
        <label class="admin-field-wide">
          <span>Long Bio / Artist Statement</span>
          <textarea name="bio" readonly>${escapeHtml(artist.bio)}</textarea>
        </label>
      `;
    }
  }

  function renderGalleries() {
    const table = document.getElementById("galleries-table");
    if (!table) {
      return;
    }

    table.innerHTML = galleries.map((gallery) => `
      <tr>
        <td>${escapeHtml(gallery.title)}</td>
        <td>${escapeHtml(gallery.slug)}</td>
        <td>${escapeHtml(gallery.artist.name)}</td>
        <td>${badge(gallery.status)}</td>
        <td>${yesNo(gallery.featured)}</td>
        <td>${escapeHtml(gallery.displayOrder)}</td>
        <td class="admin-actions">
          <button type="button" disabled>Edit</button>
          <a href="${publicArtistUrl(gallery.artist)}">View Public Gallery</a>
        </td>
      </tr>
    `).join("");

    const gallery = galleries[0] || {};
    const form = document.getElementById("gallery-form");
    if (form) {
      form.innerHTML = [
        ["title", "Gallery Title", gallery.title],
        ["slug", "Gallery Slug", gallery.slug],
        ["artist", "Associated Artist", gallery.artist?.name],
        ["coverImage", "Cover Image", gallery.coverImage],
        ["status", "Published Status", gallery.status],
        ["featured", "Featured Status", yesNo(gallery.featured)],
        ["displayOrder", "Display Order", gallery.displayOrder]
      ].map(([name, label, value]) => `
        <label>
          <span>${label}</span>
          <input name="${name}" value="${escapeHtml(value)}" readonly>
        </label>
      `).join("") + `
        <label class="admin-field-wide">
          <span>Short Description</span>
          <textarea name="description" readonly>${escapeHtml(gallery.description)}</textarea>
        </label>
      `;
    }
  }

  function renderArtwork() {
    const table = document.getElementById("artwork-table");
    if (!table) {
      return;
    }

    table.innerHTML = artworks.map((artwork) => `
      <tr>
        <td>${escapeHtml(artwork.title)}</td>
        <td>${escapeHtml(artwork.artist.name)}</td>
        <td>${escapeHtml(artwork.gallery.title)}</td>
        <td>${escapeHtml(artwork.year)}</td>
        <td>${escapeHtml(artwork.location)}</td>
        <td>${escapeHtml(artwork.displayOrder)}</td>
        <td>${badge(artwork.status)}</td>
        <td class="admin-actions">
          <button type="button" disabled>Edit</button>
        </td>
      </tr>
    `).join("");

    const artwork = artworks[0] || {};
    const form = document.getElementById("artwork-form");
    if (form) {
      form.innerHTML = [
        ["title", "Artwork Title", artwork.title],
        ["artist", "Artist", artwork.artist?.name],
        ["gallery", "Gallery", artwork.gallery?.title],
        ["image", "Image", artwork.image],
        ["alt", "Alt Text", artwork.alt],
        ["year", "Year", artwork.year],
        ["location", "Location", artwork.location],
        ["medium", "Medium", artwork.medium],
        ["dimensions", "Dimensions", artwork.dimensions],
        ["displayOrder", "Display Order", artwork.displayOrder],
        ["status", "Published Status", artwork.status]
      ].map(([name, label, value]) => `
        <label>
          <span>${label}</span>
          <input name="${name}" value="${escapeHtml(value)}" readonly>
        </label>
      `).join("") + `
        <label class="admin-field-wide">
          <span>Short Description</span>
          <textarea name="description" readonly>${escapeHtml(artwork.description)}</textarea>
        </label>
      `;
    }
  }

  renderDashboard();
  renderArtists();
  renderGalleries();
  renderArtwork();
}());
