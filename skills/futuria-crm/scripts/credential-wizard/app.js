(() => {
  "use strict";

  // Il video della guida si carica soltanto quando il cliente apre la finestra
  // di aiuto della chiave: all’apertura la pagina non fa richieste esterne.
  const VIDEO_SRC = "https://futuriamarketing.com/assets/ai/futuria-crm/creare-token-pit-agents.mp4";
  const VIDEO_POSTER = "https://futuriamarketing.com/assets/ai/futuria-crm/creare-token-pit-agents.webp";
  const GUIDE_URL = "https://futuriamarketing.com/supporto/come-creare-token-pit-futuria-crm/";
  const HEARTBEAT_MS = 60 * 1000;
  const CLOSED_MESSAGE = "Il configuratore si è chiuso: da questa pagina non è stata salvata nessuna chiave. Se hai già completato il collegamento in un’altra scheda puoi chiudere questa pagina, altrimenti chiedi all’agente di riaprirlo.";
  const UNCERTAIN_MESSAGE = "Il configuratore si è chiuso durante l’invio: la chiave potrebbe essere stata salvata oppure no. Chiedi all’agente di verificare e, se serve, di riaprirlo.";

  const form = document.getElementById("credential-form");
  const accountInput = document.getElementById("account-link");
  const keyInput = document.getElementById("private-key");
  const accountError = document.getElementById("account-error");
  const keyError = document.getElementById("key-error");
  const formError = document.getElementById("form-error");
  const accountCard = document.getElementById("account-card");
  const accountKicker = document.getElementById("account-kicker");
  const accountName = document.getElementById("account-name");
  const statusPill = document.getElementById("status-pill");
  const submitButton = document.getElementById("submit-button");
  const submitLabel = document.getElementById("submit-label");
  const visibilityToggle = document.getElementById("visibility-toggle");
  const successState = document.getElementById("success-state");
  const successKicker = successState.querySelector(".success-kicker");
  const successAccount = document.getElementById("success-account");
  const cancelButton = document.getElementById("cancel-button");
  const closeButton = document.getElementById("close-button");
  const sessionClosed = document.getElementById("session-closed");
  const videoSlot = document.getElementById("key-video-slot");
  const csrfToken = document.querySelector('meta[name="csrf-token"]').content;
  const previewMode = document.querySelector('meta[name="preview-mode"]').content === "true";
  let serverClosed = false;
  let closedReason = "";
  let connected = false;
  let heartbeatTimer;
  let channel = null;

  if (previewMode) document.getElementById("preview-banner").hidden = false;

  // Finestre di guida accanto ai campi: <dialog> nativo, chiusura con il
  // pulsante, con Esc o con un clic fuori; il focus torna al pulsante di aiuto.
  function mountVideo() {
    if (videoSlot.querySelector("video")) return;
    const video = document.createElement("video");
    video.className = "guide-video";
    video.controls = true;
    video.preload = "none";
    video.playsInline = true;
    video.setAttribute("playsinline", "");
    video.width = 1280;
    video.height = 720;
    video.setAttribute("aria-describedby", "key-guide-intro");
    video.poster = VIDEO_POSTER;
    const source = document.createElement("source");
    source.src = VIDEO_SRC;
    source.type = "video/mp4";
    video.append(source);
    videoSlot.append(video);
  }

  function unmountVideo() {
    const video = videoSlot.querySelector("video");
    if (!video) return;
    // Ferma la riproduzione e il download, poi toglie il video dalla pagina.
    video.pause();
    video.querySelectorAll("source").forEach((source) => source.remove());
    video.removeAttribute("src");
    video.load();
    video.remove();
  }

  const guides = [
    { button: document.getElementById("link-help-button"), dialog: document.getElementById("link-guide") },
    {
      button: document.getElementById("key-help-button"),
      dialog: document.getElementById("key-guide"),
      onOpen: mountVideo,
      onClose: unmountVideo,
    },
  ];

  for (const { button, dialog, onOpen, onClose } of guides) {
    button.addEventListener("click", () => {
      if (typeof dialog.showModal !== "function") {
        // Browser senza <dialog>: la guida online contiene gli stessi passi.
        window.open(GUIDE_URL, "_blank", "noreferrer");
        return;
      }
      if (dialog.open) return;
      onOpen?.();
      dialog.showModal();
    });
    dialog.addEventListener("click", (event) => {
      // Il contenuto riempie tutta la finestra: un clic che arriva al <dialog>
      // stesso è un clic sullo sfondo.
      if (event.target === dialog) dialog.close();
    });
    dialog.querySelectorAll("[data-close-dialog]").forEach((closeControl) => {
      closeControl.addEventListener("click", () => dialog.close());
    });
    dialog.addEventListener("close", () => {
      onClose?.();
      button.focus();
    });
  }

  function closeGuides() {
    for (const { dialog } of guides) {
      if (dialog.open) dialog.close();
    }
  }

  // Il server locale vive finché la pagina è aperta: il battito lo tiene
  // attivo e, se non risponde più, avvisa il cliente prima che incolli la chiave.
  function showServerClosed(reason = "closed") {
    if (connected) return;
    serverClosed = true;
    clearInterval(heartbeatTimer);
    keyInput.value = "";
    submitButton.disabled = true;
    form.classList.add("is-closed");
    // Un esito incerto (chiusura durante l’invio) non torna mai al messaggio generico.
    if (closedReason !== "uncertain") {
      closedReason = reason;
      sessionClosed.textContent = reason === "uncertain" ? UNCERTAIN_MESSAGE : CLOSED_MESSAGE;
    }
    sessionClosed.hidden = false;
  }

  function showConnected(result, otherTab = false) {
    connected = true;
    serverClosed = false;
    clearInterval(heartbeatTimer);
    keyInput.value = "";
    sessionClosed.hidden = true;
    accountCard.classList.add("is-success");
    accountKicker.textContent = "Account collegato";
    accountName.textContent = result.accountName;
    statusPill.textContent = result.preview ? "Anteprima" : "Collegato";
    successKicker.textContent = otherTab ? "Collegamento completato in un’altra scheda" : "Collegamento completato";
    successAccount.textContent = result.accountName;
    closeGuides();
    form.hidden = true;
    successState.hidden = false;
    successState.focus();
  }

  async function heartbeat() {
    // Solo con la pagina in vista: una scheda nascosta e dimenticata non tiene
    // vivo il configuratore, che si chiude da solo dopo l’inattività.
    if (serverClosed || connected || document.visibilityState !== "visible") return;
    try {
      const response = await fetch("status", { cache: "no-store", credentials: "same-origin" });
      if (!response.ok) throw new Error("status");
    } catch {
      showServerClosed();
    }
  }

  heartbeatTimer = setInterval(heartbeat, HEARTBEAT_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") heartbeat();
  });

  // Più schede della stessa sessione: se una completa il collegamento, le altre
  // lo mostrano invece di segnalare la chiusura del configuratore.
  try {
    channel = new BroadcastChannel(`futuria-crm-setup:${window.location.pathname}`);
    channel.addEventListener("message", (event) => {
      const data = event.data;
      if (connected || data?.type !== "connected" || typeof data.accountName !== "string") return;
      showConnected({ accountName: data.accountName, preview: Boolean(data.preview) }, true);
    });
  } catch {
    channel = null;
  }

  function parseLocation(value) {
    const input = value.trim();
    if (/^[A-Za-z0-9_-]{6,128}$/.test(input)) return input;
    let parsed;
    try {
      parsed = new URL(input);
    } catch {
      throw new Error("Incolla il link completo del tuo account Futuria CRM.");
    }
    if (parsed.protocol !== "https:" || parsed.hostname !== "app.futuriamarketing.com") {
      throw new Error("Il link deve appartenere a Futuria CRM.");
    }
    const match = parsed.pathname.match(/\/(?:v2\/)?location\/([A-Za-z0-9_-]{6,128})(?:\/|$)/);
    if (!match) throw new Error("Non trovo l’account nel link. Copia di nuovo l’indirizzo.");
    return match[1];
  }

  function resetErrors() {
    accountError.textContent = "";
    keyError.textContent = "";
    formError.textContent = "";
    accountInput.closest(".field-group").classList.remove("has-error");
    keyInput.closest(".field-group").classList.remove("has-error");
  }

  function updateAccountPreview() {
    try {
      const location = parseLocation(accountInput.value);
      accountCard.classList.add("is-ready");
      accountKicker.textContent = "Account rilevato";
      accountName.textContent = `ID ••••${location.slice(-4)}`;
      statusPill.textContent = "Pronto";
      accountError.textContent = "";
      accountInput.closest(".field-group").classList.remove("has-error");
    } catch {
      accountCard.classList.remove("is-ready", "is-success");
      accountKicker.textContent = "In attesa del link";
      accountName.textContent = "Il tuo account Futuria CRM";
      statusPill.textContent = "Da verificare";
    }
  }

  accountInput.addEventListener("input", updateAccountPreview);

  visibilityToggle.addEventListener("click", () => {
    const showing = keyInput.type === "text";
    keyInput.type = showing ? "password" : "text";
    visibilityToggle.textContent = showing ? "Mostra" : "Nascondi";
    visibilityToggle.setAttribute("aria-pressed", String(!showing));
    keyInput.focus();
  });

  function validate() {
    resetErrors();
    let valid = true;
    try {
      parseLocation(accountInput.value);
    } catch (error) {
      accountError.textContent = error.message;
      accountInput.closest(".field-group").classList.add("has-error");
      valid = false;
    }
    if (!/^pit-[A-Za-z0-9._-]{6,2048}$/.test(keyInput.value.trim())) {
      keyError.textContent = "Copia di nuovo la chiave privata completa: deve iniziare con pit-.";
      keyInput.closest(".field-group").classList.add("has-error");
      valid = false;
    }
    return valid;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (serverClosed) {
      showServerClosed();
      sessionClosed.focus();
      return;
    }
    if (!validate()) return;

    submitButton.disabled = true;
    submitLabel.textContent = "Verifico e collego…";
    let body = JSON.stringify({
      accountLink: accountInput.value.trim(),
      privateKey: keyInput.value.trim(),
    });
    keyInput.value = "";

    try {
      let response;
      try {
        response = await fetch("connect", {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
            "X-Futuria-CSRF": csrfToken,
          },
          body,
        });
      } catch {
        // La richiesta è partita ma la risposta non è arrivata: il salvataggio
        // può essere avvenuto o no, quindi il messaggio non promette nulla.
        showServerClosed("uncertain");
        sessionClosed.focus();
        return;
      } finally {
        body = "";
      }
      let result = {};
      try {
        result = await response.json();
      } catch {
        result = {};
      }
      if (!response.ok || !result.ok) throw new Error(result.message || "Collegamento non riuscito.");

      showConnected(result);
      try {
        channel?.postMessage({ type: "connected", accountName: result.accountName, preview: Boolean(result.preview) });
      } catch {
        // Le altre schede, se ci sono, mostreranno l’avviso di chiusura.
      }
    } catch (error) {
      formError.textContent = error.message || "Collegamento non riuscito.";
      keyInput.focus();
    } finally {
      submitButton.disabled = serverClosed;
      submitLabel.textContent = "Conferma e collega";
    }
  });

  function closeWindow() {
    keyInput.value = "";
    window.close();
    setTimeout(() => {
      if (!window.closed) window.history.back();
    }, 120);
  }

  cancelButton.addEventListener("click", closeWindow);
  closeButton.addEventListener("click", closeWindow);
  window.addEventListener("pagehide", () => { keyInput.value = ""; });
})();
