document.addEventListener("DOMContentLoaded", () => {
  const bookingForm = document.querySelector(".booking-form");
  const revealItems = document.querySelectorAll(".reveal");
  const packageCards = document.querySelectorAll("[data-booking-package]");
  const packageModal = document.querySelector(".package-modal");
  const preferredDateVisual = document.querySelector("#preferredDateVisual");
  const timeChips = document.querySelectorAll("[data-time-chip]");
  const extrasInputs = document.querySelectorAll('input[name="extrasVisual"]');
  const stepperButtons = document.querySelectorAll("[data-stepper-action]");

  const state = {
    groupSize: 10,
    selectedPackage: "",
    selectedPackagePrice: null,
    preferredDate: "",
    preferredTime: "",
    extras: [],
    bookingRules: getDefaultBookingRules()
  };

  setupRevealAnimations(revealItems);
  setupPreferredDate(preferredDateVisual);
  setupStepper(stepperButtons, state);
  setupPackageCards(packageCards, packageModal, state);
  setupDateSelection(preferredDateVisual, state);
  setupTimeSelection(timeChips, state);
  setupExtrasSelection(extrasInputs, state);
  setupBookingForm(bookingForm, state);
  setupReserveLinks();
  syncBookingUi(state);
  loadBookingRules(state).then(() => {
    validateSelectedDate(preferredDateVisual, state);
    syncBookingUi(state);
  });
  setupHeroShooting();
});

const BOOKING_GROUP_MIN = 10;
const BOOKING_GROUP_MAX = 100;
const BOOKING_ALLOWED_TIMES = ["10:00", "12:00", "14:00", "16:00", "18:00"];
const BOOKING_WEEKEND_DAYS = [0, 6];

function setupRevealAnimations(items) {
  if (!items.length) {
    return;
  }

  if (!("IntersectionObserver" in window)) {
    items.forEach(item => item.classList.add("visible"));
    return;
  }

  const observer = new IntersectionObserver(
    entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) {
          return;
        }

        entry.target.classList.add("visible");
        observer.unobserve(entry.target);
      });
    },
    { threshold: 0.12 }
  );

  items.forEach(item => observer.observe(item));
}

function setupPreferredDate(input) {
  if (!input) {
    return;
  }

  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  input.min = `${yyyy}-${mm}-${dd}`;
}

async function loadBookingRules(state) {
  try {
    const rules = await requestJson("api/booking-rules", {}, "Kunne ikke laste bookingregler.");
    state.bookingRules = normalizeBookingRules(rules);
  } catch {
    state.bookingRules = getDefaultBookingRules();
  }
}

function getDefaultBookingRules() {
  return {
    allowed_times: BOOKING_ALLOWED_TIMES,
    weekend_days: BOOKING_WEEKEND_DAYS,
    extra_open_dates: [],
    slot_capacity: 2
  };
}

function normalizeBookingRules(rules) {
  const fallback = getDefaultBookingRules();
  const allowedTimes = Array.isArray(rules?.allowed_times)
    ? rules.allowed_times.map(item => String(item).trim()).filter(Boolean)
    : fallback.allowed_times;
  const weekendDays = Array.isArray(rules?.weekend_days)
    ? rules.weekend_days.map(item => Number.parseInt(String(item), 10)).filter(day => Number.isInteger(day) && day >= 0 && day <= 6)
    : fallback.weekend_days;
  const extraOpenDates = Array.isArray(rules?.extra_open_dates)
    ? rules.extra_open_dates.map(item => String(item).trim()).filter(isValidIsoDate)
    : fallback.extra_open_dates;
  const slotCapacity = Number.parseInt(String(rules?.slot_capacity || ""), 10);

  return {
    allowed_times: allowedTimes.length ? allowedTimes : fallback.allowed_times,
    weekend_days: weekendDays.length ? weekendDays : fallback.weekend_days,
    extra_open_dates: extraOpenDates,
    slot_capacity: Number.isFinite(slotCapacity) && slotCapacity > 0 ? slotCapacity : fallback.slot_capacity
  };
}

function setupStepper(buttons, state) {
  buttons.forEach(button => {
    button.addEventListener("click", () => {
      const direction = button.dataset.stepperAction;
      const nextValue = direction === "increase" ? state.groupSize + 1 : state.groupSize - 1;
      state.groupSize = clamp(nextValue, BOOKING_GROUP_MIN, BOOKING_GROUP_MAX);

      if (!isPackageStillAllowed(state.selectedPackage, state.groupSize)) {
        state.selectedPackage = "";
        state.selectedPackagePrice = null;
      }

      syncBookingUi(state);
    });
  });
}

function setupPackageCards(cards, modal, state) {
  if (!cards.length || !modal) {
    return;
  }

  const modalTitle = modal.querySelector("[data-package-modal-title]");
  const modalImage = modal.querySelector("[data-package-modal-image]");
  const modalPrice = modal.querySelector("[data-package-modal-price]");
  const modalDescription = modal.querySelector("[data-package-modal-description]");
  const modalList = modal.querySelector("[data-package-modal-list]");
  const modalSelect = modal.querySelector("[data-package-modal-select]");

  let openPackageCard = null;

  const openModal = card => {
    openPackageCard = card;
    modal.hidden = false;
    document.body.style.overflow = "hidden";

    const packageName = card.dataset.packageName || "";
    const packagePrice = card.dataset.packagePrice || "";
    const packageDescription = card.dataset.packageDescription || "";
    const packageDetails = (card.dataset.packageDetails || "")
      .split("|")
      .map(item => item.trim())
      .filter(Boolean);
    const availability = getPackageAvailability(card, state.groupSize);

    modalTitle.textContent = packageName;
    modalImage.src = card.dataset.packageImage || "";
    modalImage.alt = packageName;
    modalPrice.textContent = packagePrice ? `${packagePrice} kr per person` : "Pris bekreftes etter forespørsel";
    modalDescription.textContent = packageDescription;
    modalList.innerHTML = packageDetails.map(item => `<li>${escapeHtml(item)}</li>`).join("");

    if (modalSelect) {
      modalSelect.disabled = false;
      modalSelect.textContent = getPackageSelectLabel(availability, state.groupSize);
    }
  };

  const closeModal = () => {
    modal.hidden = true;
    document.body.style.overflow = "";
    openPackageCard = null;
  };

  cards.forEach(card => {
    const openButton = card.querySelector("[data-package-open]");
    const selectButton = card.querySelector("[data-package-select]");

    openButton?.addEventListener("click", event => {
      event.preventDefault();
      openModal(card);
    });

    selectButton?.addEventListener("click", event => {
      event.preventDefault();
      selectPackageCard(card, state);
      scrollToBookingDateStep();
    });
  });

  modal.querySelectorAll("[data-package-close]").forEach(element => {
    element.addEventListener("click", closeModal);
  });

  modalSelect?.addEventListener("click", () => {
    if (!openPackageCard) {
      return;
    }

    selectPackageCard(openPackageCard, state);
    closeModal();
    scrollToBookingDateStep();
  });

  window.addEventListener("keydown", event => {
    if (event.key === "Escape" && !modal.hidden) {
      closeModal();
    }
  });
}

function setupDateSelection(input, state) {
  if (!input) {
    return;
  }

  input.addEventListener("change", () => {
    state.preferredDate = input.value;
    validateSelectedDate(input, state);
    syncBookingUi(state);
  });
}

function validateSelectedDate(input, state) {
  clearValidationError("preferredDate");

  if (!input?.value) {
    return;
  }

  if (isPastDate(input.value)) {
    setValidationError("preferredDate", "Velg dagens dato eller en dato frem i tid.");
    return;
  }

  if (!isBookingDateAllowed(input.value, state.bookingRules)) {
    setValidationError("preferredDate", "Velg en lørdag, søndag eller en avtalt åpen hverdag.");
  }
}

function setupTimeSelection(chips, state) {
  chips.forEach(chip => {
    chip.addEventListener("click", () => {
      state.preferredTime = chip.dataset.timeChip || "";
      clearValidationError("preferredTime");
      syncBookingUi(state);
    });
  });
}

function setupExtrasSelection(inputs, state) {
  inputs.forEach(input => {
    input.addEventListener("change", () => {
      state.extras = [...inputs].filter(item => item.checked).map(item => item.value);
      syncBookingUi(state);
    });
  });
}

function setupBookingForm(form, state) {
  if (!form) {
    return;
  }

  const detailsCard = form.closest(".booking-details-card");
  const successState = detailsCard?.querySelector(".booking-success");
  const resetButton = detailsCard?.querySelector(".booking-reset");

  if (resetButton) {
    resetButton.addEventListener("click", () => {
      form.reset();
      resetVisualState(state);
      setupPreferredDate(document.querySelector("#preferredDateVisual"));
      clearFormMessage(form);
      clearAllValidationErrors();
      toggleSuccessState(form, successState, false);
      syncBookingUi(state);
    });
  }

  setupFormFieldValidation(form);

  form.addEventListener("submit", async event => {
    event.preventDefault();

    const bookingData = collectBookingData(form);
    const validationErrors = getBookingValidationErrors(bookingData, state.bookingRules);

    if (Object.keys(validationErrors).length > 0) {
      applyValidationErrors(validationErrors);
      showFormMessage(form, "Se feltene som er markert i rødt og fyll ut det som mangler.", "error");
      return;
    }

    clearAllValidationErrors();
    clearFormMessage(form);

    try {
      try {
        await requestJson(
          "api/bookings",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify(bookingData)
          },
          "Kunne ikke lagre bookingforespørselen."
        );
      } catch (error) {
        if (!shouldUseDemoBookingFallback()) {
          throw error;
        }

        saveDemoBookingLocally(bookingData);
      }

      form.reset();
      resetVisualState(state);
      setupPreferredDate(document.querySelector("#preferredDateVisual"));
      syncBookingUi(state);
      toggleSuccessState(form, successState, true);
    } catch (error) {
      showFormMessage(
        form,
        "Kunne ikke sende bookingforespørselen akkurat nå. Prøv igjen, eller kontakt oss direkte på telefon.",
        "error"
      );
    }
  });
}

function setupReserveLinks() {
  document.querySelectorAll('a[href="#booking-contact"]').forEach(link => {
    link.addEventListener("click", () => {
      window.setTimeout(() => {
        document.querySelector("#fullName")?.focus({ preventScroll: true });
      }, 350);
    });
  });
}

function selectPackageCard(card, state) {
  const availability = getPackageAvailability(card, state.groupSize);

  if (availability.minimumPeople > 0 && state.groupSize < availability.minimumPeople) {
    state.groupSize = availability.minimumPeople;
  }

  if (availability.maximumPeople > 0 && state.groupSize > availability.maximumPeople) {
    state.groupSize = availability.maximumPeople;
  }

  state.selectedPackage = card.dataset.packageName || "";
  const rawPrice = card.dataset.packagePrice || "";
  state.selectedPackagePrice = rawPrice ? Number.parseInt(rawPrice, 10) : null;
  clearValidationError("package");
  syncBookingUi(state);
}

function scrollToBookingDateStep() {
  const dateInput = document.querySelector("#preferredDateVisual");
  if (!dateInput) {
    return;
  }

  const target = dateInput.closest(".schedule-card") || dateInput;
  target.scrollIntoView({ behavior: "smooth", block: "start" });

  window.setTimeout(() => {
    dateInput.focus({ preventScroll: true });
  }, 350);
}

function syncBookingUi(state) {
  updateStepperSummary(state);
  updatePackageAvailability(state);
  updateTimeChipSelection(state);
  updateHiddenFormValues(state);
  updateReservationSummary(state);
}

function updateStepperSummary(state) {
  const display = document.querySelector("[data-group-size-display]");
  if (display) {
    display.textContent = String(state.groupSize);
  }
}

function updatePackageAvailability(state) {
  document.querySelectorAll("[data-booking-package]").forEach(card => {
    const overlay = card.querySelector(".booking-package-overlay");
    const isSelected = state.selectedPackage === card.dataset.packageName;

    card.classList.toggle("is-selected", isSelected);

    if (overlay) {
      overlay.hidden = true;
    }
  });
}

function updateTimeChipSelection(state) {
  document.querySelectorAll("[data-time-chip]").forEach(chip => {
    chip.classList.toggle("is-selected", chip.dataset.timeChip === state.preferredTime);
  });
}

function updateHiddenFormValues(state) {
  setInputValue("#packageSelection", state.selectedPackage);
  setInputValue("#groupSizeHidden", String(state.groupSize));
  setInputValue("#preferredDate", state.preferredDate);
  setInputValue("#preferredTime", state.preferredTime);
}

function updateReservationSummary(state) {
  setText("[data-summary-package]", state.selectedPackage || "Ikke valgt");
  setText("[data-summary-group]", String(state.groupSize));
  setText("[data-summary-date]", state.preferredDate || "Ikke valgt");
  setText("[data-summary-time]", state.preferredTime || "Ikke valgt");
  setText("[data-summary-extras]", state.extras.length ? state.extras.join(", ") : "Ingen tillegg valgt");

  const totalTarget = document.querySelector("[data-summary-total]");
  if (!totalTarget) {
    return;
  }

  if (state.selectedPackagePrice == null) {
    totalTarget.textContent = state.selectedPackage ? "Bekreftes etter forespørsel" : "Ikke klar";
    return;
  }

  const extraCostPerPerson = state.extras.includes("Ekstra 200 baller") ? 70 : 0;
  const estimatedTotal = (state.selectedPackagePrice + extraCostPerPerson) * state.groupSize;
  totalTarget.textContent = `${formatCurrency(estimatedTotal)} kr`;
}

function collectBookingData(form) {
  const formData = new FormData(form);

  return {
    name: formData.get("fullName")?.toString().trim() || "",
    phone: formData.get("phone")?.toString().trim() || "",
    email: formData.get("email")?.toString().trim() || "",
    package: formData.get("package")?.toString().trim() || "",
    group_size: formData.get("groupSize")?.toString().trim() || "",
    preferred_date: formData.get("preferredDate")?.toString().trim() || "",
    preferred_time: formData.get("preferredTime")?.toString().trim() || "",
    extras: [...document.querySelectorAll('input[name="extrasVisual"]:checked')].map(input => input.value),
    notes: formData.get("message")?.toString().trim() || "",
    website: formData.get("website")?.toString().trim() || ""
  };
}

function getBookingValidationErrors(data, rules = getDefaultBookingRules()) {
  const errors = {};

  if (!data.name) {
    errors.fullName = "Fyll inn fullt navn.";
  }

  if (!data.phone) {
    errors.phone = "Fyll inn telefonnummer.";
  }

  if (!data.email) {
    errors.email = "Fyll inn e-postadresse.";
  }

  if (!data.package) {
    errors.package = "Velg en pakke.";
  }

  if (!data.preferred_date) {
    errors.preferredDate = "Velg dato.";
  }

  if (!data.preferred_time) {
    errors.preferredTime = "Velg tidspunkt.";
  }

  if (data.preferred_date && isPastDate(data.preferred_date)) {
    errors.preferredDate = "Velg dagens dato eller en dato frem i tid.";
  }

  if (data.preferred_date && !isPastDate(data.preferred_date) && !isBookingDateAllowed(data.preferred_date, rules)) {
    errors.preferredDate = "Velg en lørdag, søndag eller en avtalt åpen hverdag.";
  }

  if (data.preferred_time && !rules.allowed_times.includes(data.preferred_time)) {
    errors.preferredTime = "Velg et gyldig tidspunkt.";
  }

  const groupSize = Number.parseInt(data.group_size, 10);
  if (!Number.isFinite(groupSize) || groupSize < BOOKING_GROUP_MIN || groupSize > BOOKING_GROUP_MAX) {
    errors.groupSize = `Antall personer må være mellom ${BOOKING_GROUP_MIN} og ${BOOKING_GROUP_MAX}.`;
  }

  if (!isPackageStillAllowed(data.package, groupSize)) {
    errors.package = "Pakken passer ikke med antall personer.";
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (data.email && !emailRegex.test(data.email)) {
    errors.email = "Oppgi en gyldig e-postadresse.";
  }

  const phoneRegex = /^[\d\s+().-]{6,}$/;
  if (data.phone && !phoneRegex.test(data.phone)) {
    errors.phone = "Oppgi et gyldig telefonnummer.";
  }

  return errors;
}

function resetVisualState(state) {
  state.groupSize = BOOKING_GROUP_MIN;
  state.selectedPackage = "";
  state.selectedPackagePrice = null;
  state.preferredDate = "";
  state.preferredTime = "";
  state.extras = [];

  const dateInput = document.querySelector("#preferredDateVisual");
  if (dateInput) {
    dateInput.value = "";
  }

  document.querySelectorAll("[data-time-chip]").forEach(chip => chip.classList.remove("is-selected"));
  document.querySelectorAll('input[name="extrasVisual"]').forEach(input => {
    input.checked = false;
  });
}

function setupFormFieldValidation(form) {
  const fullNameInput = form.querySelector("#fullName");
  const phoneInput = form.querySelector("#phone");
  const emailInput = form.querySelector("#email");

  fullNameInput?.addEventListener("input", () => clearValidationError("fullName"));
  phoneInput?.addEventListener("input", () => clearValidationError("phone"));
  emailInput?.addEventListener("input", () => clearValidationError("email"));
}

function applyValidationErrors(errors) {
  clearAllValidationErrors();

  Object.entries(errors).forEach(([field, message]) => {
    setValidationError(field, message);
  });
}

function setValidationError(field, message) {
  const container = getValidationContainer(field);
  if (!container) {
    return;
  }

  container.classList.add("has-error");
  setFieldErrorMessage(container, message);
}

function clearAllValidationErrors() {
  document.querySelectorAll(".has-error").forEach(element => {
    element.classList.remove("has-error");
  });

  document.querySelectorAll(".field-error-text").forEach(element => {
    element.remove();
  });
}

function clearValidationError(field) {
  const container = getValidationContainer(field);
  if (!container) {
    return;
  }

  container.classList.remove("has-error");
  container.querySelector(".field-error-text")?.remove();
}

function getValidationContainer(field) {
  const selectorMap = {
    package: '[data-validation-group="package"]',
    preferredDate: '[data-validation-group="preferredDate"]',
    preferredTime: '[data-validation-group="preferredTime"]',
    fullName: '[data-validation-field="fullName"]',
    phone: '[data-validation-field="phone"]',
    email: '[data-validation-field="email"]'
  };

  const selector = selectorMap[field];
  return selector ? document.querySelector(selector) : null;
}

function setFieldErrorMessage(container, message) {
  let error = container.querySelector(".field-error-text");

  if (!error) {
    error = document.createElement("div");
    error.className = "field-error-text";
    container.append(error);
  }

  error.textContent = message;
}

function isPackageStillAllowed(packageName, groupSize) {
  if (!packageName) {
    return true;
  }

  const card = [...document.querySelectorAll("[data-booking-package]")].find(
    item => item.dataset.packageName === packageName
  );

  if (!card) {
    return true;
  }

  return getPackageAvailability(card, groupSize).isAllowed;
}

function toggleSuccessState(form, successState, shouldShow) {
  if (!successState) {
    return;
  }

  form.hidden = shouldShow;
  successState.hidden = !shouldShow;
}

function showFormMessage(form, text, type) {
  let message = form.querySelector(".form-message");

  if (!message) {
    message = document.createElement("div");
    message.className = "form-message";
    form.prepend(message);
  }

  message.textContent = text;
  message.className = `form-message ${type}`;
}

function clearFormMessage(form) {
  const message = form.querySelector(".form-message");
  if (!message) {
    return;
  }

  message.className = "form-message";
  message.textContent = "";
}

function shouldUseDemoBookingFallback() {
  return document.body?.dataset.demoBookingFallback === "true";
}

function saveDemoBookingLocally(bookingData) {
  const storageKey = "osloPaintballDemoBookings";
  const currentBookings = readDemoBookings(storageKey);
  const booking = {
    id: `demo-${Date.now()}`,
    ...bookingData,
    group_size: Number.parseInt(bookingData.group_size, 10),
    status: "pending",
    created_at: new Date().toISOString()
  };

  try {
    window.localStorage?.setItem(storageKey, JSON.stringify([booking, ...currentBookings].slice(0, 25)));
  } catch {
    // Demo fallback should never block the visible booking confirmation.
  }
}

function readDemoBookings(storageKey) {
  try {
    const raw = window.localStorage?.getItem(storageKey);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
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
      "Bookingsiden får HTML i stedet for API-data. Kjør løsningen via V1-serveren med `npm start`, ikke via en statisk preview."
    );
  } else {
    throw new Error(fallbackMessage);
  }

  if (!response.ok) {
    throw new Error(payload?.error || fallbackMessage);
  }

  return payload;
}

function setText(selector, value) {
  const element = document.querySelector(selector);
  if (element) {
    element.textContent = value;
  }
}

function setInputValue(selector, value) {
  const input = document.querySelector(selector);
  if (input) {
    input.value = value;
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getPackageAvailability(card, groupSize) {
  const minimumPeople = Number.parseInt(card.dataset.packageMin || "0", 10);
  const maximumPeople = Number.parseInt(card.dataset.packageMax || "0", 10);
  const isBelowMinimum = Number.isFinite(minimumPeople) && groupSize < minimumPeople;
  const isAboveMaximum = Number.isFinite(maximumPeople) && maximumPeople > 0 && groupSize > maximumPeople;

  return {
    isAllowed: !isBelowMinimum && !isAboveMaximum,
    isBelowMinimum,
    isAboveMaximum,
    minimumPeople,
    maximumPeople,
    message: isBelowMinimum
      ? `Min ${minimumPeople} personer`
      : isAboveMaximum
        ? `Maks ${maximumPeople} personer`
        : ""
  };
}

function getPackageSelectLabel(availability, groupSize) {
  if (availability.minimumPeople > 0 && groupSize < availability.minimumPeople) {
    return `Velg og sett til ${availability.minimumPeople} personer`;
  }

  if (availability.maximumPeople > 0 && groupSize > availability.maximumPeople) {
    return `Velg og sett til ${availability.maximumPeople} personer`;
  }

  return "Velg denne pakken";
}

function formatCurrency(value) {
  return new Intl.NumberFormat("no-NO").format(value);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function isPastDate(value) {
  if (!isValidIsoDate(value)) {
    return true;
  }

  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");

  return value < `${yyyy}-${mm}-${dd}`;
}

function isBookingDateAllowed(value, rules = getDefaultBookingRules()) {
  const date = parseIsoDate(value);
  if (!date) {
    return false;
  }

  return rules.weekend_days.includes(date.getUTCDay()) || rules.extra_open_dates.includes(value);
}

function isValidIsoDate(value) {
  return Boolean(parseIsoDate(value));
}

function parseIsoDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (!match) {
    return null;
  }

  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const day = Number.parseInt(match[3], 10);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return date;
}

const SPLAT_PATHS = [
  "M50 12 C38 4,16 14,10 30 C4 46,14 66,30 74 C16 70,2 82,8 90 C14 98,36 90,44 80 C50 90,66 96,78 86 C92 72,88 50,74 38 C90 44,100 32,98 18 C96 4,72 -2,58 6 Z M20 58 C16 58,14 54,16 50 C18 46,22 46,24 50 Z M80 78 C78 82,74 82,72 78 C70 74,72 70,76 70 Z",
  "M48 8 C34 2,12 18,8 36 C4 54,16 76,36 82 C18 78,2 88,8 96 C16 104,40 94,48 82 C56 94,74 98,86 86 C100 70,94 46,78 34 C96 40,106 26,102 12 C98 -2,70 -4,56 6 Z M26 62 C22 64,18 60,20 56 C22 52,28 52,28 56 Z",
  "M44 10 C30 4,10 16,6 32 C2 50,12 70,28 78 C12 72,0 84,4 92 C10 100,32 92,40 80 C44 90,60 96,72 84 C86 68,80 44,64 34 C80 38,90 26,88 14 C86 2,60 -2,48 6 Z M18 56 C14 56,12 52,14 48 C16 44,20 44,22 48 Z M70 74 C68 78,64 78,62 74 C60 70,62 66,66 66 Z M76 28 C78 24,82 24,84 28 C86 32,82 36,78 34 Z",
  "M52 6 C36 0,14 14,10 32 C6 50,18 72,38 80 C20 76,6 88,10 96 C18 104,40 96,48 84 C54 96,72 102,84 90 C98 76,94 52,76 40 C94 46,104 34,100 18 C96 2,68 -2,56 4 Z M16 60 C12 62,10 58,12 54 C14 50,18 50,20 54 Z M82 26 C84 22,88 22,90 26 C92 30,88 34,84 32 Z"
];

function setupHeroShooting() {
  const heroLeft = document.querySelector(".hero-left");
  if (!heroLeft) return;
  if (!window.matchMedia("(min-width: 769px)").matches) return;

  heroLeft.classList.add("is-shootable");

  heroLeft.addEventListener("click", event => {
    if (event.target.closest("a, button, .hero-shoot-target")) return;
    const rect = heroLeft.getBoundingClientRect();
    fireHeroSplat(
      heroLeft.querySelector(".hero-decor"),
      event.clientX - rect.left,
      event.clientY - rect.top
    );
  });

  scheduleShootTarget(heroLeft);
}

function scheduleShootTarget(heroLeft) {
  const delay = 1200 + Math.random() * 1800;
  setTimeout(() => {
    if (document.body.contains(heroLeft)) {
      spawnShootTarget(heroLeft);
    }
  }, delay);
}

function spawnShootTarget(heroLeft) {
  const heroDecor = heroLeft.querySelector(".hero-decor");
  if (!heroDecor || heroLeft.querySelector(".hero-shoot-target")) return;

  const rect = heroLeft.getBoundingClientRect();
  const pad = 70;
  const x = pad + Math.random() * (rect.width - pad * 2);
  const y = 110 + Math.random() * (rect.height - 180);

  const target = document.createElement("div");
  target.className = "hero-shoot-target";
  target.style.left = `${x}px`;
  target.style.top = `${y}px`;
  heroLeft.appendChild(target);

  const autoTimer = setTimeout(() => removeShootTarget(target, heroLeft, false), 3500);

  target.addEventListener("click", event => {
    event.stopPropagation();
    clearTimeout(autoTimer);

    for (let i = 0; i < 3; i++) {
      setTimeout(() => {
        fireHeroSplat(
          heroDecor,
          x + (Math.random() - 0.5) * 60,
          y + (Math.random() - 0.5) * 60
        );
      }, i * 80);
    }

    removeShootTarget(target, heroLeft, true);
  });
}

function removeShootTarget(target, heroLeft, wasHit) {
  if (!target.isConnected) return;
  target.classList.add(wasHit ? "is-hit" : "is-leaving");
  setTimeout(() => {
    target.remove();
    scheduleShootTarget(heroLeft);
  }, 220);
}

function fireHeroSplat(container, x, y) {
  if (!container) return;

  const ns = "http://www.w3.org/2000/svg";
  const size = 56 + Math.random() * 72;
  const rotation = Math.random() * 360;
  const pathData = SPLAT_PATHS[Math.floor(Math.random() * SPLAT_PATHS.length)];
  const color = Math.random() < 0.3 ? "#ffffff" : "#e8191a";
  const opacity = color === "#ffffff" ? "0.55" : "0.82";

  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 110 110");
  svg.style.cssText = [
    `position:absolute`,
    `left:${x}px`,
    `top:${y}px`,
    `width:${size}px`,
    `height:${size}px`,
    `transform:translate(-50%,-50%) rotate(${rotation}deg) scale(0)`,
    `pointer-events:none`,
    `z-index:2`,
    `will-change:transform`
  ].join(";");

  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", pathData);
  path.setAttribute("fill", color);
  path.setAttribute("opacity", opacity);
  svg.appendChild(path);
  container.appendChild(svg);

  requestAnimationFrame(() => {
    svg.style.transition = "transform 0.18s cubic-bezier(0.15, 1.8, 0.35, 1)";
    svg.style.transform = `translate(-50%,-50%) rotate(${rotation}deg) scale(1)`;
  });
}
