(function () {
  function formData(form) {
    const data = {};
    [...form.elements].forEach((element) => {
      if (!element.name) {
        return;
      }
      data[element.name] = element.value;
    });
    return data;
  }

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function feedbackFor(form) {
    return form.querySelector("[data-inquiry-feedback]");
  }

  function showFeedback(form, type, message, errors) {
    const element = feedbackFor(form);
    if (!element) {
      return;
    }

    element.className = `inquiry-feedback ${type}`;
    element.innerHTML = `
      <strong>${escapeHtml(message)}</strong>
      ${errors?.length ? `<ul>${errors.map((error) => `<li>${escapeHtml(error)}</li>`).join("")}</ul>` : ""}
    `;
  }

  function selectArtwork(artworkId) {
    const select = document.querySelector("[data-inquiry-artwork-select]");
    const form = document.querySelector("[data-inquiry-form]");
    if (select && artworkId) {
      select.value = artworkId;
    }
    if (form) {
      form.scrollIntoView({ behavior: "smooth", block: "center" });
      form.querySelector('[name="message"]')?.focus({ preventScroll: true });
    }
  }

  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-inquiry-select]");
    if (button) {
      selectArtwork(button.dataset.inquirySelect);
    }
  });

  document.addEventListener("galleria:selectInquiryArtwork", (event) => {
    selectArtwork(event.detail?.artworkId || "");
  });

  document.querySelectorAll("[data-inquiry-form]").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      showFeedback(form, "pending", "Sending inquiry...");

      try {
        const response = await fetch("/api/inquiries", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(formData(form))
        });
        const payload = await response.json();

        if (!payload.ok) {
          showFeedback(form, "error", payload.message || "Unable to send inquiry.", payload.errors);
          return;
        }

        showFeedback(form, "success", payload.message || "Thank you. Your inquiry has been received.");
        form.reset();
      } catch (error) {
        showFeedback(form, "error", "Unable to send inquiry. Please try again.");
      }
    });
  });
}());
