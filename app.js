const DB_NAME = "luma-vault-db";
const DB_VERSION = 1;
const USERS_STORE = "users";
const PHOTOS_STORE = "photos";
const SESSION_KEY = "luma-vault-session";
const PLAN_BYTES = 1500 * 1024 * 1024 * 1024;

const state = {
  db: null,
  currentUser: null,
  photos: [],
  activePhotoId: null,
  searchQuery: "",
  draftTimer: null,
  isDirty: false,
  listObjectUrls: [],
  activeViewerUrl: null,
};

const els = {
  authShell: document.querySelector("#authShell"),
  appShell: document.querySelector("#appShell"),
  loginTab: document.querySelector("#loginTab"),
  registerTab: document.querySelector("#registerTab"),
  authStatus: document.querySelector("#authStatus"),
  loginForm: document.querySelector("#loginForm"),
  registerForm: document.querySelector("#registerForm"),
  loginIdentifier: document.querySelector("#loginIdentifier"),
  loginPassword: document.querySelector("#loginPassword"),
  registerDisplayName: document.querySelector("#registerDisplayName"),
  registerIdentifier: document.querySelector("#registerIdentifier"),
  registerPassword: document.querySelector("#registerPassword"),
  registerPasswordConfirm: document.querySelector("#registerPasswordConfirm"),
  copyCredentialsBtn: document.querySelector("#copyCredentialsBtn"),
  currentUserName: document.querySelector("#currentUserName"),
  currentUserId: document.querySelector("#currentUserId"),
  logoutBtn: document.querySelector("#logoutBtn"),
  storageSummary: document.querySelector("#storageSummary"),
  storageMeta: document.querySelector("#storageMeta"),
  storageFill: document.querySelector("#storageFill"),
  photoImportInput: document.querySelector("#photoImportInput"),
  archiveImportInput: document.querySelector("#archiveImportInput"),
  exportLibraryBtn: document.querySelector("#exportLibraryBtn"),
  downloadPhotoBtn: document.querySelector("#downloadPhotoBtn"),
  searchInput: document.querySelector("#searchInput"),
  photoCountBadge: document.querySelector("#photoCountBadge"),
  photoList: document.querySelector("#photoList"),
  workspaceLead: document.querySelector("#workspaceLead"),
  heroPhotoCount: document.querySelector("#heroPhotoCount"),
  heroLibrarySize: document.querySelector("#heroLibrarySize"),
  heroActiveMeta: document.querySelector("#heroActiveMeta"),
  heroStatus: document.querySelector("#heroStatus"),
  dropzone: document.querySelector("#dropzone"),
  activePhotoImage: document.querySelector("#activePhotoImage"),
  viewerEmpty: document.querySelector("#viewerEmpty"),
  photoHeading: document.querySelector("#photoHeading"),
  favoriteBtn: document.querySelector("#favoriteBtn"),
  deletePhotoBtn: document.querySelector("#deletePhotoBtn"),
  photoTitleInput: document.querySelector("#photoTitleInput"),
  photoCaptionInput: document.querySelector("#photoCaptionInput"),
  metaFileName: document.querySelector("#metaFileName"),
  metaFormat: document.querySelector("#metaFormat"),
  metaSize: document.querySelector("#metaSize"),
  metaResolution: document.querySelector("#metaResolution"),
  metaAddedAt: document.querySelector("#metaAddedAt"),
  metaUpdatedAt: document.querySelector("#metaUpdatedAt"),
  persistStatus: document.querySelector("#persistStatus"),
  selectionStatus: document.querySelector("#selectionStatus"),
  photoCardTemplate: document.querySelector("#photoCardTemplate"),
};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  bindUI();
  resetRegisterFields();

  try {
    await openDatabase();
    await restoreSession();
    await requestPersistentStorage();
    await updateStorageDisplay();

    if ("serviceWorker" in navigator) {
      try {
        await navigator.serviceWorker.register("./sw.js");
      } catch (error) {
        console.warn("Service worker registration failed:", error);
      }
    }
  } catch (error) {
    console.error(error);
    setAuthStatus(
      "Le stockage local n'a pas pu s'initialiser. Essaie dans un navigateur moderne avec IndexedDB activee.",
      "error"
    );
    els.persistStatus.textContent = "Initialisation du stockage impossible.";
    showAuth("register");
  }
}

function bindUI() {
  [els.loginTab, els.registerTab].forEach((button) => {
    button.addEventListener("click", () => switchAuthMode(button.dataset.authTarget));
  });

  els.loginForm.addEventListener("submit", handleLogin);
  els.registerForm.addEventListener("submit", handleRegister);
  els.copyCredentialsBtn.addEventListener("click", copyCredentials);
  els.logoutBtn.addEventListener("click", handleLogout);

  els.exportLibraryBtn.addEventListener("click", exportLibrary);
  els.downloadPhotoBtn.addEventListener("click", downloadActivePhoto);
  els.favoriteBtn.addEventListener("click", toggleFavorite);
  els.deletePhotoBtn.addEventListener("click", deleteActivePhoto);

  els.photoImportInput.addEventListener("change", handlePhotoImport);
  els.archiveImportInput.addEventListener("change", handleArchiveImport);

  els.searchInput.addEventListener("input", (event) => {
    state.searchQuery = event.target.value.trim().toLowerCase();
    renderPhotoList();
  });

  [els.photoTitleInput, els.photoCaptionInput].forEach((field) => {
    field.addEventListener("input", scheduleDraftSave);
  });

  bindDropzone();

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      void savePendingDraft();
    }
  });

  window.addEventListener("beforeunload", cleanupObjectUrls);
}

function bindDropzone() {
  ["dragenter", "dragover"].forEach((eventName) => {
    els.dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      els.dropzone.classList.add("is-dragging");
    });
  });

  ["dragleave", "drop"].forEach((eventName) => {
    els.dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      els.dropzone.classList.remove("is-dragging");
    });
  });

  els.dropzone.addEventListener("drop", async (event) => {
    const files = Array.from(event.dataTransfer?.files || []);
    if (files.length) {
      await importPhotoFiles(files);
    }
  });
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      state.db = request.result;
      resolve(state.db);
    };

    request.onupgradeneeded = () => {
      const db = request.result;

      let usersStore;
      if (!db.objectStoreNames.contains(USERS_STORE)) {
        usersStore = db.createObjectStore(USERS_STORE, { keyPath: "id" });
      } else {
        usersStore = request.transaction.objectStore(USERS_STORE);
      }

      if (!usersStore.indexNames.contains("identifierLower")) {
        usersStore.createIndex("identifierLower", "identifierLower", { unique: true });
      }

      let photosStore;
      if (!db.objectStoreNames.contains(PHOTOS_STORE)) {
        photosStore = db.createObjectStore(PHOTOS_STORE, { keyPath: "id" });
      } else {
        photosStore = request.transaction.objectStore(PHOTOS_STORE);
      }

      if (!photosStore.indexNames.contains("ownerId")) {
        photosStore.createIndex("ownerId", "ownerId");
      }

      if (!photosStore.indexNames.contains("updatedAt")) {
        photosStore.createIndex("updatedAt", "updatedAt");
      }
    };
  });
}

async function restoreSession() {
  const sessionUserId = localStorage.getItem(SESSION_KEY);

  if (!sessionUserId) {
    const allUsers = await getAllUsersFromDb();
    showAuth(allUsers.length ? "login" : "register");
    return;
  }

  const user = await getUserById(sessionUserId);
  if (!user) {
    localStorage.removeItem(SESSION_KEY);
    showAuth("login");
    return;
  }

  await activateUser(user);
}

async function activateUser(user) {
  state.currentUser = user;
  state.searchQuery = "";
  state.activePhotoId = null;
  state.isDirty = false;
  els.searchInput.value = "";
  localStorage.setItem(SESSION_KEY, user.id);
  renderCurrentUser();
  await loadPhotos();
  await updateStorageDisplay();
  clearAuthStatus();
  els.authShell.classList.add("is-hidden");
  els.appShell.classList.remove("is-hidden");
  setHeroStatus("Pret");
}

function showAuth(mode = "login") {
  window.clearTimeout(state.draftTimer);
  state.draftTimer = null;
  state.currentUser = null;
  state.photos = [];
  state.activePhotoId = null;
  state.searchQuery = "";
  state.isDirty = false;
  els.searchInput.value = "";
  els.appShell.classList.add("is-hidden");
  els.authShell.classList.remove("is-hidden");
  cleanupObjectUrls();
  switchAuthMode(mode);
  renderCurrentUser();
  renderPhotoList();
  renderActivePhoto();
  updateStorageDisplay().catch(() => {});
}

function switchAuthMode(mode) {
  const isLogin = mode === "login";
  els.loginTab.classList.toggle("active", isLogin);
  els.registerTab.classList.toggle("active", !isLogin);
  els.loginForm.classList.toggle("is-hidden", !isLogin);
  els.registerForm.classList.toggle("is-hidden", isLogin);
}

async function handleRegister(event) {
  event.preventDefault();

  const displayName = sanitizeSingleLineText(els.registerDisplayName.value.trim()) || "Utilisateur";
  const identifier = normalizeIdentifier(els.registerIdentifier.value);
  const password = els.registerPassword.value.trim();
  const passwordConfirm = els.registerPasswordConfirm.value.trim();

  if (identifier.length < 4) {
    setAuthStatus("Choisis un identifiant d'au moins 4 caracteres.", "error");
    return;
  }

  if (password.length < 8) {
    setAuthStatus("Le mot de passe doit contenir au moins 8 caracteres.", "error");
    return;
  }

  if (password !== passwordConfirm) {
    setAuthStatus("Les mots de passe ne correspondent pas.", "error");
    return;
  }

  const existingUser = await getUserByIdentifier(identifier);
  if (existingUser) {
    setAuthStatus("Cet identifiant existe deja. Choisis-en un autre.", "error");
    return;
  }

  const now = new Date().toISOString();
  const user = {
    id: crypto.randomUUID(),
    displayName,
    identifier,
    identifierLower: identifier.toLowerCase(),
    passwordHash: await hashPassword(password),
    createdAt: now,
    updatedAt: now,
  };

  await saveUserToDb(user);
  els.loginIdentifier.value = user.identifier;
  els.loginPassword.value = password;
  resetRegisterFields();
  await activateUser(user);
}

async function handleLogin(event) {
  event.preventDefault();

  const identifier = normalizeIdentifier(els.loginIdentifier.value);
  const password = els.loginPassword.value.trim();

  if (!identifier || !password) {
    setAuthStatus("Entre ton identifiant et ton mot de passe.", "error");
    return;
  }

  const user = await getUserByIdentifier(identifier);
  if (!user) {
    setAuthStatus("Aucun compte ne correspond a cet identifiant.", "error");
    return;
  }

  const passwordHash = await hashPassword(password);
  if (passwordHash !== user.passwordHash) {
    setAuthStatus("Mot de passe incorrect.", "error");
    return;
  }

  els.loginForm.reset();
  await activateUser(user);
}

async function handleLogout() {
  await savePendingDraft();
  localStorage.removeItem(SESSION_KEY);
  els.loginPassword.value = "";
  setAuthStatus("Deconnecte. Tu peux te reconnecter ou creer un autre compte.", "success");
  showAuth("login");
}

function renderCurrentUser() {
  if (!state.currentUser) {
    els.currentUserName.textContent = "Utilisateur";
    els.currentUserId.textContent = "Aucun identifiant actif";
    els.workspaceLead.textContent =
      "Chaque compte affiche uniquement ses propres photos.";
    return;
  }

  els.currentUserName.textContent = state.currentUser.displayName;
  els.currentUserId.textContent = `Identifiant : ${state.currentUser.identifier}`;
  els.workspaceLead.textContent =
    `Bibliotheque privee de ${state.currentUser.displayName}. Importe, trie et exporte tes souvenirs.`;
}

async function loadPhotos() {
  if (!state.currentUser) {
    return;
  }

  state.photos = sortPhotos(await getPhotosForUser(state.currentUser.id));

  const activeStillExists = state.photos.some((photo) => photo.id === state.activePhotoId);
  if (!activeStillExists) {
    state.activePhotoId = state.photos[0]?.id ?? null;
  }

  renderPhotoList();
  renderActivePhoto();
  await updateStorageDisplay();
}

function getAllUsersFromDb() {
  return new Promise((resolve, reject) => {
    const transaction = state.db.transaction(USERS_STORE, "readonly");
    const store = transaction.objectStore(USERS_STORE);
    const request = store.getAll();

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result || []);
  });
}

function getUserById(userId) {
  return new Promise((resolve, reject) => {
    const transaction = state.db.transaction(USERS_STORE, "readonly");
    const store = transaction.objectStore(USERS_STORE);
    const request = store.get(userId);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result || null);
  });
}

function getUserByIdentifier(identifier) {
  return new Promise((resolve, reject) => {
    const transaction = state.db.transaction(USERS_STORE, "readonly");
    const store = transaction.objectStore(USERS_STORE);
    const index = store.index("identifierLower");
    const request = index.get(identifier.toLowerCase());

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result || null);
  });
}

function saveUserToDb(user) {
  return new Promise((resolve, reject) => {
    const transaction = state.db.transaction(USERS_STORE, "readwrite");
    const store = transaction.objectStore(USERS_STORE);
    const request = store.put(user);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(user);
  });
}

function getPhotosForUser(userId) {
  return new Promise((resolve, reject) => {
    const transaction = state.db.transaction(PHOTOS_STORE, "readonly");
    const store = transaction.objectStore(PHOTOS_STORE);

    if (!store.indexNames.contains("ownerId")) {
      const fallback = store.getAll();
      fallback.onerror = () => reject(fallback.error);
      fallback.onsuccess = () => {
        resolve((fallback.result || []).filter((photo) => photo.ownerId === userId));
      };
      return;
    }

    const index = store.index("ownerId");
    const request = index.getAll(IDBKeyRange.only(userId));

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result || []);
  });
}

function savePhotoToDb(photo) {
  return new Promise((resolve, reject) => {
    const transaction = state.db.transaction(PHOTOS_STORE, "readwrite");
    const store = transaction.objectStore(PHOTOS_STORE);
    const request = store.put(photo);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(photo);
  });
}

function deletePhotoFromDb(photoId) {
  return new Promise((resolve, reject) => {
    const transaction = state.db.transaction(PHOTOS_STORE, "readwrite");
    const store = transaction.objectStore(PHOTOS_STORE);
    const request = store.delete(photoId);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

function sortPhotos(photos) {
  return [...photos].sort((a, b) => {
    if (a.favorite !== b.favorite) {
      return Number(b.favorite) - Number(a.favorite);
    }

    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
}

function getActivePhoto() {
  return state.photos.find((photo) => photo.id === state.activePhotoId) || null;
}

function getFilteredPhotos() {
  return state.photos.filter((photo) => {
    if (!state.searchQuery) {
      return true;
    }

    return [photo.title, photo.fileName, photo.caption]
      .join(" ")
      .toLowerCase()
      .includes(state.searchQuery);
  });
}

function renderPhotoList() {
  cleanupListObjectUrls();
  els.photoList.innerHTML = "";
  els.photoCountBadge.textContent = state.currentUser ? String(getFilteredPhotos().length) : "0";

  if (!state.currentUser) {
    appendEmptyState(els.photoList, "Connecte-toi pour voir ta phototheque.");
    updateHeroMetrics();
    return;
  }

  const filteredPhotos = getFilteredPhotos();
  if (!filteredPhotos.length) {
    appendEmptyState(
      els.photoList,
      state.searchQuery
        ? "Aucune photo ne correspond a ta recherche."
        : "Aucune photo pour le moment. Importe tes premieres images."
    );
    updateHeroMetrics();
    return;
  }

  filteredPhotos.forEach((photo) => {
    const fragment = els.photoCardTemplate.content.cloneNode(true);
    const card = fragment.querySelector(".photo-card");
    const image = fragment.querySelector(".photo-card-image");
    const title = fragment.querySelector(".photo-card-title");
    const meta = fragment.querySelector(".photo-card-meta");

    const thumbUrl = URL.createObjectURL(photo.thumbBlob || photo.blob);
    state.listObjectUrls.push(thumbUrl);

    image.src = thumbUrl;
    image.alt = photo.title || photo.fileName || "Photo";
    title.textContent = photo.title || deriveTitleFromFileName(photo.fileName);
    meta.textContent = `${formatBytes(photo.sizeBytes)} | ${formatResolution(photo)} | ${formatShortDate(photo.updatedAt)}`;

    card.classList.toggle("active", photo.id === state.activePhotoId);
    card.classList.toggle("favorite", Boolean(photo.favorite));
    card.addEventListener("click", async () => {
      await savePendingDraft();
      state.activePhotoId = photo.id;
      renderPhotoList();
      renderActivePhoto();
    });

    els.photoList.append(fragment);
  });

  updateHeroMetrics();
}

function renderActivePhoto() {
  cleanupActiveViewerUrl();

  const photo = getActivePhoto();

  if (!state.currentUser || !photo) {
    els.activePhotoImage.src = "";
    els.activePhotoImage.alt = "";
    els.activePhotoImage.classList.add("is-hidden");
    els.viewerEmpty.classList.remove("is-hidden");
    els.photoHeading.textContent = "Aucune photo selectionnee";
    els.photoTitleInput.value = "";
    els.photoCaptionInput.value = "";
    els.metaFileName.textContent = "-";
    els.metaFormat.textContent = "-";
    els.metaSize.textContent = "-";
    els.metaResolution.textContent = "-";
    els.metaAddedAt.textContent = "-";
    els.metaUpdatedAt.textContent = "-";
    els.selectionStatus.textContent = "Aucune photo active";
    setPhotoEditorDisabled(true);
    updateHeroMetrics();
    return;
  }

  const imageUrl = URL.createObjectURL(photo.blob);
  state.activeViewerUrl = imageUrl;
  els.activePhotoImage.src = imageUrl;
  els.activePhotoImage.alt = photo.title || photo.fileName || "Photo";
  els.activePhotoImage.classList.remove("is-hidden");
  els.viewerEmpty.classList.add("is-hidden");
  els.photoTitleInput.value = photo.title || deriveTitleFromFileName(photo.fileName);
  els.photoCaptionInput.value = photo.caption || "";
  setPhotoEditorDisabled(false);
  updateDisplayedPhotoInfo(photo);
  updateHeroMetrics();
}

function updateDisplayedPhotoInfo(photo) {
  els.photoHeading.textContent = photo.title || deriveTitleFromFileName(photo.fileName);
  els.favoriteBtn.textContent = photo.favorite ? "Retirer favori" : "Favori";
  els.metaFileName.textContent = photo.fileName || "-";
  els.metaFormat.textContent = normalizeMimeLabel(photo.mimeType);
  els.metaSize.textContent = formatBytes(photo.sizeBytes);
  els.metaResolution.textContent = formatResolution(photo);
  els.metaAddedAt.textContent = formatDateTime(photo.importedAt || photo.createdAt);
  els.metaUpdatedAt.textContent = formatDateTime(photo.updatedAt);
  els.selectionStatus.textContent = `${formatResolution(photo)} | ${formatBytes(photo.sizeBytes)}`;
}

function setPhotoEditorDisabled(disabled) {
  [
    els.photoTitleInput,
    els.photoCaptionInput,
    els.favoriteBtn,
    els.deletePhotoBtn,
    els.downloadPhotoBtn,
  ].forEach((element) => {
    element.disabled = disabled;
  });
}

function scheduleDraftSave() {
  if (!state.currentUser || !getActivePhoto()) {
    return;
  }

  state.isDirty = true;
  setHeroStatus("Sauvegarde...");
  window.clearTimeout(state.draftTimer);
  state.draftTimer = window.setTimeout(async () => {
    const draft = getDraftPhoto();
    if (!draft) {
      return;
    }

    await saveActivePhoto(draft, { fromEditor: true });
  }, 260);
}

function getDraftPhoto() {
  const activePhoto = getActivePhoto();
  if (!activePhoto || !state.currentUser) {
    return null;
  }

  const title =
    sanitizeSingleLineText(els.photoTitleInput.value.trim()) ||
    deriveTitleFromFileName(activePhoto.fileName);
  const caption = sanitizeMultilineText(els.photoCaptionInput.value);

  return {
    ...activePhoto,
    ownerId: state.currentUser.id,
    title,
    caption,
    updatedAt: new Date().toISOString(),
  };
}

async function saveActivePhoto(photo, options = {}) {
  await savePhotoToDb(photo);

  const photoIndex = state.photos.findIndex((item) => item.id === photo.id);
  if (photoIndex >= 0) {
    state.photos[photoIndex] = photo;
  } else {
    state.photos.unshift(photo);
  }

  state.photos = sortPhotos(state.photos);
  state.activePhotoId = photo.id;
  state.isDirty = false;
  setHeroStatus("Sauvegarde ok");
  renderPhotoList();
  updateDisplayedPhotoInfo(photo);
  updateHeroMetrics();
  await updateStorageDisplay();

  if (!options.fromEditor) {
    renderActivePhoto();
  }
}

async function savePendingDraft() {
  const draft = getDraftPhoto();
  if (!draft || !state.isDirty) {
    return;
  }

  window.clearTimeout(state.draftTimer);
  state.draftTimer = null;
  await saveActivePhoto(draft, { fromEditor: true });
}

async function handlePhotoImport(event) {
  const files = Array.from(event.target.files || []);
  event.target.value = "";

  if (!files.length) {
    return;
  }

  await importPhotoFiles(files);
}

async function importPhotoFiles(files) {
  if (!state.currentUser) {
    return;
  }

  await savePendingDraft();

  const imageFiles = files.filter((file) => file.type.startsWith("image/"));
  if (!imageFiles.length) {
    window.alert("Aucune image valide n'a ete trouvee.");
    return;
  }

  setHeroStatus(`Import de ${imageFiles.length} photo(s)...`);
  const imported = [];
  let failedCount = 0;

  for (const file of imageFiles) {
    try {
      const photo = await createPhotoRecordFromFile(file);
      await savePhotoToDb(photo);
      state.photos.push(photo);
      imported.push(photo);
    } catch (error) {
      console.error("Photo import failed:", error);
      failedCount += 1;
    }
  }

  state.photos = sortPhotos(state.photos);

  if (imported.length) {
    state.activePhotoId = imported[imported.length - 1].id;
  }

  renderPhotoList();
  renderActivePhoto();
  await updateStorageDisplay();
  setHeroStatus(
    failedCount
      ? `${imported.length} photo(s) importee(s), ${failedCount} ignoree(s)`
      : `${imported.length} photo(s) importee(s)`
  );
}

async function handleArchiveImport(event) {
  const file = event.target.files?.[0];
  event.target.value = "";

  if (!file || !state.currentUser) {
    return;
  }

  await savePendingDraft();

  try {
    setHeroStatus("Import de l'archive...");
    const text = await file.text();
    const parsed = JSON.parse(text);
    const rawPhotos = Array.isArray(parsed.photos) ? parsed.photos : [];

    if (!rawPhotos.length) {
      throw new Error("Archive vide");
    }

    const imported = [];
    for (const rawPhoto of rawPhotos) {
      const photo = await createPhotoRecordFromArchive(rawPhoto);
      await savePhotoToDb(photo);
      state.photos.push(photo);
      imported.push(photo);
    }

    state.photos = sortPhotos(state.photos);
    state.activePhotoId = imported[imported.length - 1]?.id ?? state.activePhotoId;
    renderPhotoList();
    renderActivePhoto();
    await updateStorageDisplay();
    setHeroStatus(`${imported.length} photo(s) restauree(s)`);
  } catch (error) {
    console.error(error);
    window.alert("Import impossible : l'archive JSON est invalide.");
    setHeroStatus("Import annule");
  }
}

async function exportLibrary() {
  if (!state.currentUser || !state.photos.length) {
    return;
  }

  await savePendingDraft();
  setHeroStatus("Preparation de l'archive...");

  const exportPayload = [];
  for (const photo of state.photos) {
    exportPayload.push({
      title: photo.title,
      caption: photo.caption,
      fileName: photo.fileName,
      mimeType: photo.mimeType,
      sizeBytes: photo.sizeBytes,
      storageBytes: photo.storageBytes,
      width: photo.width,
      height: photo.height,
      favorite: photo.favorite,
      createdAt: photo.createdAt,
      updatedAt: photo.updatedAt,
      importedAt: photo.importedAt,
      dataUrl: await blobToDataUrl(photo.blob),
      thumbDataUrl: photo.thumbBlob ? await blobToDataUrl(photo.thumbBlob) : null,
    });
  }

  const payload = {
    app: "Luma Vault",
    version: 1,
    exportedAt: new Date().toISOString(),
    user: {
      displayName: state.currentUser.displayName,
      identifier: state.currentUser.identifier,
    },
    plan: {
      label: "1500 Go par personne",
    },
    photos: exportPayload,
  };

  const fileName = `luma-vault-${state.currentUser.identifier}-${new Date().toISOString().slice(0, 10)}.json`;
  downloadBlob(
    new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }),
    fileName
  );

  setHeroStatus("Archive exportee");
}

async function downloadActivePhoto() {
  const photo = getActivePhoto();
  if (!photo) {
    return;
  }

  await savePendingDraft();
  downloadBlob(photo.blob, photo.fileName || buildFallbackFileName(photo));
  setHeroStatus("Photo telechargee");
}

async function toggleFavorite() {
  const draft = getDraftPhoto();
  if (!draft) {
    return;
  }

  const updated = {
    ...draft,
    favorite: !getActivePhoto().favorite,
    updatedAt: new Date().toISOString(),
  };

  await saveActivePhoto(updated, { fromEditor: true });
}

async function deleteActivePhoto() {
  const photo = getActivePhoto();
  if (!photo) {
    return;
  }

  const confirmed = window.confirm(`Supprimer "${photo.title || photo.fileName}" ?`);
  if (!confirmed) {
    return;
  }

  await deletePhotoFromDb(photo.id);
  state.photos = state.photos.filter((item) => item.id !== photo.id);
  state.activePhotoId = state.photos[0]?.id ?? null;
  renderPhotoList();
  renderActivePhoto();
  await updateStorageDisplay();
  setHeroStatus("Photo supprimee");
}

async function createPhotoRecordFromFile(file) {
  const blob = file.slice(0, file.size, file.type || "application/octet-stream");
  const thumbnail = await createThumbnailFromBlob(blob);
  const now = new Date().toISOString();

  return {
    id: crypto.randomUUID(),
    ownerId: state.currentUser.id,
    title: deriveTitleFromFileName(file.name),
    caption: "",
    fileName: sanitizeFileName(file.name),
    mimeType: file.type || blob.type || "image/jpeg",
    sizeBytes: blob.size,
    storageBytes: blob.size + (thumbnail.thumbBlob?.size || 0),
    width: thumbnail.width,
    height: thumbnail.height,
    favorite: false,
    createdAt: now,
    updatedAt: now,
    importedAt: new Date(file.lastModified || Date.now()).toISOString(),
    blob,
    thumbBlob: thumbnail.thumbBlob,
  };
}

async function createPhotoRecordFromArchive(rawPhoto) {
  const originalBlob = await dataUrlToBlob(rawPhoto.dataUrl);
  let thumbBlob = rawPhoto.thumbDataUrl ? await dataUrlToBlob(rawPhoto.thumbDataUrl) : null;
  let width = Number(rawPhoto.width) || 0;
  let height = Number(rawPhoto.height) || 0;

  if (!thumbBlob || !width || !height) {
    const generated = await createThumbnailFromBlob(originalBlob);
    thumbBlob = thumbBlob || generated.thumbBlob;
    width = width || generated.width;
    height = height || generated.height;
  }

  const importedAt = rawPhoto.importedAt || rawPhoto.createdAt || new Date().toISOString();
  const createdAt = rawPhoto.createdAt || importedAt;
  const updatedAt = rawPhoto.updatedAt || importedAt;
  const title = sanitizeSingleLineText(
    rawPhoto.title || deriveTitleFromFileName(rawPhoto.fileName || "photo")
  );

  return {
    id: crypto.randomUUID(),
    ownerId: state.currentUser.id,
    title: title || "Photo",
    caption: sanitizeMultilineText(rawPhoto.caption || ""),
    fileName: sanitizeFileName(rawPhoto.fileName || buildArchiveFileName(rawPhoto, originalBlob.type)),
    mimeType: rawPhoto.mimeType || originalBlob.type || "image/jpeg",
    sizeBytes: originalBlob.size,
    storageBytes: originalBlob.size + (thumbBlob?.size || 0),
    width,
    height,
    favorite: Boolean(rawPhoto.favorite),
    createdAt,
    updatedAt,
    importedAt,
    blob: originalBlob,
    thumbBlob,
  };
}

async function createThumbnailFromBlob(blob) {
  const { image, url } = await loadImageElement(blob);

  try {
    const sourceWidth = image.naturalWidth || image.width || 0;
    const sourceHeight = image.naturalHeight || image.height || 0;
    const maxEdge = 720;
    const scale = Math.min(1, maxEdge / Math.max(sourceWidth, sourceHeight, 1));
    const targetWidth = Math.max(1, Math.round(sourceWidth * scale));
    const targetHeight = Math.max(1, Math.round(sourceHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;

    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Canvas indisponible");
    }

    context.drawImage(image, 0, 0, targetWidth, targetHeight);

    const thumbBlob = await canvasToBlob(canvas, "image/jpeg", 0.84);
    return {
      width: sourceWidth,
      height: sourceHeight,
      thumbBlob,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImageElement(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();

    image.onload = () => resolve({ image, url });
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Image non lisible"));
    };
    image.src = url;
  });
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Conversion d'image impossible"));
        return;
      }

      resolve(blob);
    }, type, quality);
  });
}

async function requestPersistentStorage() {
  if (!navigator.storage?.persist) {
    els.persistStatus.textContent =
      "Persistance non supportee par ce navigateur.";
    return;
  }

  try {
    const persisted = await navigator.storage.persisted();
    if (persisted) {
      els.persistStatus.textContent =
        "Stockage persistant actif. Les comptes et les photos resistent mieux au nettoyage automatique.";
      return;
    }

    const granted = await navigator.storage.persist();
    els.persistStatus.textContent = granted
      ? "Stockage persistant active. Les galeries privees restent plus stables hors ligne."
      : "Persistance non accordee. Le quota reel depend encore du navigateur.";
  } catch (error) {
    els.persistStatus.textContent =
      "Impossible de verifier la persistance du stockage.";
  }
}

async function updateStorageDisplay() {
  const userUsageBytes = state.currentUser
    ? state.photos.reduce((total, photo) => total + (photo.storageBytes || photo.sizeBytes || 0), 0)
    : 0;

  const ratio = userUsageBytes
    ? Math.min(100, Math.max(1.2, (userUsageBytes / PLAN_BYTES) * 100))
    : 0;

  els.storageSummary.textContent = `${formatBytes(userUsageBytes)} utilises sur 1500 Go`;
  els.storageFill.style.width = `${ratio}%`;

  if (!navigator.storage?.estimate) {
    els.storageMeta.textContent = state.currentUser
      ? `Compte prive actif. ${state.photos.length} photo(s) dans ce navigateur.`
      : "Le navigateur ne fournit pas de detail sur le quota local.";
    updateHeroMetrics();
    return;
  }

  try {
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    const browserQuotaLabel = quota ? formatBytes(quota) : "quota inconnu";
    const browserUsageLabel = formatBytes(usage);

    els.storageMeta.textContent = state.currentUser
      ? `${state.photos.length} photo(s). Quota navigateur detecte : ${browserUsageLabel} utilises sur ${browserQuotaLabel}.`
      : `Quota navigateur detecte : ${browserUsageLabel} utilises sur ${browserQuotaLabel}.`;
  } catch (error) {
    els.storageMeta.textContent =
      "La capacite reelle depend du quota local accorde par le navigateur.";
  }

  updateHeroMetrics();
}

function updateHeroMetrics() {
  const activePhoto = getActivePhoto();
  const libraryBytes = state.photos.reduce(
    (total, photo) => total + (photo.storageBytes || photo.sizeBytes || 0),
    0
  );

  els.heroPhotoCount.textContent = String(state.photos.length);
  els.heroLibrarySize.textContent = formatBytes(libraryBytes);
  els.heroActiveMeta.textContent = activePhoto ? formatResolution(activePhoto) : "Aucune";
}

function setHeroStatus(message) {
  els.heroStatus.textContent = message;
}

function appendEmptyState(container, message) {
  const empty = document.createElement("div");
  empty.className = "empty-state";
  empty.textContent = message;
  container.append(empty);
}

function cleanupListObjectUrls() {
  state.listObjectUrls.forEach((url) => URL.revokeObjectURL(url));
  state.listObjectUrls = [];
}

function cleanupActiveViewerUrl() {
  if (!state.activeViewerUrl) {
    return;
  }

  URL.revokeObjectURL(state.activeViewerUrl);
  state.activeViewerUrl = null;
}

function cleanupObjectUrls() {
  cleanupListObjectUrls();
  cleanupActiveViewerUrl();
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
}

async function dataUrlToBlob(dataUrl) {
  if (!dataUrl || typeof dataUrl !== "string") {
    throw new Error("Archive photo invalide");
  }

  const response = await fetch(dataUrl);
  return response.blob();
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 Mo";
  }

  const units = ["octets", "Ko", "Mo", "Go", "To"];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const decimals = value >= 100 || unitIndex === 0 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(decimals)} ${units[unitIndex]}`;
}

function formatResolution(photo) {
  if (!photo?.width || !photo?.height) {
    return "-";
  }

  return `${photo.width} x ${photo.height}`;
}

function formatDateTime(value) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatShortDate(value) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "short",
  }).format(new Date(value));
}

function normalizeMimeLabel(mimeType) {
  if (!mimeType) {
    return "-";
  }

  return mimeType.replace("image/", "").toUpperCase();
}

function deriveTitleFromFileName(fileName) {
  const baseName = String(fileName || "Photo").replace(/\.[^/.]+$/, "");
  const words = baseName.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return words || "Photo";
}

function sanitizeSingleLineText(value) {
  return String(value || "")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeMultilineText(value) {
  return String(value || "")
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .trim();
}

function sanitizeFileName(fileName) {
  const cleaned = String(fileName || "photo")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned || "photo";
}

function buildArchiveFileName(rawPhoto, mimeType) {
  const base = deriveTitleFromFileName(rawPhoto.title || "photo")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const extension = mimeTypeToExtension(mimeType);
  return `${base || "photo"}.${extension}`;
}

function buildFallbackFileName(photo) {
  const base = deriveTitleFromFileName(photo.title || photo.fileName || "photo")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${base || "photo"}.${mimeTypeToExtension(photo.mimeType)}`;
}

function mimeTypeToExtension(mimeType) {
  switch (mimeType) {
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    case "image/svg+xml":
      return "svg";
    default:
      return "jpg";
  }
}

function resetRegisterFields() {
  els.registerDisplayName.value = "";
  els.registerIdentifier.value = "";
  els.registerPassword.value = "";
  els.registerPasswordConfirm.value = "";
}

function normalizeIdentifier(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

async function hashPassword(password) {
  if (window.crypto?.subtle && window.TextEncoder) {
    const digest = await window.crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(password)
    );
    return [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }

  return `fallback:${password}`;
}

async function copyCredentials() {
  const identifier = els.registerIdentifier.value.trim();
  const password = els.registerPassword.value.trim();

  if (!identifier || !password) {
    setAuthStatus("Choisis d'abord un identifiant et un mot de passe.", "error");
    return;
  }

  const payload = `Identifiant: ${identifier}\nMot de passe: ${password}`;

  try {
    await navigator.clipboard.writeText(payload);
    setAuthStatus("Identifiant et mot de passe copies.", "success");
  } catch (error) {
    setAuthStatus("Impossible de copier automatiquement. Note-les a la main.", "error");
  }
}

function setAuthStatus(message, type = "info") {
  els.authStatus.textContent = message;
  els.authStatus.dataset.type = type;
}

function clearAuthStatus() {
  els.authStatus.textContent = "";
  delete els.authStatus.dataset.type;
}
