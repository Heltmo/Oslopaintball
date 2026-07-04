document.addEventListener("DOMContentLoaded", () => {
  const bookingsBody = document.querySelector(".bookings-body");
  const refreshButton = document.querySelector(".admin-refresh");
  const messageBox = document.querySelector(".admin-message");
  const searchInput = document.querySelector(".admin-search");
  const statusFilter = document.querySelector(".admin-status-filter");
  const dateFilter = document.querySelector(".admin-date-filter");
  const clearFiltersButton = document.querySelector(".admin-clear-filters");
  const tabButtons = Array.from(document.querySelectorAll("[data-work-view]"));
  const detailPanel = document.querySelector(".admin-detail-panel");
  const detailClose = document.querySelector(".admin-detail-close");
  const noteInput = document.querySelector(".admin-note-input");
  const saveNoteButton = document.querySelector(".admin-save-note");
  const deleteBookingButton = document.querySelector(".admin-delete-booking");
  const detailTargets = {
    title: document.querySelector("[data-detail-title]"),
    customer: document.querySelector("[data-detail-customer]"),
    contact: document.querySelector("[data-detail-contact]"),
    package: document.querySelector("[data-detail-package]"),
    datetime: document.querySelector("[data-detail-datetime]"),
    group: document.querySelector("[data-detail-group]"),
    extras: document.querySelector("[data-detail-extras]"),
    notes: document.querySelector("[data-detail-notes]"),
    call: document.querySelector("[data-detail-call]"),
    email: document.querySelector("[data-detail-email]")
  };
  const summaryTargets = {
    total: document.querySelector('[data-summary="total"]'),
    createdToday: document.querySelector('[data-summary="createdToday"]'),
    eventToday: document.querySelector('[data-summary="eventToday"]'),
    upcoming: document.querySelector('[data-summary="upcoming"]'),
    pending: document.querySelector('[data-summary="pending"]'),
    confirmed: document.querySelector('[data-summary="confirmed"]'),
    cancelled: document.querySelector('[data-summary="cancelled"]'),
    completed: document.querySelector('[data-summary="completed"]')
  };
  const viewCountTargets = {
    all: document.querySelector('[data-view-count="all"]'),
    pending: document.querySelector('[data-view-count="pending"]'),
    createdToday: document.querySelector('[data-view-count="createdToday"]'),
    eventToday: document.querySelector('[data-view-count="eventToday"]'),
    upcoming: document.querySelector('[data-view-count="upcoming"]')
  };

  let latestSeenCreatedAt = "";
  let allBookings = [];
  let selectedBookingId = null;
  let activeWorkView = "all";

  const loadBookings = async options => {
    const isInitial = options?.initial === true;

    try {
      const payload = await requestJson("api/bookings", {}, "Kunne ikke laste bookinger.");

      allBookings = sortBookings(payload.bookings);
      renderDashboard();
      refreshSelectedBooking();

      if (payload.bookings.length) {
        latestSeenCreatedAt = payload.bookings[0].created_at;
      }

      if (!isInitial) {
        showMessage(messageBox, "Adminoversikten er oppdatert.", "success");
      }
    } catch (error) {
      if (isInitial && !allBookings.length) {
        renderSummary(summaryTargets, getSummary([]));
        renderViewCounts(viewCountTargets, []);
        renderBookings(bookingsBody, [], latestSeenCreatedAt, selectedBookingId);
      }

      showMessage(messageBox, error.message, "error");
    }
  };

  if (refreshButton) {
    refreshButton.addEventListener("click", () => {
      loadBookings({ initial: false });
    });
  }

  [searchInput, statusFilter, dateFilter].forEach(input => {
    input?.addEventListener("input", () => {
      renderVisibleBookings();
    });
    input?.addEventListener("change", () => {
      renderVisibleBookings();
    });
  });

  clearFiltersButton?.addEventListener("click", () => {
    if (searchInput) searchInput.value = "";
    if (statusFilter) statusFilter.value = "all";
    if (dateFilter) dateFilter.value = "";
    activeWorkView = "all";
    updateActiveTab(tabButtons, activeWorkView);
    renderDashboard();
  });

  tabButtons.forEach(button => {
    button.addEventListener("click", () => {
      activeWorkView = button.dataset.workView || "all";
      updateActiveTab(tabButtons, activeWorkView);
      renderVisibleBookings();
    });
  });

  loadBookings({ initial: true });
  window.setInterval(() => {
    loadBookings({ initial: true });
  }, 15000);

  bookingsBody?.addEventListener("click", event => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.matches(".admin-row-action")) {
      return;
    }

    const bookingId = Number.parseInt(target.dataset.bookingId || "", 10);
    const booking = allBookings.find(item => item.id === bookingId);
    if (booking) {
      openBookingDetail(booking);
    }
  });

  bookingsBody?.addEventListener("change", async event => {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement) || !target.matches(".status-select")) {
      return;
    }

    const bookingId = target.dataset.bookingId;
    const nextStatus = target.value;

    updateBookingStatus(bookingId, nextStatus);
  });

  detailClose?.addEventListener("click", () => {
    selectedBookingId = null;
    if (detailPanel) {
      detailPanel.hidden = true;
    }
    renderVisibleBookings();
  });

  detailPanel?.addEventListener("click", event => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.matches("[data-detail-status]") || selectedBookingId == null) {
      return;
    }

    updateBookingStatus(selectedBookingId, target.dataset.detailStatus || "");
  });

  deleteBookingButton?.addEventListener("click", async () => {
    if (selectedBookingId == null) {
      return;
    }

    const booking = allBookings.find(item => item.id === selectedBookingId);
    const label = booking ? `#${booking.id} - ${booking.name}` : `#${selectedBookingId}`;
    const confirmed = window.confirm(`Slette booking ${label}? Dette kan ikke angres.`);

    if (!confirmed) {
      return;
    }

    try {
      await requestJson(
        `api/bookings/${selectedBookingId}`,
        { method: "DELETE" },
        "Kunne ikke slette booking."
      );

      allBookings = allBookings.filter(item => item.id !== selectedBookingId);
      selectedBookingId = null;
      if (detailPanel) {
        detailPanel.hidden = true;
      }
      renderDashboard();
      showMessage(messageBox, `Booking ${label} er slettet.`, "success");
    } catch (error) {
      showMessage(messageBox, error.message, "error");
    }
  });

  saveNoteButton?.addEventListener("click", async () => {
    if (selectedBookingId == null) {
      return;
    }

    try {
      const payload = await requestJson(
        `api/bookings/${selectedBookingId}/admin-notes`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ admin_notes: noteInput?.value || "" })
        },
        "Kunne ikke lagre internt notat."
      );

      updateBookingInState(payload.booking);
      openBookingDetail(payload.booking);
      showMessage(messageBox, `Notat for booking #${selectedBookingId} er lagret.`, "success");
    } catch (error) {
      showMessage(messageBox, error.message, "error");
    }
  });

  function getFilteredBookings(bookings) {
    const query = (searchInput?.value || "").trim().toLowerCase();
    const status = statusFilter?.value || "all";
    const date = dateFilter?.value || "";

    return bookings.filter(booking => {
      const matchesWorkView = bookingMatchesWorkView(booking, activeWorkView);
      const matchesStatus = status === "all" || booking.status === status;
      const matchesDate = !date || booking.preferred_date === date;
      const searchable = [
        booking.name,
        booking.phone,
        booking.email,
        booking.package,
        booking.notes,
        booking.preferred_date,
        booking.preferred_time
      ]
        .join(" ")
        .toLowerCase();

      return matchesWorkView && matchesStatus && matchesDate && (!query || searchable.includes(query));
    });
  }

  function renderDashboard() {
    renderSummary(summaryTargets, getSummary(allBookings));
    renderViewCounts(viewCountTargets, allBookings);
    renderVisibleBookings();
  }

  function renderVisibleBookings() {
    renderBookings(bookingsBody, getFilteredBookings(allBookings), latestSeenCreatedAt, selectedBookingId);
  }

  async function updateBookingStatus(bookingId, nextStatus) {
    try {
      const payload = await requestJson(
        `api/bookings/${bookingId}/status`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ status: nextStatus })
        },
        "Kunne ikke oppdatere status."
      );

      updateBookingInState(payload.booking);
      refreshSelectedBooking();
      renderDashboard();
      showMessage(messageBox, `Booking #${bookingId} er oppdatert til ${nextStatus}.`, "success");
    } catch (error) {
      showMessage(messageBox, error.message, "error");
      renderVisibleBookings();
    }
  }

  function updateBookingInState(updatedBooking) {
    allBookings = sortBookings(allBookings.map(booking => (booking.id === updatedBooking.id ? updatedBooking : booking)));
  }

  function openBookingDetail(booking) {
    selectedBookingId = booking.id;
    renderBookingDetail(booking, detailTargets, noteInput);
    if (detailPanel) {
      detailPanel.hidden = false;
      detailPanel.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    renderVisibleBookings();
  }

  function refreshSelectedBooking() {
    if (selectedBookingId == null) {
      return;
    }

    const booking = allBookings.find(item => item.id === selectedBookingId);
    if (booking) {
      renderBookingDetail(booking, detailTargets, noteInput);
    }
  }
});

function renderSummary(targets, summary) {
  Object.entries(targets).forEach(([key, element]) => {
    if (!element) {
      return;
    }

    element.textContent = String(summary?.[key] ?? 0);
  });
}

function getSummary(bookings) {
  return {
    total: bookings.length,
    createdToday: bookings.filter(isCreatedToday).length,
    eventToday: bookings.filter(isEventToday).length,
    upcoming: bookings.filter(isUpcomingBooking).length,
    pending: bookings.filter(booking => booking.status === "pending").length,
    confirmed: bookings.filter(booking => booking.status === "confirmed").length,
    cancelled: bookings.filter(booking => booking.status === "cancelled").length,
    completed: bookings.filter(booking => booking.status === "completed").length
  };
}

function renderViewCounts(targets, bookings) {
  const counts = {
    all: bookings.length,
    pending: bookings.filter(booking => bookingMatchesWorkView(booking, "pending")).length,
    createdToday: bookings.filter(booking => bookingMatchesWorkView(booking, "createdToday")).length,
    eventToday: bookings.filter(booking => bookingMatchesWorkView(booking, "eventToday")).length,
    upcoming: bookings.filter(booking => bookingMatchesWorkView(booking, "upcoming")).length
  };

  Object.entries(targets).forEach(([key, element]) => {
    if (element) {
      element.textContent = String(counts[key] ?? 0);
    }
  });
}

function updateActiveTab(buttons, activeView) {
  buttons.forEach(button => {
    const isActive = button.dataset.workView === activeView;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  });
}

function renderBookingDetail(booking, targets, noteInput) {
  const extras = booking.extras.length ? booking.extras.join(", ") : "Ingen tillegg";
  const notes = booking.notes || "Ingen kundemelding.";

  setElementText(targets.title, `Booking #${booking.id}`);
  setElementText(targets.customer, booking.name);
  setElementText(targets.contact, `${booking.phone} · ${booking.email}`);
  setElementText(targets.package, booking.package);
  setElementText(targets.datetime, formatBookingDateTime(booking));
  setElementText(targets.group, `${booking.group_size} personer`);
  setElementText(targets.extras, extras);
  setElementText(targets.notes, notes);

  if (targets.call) {
    targets.call.href = `tel:${booking.phone}`;
  }

  if (targets.email) {
    targets.email.href = `mailto:${booking.email}`;
  }

  if (noteInput) {
    noteInput.value = booking.admin_notes || "";
  }
}

function setElementText(element, value) {
  if (element) {
    element.textContent = value;
  }
}

function renderBookings(container, bookings, latestSeenCreatedAt, selectedBookingId = null) {
  if (!container) {
    return;
  }

  if (!bookings.length) {
    container.innerHTML = `
      <tr>
        <td colspan="10" class="empty-state">Ingen bookinger matcher filtrene.</td>
      </tr>
    `;
    return;
  }

  container.innerHTML = bookings
    .map(booking => {
      const extras = booking.extras.length ? booking.extras.join(", ") : "Ingen tillegg";
      const notes = booking.notes || "Ingen notater";
      const isNew = isCreatedToday(booking) || (latestSeenCreatedAt && booking.created_at > latestSeenCreatedAt);
      const isSelected = selectedBookingId === booking.id;
      const rowFlags = getBookingFlags(booking);
      const rowClasses = [
        isNew ? "new-row" : "",
        isSelected ? "selected-row" : "",
        isEventToday(booking) ? "event-today-row" : "",
        needsFollowUp(booking) ? "follow-up-row" : ""
      ].filter(Boolean).join(" ");

      return `
        <tr class="${rowClasses}">
          <td>#${booking.id}</td>
          <td>
            <strong>${escapeHtml(booking.name)}</strong><br />
            <span class="booking-meta">${escapeHtml(booking.phone)}</span><br />
            <span class="booking-meta">${escapeHtml(booking.email)}</span>
            ${renderBookingTags(rowFlags)}
          </td>
          <td>${escapeHtml(booking.package)}</td>
          <td>${booking.group_size} pers</td>
          <td>
            <strong class="booking-date">${escapeHtml(formatBookingDate(booking.preferred_date))}</strong><br />
            <span class="booking-meta">kl. ${escapeHtml(booking.preferred_time)}</span>
          </td>
          <td>${escapeHtml(extras)}</td>
          <td>
            <span class="status-chip ${escapeHtml(booking.status)}">${escapeHtml(statusLabel(booking.status))}</span>
            <div class="status-control">
              <select class="status-select" data-booking-id="${booking.id}">
                ${renderStatusOptions(booking.status)}
              </select>
            </div>
          </td>
          <td>${formatDateTime(booking.created_at)}</td>
          <td>${escapeHtml(notes)}</td>
          <td>
            <button type="button" class="admin-row-action" data-booking-id="${booking.id}">
              Åpne
            </button>
          </td>
        </tr>
      `;
    })
    .join("");
}

function renderBookingTags(flags) {
  if (!flags.length) {
    return "";
  }

  return `
    <div class="booking-tags">
      ${flags.map(flag => `<span class="booking-tag ${escapeHtml(flag.type)}">${escapeHtml(flag.label)}</span>`).join("")}
    </div>
  `;
}

function renderStatusOptions(currentStatus) {
  const statuses = ["pending", "confirmed", "cancelled", "completed"];

  return statuses
    .map(status => `<option value="${status}" ${status === currentStatus ? "selected" : ""}>${statusLabel(status)}</option>`)
    .join("");
}

function statusLabel(status) {
  const labels = {
    pending: "Venter",
    confirmed: "Bekreftet",
    cancelled: "Avlyst",
    completed: "Fullført"
  };

  return labels[status] || status;
}

function getBookingFlags(booking) {
  const flags = [];

  if (isCreatedToday(booking)) {
    flags.push({ type: "new", label: "NY" });
  }

  if (isEventToday(booking)) {
    flags.push({ type: "today", label: "I dag" });
  }

  if (needsFollowUp(booking)) {
    flags.push({ type: "attention", label: "Oppfølging" });
  }

  return flags;
}

function bookingMatchesWorkView(booking, workView) {
  if (workView === "pending") {
    return booking.status === "pending";
  }

  if (workView === "createdToday") {
    return isCreatedToday(booking);
  }

  if (workView === "eventToday") {
    return isEventToday(booking);
  }

  if (workView === "upcoming") {
    return isUpcomingBooking(booking);
  }

  return true;
}

function isCreatedToday(booking) {
  return toOsloDateIso(booking.created_at) === getTodayIsoOslo();
}

function isEventToday(booking) {
  return booking.preferred_date === getTodayIsoOslo();
}

function isUpcomingBooking(booking) {
  return booking.preferred_date > getTodayIsoOslo() && !["cancelled", "completed"].includes(booking.status);
}

function needsFollowUp(booking) {
  if (booking.status !== "pending") {
    return false;
  }

  const createdAt = new Date(booking.created_at).getTime();
  return Number.isFinite(createdAt) && Date.now() - createdAt > 24 * 60 * 60 * 1000;
}

function sortBookings(bookings) {
  return [...bookings].sort((left, right) => {
    const leftCreated = new Date(left.created_at).getTime();
    const rightCreated = new Date(right.created_at).getTime();
    const createdDiff = (Number.isFinite(rightCreated) ? rightCreated : 0) - (Number.isFinite(leftCreated) ? leftCreated : 0);

    if (createdDiff !== 0) {
      return createdDiff;
    }

    return Number(right.id || 0) - Number(left.id || 0);
  });
}

function showMessage(element, text, type) {
  if (!element) {
    return;
  }

  element.hidden = false;
  element.textContent = text;
  element.className = `admin-message ${type}`;

  if (type === "success") {
    window.setTimeout(() => {
      element.hidden = true;
      element.className = "admin-message";
      element.textContent = "";
    }, 2500);
  }
}

async function requestJson(url, init, fallbackMessage) {
  const response = await fetch(url, init);
  const contentType = response.headers.get("content-type") || "";
  const raw = await response.text();

  let payload = null;
  if (contentType.includes("application/json")) {
    try {
      payload = raw ? JSON.parse(raw) : {};
    } catch {
      throw new Error("API-et svarte med ugyldig JSON.");
    }
  } else if (raw.trim().startsWith("<!DOCTYPE") || raw.trim().startsWith("<html")) {
    throw new Error(
      "Admin-siden får HTML i stedet for API-data. Åpne løsningen via V1-serveren med `npm start`, ikke via en statisk visning eller Live Server."
    );
  } else {
    throw new Error(fallbackMessage);
  }

  if (!response.ok) {
    throw new Error(payload?.error || fallbackMessage);
  }

  return payload;
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("no-NO", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatBookingDateTime(booking) {
  return `${formatBookingDate(booking.preferred_date)} kl. ${booking.preferred_time}`;
}

function formatBookingDate(value) {
  const [year, month, day] = String(value || "").split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (!year || !month || !day || Number.isNaN(date.getTime())) {
    return value || "Ukjent dato";
  }

  return date.toLocaleDateString("no-NO", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC"
  });
}

function toOsloDateIso(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Oslo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function getTodayIsoOslo() {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Oslo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
