(function () {
  const data = window.GalleriaData || { artists: [] };
  const artists = data.artists || [];
  const galleryList = document.getElementById("gallery-list");
  const featuredCard = document.getElementById("featured-gallery-card");
  const exploreButton = document.getElementById("explore-gallery");
  const searchInput = document.getElementById("gallery-search");

  function artistUrl(artist) {
    return `/${artist.slug}/`;
  }

  function galleryKeywords(artist) {
    const galleryText = (artist.galleries || [])
      .map((gallery) => `${gallery.title} ${gallery.description}`)
      .join(" ");
    return [
      artist.name,
      artist.professionalTitle,
      artist.city,
      artist.medium,
      artist.category,
      artist.shortDescription,
      galleryText
    ].join(" ").toLowerCase();
  }

  function renderGalleryCards(list) {
    galleryList.innerHTML = "";

    list.forEach((artist) => {
      const card = document.createElement("article");
      card.className = "gallery-card";
      card.innerHTML = `
        <div>
          <p>${artist.professionalTitle}</p>
          <h3><a class="gallery-link" href="${artistUrl(artist)}">${artist.name}</a></h3>
        </div>
        <a class="card-arrow" href="${artistUrl(artist)}" aria-label="View ${artist.name} gallery">View Gallery</a>
      `;
      galleryList.appendChild(card);
    });

    if (!list.length) {
      galleryList.innerHTML = '<p class="empty-state">No public galleries match that search yet.</p>';
    }
  }

  function getFeaturedArtist() {
    return artists.find((artist) => (artist.galleries || []).some((gallery) => gallery.featured)) || artists[0];
  }

  function renderFeaturedGallery() {
    const artist = getFeaturedArtist();

    if (!artist) {
      featuredCard.innerHTML = "";
      return;
    }

    const gallery = (artist.galleries || []).find((item) => item.featured) || artist.galleries?.[0] || {};
    featuredCard.innerHTML = `
      <img src="${gallery.coverImage || artist.heroImage}" alt="${artist.name} featured gallery image">
      <div class="featured-copy">
        <p>${artist.professionalTitle}</p>
        <h3>${artist.name}</h3>
        <p>${gallery.description || artist.shortDescription}</p>
        <a class="home-button" href="${artistUrl(artist)}">VIEW GALLERY</a>
      </div>
    `;
  }

  searchInput.addEventListener("input", () => {
    const query = searchInput.value.trim().toLowerCase();
    const filteredArtists = query
      ? artists.filter((artist) => galleryKeywords(artist).includes(query))
      : artists;
    renderGalleryCards(filteredArtists);
  });

  exploreButton.addEventListener("click", () => {
    if (!artists.length) {
      return;
    }

    const publishedArtists = artists.filter((artist) => artist.slug);
    const randomArtist = publishedArtists[Math.floor(Math.random() * publishedArtists.length)] || artists[0];
    window.location.href = artistUrl(randomArtist);
  });

  renderGalleryCards(artists);
  renderFeaturedGallery();
}());
