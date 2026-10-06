(() => {
  const CARD_VERSION = "1.8.3";

  const STATUS_META = {
    AVAILABLE_FOR_PICKUP: { label: "Do odbioru", icon: "mdi:archive-check" },
    IN_TRANSIT: { label: "W drodze", icon: "mdi:truck-fast" },
    IN_DELIVERY: { label: "W dostawie", icon: "mdi:truck-delivery" },
    IN_PREPARATION: { label: "W realizacji", icon: "mdi:package-variant" },
    PAID: { label: "Opłacone", icon: "mdi:cash-check" },
    PROBLEM: { label: "Problem", icon: "mdi:alert-circle-outline" },

    PARTIALLY_RETURNED: { label: "Częściowy zwrot", icon: "mdi:backup-restore" },
    RETURNED: { label: "Zwrot", icon: "mdi:backup-restore" },
    DELIVERED: { label: "Dostarczono", icon: "mdi:package-variant-closed-check" },
    ORDER_CANCELLED: { label: "Anulowane", icon: "mdi:cancel" },
    CANCELLED: { label: "Anulowane", icon: "mdi:cancel" },

    UNPAID: { label: "Nieopłacone", icon: "mdi:cash-remove" },
    WAITING_FOR_PAYMENT: { label: "Oczekuje na płatność", icon: "mdi:cash-clock" }
  };

  const STATUS_ORDER = [
    "AVAILABLE_FOR_PICKUP",
    "IN_TRANSIT",
    "IN_DELIVERY",
    "IN_PREPARATION",
    "PAID",
    "PROBLEM",
    "WAITING_FOR_PAYMENT",
    "UNPAID",
    "PARTIALLY_RETURNED",
    "RETURNED",
    "DELIVERED",
    "ORDER_CANCELLED",
    "CANCELLED"
  ];

  const DEFAULT_HIDDEN_STATUSES = new Set([
    "PARTIALLY_RETURNED",
    "RETURNED",
    "DELIVERED",
    "ORDER_CANCELLED",
    "CANCELLED"
  ]);

  const PICKUP_STATUSES = new Set(["AVAILABLE_FOR_PICKUP"]);
  const TRANSIT_STATUSES = new Set(["IN_TRANSIT", "IN_DELIVERY"]);

  const CARRIER_ORDER = [
    "ORLEN",
    "DPD",
    "DHL",
    "One Kurier",
    "Allegro One",
    "InPost",
    "GLS",
    "UPS",
    "Pocztex",
    "FedEx",
    "Inny"
  ];

  const DEFAULT_PEOPLE = [];

  const DEFAULTS = {
    inpost_people: DEFAULT_PEOPLE,
    dpd_people: [],
    dhl_people: [],
    allegro_progress_entity: "",

    columns: 3,
    show_empty_message: true,
    empty_message: "Brak przesyłek",

    pickup_color: "#E3F3E7",
    transit_color: "#E7F1FA",
    other_color: "#FFFFFF",
    show_pickup_qr: true,
    mail_entities: [],

    // null = automatycznie: wszystkie nowe/robocze statusy są widoczne,
    // a zwroty/anulowane/dostarczone są domyślnie ukryte.
    visible_statuses: null
  };

  function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function asNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function normalizePeople(config) {
    if (Array.isArray(config?.inpost_people)) {
      return config.inpost_people.map((p, index) => ({
        name: String(p?.name || `Osoba ${index + 1}`),
        source_entity: String(
          p?.source_entity ||
          p?.ready_entity ||
          p?.transit_entity ||
          ""
        )
      }));
    }

    // Ogólna migracja starszego formatu *_ready_entity / *_transit_entity
    // bez przechowywania w kodzie prywatnych nazw osób.
    const legacy = new Map();

    for (const [key, value] of Object.entries(config || {})) {
      const match = key.match(/^(.+)_(ready|transit)_entity$/);
      if (!match || !value) continue;

      const prefix = match[1];
      const type = match[2];
      if (!legacy.has(prefix)) legacy.set(prefix, {});
      legacy.get(prefix)[type] = String(value);
    }

    if (legacy.size) {
      return [...legacy.values()].map((item, index) => ({
        name: `Osoba ${index + 1}`,
        source_entity: item.ready || item.transit || ""
      }));
    }

    return deepClone(DEFAULT_PEOPLE);
  }

  function normalizeSourcePeople(items) {
    if (!Array.isArray(items)) return [];

    return items.map((p, index) => ({
      name: String(p?.name || `Osoba ${index + 1}`),
      source_entity: String(p?.source_entity || "")
    }));
  }

  function normalizeConfig(config = {}) {
    const merged = {
      ...DEFAULTS,
      ...config,
      inpost_people: normalizePeople(config),
      dpd_people: normalizeSourcePeople(config.dpd_people),
      dhl_people: normalizeSourcePeople(config.dhl_people),
      columns: Math.min(6, Math.max(1, asNumber(config.columns ?? DEFAULTS.columns, 3)))
    };

    if (Array.isArray(config.visible_statuses)) {
      merged.visible_statuses = [...new Set(config.visible_statuses.map(String))];
    } else {
      merged.visible_statuses = null;
    }

    merged.mail_entities = Array.isArray(config.mail_entities)
      ? config.mail_entities.map(String).filter(Boolean)
      : [];

    return merged;
  }

  function humanizeStatus(status) {
    if (!status) return "Status nieznany";
    return String(status)
      .toLowerCase()
      .split("_")
      .filter(Boolean)
      .map((x) => x.charAt(0).toUpperCase() + x.slice(1))
      .join(" ");
  }

  // Lokalny generator QR dla kodów odbioru.
  // Obsługuje pełny payload Allegro, np. "D:XXXXXXXXX:XXXXXX",
  // a nie tylko same cyfry. Dla krótkich danych używa QR Version 1-L,
  // dla dłuższych Version 2-L. Bez zewnętrznych usług i bibliotek.
  function makePickupQrMatrix(value) {
    const text = String(value ?? "");
    const bytes = new TextEncoder().encode(text);

    let version;
    let dataCodewords;
    let eccCodewords;
    let remainderBits;

    // Byte mode capacities for error correction L.
    if (bytes.length <= 17) {
      version = 1;
      dataCodewords = 19;
      eccCodewords = 7;
      remainderBits = 0;
    } else if (bytes.length <= 32) {
      version = 2;
      dataCodewords = 34;
      eccCodewords = 10;
      remainderBits = 7;
    } else {
      return null;
    }

    const bits = [];

    const putBits = (number, length) => {
      for (let i = length - 1; i >= 0; i--) {
        bits.push((number >>> i) & 1);
      }
    };

    // Byte mode: 0100. Versions 1-9 use 8-bit character count.
    putBits(0x4, 4);
    putBits(bytes.length, 8);

    for (const byte of bytes) {
      putBits(byte, 8);
    }

    const dataCapacityBits = dataCodewords * 8;

    for (let i = 0; i < 4 && bits.length < dataCapacityBits; i++) {
      bits.push(0);
    }

    while (bits.length % 8 !== 0) {
      bits.push(0);
    }

    const data = [];

    for (let i = 0; i < bits.length; i += 8) {
      let number = 0;

      for (let j = 0; j < 8; j++) {
        number = (number << 1) | (bits[i + j] || 0);
      }

      data.push(number);
    }

    const pads = [0xec, 0x11];
    let padIndex = 0;

    while (data.length < dataCodewords) {
      data.push(pads[padIndex % 2]);
      padIndex++;
    }

    // GF(256), primitive polynomial 0x11D.
    const exp = new Array(512).fill(0);
    const log = new Array(256).fill(0);

    let x = 1;

    for (let i = 0; i < 255; i++) {
      exp[i] = x;
      log[x] = i;

      x <<= 1;

      if (x & 0x100) {
        x ^= 0x11d;
      }
    }

    for (let i = 255; i < 512; i++) {
      exp[i] = exp[i - 255];
    }

    const gfMul = (a, b) => {
      if (!a || !b) return 0;
      return exp[log[a] + log[b]];
    };

    // Reed-Solomon generator polynomial.
    let generator = [1];

    for (let i = 0; i < eccCodewords; i++) {
      const next = new Array(generator.length + 1).fill(0);

      generator.forEach((coefficient, j) => {
        next[j] ^= coefficient;
        next[j + 1] ^= gfMul(coefficient, exp[i]);
      });

      generator = next;
    }

    const message = [
      ...data,
      ...new Array(eccCodewords).fill(0)
    ];

    for (let i = 0; i < data.length; i++) {
      const factor = message[i];

      if (!factor) continue;

      generator.forEach((coefficient, j) => {
        message[i + j] ^= gfMul(coefficient, factor);
      });
    }

    const codewords = [
      ...data,
      ...message.slice(-eccCodewords)
    ];

    const size = version * 4 + 17;

    const modules = Array.from(
      { length: size },
      () => new Array(size).fill(false)
    );

    const isFunction = Array.from(
      { length: size },
      () => new Array(size).fill(false)
    );

    const setFunction = (col, row, dark) => {
      if (
        col < 0 ||
        row < 0 ||
        col >= size ||
        row >= size
      ) {
        return;
      }

      modules[row][col] = !!dark;
      isFunction[row][col] = true;
    };

    const drawFinder = (col, row) => {
      for (let dy = -1; dy <= 7; dy++) {
        for (let dx = -1; dx <= 7; dx++) {
          const px = col + dx;
          const py = row + dy;

          if (
            px < 0 ||
            py < 0 ||
            px >= size ||
            py >= size
          ) {
            continue;
          }

          const dark =
            dx >= 0 &&
            dx <= 6 &&
            dy >= 0 &&
            dy <= 6 &&
            (
              dx === 0 ||
              dx === 6 ||
              dy === 0 ||
              dy === 6 ||
              (
                dx >= 2 &&
                dx <= 4 &&
                dy >= 2 &&
                dy <= 4
              )
            );

          setFunction(px, py, dark);
        }
      }
    };

    drawFinder(0, 0);
    drawFinder(size - 7, 0);
    drawFinder(0, size - 7);

    // Version 2 has one non-overlapping alignment pattern at 18,18.
    if (version === 2) {
      const center = 18;

      if (!isFunction[center][center]) {
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const dark =
              Math.max(Math.abs(dx), Math.abs(dy)) !== 1;

            setFunction(
              center + dx,
              center + dy,
              dark
            );
          }
        }
      }
    }

    // Timing patterns.
    for (let i = 8; i < size - 8; i++) {
      if (!isFunction[6][i]) {
        setFunction(i, 6, i % 2 === 0);
      }

      if (!isFunction[i][6]) {
        setFunction(6, i, i % 2 === 0);
      }
    }

    // Dark module.
    setFunction(8, size - 8, true);

    // Format bits: error correction L + mask pattern 0.
    const eclFormatBits = 1;
    const mask = 0;
    const formatData = (eclFormatBits << 3) | mask;

    let remainder = formatData;

    for (let i = 0; i < 10; i++) {
      remainder =
        (remainder << 1) ^
        (((remainder >>> 9) & 1) * 0x537);
    }

    const formatBits =
      ((formatData << 10) | remainder) ^ 0x5412;

    const formatBit = (i) =>
      ((formatBits >>> i) & 1) !== 0;

    for (let i = 0; i <= 5; i++) {
      setFunction(8, i, formatBit(i));
    }

    setFunction(8, 7, formatBit(6));
    setFunction(8, 8, formatBit(7));
    setFunction(7, 8, formatBit(8));

    for (let i = 9; i < 15; i++) {
      setFunction(14 - i, 8, formatBit(i));
    }

    for (let i = 0; i < 8; i++) {
      setFunction(
        size - 1 - i,
        8,
        formatBit(i)
      );
    }

    for (let i = 8; i < 15; i++) {
      setFunction(
        8,
        size - 15 + i,
        formatBit(i)
      );
    }

    setFunction(8, size - 8, true);

    // Codeword bit stream + version-specific remainder bits.
    const stream = [];

    for (const codeword of codewords) {
      for (let bit = 7; bit >= 0; bit--) {
        stream.push((codeword >>> bit) & 1);
      }
    }

    for (let i = 0; i < remainderBits; i++) {
      stream.push(0);
    }

    // Place data using mask pattern 0: (row + col) % 2 == 0.
    let bitIndex = 0;

    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) {
        right = 5;
      }

      for (
        let vertical = 0;
        vertical < size;
        vertical++
      ) {
        const upward =
          ((right + 1) & 2) === 0;

        const row = upward
          ? size - 1 - vertical
          : vertical;

        for (let j = 0; j < 2; j++) {
          const col = right - j;

          if (isFunction[row][col]) {
            continue;
          }

          let dark =
            bitIndex < stream.length
              ? stream[bitIndex] !== 0
              : false;

          if ((row + col) % 2 === 0) {
            dark = !dark;
          }

          modules[row][col] = dark;
          bitIndex++;
        }
      }
    }

    return modules;
  }

  function makePickupQrSvg(value) {
    const matrix = makePickupQrMatrix(value);

    if (!matrix) {
      return "";
    }

    const size = matrix.length;
    const quiet = 4;
    const total = size + quiet * 2;
    let path = "";

    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        if (!matrix[row][col]) continue;

        path +=
          `M${col + quiet} ${row + quiet}` +
          "h1v1h-1z";
      }
    }

    return `
      <svg
        class="pickup-qr-svg"
        viewBox="0 0 ${total} ${total}"
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        aria-label="Kod QR do odbioru"
        shape-rendering="crispEdges"
      >
        <rect
          width="${total}"
          height="${total}"
          fill="#fff"
        ></rect>
        <path
          d="${path}"
          fill="#000"
        ></path>
      </svg>
    `;
  }

  class ParcelCard extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: "open" });
      this._hass = null;
      this._config = normalizeConfig({});
      this._selectedCarrier = null;
      this._lastSignature = null;

      // Home Assistant przełącza widoki bez pełnego przeładowania strony.
      // Jeśli użytkownik wyjdzie z widoku z otwartym <dialog>, przeglądarka
      // może pozostawić go w top-layer. Zamykamy popup przy każdej nawigacji.
      this._navigationHandler = () => this._closePopupForNavigation();
      this._navigationListenersAttached = false;
    }

    connectedCallback() {
      if (this._navigationListenersAttached) return;

      window.addEventListener("popstate", this._navigationHandler);
      window.addEventListener("hashchange", this._navigationHandler);
      window.addEventListener("location-changed", this._navigationHandler);

      this._navigationListenersAttached = true;
    }

    disconnectedCallback() {
      if (this._navigationListenersAttached) {
        window.removeEventListener("popstate", this._navigationHandler);
        window.removeEventListener("hashchange", this._navigationHandler);
        window.removeEventListener("location-changed", this._navigationHandler);
        this._navigationListenersAttached = false;
      }

      // Najważniejsze: dialog jest elementem top-layer i musi być jawnie
      // zamknięty przed opuszczeniem karty.
      const dialog = this.shadowRoot?.getElementById("parcel-dialog");
      this._selectedCarrier = null;
      this._lastSignature = null;

      if (dialog?.open) {
        try {
          dialog.close();
        } catch (_) {}
      }
    }

    _closePopupForNavigation() {
      if (!this._selectedCarrier) return;

      const dialog = this.shadowRoot?.getElementById("parcel-dialog");

      this._selectedCarrier = null;
      this._lastSignature = null;

      if (dialog?.open) {
        try {
          dialog.close();
          return;
        } catch (_) {}
      }

      // Jeśli dialog zdążył już zniknąć, ale stan wyboru pozostał,
      // odtwórz kartę bez popupu.
      if (this.isConnected) {
        this._render();
      }
    }

    static getStubConfig() {
      return {
        type: "custom:parcel-card",
        inpost_people: deepClone(DEFAULT_PEOPLE),
        allegro_progress_entity: DEFAULTS.allegro_progress_entity,
        columns: 3
      };
    }

    static getConfigElement() {
      return document.createElement("parcel-card-editor");
    }

    setConfig(config) {
      if (!config) throw new Error("Brak konfiguracji karty.");
      this._config = normalizeConfig(config);
      this._lastSignature = null;
      this._render();
    }

    set hass(hass) {
      this._hass = hass;
      if (!hass) return;

      // Kluczowa poprawka migotania:
      // HA przekazuje nowy obiekt hass bardzo często, nawet gdy żadna encja
      // używana przez kartę się nie zmieniła. Nie przebudowujemy wtedy DOM.
      if (this._selectedCarrier) return;

      const signature = this._stateSignature();
      if (signature !== this._lastSignature) {
        this._render();
      }
    }

    getCardSize() {
      return 2;
    }

    _stateSignature() {
      if (!this._hass) return "";

      const people = this._config.inpost_people.map((p) => {
        const sourceState = p.source_entity
          ? this._hass.states?.[p.source_entity]
          : null;

        return {
          name: p.name,
          source_entity: p.source_entity,
          state: sourceState?.state ?? "",
          attrs: sourceState?.attributes ?? {}
        };
      });

      const sourceAccounts = (items) =>
        items.map((p) => {
          const sourceState = p.source_entity
            ? this._hass.states?.[p.source_entity]
            : null;

          return {
            name: p.name,
            source_entity: p.source_entity,
            state: sourceState?.state ?? "",
            attrs: sourceState?.attributes ?? {}
          };
        });

      const dpdPeople = sourceAccounts(this._config.dpd_people);
      const dhlPeople = sourceAccounts(this._config.dhl_people);

      const allegro = this._hass.states?.[this._config.allegro_progress_entity];
      const mail = this._config.mail_entities.map((entityId) => ({
        entity: entityId,
        state: this._hass.states?.[entityId]?.state ?? ""
      }));

      return JSON.stringify({
        people,
        dpdPeople,
        dhlPeople,
        mail,
        allegro_state: allegro?.state ?? "",
        allegro_details: allegro?.attributes?.details ?? [],
        config: {
          columns: this._config.columns,
          pickup_color: this._config.pickup_color,
          transit_color: this._config.transit_color,
          other_color: this._config.other_color,
          show_pickup_qr: this._config.show_pickup_qr,
          visible_statuses: this._config.visible_statuses
        }
      });
    }

    _stateInt(entityId, offset = 0) {
      if (!this._hass || !entityId) return 0;
      const value = parseInt(this._hass.states?.[entityId]?.state ?? "0", 10);
      const safe = Number.isFinite(value) ? value : 0;
      return Math.max(0, safe + asNumber(offset, 0));
    }

    _mailCount() {
      return this._config.mail_entities.reduce(
        (sum, entityId) => sum + this._stateInt(entityId),
        0
      );
    }

    _progressEntity() {
      return this._hass?.states?.[this._config.allegro_progress_entity];
    }

    _normalizePackage(raw) {
      const offersRaw = raw?.Offers ?? raw?.offers ?? [];
      const offers = Array.isArray(offersRaw) ? offersRaw : [offersRaw];
      const trackingUrl = raw?.tracing_url ?? raw?.tracking_url ?? "";
      const trackingNumber = this._extractTrackingNumber(raw, trackingUrl);

      return {
        raw,
        source: "allegro",
        sources: ["Allegro"],
        assignments: [],
        seller: raw?.Seller ?? raw?.seller ?? "Sprzedawca",
        status: String(raw?.Status ?? raw?.status ?? ""),
        offers: offers
          .map((item) => {
            if (typeof item === "string") return item;
            return item?.name ?? item?.title ?? item?.offer_name ?? "Produkt";
          })
          .filter(Boolean),
        deliveryName: raw?.delivery_name ?? raw?.deliveryName ?? "",
        trackingUrl,
        trackingNumber,
        allegroTrackingNumber: trackingNumber,
        carrierTrackingNumber: "",
        pickupCode: raw?.pickup_code ?? raw?.pickupCode ?? null,
        qrCode: raw?.qr_code ?? raw?.qrCode ?? null
      };
    }

    _packages() {
      const details = this._progressEntity()?.attributes?.details;
      if (!Array.isArray(details)) return [];
      return details.map((p) => this._normalizePackage(p));
    }

    _normalizeMatchValue(value) {
      if (value === null || value === undefined) return "";

      const normalized = String(value)
        .replace(/\s+/g, "")
        .trim()
        .toUpperCase();

      // Nigdy nie traktuj wartości pustych / technicznych jako identyfikatora.
      // Dzięki temu wiele paczek z numerem null nie zostanie scalonych razem.
      if (
        !normalized ||
        normalized === "NULL" ||
        normalized === "NONE" ||
        normalized === "UNKNOWN" ||
        normalized === "UNAVAILABLE" ||
        normalized === "N/A" ||
        normalized === "-"
      ) {
        return "";
      }

      return normalized;
    }

    _extractTrackingNumber(raw, trackingUrl = "") {
      const object = raw && typeof raw === "object" ? raw : {};

      const knownKeys = [
        "tracking_number",
        "trackingNumber",
        "shipment_number",
        "shipmentNumber",
        "parcel_number",
        "parcelNumber",
        "package_number",
        "packageNumber",
        "shipment_id",
        "shipmentId",
        "parcel_id",
        "parcelId",
        "tracking_id",
        "trackingId",
        "parcel",
        "waybill",
        "waybill_number",
        "waybillNumber",
        "numer_przesylki",
        "numerPrzesylki",
        "numer_przesyłki",
        "numer",
        "number"
      ];

      for (const key of knownKeys) {
        const value = object?.[key];

        if (
          value !== undefined &&
          value !== null &&
          String(value).trim() !== ""
        ) {
          return this._normalizeMatchValue(value);
        }
      }

      if (trackingUrl) {
        try {
          const url = new URL(trackingUrl, window.location.origin);

          const params = [
            "numer",
            "number",
            "tracking_number",
            "trackingNumber",
            "shipment_number",
            "shipmentNumber",
            "parcel_number",
            "parcelNumber",
            "parcel",
            "shipment",
            "tracking",
            "tracking-id",
            "trackingId",
            "shipment-id",
            "shipmentId",
            "piececode",
            "pieceCode",
            "waybill"
          ];

          for (const key of params) {
            const value = url.searchParams.get(key);

            if (value) {
              return this._normalizeMatchValue(value);
            }
          }
        } catch (_) {}
      }

      return "";
    }

    _pickupTokenFromQr(value) {
      const raw = this._normalizeMatchValue(value);
      if (!raw) return "";

      const parts = raw.split(/[:|]/).filter(Boolean);
      const last = parts.length ? parts[parts.length - 1] : raw;
      return /^\d+$/.test(last) ? last : "";
    }

    _normalizeInpostPackage(raw, person, phase) {
      const ready = phase === "ready";

      return {
        raw,
        source: "inpost",
        sources: ["InPost"],
        assignments: [{ source: "InPost", name: person.name }],
        personName: person.name,
        accountName: person.name,
        seller: raw?.nadawca || "InPost",
        inpostSender: raw?.nadawca || "",
        status: ready ? "AVAILABLE_FOR_PICKUP" : "IN_TRANSIT",
        inpostStatus: raw?.status || "",
        offers: [],
        deliveryName: "InPost",
        trackingUrl: "",
        trackingNumber: this._extractTrackingNumber(raw),
        allegroTrackingNumber: "",
        carrierTrackingNumber: this._extractTrackingNumber(raw),
        pickupCode: raw?.kod_odbioru ?? null,
        qrCode: raw?.qr ?? null,
        locker: raw?.paczkomat || "",
        address: raw?.adres || "",
        deadline: raw?.termin_odbioru || "",
        multiLocker: raw?.multiskrytka ?? null
      };
    }

    _expandInpostReadyPackage(raw, person, multiLockerGroup = null) {
      const parcelNumbers = Array.isArray(raw?.paczki)
        ? raw.paczki
        : [];

      const fallbackCodes = Array.isArray(raw?.kody_fallback)
        ? raw.kody_fallback
        : [];

      const multiCount = Math.max(
        0,
        asNumber(raw?.multiskrytka, 0)
      );

      // Zwykła paczka — niczego nie rozbijamy.
      if (multiCount <= 1 || parcelNumbers.length <= 1) {
        return [
          this._normalizeInpostPackage(raw, person, "ready")
        ];
      }

      const primaryNumber = this._normalizeMatchValue(raw?.numer);
      const primaryCode = this._normalizeMatchValue(raw?.kod_odbioru);

      const count = Math.max(
        multiCount,
        parcelNumbers.length,
        fallbackCodes.length
      );

      const result = [];

      for (let index = 0; index < count; index++) {
        const number = parcelNumbers[index] ?? null;
        const code = fallbackCodes[index] ?? null;

        const normalizedNumber = this._normalizeMatchValue(number);
        const normalizedCode = this._normalizeMatchValue(code);

        // Rekord grupowy z integracji niesie pełnego nadawcę i QR tylko
        // dla jednej z paczek w multiskrytce. Rozpoznajemy ją po numerze
        // lub kodzie. Dla pozostałych nie kopiujemy nadawcy/QR w ciemno.
        const isPrimary =
          (
            primaryNumber &&
            normalizedNumber &&
            primaryNumber === normalizedNumber
          ) ||
          (
            primaryCode &&
            normalizedCode &&
            primaryCode === normalizedCode
          );

        const childRaw = {
          ...raw,
          numer: number,
          kod_odbioru: code,
          qr: isPrimary ? raw?.qr ?? null : null,
          nadawca: isPrimary ? raw?.nadawca ?? null : null
        };

        const pkg = this._normalizeInpostPackage(
          childRaw,
          person,
          "ready"
        );

        pkg.multiLocker = multiCount;
        pkg.multiLockerGroup = multiLockerGroup;
        pkg.multiLockerIndex = index + 1;
        pkg.multiLockerNumbers = parcelNumbers;
        pkg.multiLockerCodes = fallbackCodes;

        result.push(pkg);
      }

      return result;
    }

    _inpostPackageKey(pkg) {
      const tracking = this._normalizeMatchValue(pkg.trackingNumber);
      if (tracking) return `tracking:${tracking}`;

      const qr = this._normalizeMatchValue(pkg.qrCode);
      if (qr) return `qr:${qr}`;

      const code = this._normalizeMatchValue(pkg.pickupCode);
      if (code) return `code:${code}`;

      // Bez numeru / QR / kodu odbioru nie deduplikujemy rekordów
      // na podstawie słabszych pól, żeby nie skleić dwóch różnych paczek.
      return "";
    }

    _inpostPackagesForPerson(person) {
      const entityId = person.source_entity;
      if (!entityId) return [];

      const state = this._hass?.states?.[entityId];
      const attrs = state?.attributes || {};

      const ready = Array.isArray(attrs.do_odbioru)
        ? attrs.do_odbioru
        : [];

      const transit = Array.isArray(attrs.w_drodze)
        ? attrs.w_drodze
        : [];

      const collected = [];

      let multiLockerGroup = 0;

      for (const item of ready) {
        const isMultiLocker =
          Math.max(0, asNumber(item?.multiskrytka, 0)) > 1 &&
          Array.isArray(item?.paczki) &&
          item.paczki.length > 1;

        if (isMultiLocker) {
          multiLockerGroup++;
        }

        collected.push(
          ...this._expandInpostReadyPackage(
            item,
            person,
            isMultiLocker ? multiLockerGroup : null
          )
        );
      }

      for (const item of transit) {
        collected.push(
          this._normalizeInpostPackage(item, person, "transit")
        );
      }

      // Ewentualne duplikaty w samych atrybutach tej encji.
      const unique = new Map();

      for (const pkg of collected) {
        const key = this._inpostPackageKey(pkg);

        // Jeżeli nie mamy stabilnego klucza, nie próbujemy na siłę scalać.
        // Każdy taki rekord pozostaje osobną paczką.
        if (!key) {
          unique.set(`anonymous:${unique.size}`, pkg);
          continue;
        }

        if (!unique.has(key)) unique.set(key, pkg);
      }

      let packages = [...unique.values()];

      // Fallback dla wersji integracji, które mają liczniki, ale chwilowo
      // nie zwracają pełnych list. Preferujemy *_count z tej samej encji.
      const readyDetails = packages.filter(
        (p) => p.status === "AVAILABLE_FOR_PICKUP"
      ).length;

      const transitDetails = packages.filter(
        (p) => p.status === "IN_TRANSIT"
      ).length;

      const readyCount = Math.max(
        0,
        asNumber(attrs.do_odbioru_count, state?.state)
      );

      const transitCount = Math.max(
        0,
        asNumber(attrs.w_drodze_count, 0)
      );

      for (let i = readyDetails; i < readyCount; i++) {
        packages.push({
          source: "inpost",
          sources: ["InPost"],
          assignments: [{ source: "InPost", name: person.name }],
          personName: person.name,
          accountName: person.name,
          seller: "InPost",
          inpostSender: "",
          status: "AVAILABLE_FOR_PICKUP",
          inpostStatus: "",
          offers: [],
          deliveryName: "InPost",
          trackingUrl: "",
          trackingNumber: "",
          allegroTrackingNumber: "",
          carrierTrackingNumber: "",
          pickupCode: null,
          qrCode: null,
          locker: "",
          address: "",
          deadline: "",
          multiLocker: null,
          raw: {}
        });
      }

      for (let i = transitDetails; i < transitCount; i++) {
        packages.push({
          source: "inpost",
          sources: ["InPost"],
          assignments: [{ source: "InPost", name: person.name }],
          personName: person.name,
          accountName: person.name,
          seller: "InPost",
          inpostSender: "",
          status: "IN_TRANSIT",
          inpostStatus: "",
          offers: [],
          deliveryName: "InPost",
          trackingUrl: "",
          trackingNumber: "",
          allegroTrackingNumber: "",
          carrierTrackingNumber: "",
          pickupCode: null,
          qrCode: null,
          locker: "",
          address: "",
          deadline: "",
          multiLocker: null,
          raw: {}
        });
      }

      return packages;
    }

    _allInpostPackages() {
      const result = [];

      for (const person of this._config.inpost_people) {
        result.push(...this._inpostPackagesForPerson(person));
      }

      return result;
    }


    _carrierStatusToCardStatus(status, carrier) {
      const s = String(status || "").trim().toLowerCase();

      if (!s) return "IN_TRANSIT";

      if (
        s.includes("do odbioru") ||
        s.includes("doręczona do automatu") ||
        s.includes("doreczona do automatu") ||
        s.includes("doręczona do punktu") ||
        s.includes("doreczona do punktu") ||
        s.includes("waiting_for_pickup")
      ) {
        return "AVAILABLE_FOR_PICKUP";
      }

      if (
        s.includes("w doręczeniu") ||
        s.includes("w doreczeniu") ||
        s === "doręczenie" ||
        s === "doreczenie" ||
        s.includes("handed_out_for_delivery")
      ) {
        return "IN_DELIVERY";
      }

      if (
        s.includes("przygotowaniu") ||
        s.includes("utworzona") ||
        s.includes("czeka na odbiór kuriera") ||
        s.includes("czeka na odbior kuriera") ||
        s.includes("created")
      ) {
        return "IN_PREPARATION";
      }

      if (
        s.includes("dostarczona") ||
        s === "doręczona" ||
        s === "doreczona" ||
        s.includes("odebrana z punktu") ||
        s.includes("odebrana z automatu")
      ) {
        return "DELIVERED";
      }

      if (
        s.includes("zwrócona") ||
        s.includes("zwrocona") ||
        s.includes("wraca do nadawcy") ||
        s.includes("wróciła do nadawcy") ||
        s.includes("wrocila do nadawcy")
      ) {
        return "RETURNED";
      }

      if (
        s.includes("anulowana") ||
        s.includes("wycofanie") ||
        s.includes("utylizowana")
      ) {
        return "CANCELLED";
      }

      if (
        s.includes("problem") ||
        s.includes("nieudana") ||
        s.includes("opóźnienie") ||
        s.includes("opoznienie") ||
        s.includes("zaginęła") ||
        s.includes("zaginela") ||
        s.includes("odmowa") ||
        s.includes("oczekujemy na decyzje nadawcy") ||
        s.includes("oczekujemy na decyzję nadawcy") ||
        s.includes("skontaktuj się z dhl") ||
        s.includes("skontaktuj sie z dhl")
      ) {
        return "PROBLEM";
      }

      return "IN_TRANSIT";
    }

    _normalizeExternalCarrierPackage(raw, account, carrier) {
      const statusText = String(raw?.status ?? "");
      const carrierUpper = String(carrier || "").toUpperCase();
      const assignmentName = account?.name || "";

      return {
        raw,
        source: carrierUpper.toLowerCase(),
        sources: [carrierUpper],
        assignments: assignmentName
          ? [{ source: carrierUpper, name: assignmentName }]
          : [],
        accountName: assignmentName,
        seller: raw?.nadawca || carrierUpper,
        status: this._carrierStatusToCardStatus(statusText, carrierUpper),
        externalStatus: statusText,
        offers: [],
        deliveryName: carrierUpper,
        trackingUrl: "",
        trackingNumber: this._extractTrackingNumber(raw),
        allegroTrackingNumber: "",
        carrierTrackingNumber: this._extractTrackingNumber(raw),
        pickupCode: null,
        qrCode: null,
        updated: raw?.aktualizacja || "",
        senderAddress: raw?.adres_nadawcy || "",
        deliveryGps: raw?.gps_doreczenia || null,
        courierName: raw?.kurier || "",
        courierPhone: raw?.telefon_kuriera || "",
        mpsPart: raw?.czesc_przesylki || "",
        mpsSiblings: raw?.pozostale_paczki || null,
        shared: raw?.udostepniona ?? null
      };
    }

    _packagesForSourceAccounts(accounts, carrier) {
      const packages = [];

      for (const account of accounts) {
        if (!account?.source_entity) continue;

        const state = this._hass?.states?.[account.source_entity];
        const attrs = state?.attributes || {};
        const active = Array.isArray(attrs.w_drodze)
          ? attrs.w_drodze
          : [];

        for (const item of active) {
          packages.push(
            this._normalizeExternalCarrierPackage(
              item,
              account,
              carrier
            )
          );
        }

        // Fallback: jeżeli licznik jest większy niż liczba szczegółów,
        // dodaj anonimowe rekordy, ale nigdy ich nie scalaj po pustym numerze.
        const expected = Math.max(
          0,
          asNumber(attrs.active_count, state?.state)
        );

        for (let i = active.length; i < expected; i++) {
          packages.push({
            source: String(carrier).toLowerCase(),
            sources: [String(carrier).toUpperCase()],
            assignments: account?.name
              ? [{ source: String(carrier).toUpperCase(), name: account.name }]
              : [],
            accountName: account?.name || "",
            seller: String(carrier).toUpperCase(),
            status: "IN_TRANSIT",
            externalStatus: "",
            offers: [],
            deliveryName: String(carrier).toUpperCase(),
            trackingUrl: "",
            trackingNumber: "",
            allegroTrackingNumber: "",
            carrierTrackingNumber: "",
            pickupCode: null,
            qrCode: null,
            updated: "",
            raw: {}
          });
        }
      }

      return packages;
    }

    _dpdPackages() {
      return this._packagesForSourceAccounts(
        this._config.dpd_people,
        "DPD"
      );
    }

    _dhlPackages() {
      return this._packagesForSourceAccounts(
        this._config.dhl_people,
        "DHL"
      );
    }

    _accountGroups(packages, accounts) {
      return accounts
        .map((account) => ({
          name: account.name,
          items: packages.filter(
            (pkg) =>
              pkg.accountName === account.name &&
              this._isStatusVisible(pkg.status)
          )
        }))
        .filter((group) => group.items.length > 0);
    }

    _packageMatchMethod(allegro, inpost) {
      const allegroTracking = this._normalizeMatchValue(
        allegro.trackingNumber
      );
      const inpostTracking = this._normalizeMatchValue(
        inpost.trackingNumber
      );

      if (
        allegroTracking &&
        inpostTracking &&
        allegroTracking === inpostTracking
      ) {
        return "tracking_number";
      }

      const allegroCode = this._normalizeMatchValue(allegro.pickupCode);
      const inpostCode = this._normalizeMatchValue(inpost.pickupCode);

      if (
        allegroCode &&
        inpostCode &&
        allegroCode === inpostCode
      ) {
        return "pickup_code";
      }

      const allegroQr = this._normalizeMatchValue(allegro.qrCode);
      const inpostQr = this._normalizeMatchValue(inpost.qrCode);

      if (allegroQr && inpostQr && allegroQr === inpostQr) {
        return "qr";
      }

      const allegroQrCode = this._pickupTokenFromQr(allegro.qrCode);
      const inpostQrCode = this._pickupTokenFromQr(inpost.qrCode);

      const aToken = allegroCode || allegroQrCode;
      const iToken = inpostCode || inpostQrCode;

      if (aToken && iToken && aToken === iToken) {
        return "qr_pickup_code";
      }

      return "";
    }

    _packagesMatch(allegro, inpost) {
      return !!this._packageMatchMethod(allegro, inpost);
    }

    _mergeAllegroWithInpost(allegroPackages, inpostPackages) {
      const usedAllegro = new Set();
      const mergedInpost = [];

      for (const inpost of inpostPackages) {
        let matchIndex = -1;

        for (let i = 0; i < allegroPackages.length; i++) {
          if (usedAllegro.has(i)) continue;

          if (this._packagesMatch(allegroPackages[i], inpost)) {
            matchIndex = i;
            break;
          }
        }

        if (matchIndex === -1) {
          mergedInpost.push(inpost);
          continue;
        }

        usedAllegro.add(matchIndex);
        const allegro = allegroPackages[matchIndex];
        const mergedBy = this._packageMatchMethod(allegro, inpost);

        mergedInpost.push({
          ...allegro,
          source: "merged",
          sources: [
            ...new Set([
              ...(Array.isArray(inpost.sources) ? inpost.sources : ["InPost"]),
              ...(Array.isArray(allegro.sources) ? allegro.sources : ["Allegro"])
            ])
          ],
          assignments: [
            ...new Map(
              [
                ...(Array.isArray(inpost.assignments) ? inpost.assignments : []),
                ...(Array.isArray(allegro.assignments) ? allegro.assignments : [])
              ].map((item) => [
                `${item.source}|${item.name}`,
                item
              ])
            ).values()
          ],
          personName: inpost.personName,
          accountName: inpost.accountName,
          status: inpost.status || allegro.status,
          trackingNumber:
            inpost.trackingNumber || allegro.trackingNumber || "",
          allegroTrackingNumber:
            allegro.allegroTrackingNumber || allegro.trackingNumber || "",
          carrierTrackingNumber:
            inpost.carrierTrackingNumber || inpost.trackingNumber || "",
          pickupCode: inpost.pickupCode || allegro.pickupCode,
          qrCode: inpost.qrCode || allegro.qrCode,
          locker: inpost.locker,
          address: inpost.address,
          deadline: inpost.deadline,
          multiLocker: inpost.multiLocker,
          multiLockerGroup: inpost.multiLockerGroup,
          multiLockerIndex: inpost.multiLockerIndex,
          multiLockerNumbers: inpost.multiLockerNumbers,
          multiLockerCodes: inpost.multiLockerCodes,
          inpostSender: inpost.inpostSender,
          inpostStatus: inpost.inpostStatus,
          inpostRaw: inpost.raw,
          allegroRaw: allegro.raw,
          mergedBy
        });
      }

      const remainingAllegro = allegroPackages.filter(
        (_, index) => !usedAllegro.has(index)
      );

      return {
        inpostPackages: mergedInpost,
        allegroPackages: remainingAllegro
      };
    }


    _statusMergePriority(status) {
      const order = {
        AVAILABLE_FOR_PICKUP: 60,
        PROBLEM: 55,
        IN_DELIVERY: 50,
        IN_TRANSIT: 40,
        IN_PREPARATION: 30,
        PAID: 20,
        WAITING_FOR_PAYMENT: 15,
        UNPAID: 10,
        RETURNED: 5,
        PARTIALLY_RETURNED: 5,
        DELIVERED: 4,
        CANCELLED: 3,
        ORDER_CANCELLED: 3
      };
      return order[status] ?? 0;
    }

    _mergePackagePair(a, b) {
      const sources = [
        ...new Set([
          ...(Array.isArray(a.sources) ? a.sources : []),
          ...(Array.isArray(b.sources) ? b.sources : [])
        ])
      ];

      const assignments = [
        ...new Map(
          [
            ...(Array.isArray(a.assignments) ? a.assignments : []),
            ...(Array.isArray(b.assignments) ? b.assignments : [])
          ].map((item) => [
            `${item.source}|${item.name}`,
            item
          ])
        ).values()
      ];

      const offers = [
        ...new Set([
          ...(Array.isArray(a.offers) ? a.offers : []),
          ...(Array.isArray(b.offers) ? b.offers : [])
        ])
      ];

      const betterStatus =
        this._statusMergePriority(b.status) >
        this._statusMergePriority(a.status)
          ? b.status
          : a.status;

      const preferSeller = (x, y) => {
        const generic = new Set([
          "INPOST", "DPD", "DHL", "SPRZEDAWCA", ""
        ]);
        const xs = String(x || "").trim();
        const ys = String(y || "").trim();

        if (!generic.has(xs.toUpperCase())) return xs;
        if (!generic.has(ys.toUpperCase())) return ys;
        return xs || ys;
      };

      return {
        ...a,
        ...b,
        source: sources.length > 1 ? "merged" : (b.source || a.source),
        sources,
        assignments,
        offers,
        seller: preferSeller(a.seller, b.seller),
        status: betterStatus,
        trackingNumber: a.trackingNumber || b.trackingNumber || "",
        allegroTrackingNumber:
          a.allegroTrackingNumber || b.allegroTrackingNumber || "",
        carrierTrackingNumber:
          a.carrierTrackingNumber || b.carrierTrackingNumber || "",
        trackingUrl: a.trackingUrl || b.trackingUrl || "",
        pickupCode: a.pickupCode || b.pickupCode || null,
        qrCode: a.qrCode || b.qrCode || null,
        locker: a.locker || b.locker || "",
        address: a.address || b.address || "",
        deadline: a.deadline || b.deadline || "",
        multiLocker: a.multiLocker || b.multiLocker || null,
        multiLockerGroup: a.multiLockerGroup || b.multiLockerGroup || null,
        multiLockerIndex: a.multiLockerIndex || b.multiLockerIndex || null,
        multiLockerNumbers: a.multiLockerNumbers || b.multiLockerNumbers,
        multiLockerCodes: a.multiLockerCodes || b.multiLockerCodes,
        inpostSender: a.inpostSender || b.inpostSender || "",
        inpostStatus: a.inpostStatus || b.inpostStatus || "",
        inpostRaw: a.inpostRaw || b.inpostRaw,
        allegroRaw: a.allegroRaw || b.allegroRaw,
        updated: a.updated || b.updated || "",
        senderAddress: a.senderAddress || b.senderAddress || "",
        deliveryGps: a.deliveryGps || b.deliveryGps || null,
        courierName: a.courierName || b.courierName || "",
        courierPhone: a.courierPhone || b.courierPhone || "",
        mpsPart: a.mpsPart || b.mpsPart || "",
        mpsSiblings: a.mpsSiblings || b.mpsSiblings || null,
        shared:
          a.shared !== null && a.shared !== undefined
            ? a.shared
            : b.shared
      };
    }

    _mergeByTracking(packages) {
      const result = [];
      const keyed = new Map();

      for (const pkg of packages) {
        const tracking = this._normalizeMatchValue(pkg.trackingNumber);
        const carrier = this._carrierForPackage(pkg);

        // Null/puste numery nigdy nie uczestniczą w scalaniu.
        if (!tracking || !carrier) {
          result.push(pkg);
          continue;
        }

        const key = `${carrier}|${tracking}`;

        if (!keyed.has(key)) {
          keyed.set(key, result.length);
          result.push(pkg);
          continue;
        }

        const index = keyed.get(key);
        result[index] = {
          ...this._mergePackagePair(
            result[index],
            pkg
          ),
          mergedBy: "tracking_number"
        };
      }

      return result;
    }

    _inpostGroups(packages) {
      return this._config.inpost_people
        .map((person) => ({
          name: person.name,
          items: packages.filter(
            (pkg) =>
              pkg.personName === person.name &&
              this._isStatusVisible(pkg.status)
          )
        }))
        .filter((group) => group.items.length > 0);
    }

    _isStatusVisible(status) {
      const configured = this._config.visible_statuses;
      if (Array.isArray(configured)) return configured.includes(status);
      return !DEFAULT_HIDDEN_STATUSES.has(status);
    }

    _carrierFor(deliveryName) {
      const s = String(deliveryName || "").toLowerCase();

      if (s.includes("orlen")) return "ORLEN";

      // Najpierw właściwy przewoźnik, np. "Allegro One Box, DPD".
      if (s.includes("dpd")) return "DPD";
      if (s.includes("dhl")) return "DHL";
      if (s.includes("gls")) return "GLS";
      if (s.includes("fedex")) return "FedEx";
      if (s.includes("ups")) return "UPS";
      if (s.includes("pocztex") || s.includes("poczta polska")) return "Pocztex";
      if (s.includes("inpost") || s.includes("paczkomat")) return "InPost";

      if (s.includes("one kurier")) return "One Kurier";
      if (
        s.includes("allegro one") ||
        s.includes("one box") ||
        s.includes("one punkt")
      ) {
        return "Allegro One";
      }

      return "Inny";
    }

    _carrierForPackage(pkg) {
      // Jeżeli paczka pochodzi z InPost albo została połączona
      // Allegro + InPost, zawsze trafia do wspólnego kafelka InPost.
      if (
        pkg?.source === "inpost" ||
        pkg?.personName ||
        (Array.isArray(pkg?.sources) && pkg.sources.includes("InPost"))
      ) {
        return "InPost";
      }

      if (Array.isArray(pkg?.sources)) {
        if (pkg.sources.includes("DPD")) return "DPD";
        if (pkg.sources.includes("DHL")) return "DHL";
      }

      return this._carrierFor(pkg?.deliveryName);
    }

    _carrierTrackingUrl(pkg) {
      const tracking = this._normalizeMatchValue(
        pkg?.carrierTrackingNumber
      );

      // Numer z Allegro Delivery (np. AD...) nie musi być numerem listu
      // przewozowego partnera logistycznego. Generujemy link przewoźnika
      // wyłącznie z numeru pochodzącego z jego własnej integracji.
      if (!tracking) return "";

      const carrier = this._carrierForPackage(pkg);
      const encoded = encodeURIComponent(tracking);

      if (carrier === "InPost") {
        return `https://inpost.pl/sledzenie-przesylek?number=${encoded}`;
      }

      if (carrier === "DPD") {
        return `https://tracktrace.dpd.com.pl/parcelDetails?p1=${encoded}`;
      }

      if (carrier === "DHL") {
        return `https://sprawdz.dhl.com.pl/laststatus.aspx?NR1=${encoded}`;
      }

      return "";
    }

    _trackingLinkLabel(url, pkg, isCarrierLink = false) {
      if (isCarrierLink) {
        return `Śledź w ${this._carrierForPackage(pkg)}`;
      }

      try {
        const host = new URL(url, window.location.origin).hostname.toLowerCase();
        if (host.includes("inpost.pl")) return "Śledź w InPost";
        if (host.includes("dpd.com.pl")) return "Śledź w DPD";
        if (host.includes("dhl.com.pl")) return "Śledź w DHL";
        if (host.includes("allegro.pl")) return "Śledź w Allegro";
      } catch (_) {}

      return "Śledź przesyłkę";
    }

    _trackingLinksForPackage(pkg) {
      const links = [];
      const seen = new Set();

      const add = (url, label, source) => {
        const safe = this._safeUrl(url);
        if (!safe || seen.has(safe)) return;
        seen.add(safe);
        links.push({ url: safe, label, source });
      };

      const sourceUrl = this._safeUrl(pkg?.trackingUrl);
      if (sourceUrl) {
        add(
          sourceUrl,
          this._trackingLinkLabel(sourceUrl, pkg, false),
          "source"
        );
      }

      const carrierUrl = this._carrierTrackingUrl(pkg);
      if (carrierUrl) {
        add(
          carrierUrl,
          this._trackingLinkLabel(carrierUrl, pkg, true),
          "carrier"
        );
      }

      return links;
    }

    _packageSources(pkg) {
      const sources = new Set();

      if (Array.isArray(pkg?.sources)) {
        for (const source of pkg.sources) {
          const label = String(source || "").trim();
          if (label) sources.add(label);
        }
      }

      // Kompatybilność ze starszymi / przyszłymi rekordami,
      // które nie mają jeszcze jawnej tablicy `sources`.
      if (pkg?.source === "inpost" || pkg?.personName || pkg?.inpostRaw) {
        sources.add("InPost");
      }

      if (
        pkg?.source === "allegro" ||
        pkg?.allegroRaw
      ) {
        sources.add("Allegro");
      }

      // Stabilna kolejność znanych źródeł, potem dowolne nowe.
      const preferred = ["InPost", "DPD", "DHL", "Allegro"];
      const all = [...sources];

      return [
        ...preferred.filter((name) => sources.has(name)),
        ...all
          .filter((name) => !preferred.includes(name))
          .sort((a, b) => a.localeCompare(b, "pl"))
      ];
    }

    _groupCarriers(packages) {
      const map = new Map();

      packages.forEach((pkg) => {
        if (!this._isStatusVisible(pkg.status)) return;

        const carrier = this._carrierForPackage(pkg);
        if (!map.has(carrier)) map.set(carrier, []);
        map.get(carrier).push(pkg);
      });

      return [...map.entries()]
        .map(([name, items]) => ({ name, items }))
        .sort((a, b) => {
          const ai = CARRIER_ORDER.indexOf(a.name);
          const bi = CARRIER_ORDER.indexOf(b.name);
          const aa = ai === -1 ? 999 : ai;
          const bb = bi === -1 ? 999 : bi;
          return aa - bb || a.name.localeCompare(b.name, "pl");
        });
    }

    _statusCounts(items) {
      const counts = new Map();
      items.forEach((pkg) => {
        const status = pkg.status || "UNKNOWN";
        counts.set(status, (counts.get(status) || 0) + 1);
      });
      return counts;
    }

    _statusLabel(status) {
      return STATUS_META[status]?.label || humanizeStatus(status);
    }

    _statusIcon(status) {
      return STATUS_META[status]?.icon || "mdi:package-variant";
    }

    _tilePriority(items) {
      const statuses = new Set(items.map((x) => x.status));

      if ([...statuses].some((s) => PICKUP_STATUSES.has(s))) {
        return 1;
      }

      if ([...statuses].some((s) => TRANSIT_STATUSES.has(s))) {
        return 2;
      }

      return 3;
    }

    _tileColor(items) {
      const priority = this._tilePriority(items);
      if (priority === 1) return this._config.pickup_color;
      if (priority === 2) return this._config.transit_color;
      return this._config.other_color;
    }

    _textColorForBackground(color) {
      const value = String(color || "").trim();
      const match = /^#([0-9a-f]{6})$/i.exec(value);
      if (!match) return "var(--primary-text-color)";

      const hex = match[1];
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

      return lum > 0.58 ? "#242424" : "#FFFFFF";
    }

    _e(value) {
      return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
    }

    _safeUrl(value) {
      try {
        const u = new URL(value);
        if (u.protocol === "http:" || u.protocol === "https:") return u.href;
      } catch (_) {}
      return "";
    }

    _renderStatusIcons(items) {
      const counts = this._statusCounts(items);

      const statuses = [
        ...STATUS_ORDER.filter((s) => counts.has(s)),
        ...[...counts.keys()]
          .filter((s) => !STATUS_ORDER.includes(s))
          .sort((a, b) => a.localeCompare(b))
      ];

      return statuses
        .map((status) => {
          const count = counts.get(status);
          return `
            <span class="status-mini" title="${this._e(this._statusLabel(status))}">
              <ha-icon icon="${this._e(this._statusIcon(status))}"></ha-icon>
              <span>${count}</span>
            </span>
          `;
        })
        .join("");
    }

    _renderInpostHeader(groups) {
      if (!groups.length) return "";

      return groups
        .map(
          (group) => `
            <div class="summary-row">
              <span class="summary-icon">📦</span>
              <span>
                <b>InPost ${this._e(group.name)}</b> —
                <b>${group.items.length}</b> szt.
              </span>
            </div>
          `
        )
        .join("");
    }

    _renderInpostButtons(groups) {
      if (!groups.length) return "";

      const items = groups.flatMap((group) => group.items);
      const bg = this._tileColor(items);
      const fg = this._textColorForBackground(bg);

      return `
        <div
          class="carrier-grid inpost-grid"
          style="--parcel-columns:1;--status-columns:6;"
        >
          <button
            class="carrier-button parcel-group-button"
            data-group-type="inpost"
            data-group-name="all"
            type="button"
            style="--tile-bg:${this._e(bg)};--tile-fg:${this._e(fg)}"
          >
            <div class="carrier-title">
              <span class="carrier-name">InPost</span>
              <span class="carrier-count">- ${items.length} szt.</span>
            </div>
            <div class="carrier-statuses">
              ${this._renderStatusIcons(items)}
            </div>
          </button>
        </div>
      `;
    }


    _renderAccountHeader(carrier, groups, emoji = "🚚") {
      if (!groups.length) return "";

      return groups
        .map(
          (group) => `
            <div class="summary-row">
              <span class="summary-icon">${emoji}</span>
              <span>
                <b>${this._e(carrier)} ${this._e(group.name)}</b> —
                <b>${group.items.length}</b> szt.
              </span>
            </div>
          `
        )
        .join("");
    }

    _renderAllegroRow(activeCount) {
      if (activeCount <= 0) return "";
      return `
        <div class="summary-row">
          <span class="summary-icon">🛒</span>
          <span><b>Allegro</b> — <b>${activeCount}</b> aktywnych</span>
        </div>
      `;
    }

    _renderMailRow(count) {
      if (count <= 0) return "";
      return `
        <div class="summary-row">
          <span class="summary-icon summary-ha-icon">
            <ha-icon icon="mdi:mailbox-up-outline"></ha-icon>
          </span>
          <span><b>Listy w skrzynce:</b> <b>${count}</b> szt.</span>
        </div>
      `;
    }

    _renderCarrierButtons(groups) {
      if (!groups.length) return "";

      // 1 przewoźnik = cała szerokość i do 6 statusów w wierszu
      // 2 przewoźników = po 1/2 szerokości i do 4 statusów w wierszu
      // 3+ = maks. 3 kafelki w wierszu i do 3 statusów w wierszu
      const columns = groups.length === 1 ? 1 : groups.length === 2 ? 2 : 3;
      const statusColumns = groups.length === 1 ? 6 : groups.length === 2 ? 4 : 3;

      return `
        <div
          class="carrier-grid"
          style="--parcel-columns:${columns};--status-columns:${statusColumns};"
        >
          ${groups
            .map((group) => {
              const bg = this._tileColor(group.items);
              const fg = this._textColorForBackground(bg);

              return `
                <button
                  class="carrier-button parcel-group-button"
                  data-group-type="carrier"
                  data-group-name="${this._e(group.name)}"
                  type="button"
                  style="--tile-bg:${this._e(bg)};--tile-fg:${this._e(fg)}"
                >
                  <div class="carrier-title">
                    <span class="carrier-name">${this._e(group.name)}</span>
                    <span class="carrier-count">- ${group.items.length} szt.</span>
                  </div>
                  <div class="carrier-statuses">
                    ${this._renderStatusIcons(group.items)}
                  </div>
                </button>
              `;
            })
            .join("")}
        </div>
      `;
    }

    _renderModal(packages) {
      if (!this._selectedCarrier) return "";

      const [type, ...nameParts] = String(this._selectedCarrier).split(":");
      const name = nameParts.join(":");

      const title = name;
      const selectedPackages = packages.filter(
        (pkg) =>
          this._isStatusVisible(pkg.status) &&
          this._carrierForPackage(pkg) === name
      );
      return `
        <dialog
          class="parcel-dialog"
          id="parcel-dialog"
          aria-label="${this._e(title)}"
        >
          <section class="modal">
            <div class="modal-header">
              <div class="modal-title">${this._e(title)}</div>
              <button
                class="close-button"
                id="parcel-modal-close"
                type="button"
                aria-label="Zamknij"
              >
                <ha-icon icon="mdi:close"></ha-icon>
              </button>
            </div>

            <div class="modal-body">
              ${
                selectedPackages.length
                  ? selectedPackages.map((pkg) => this._renderPackage(pkg)).join("")
                  : `<div class="empty-popup">Brak przesyłek.</div>`
              }
            </div>
          </section>
        </dialog>
      `;
    }

    _renderPackage(pkg) {
      const trackingLinks = this._trackingLinksForPackage(pkg);
      const statusLabel = this._statusLabel(pkg.status);
      const statusIcon = this._statusIcon(pkg.status);

      const pickup = pkg.pickupCode
        ? `
          <div class="pickup-code">
            <span>Kod odbioru</span>
            <strong>${this._e(pkg.pickupCode)}</strong>
          </div>
        `
        : "";

      // Nie każdy przewoźnik zwraca osobne pole `qr_code`.
      // Allegro One / One Kurier często podaje tylko `pickup_code`,
      // więc jako fallback używamy kodu odbioru bez spacji.
      const qrPayload =
        pkg.qrCode ||
        (pkg.pickupCode
          ? String(pkg.pickupCode).replace(/\s+/g, "")
          : "");

      const qrSvg =
        this._config.show_pickup_qr &&
        pkg.status === "AVAILABLE_FOR_PICKUP" &&
        qrPayload
          ? makePickupQrSvg(qrPayload)
          : "";

      const pickupQr = qrSvg
        ? `
          <div class="pickup-qr">
            <div class="pickup-qr-label">Kod QR do odbioru</div>
            <div class="pickup-qr-canvas">
              ${qrSvg}
            </div>
          </div>
        `
        : "";

      const offers = pkg.offers.length
        ? `
          <div class="offers">
            ${pkg.offers
              .map((offer) => `<div class="offer">• ${this._e(offer)}</div>`)
              .join("")}
          </div>
        `
        : "";

      const tracking = trackingLinks.length
        ? `
          <div class="tracking-links">
            ${trackingLinks
              .map(
                (item) => `
                  <a
                    class="track-link"
                    href="${this._e(item.url)}"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    ${this._e(item.label)}
                    <ha-icon icon="mdi:open-in-new"></ha-icon>
                  </a>
                `
              )
              .join("")}
          </div>
        `
        : "";

      const packageSources = this._packageSources(pkg);

      const multiLockerBadge =
        pkg.multiLocker &&
        Number(pkg.multiLocker) > 1
          ? `
            <span class="multilocker-badge">
              Multiskrytka
              ${pkg.multiLockerGroup ? this._e(pkg.multiLockerGroup) : "?"}
              · paczka
              ${this._e(pkg.multiLockerIndex || "?")}/${this._e(pkg.multiLocker)}
            </span>
          `
          : "";

      const sourceStrip =
        packageSources.length || multiLockerBadge
          ? `
            <div class="source-strip">
              ${packageSources
                .map(
                  (source, index) => `
                    ${index > 0 ? `<span class="source-separator">|</span>` : ""}
                    <span class="source-label">${this._e(source)}</span>
                  `
                )
                .join("")}
              ${multiLockerBadge}
            </div>
          `
          : "";

      const assignmentLine =
        Array.isArray(pkg.assignments) && pkg.assignments.length
          ? `
            <div class="assignment-line">
              <ha-icon icon="mdi:account-outline"></ha-icon>
              <span>
                ${pkg.assignments
                  .map(
                    (item) =>
                      `${this._e(item.source)}: <b>${this._e(item.name)}</b>`
                  )
                  .join(" · ")}
              </span>
            </div>
          `
          : "";

      const mergedLine =
        Array.isArray(pkg.sources) &&
        pkg.sources.length > 1 &&
        pkg.mergedBy
          ? `
            <div class="merged-line">
              <ha-icon icon="mdi:link-variant"></ha-icon>
              <span>
                Scalono po:
                <b>${
                  pkg.mergedBy === "tracking_number"
                    ? "numerze przesyłki"
                    : pkg.mergedBy === "pickup_code"
                      ? "kodzie odbioru"
                      : "QR / kodzie odbioru"
                }</b>
              </span>
            </div>
          `
          : "";

      const lockerLine =
        pkg.locker || pkg.address
          ? `
            <div class="inpost-location">
              <ha-icon icon="mdi:map-marker-radius-outline"></ha-icon>
              <span>
                ${pkg.locker ? `<b>${this._e(pkg.locker)}</b>` : ""}
                ${pkg.locker && pkg.address ? " · " : ""}
                ${pkg.address ? this._e(pkg.address) : ""}
              </span>
            </div>
          `
          : "";

      const courierLine =
        pkg.courierName || pkg.courierPhone
          ? `
            <div class="courier-line">
              <ha-icon icon="mdi:account-hard-hat-outline"></ha-icon>
              <span>
                ${pkg.courierName ? `<b>${this._e(pkg.courierName)}</b>` : "Kurier"}
                ${
                  pkg.courierPhone
                    ? ` · <a href="tel:${this._e(pkg.courierPhone)}">${this._e(pkg.courierPhone)}</a>`
                    : ""
                }
              </span>
            </div>
          `
          : "";

      const mpsLine = pkg.mpsPart
        ? `
          <div class="mps-line">
            <ha-icon icon="mdi:package-variant-closed-plus"></ha-icon>
            <span>Część przesyłki: <b>${this._e(pkg.mpsPart)}</b></span>
          </div>
        `
        : "";

      const sharedLine = pkg.shared === true
        ? `
          <div class="shared-line">
            <ha-icon icon="mdi:share-variant-outline"></ha-icon>
            <span>Przesyłka udostępniona</span>
          </div>
        `
        : "";

      const trackingNumberLine = pkg.trackingNumber
        ? `
          <div class="tracking-number-line">
            <ha-icon icon="mdi:barcode-scan"></ha-icon>
            <span>Numer przesyłki: <b>${this._e(pkg.trackingNumber)}</b></span>
          </div>
        `
        : "";

      const senderAddressLine = pkg.senderAddress
        ? `
          <div class="sender-address-line">
            <ha-icon icon="mdi:office-building-marker-outline"></ha-icon>
            <span>
              Adres nadawcy:
              <b>${this._e(pkg.senderAddress)}</b>
            </span>
          </div>
        `
        : "";

      let updatedLine = "";

      if (pkg.updated) {
        try {
          const date = new Date(pkg.updated);

          if (!Number.isNaN(date.getTime())) {
            const formatted = new Intl.DateTimeFormat("pl-PL", {
              day: "2-digit",
              month: "2-digit",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit"
            }).format(date);

            updatedLine = `
              <div class="updated-line">
                <ha-icon icon="mdi:clock-check-outline"></ha-icon>
                <span>Aktualizacja: <b>${this._e(formatted)}</b></span>
              </div>
            `;
          }
        } catch (_) {}
      }

      let deliveryMapLine = "";

      if (pkg.deliveryGps) {
        const lat = Number(
          pkg.deliveryGps.lat ??
          pkg.deliveryGps.latitude
        );
        const lon = Number(
          pkg.deliveryGps.lon ??
          pkg.deliveryGps.lng ??
          pkg.deliveryGps.longitude
        );

        if (
          Number.isFinite(lat) &&
          Number.isFinite(lon) &&
          Math.abs(lat) <= 90 &&
          Math.abs(lon) <= 180
        ) {
          const mapUrl =
            `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lat},${lon}`)}`;

          deliveryMapLine = `
            <div class="delivery-map-line">
              <ha-icon icon="mdi:map-marker-outline"></ha-icon>
              <a
                href="${this._e(mapUrl)}"
                target="_blank"
                rel="noopener noreferrer"
              >
                Pokaż miejsce doręczenia na mapie
              </a>
            </div>
          `;
        }
      }

      let deadline = "";

      if (pkg.deadline) {
        try {
          const date = new Date(pkg.deadline);

          if (!Number.isNaN(date.getTime())) {
            const formatted = new Intl.DateTimeFormat("pl-PL", {
              day: "2-digit",
              month: "2-digit",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit"
            }).format(date);

            deadline = `
              <div class="inpost-deadline">
                <ha-icon icon="mdi:clock-outline"></ha-icon>
                <span>Odbierz do: <b>${this._e(formatted)}</b></span>
              </div>
            `;
          }
        } catch (_) {}
      }

      const inpostRawStatus =
        pkg.inpostStatus &&
        pkg.status === "IN_TRANSIT"
          ? `<div class="inpost-raw-status">InPost: ${this._e(pkg.inpostStatus)}</div>`
          : "";

      const externalRawStatus =
        pkg.externalStatus
          ? `<div class="inpost-raw-status">${this._e(this._carrierForPackage(pkg))}: ${this._e(pkg.externalStatus)}</div>`
          : "";

      const multiLockerLine = "";
      return `
        <article class="package">
          ${sourceStrip}
          <div class="seller">${this._e(pkg.seller)}</div>

          <div class="status-line">
            <ha-icon icon="${this._e(statusIcon)}"></ha-icon>
            <span>${this._e(statusLabel)}</span>
          </div>

          ${
            pkg.deliveryName
              ? `<div class="delivery-name">${this._e(pkg.deliveryName)}</div>`
              : ""
          }

          ${assignmentLine}
          ${mergedLine}
          ${inpostRawStatus}
          ${externalRawStatus}
          ${trackingNumberLine}
          ${senderAddressLine}
          ${updatedLine}
          ${lockerLine}
          ${deliveryMapLine}
          ${courierLine}
          ${mpsLine}
          ${sharedLine}
          ${multiLockerLine}
          ${deadline}
          ${pickup}
          ${pickupQr}
          ${offers}
          ${tracking}
        </article>
      `;
    }

    _render() {
      if (!this.shadowRoot) return;

      if (!this._hass) {
        this.shadowRoot.innerHTML =
          `<ha-card><div style="padding:16px">Ładowanie…</div></ha-card>`;
        return;
      }

      const rawAllegroPackages = this._packages();
      const rawInpostPackages = this._allInpostPackages();
      const rawDpdPackages = this._dpdPackages();
      const rawDhlPackages = this._dhlPackages();

      // Najpierw InPost + Allegro: poza numerem przesyłki umiemy tu użyć
      // także kodu odbioru i QR.
      const mergedInpost = this._mergeAllegroWithInpost(
        rawAllegroPackages,
        rawInpostPackages
      );

      const allegroPackages = mergedInpost.allegroPackages;
      const inpostPackages = mergedInpost.inpostPackages;

      // Nagłówki źródeł są liczone niezależnie od późniejszego scalania.
      const inpostGroups = this._inpostGroups(inpostPackages);
      const dpdGroups = this._accountGroups(
        rawDpdPackages,
        this._config.dpd_people
      );
      const dhlGroups = this._accountGroups(
        rawDhlPackages,
        this._config.dhl_people
      );

      const allegroActive = rawAllegroPackages.filter((pkg) =>
        this._isStatusVisible(pkg.status)
      ).length;

      // Następnie wspólne scalanie po: przewoźnik + numer przesyłki.
      // Pozwala to połączyć Allegro + DPD i Allegro + DHL.
      const displayPackages = this._mergeByTracking([
        ...inpostPackages,
        ...allegroPackages,
        ...rawDpdPackages,
        ...rawDhlPackages
      ]).filter((pkg) => this._isStatusVisible(pkg.status));

      const groups = this._groupCarriers(displayPackages);
      const mailCount = this._mailCount();

      const any =
        displayPackages.length > 0 ||
        mailCount > 0;

      this.shadowRoot.innerHTML = `
        <style>
          :host {
            display:block;
          }

          ha-card {
            overflow:visible;
          }

          .card {
            padding:14px;
          }

          .summary {
            display:flex;
            flex-direction:column;
            gap:6px;
          }

          /* Wszystkie kafelki przewoźników są teraz w jednej wspólnej siatce. */

          .summary-row {
            display:flex;
            align-items:center;
            gap:6px;
            min-height:22px;
            font-size:14px;
            line-height:1.35;
          }

          .summary-icon {
            width:18px;
            flex:0 0 18px;
            text-align:center;
            font-size:14px;
          }

          .summary-ha-icon {
            display:inline-flex;
            align-items:center;
            justify-content:center;
          }

          .summary-ha-icon ha-icon {
            --mdc-icon-size:16px;
            color:var(--primary-text-color);
            opacity:.72;
          }

          .empty {
            display:flex;
            gap:7px;
            align-items:center;
            opacity:.7;
            font-size:14px;
          }

          .carrier-grid {
            display:grid;
            grid-template-columns:repeat(var(--parcel-columns), minmax(0,1fr));
            gap:8px;
            margin-top:10px;
          }

          .carrier-button {
            appearance:none;
            border:1px solid color-mix(
              in srgb,
              var(--tile-bg) 74%,
              var(--divider-color)
            );
            background:var(--tile-bg);
            color:var(--tile-fg);
            border-radius:10px;
            padding:7px 6px;
            min-height:52px;
            cursor:pointer;
            font:inherit;
            text-align:center;
            overflow:hidden;

            /* Celowo bez zmiany tła na hover:
               eliminuje wrażenie mrugania. */
            transition:box-shadow .10s ease, transform .06s ease;
          }

          .carrier-button:hover {
            box-shadow:0 1px 4px rgba(0,0,0,.14);
          }

          .carrier-button:active {
            transform:scale(.985);
          }

          .carrier-title {
            display:flex;
            flex-wrap:wrap;
            justify-content:center;
            align-items:baseline;
            gap:0 4px;
            font-size:11px;
            line-height:1.15;
            font-weight:600;
            white-space:normal;
            overflow-wrap:anywhere;
          }

          .carrier-name {
            min-width:0;
          }

          .carrier-count {
            white-space:nowrap;
            opacity:.78;
            font-weight:500;
          }

          .carrier-statuses {
            display:grid;
            grid-template-columns:repeat(var(--status-columns), max-content);
            justify-content:center;
            align-items:center;
            gap:4px 8px;
            margin-top:5px;
            min-height:14px;
            opacity:.72;
          }

          .status-mini {
            display:inline-flex;
            align-items:center;
            justify-content:center;
            gap:2px;
            font-size:10px;
            line-height:1;
          }

          .status-mini ha-icon {
            --mdc-icon-size:13px;
          }

          .parcel-dialog {
            position:fixed;
            top:0;
            right:0;
            bottom:0;
            left:auto;
            width:min(560px, 94vw);
            max-width:none;
            height:100dvh;
            max-height:none;
            margin:0;
            padding:0;
            border:0;
            border-radius:0;
            overflow:hidden;
            background:transparent;
            color:var(--primary-text-color);
          }

          .parcel-dialog::backdrop {
            background:rgba(0,0,0,.42);
          }

          .modal {
            width:100%;
            height:100%;
            background:var(--ha-card-background, var(--card-background-color, #fff));
            color:var(--primary-text-color);
            box-shadow:-8px 0 28px rgba(0,0,0,.22);
            display:flex;
            flex-direction:column;
          }

          .modal-header {
            display:flex;
            align-items:center;
            gap:10px;
            padding:14px 16px;
            border-bottom:1px solid var(--divider-color);
          }

          .modal-title {
            flex:1;
            font-weight:700;
            font-size:18px;
          }

          .close-button {
            width:38px;
            height:38px;
            border:0;
            border-radius:50%;
            background:transparent;
            color:var(--primary-text-color);
            cursor:pointer;
            display:grid;
            place-items:center;
          }

          .close-button:hover {
            background:var(--secondary-background-color);
          }

          .modal-body {
            overflow:auto;
            padding:0 16px 24px;
          }

          .package {
            padding:15px 0;
            border-bottom:1px solid var(--divider-color);
          }

          .seller {
            font-size:15px;
            font-weight:700;
            overflow-wrap:anywhere;
          }

          .status-line {
            display:flex;
            align-items:center;
            gap:5px;
            margin-top:4px;
            font-size:12px;
            opacity:.72;
          }

          .status-line ha-icon {
            --mdc-icon-size:15px;
          }

          .delivery-name {
            font-size:11px;
            opacity:.55;
            margin-top:2px;
            overflow-wrap:anywhere;
          }

          .source-strip {
            display:flex;
            flex-wrap:wrap;
            align-items:center;
            gap:5px;
            margin-bottom:7px;
            font-size:10px;
            font-weight:600;
          }

          .source-label {
            display:inline-flex;
            align-items:center;
            padding:3px 7px;
            border-radius:999px;
            background:var(--secondary-background-color);
            opacity:.82;
          }

          .multilocker-badge {
            display:inline-flex;
            align-items:center;
            padding:3px 7px;
            border-radius:999px;
            background:color-mix(
              in srgb,
              var(--primary-color) 12%,
              var(--secondary-background-color)
            );
            font-weight:700;
            opacity:.9;
          }

          .source-separator {
            opacity:.38;
            font-weight:400;
          }

          .inpost-location,
          .inpost-deadline,
          .tracking-number-line,
          .assignment-line,
          .merged-line,
          .sender-address-line,
          .updated-line,
          .delivery-map-line,
          .courier-line,
          .mps-line,
          .shared-line {
            display:flex;
            align-items:flex-start;
            gap:6px;
            margin-top:8px;
            font-size:12px;
            line-height:1.35;
          }

          .inpost-location ha-icon,
          .inpost-deadline ha-icon,
          .tracking-number-line ha-icon,
          .assignment-line ha-icon,
          .merged-line ha-icon,
          .sender-address-line ha-icon,
          .updated-line ha-icon,
          .delivery-map-line ha-icon,
          .courier-line ha-icon,
          .mps-line ha-icon,
          .shared-line ha-icon {
            --mdc-icon-size:16px;
            flex:0 0 16px;
            opacity:.7;
          }

          .inpost-raw-status {
            margin-top:4px;
            font-size:11px;
            opacity:.55;
          }

          .courier-line a,
          .delivery-map-line a {
            color:var(--primary-color);
            text-decoration:none;
            font-weight:600;
          }

          .offers {
            margin-top:9px;
            font-size:13px;
            line-height:1.4;
          }

          .offer {
            margin:2px 0;
            white-space:normal;
            overflow-wrap:anywhere;
            word-break:normal;
          }

          .pickup-code {
            display:inline-flex;
            align-items:baseline;
            gap:8px;
            margin-top:10px;
            padding:7px 10px;
            border-radius:8px;
            background:var(--secondary-background-color);
          }

          .pickup-code span {
            font-size:11px;
            opacity:.65;
          }

          .pickup-code strong {
            font-size:17px;
            letter-spacing:.5px;
          }

          .pickup-qr {
            margin-top:12px;
            display:flex;
            flex-direction:column;
            align-items:flex-start;
            gap:6px;
          }

          .pickup-qr-label {
            font-size:11px;
            opacity:.65;
          }

          .pickup-qr-canvas {
            display:flex;
            align-items:center;
            justify-content:center;
            width:210px;
            min-height:210px;
            padding:10px;
            box-sizing:border-box;
            border-radius:10px;
            background:#fff;
            border:1px solid rgba(0,0,0,.08);
          }

          .pickup-qr-svg {
            display:block;
            width:190px;
            height:190px;
            max-width:100%;
          }

          .tracking-links {
            display:flex;
            flex-wrap:wrap;
            gap:8px 12px;
            margin-top:10px;
          }

          .track-link {
            display:inline-flex;
            align-items:center;
            gap:4px;
            margin-top:0;
            font-size:13px;
            font-weight:600;
            color:var(--primary-color);
            text-decoration:none;
          }

          .track-link ha-icon {
            --mdc-icon-size:15px;
          }

          .empty-popup {
            padding:18px 0;
            opacity:.6;
          }

          @media (max-width:420px) {
            .card {
              padding:12px;
            }

            .carrier-grid {
              gap:6px;
            }

            .carrier-button {
              padding:6px 4px;
            }

            .carrier-title {
              font-size:10.5px;
            }

            .parcel-dialog {
              width:100vw;
            }
          }
        </style>

        <ha-card>
          <div class="card">
            <div class="summary">
              ${this._renderMailRow(mailCount)}
              ${this._renderInpostHeader(inpostGroups)}
              ${this._renderAccountHeader("DPD", dpdGroups, "🚚")}
              ${this._renderAccountHeader("DHL", dhlGroups, "🚚")}
              ${this._renderAllegroRow(allegroActive)}

              ${
                !any && this._config.show_empty_message
                  ? `<div class="empty">✅ <span>${this._e(this._config.empty_message)}</span></div>`
                  : ""
              }
            </div>

            ${groups.length > 0 ? this._renderCarrierButtons(groups) : ""}
          </div>
        </ha-card>

        ${this._renderModal(displayPackages)}
      `;

      this._lastSignature = this._stateSignature();

      this.shadowRoot
        .querySelectorAll(".parcel-group-button")
        .forEach((button) => {
          button.addEventListener("click", () => {
            const type = button.dataset.groupType || "carrier";
            const name = button.dataset.groupName || "";
            this._selectedCarrier = `${type}:${name}`;
            this._render();
          });
        });

      const dialog = this.shadowRoot.getElementById("parcel-dialog");
      const close = this.shadowRoot.getElementById("parcel-modal-close");

      if (dialog) {
        if (!dialog.open) {
          try {
            dialog.showModal();
          } catch (_) {
            dialog.setAttribute("open", "");
          }
        }

        dialog.addEventListener("cancel", (event) => {
          event.preventDefault();
          dialog.close();
        });

        dialog.addEventListener("close", () => {
          this._selectedCarrier = null;
          this._lastSignature = null;

          // Po przejściu na inny widok karta może być już odłączona.
          // Nie próbujemy wtedy odbudowywać jej DOM.
          if (this.isConnected) {
            this._render();
          }
        });
      }

      if (close && dialog) {
        close.addEventListener("click", () => dialog.close());
      }
    }
  }

  class ParcelCardEditor extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: "open" });
      this._hass = null;
      this._config = normalizeConfig({});
      this._rendered = false;
    }

    set hass(hass) {
      this._hass = hass;

      // Nie przebudowujemy całego edytora przy każdym update HA.
      // To usuwa migotanie entity-pickerów i pól podczas najechania.
      if (!this._rendered) {
        this._render();
      } else {
        this._refreshPickerHass();
      }
    }

    setConfig(config) {
      this._config = normalizeConfig(config || {});

      // Przy pierwszym otwarciu renderujemy normalnie.
      if (this._hass && !this._rendered) {
        this._render();
        return;
      }

      // HA potrafi ponownie podać zapisany config do już istniejącego
      // edytora. W v1.2.0 lokalny _config był poprawny, ale checkboxy
      // pozostawały w starym stanie. Synchronizujemy więc kontrolki
      // bez przebudowy całego edytora (brak migotania).
      if (this._hass && this._rendered) {
        this._syncControlsFromConfig();
      }
    }

    _fireConfigChanged() {
      const clean = {
        type: "custom:parcel-card",
        inpost_people: deepClone(this._config.inpost_people),
        dpd_people: deepClone(this._config.dpd_people),
        dhl_people: deepClone(this._config.dhl_people),
        allegro_progress_entity: this._config.allegro_progress_entity,
        columns: this._config.columns,
        show_empty_message: this._config.show_empty_message,
        empty_message: this._config.empty_message,
        pickup_color: this._config.pickup_color,
        transit_color: this._config.transit_color,
        other_color: this._config.other_color,
        show_pickup_qr: this._config.show_pickup_qr,
        mail_entities: [...this._config.mail_entities],
        visible_statuses: this._config.visible_statuses
      };

      this.dispatchEvent(
        new CustomEvent("config-changed", {
          detail: { config: clean },
          bubbles: true,
          composed: true
        })
      );
    }
    _update(key, value) {
      this._config = { ...this._config, [key]: value };
      this._fireConfigChanged();
    }

    _updatePerson(index, key, value) {
      const people = deepClone(this._config.inpost_people);
      if (!people[index]) return;
      people[index][key] = value;
      this._config = { ...this._config, inpost_people: people };
      this._fireConfigChanged();
    }

    _addPerson() {
      const people = deepClone(this._config.inpost_people);
      people.push({
        name: `Osoba ${people.length + 1}`,
        source_entity: ""
      });
      this._config = { ...this._config, inpost_people: people };
      this._fireConfigChanged();
      this._render();
    }

    _removePerson(index) {
      const people = deepClone(this._config.inpost_people);
      people.splice(index, 1);
      this._config = { ...this._config, inpost_people: people };
      this._fireConfigChanged();
      this._render();
    }

    _updateSourcePerson(kind, index, key, value) {
      const configKey = `${kind}_people`;
      const people = deepClone(this._config[configKey] || []);
      if (!people[index]) return;

      people[index][key] = value;
      this._config = { ...this._config, [configKey]: people };
      this._fireConfigChanged();
    }

    _addSourcePerson(kind) {
      const configKey = `${kind}_people`;
      const people = deepClone(this._config[configKey] || []);

      people.push({
        name: `Osoba ${people.length + 1}`,
        source_entity: ""
      });

      this._config = { ...this._config, [configKey]: people };
      this._fireConfigChanged();
      this._render();
    }

    _removeSourcePerson(kind, index) {
      const configKey = `${kind}_people`;
      const people = deepClone(this._config[configKey] || []);
      people.splice(index, 1);

      this._config = { ...this._config, [configKey]: people };
      this._fireConfigChanged();
      this._render();
    }

    _addMailEntity() {
      this._config = {
        ...this._config,
        mail_entities: [...this._config.mail_entities, ""]
      };
      this._fireConfigChanged();
      this._render();
    }

    _removeMailEntity(index) {
      const items = [...this._config.mail_entities];
      items.splice(index, 1);
      this._config = { ...this._config, mail_entities: items };
      this._fireConfigChanged();
      this._render();
    }

    _updateMailEntity(index, value) {
      const items = [...this._config.mail_entities];
      items[index] = value || "";
      this._config = { ...this._config, mail_entities: items };
      this._fireConfigChanged();
    }

    _details() {
      return (
        this._hass?.states?.[this._config.allegro_progress_entity]
          ?.attributes?.details || []
      );
    }

    _knownAndDiscoveredStatuses() {
      const found = new Set(STATUS_ORDER);

      // Zachowaj również statusy zapisane wcześniej w konfiguracji,
      // nawet jeśli w tej chwili nie występują w aktywnych zamówieniach.
      if (Array.isArray(this._config.visible_statuses)) {
        for (const status of this._config.visible_statuses) {
          if (status) found.add(String(status));
        }
      }

      for (const item of this._details()) {
        const status = String(item?.Status ?? item?.status ?? "").trim();
        if (status) found.add(status);
      }

      return [...found].sort((a, b) => {
        const ai = STATUS_ORDER.indexOf(a);
        const bi = STATUS_ORDER.indexOf(b);
        if (ai !== -1 || bi !== -1) {
          return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
        }
        return a.localeCompare(b);
      });
    }

    _isStatusVisible(status) {
      if (Array.isArray(this._config.visible_statuses)) {
        return this._config.visible_statuses.includes(status);
      }
      return !DEFAULT_HIDDEN_STATUSES.has(status);
    }

    _toggleStatus(status, checked) {
      const statuses = this._knownAndDiscoveredStatuses();
      let visible;

      if (Array.isArray(this._config.visible_statuses)) {
        visible = new Set(this._config.visible_statuses);
      } else {
        visible = new Set(statuses.filter((s) => !DEFAULT_HIDDEN_STATUSES.has(s)));
      }

      if (checked) visible.add(status);
      else visible.delete(status);

      this._config = {
        ...this._config,
        visible_statuses: [...visible]
      };
      this._fireConfigChanged();
    }

    _resetStatuses() {
      this._config = { ...this._config, visible_statuses: null };
      this._fireConfigChanged();
      this._render();
    }

    _refreshPickerHass() {
      if (!this._hass) return;
      this.shadowRoot
        .querySelectorAll("ha-entity-picker")
        .forEach((picker) => (picker.hass = this._hass));
    }

    _syncControlsFromConfig() {
      if (!this._hass || !this._rendered) return;

      // Jeżeli zmieniła się liczba osób albo zestaw statusów widocznych
      // w edytorze, potrzebny jest jednorazowy pełny render.
      const personCards = this.shadowRoot.querySelectorAll(".inpost-person-card");
      const dpdPersonCards = this.shadowRoot.querySelectorAll(".dpd-person-card");
      const dhlPersonCards = this.shadowRoot.querySelectorAll(".dhl-person-card");
      const expectedStatuses = this._knownAndDiscoveredStatuses();
      const statusInputs = [
        ...this.shadowRoot.querySelectorAll("[data-status]")
      ];
      const renderedStatuses = statusInputs.map((x) => x.dataset.status);

      const sameStatusSet =
        expectedStatuses.length === renderedStatuses.length &&
        expectedStatuses.every((status) => renderedStatuses.includes(status));

      const mailPickers = this.shadowRoot.querySelectorAll(
        "[data-mail-entity]"
      );

      if (
        personCards.length !== this._config.inpost_people.length ||
        dpdPersonCards.length !== this._config.dpd_people.length ||
        dhlPersonCards.length !== this._config.dhl_people.length ||
        mailPickers.length !== this._config.mail_entities.length ||
        !sameStatusSet
      ) {
        this._render();
        return;
      }

      // Allegro entity picker
      const allegro = this.shadowRoot.getElementById("allegro-progress");
      if (allegro) {
        allegro.hass = this._hass;
        allegro.value = this._config.allegro_progress_entity || "";
      }

      // InPost people
      this._config.inpost_people.forEach((person, index) => {
        const name = this.shadowRoot.querySelector(
          `[data-person-name="${index}"]`
        );
        const source = this.shadowRoot.querySelector(
          `[data-person-source="${index}"]`
        );

        if (name && document.activeElement !== name) {
          name.value = person.name || "";
        }

        if (source) {
          source.hass = this._hass;
          source.value = person.source_entity || "";
        }
      });

      for (const kind of ["dpd", "dhl"]) {
        const people = this._config[`${kind}_people`] || [];

        people.forEach((person, index) => {
          const name = this.shadowRoot.querySelector(
            `[data-${kind}-person-name="${index}"]`
          );
          const source = this.shadowRoot.querySelector(
            `[data-${kind}-person-source="${index}"]`
          );

          if (name && document.activeElement !== name) {
            name.value = person.name || "";
          }

          if (source) {
            source.hass = this._hass;
            source.value = person.source_entity || "";
          }
        });
      }

      this._config.mail_entities.forEach((entityId, index) => {
        const picker = this.shadowRoot.querySelector(
          `[data-mail-entity="${index}"]`
        );
        if (picker) {
          picker.hass = this._hass;
          picker.value = entityId || "";
        }
      });

      // Statusy — to jest właściwa poprawka błędu v1.2.0.
      statusInputs.forEach((checkbox) => {
        checkbox.checked = this._isStatusVisible(checkbox.dataset.status);
      });

      // Kolory / wygląd
      const pickupColor = this.shadowRoot.getElementById("pickup-color");
      const transitColor = this.shadowRoot.getElementById("transit-color");
      const otherColor = this.shadowRoot.getElementById("other-color");
      const columns = this.shadowRoot.getElementById("columns");
      const emptyMessage = this.shadowRoot.getElementById("empty-message");
      const showEmpty = this.shadowRoot.getElementById("show-empty");
      const showPickupQr = this.shadowRoot.getElementById("show-pickup-qr");

      if (pickupColor) pickupColor.value = this._config.pickup_color;
      if (transitColor) transitColor.value = this._config.transit_color;
      if (otherColor) otherColor.value = this._config.other_color;

      if (columns && document.activeElement !== columns) {
        columns.value = this._config.columns;
      }

      if (emptyMessage && document.activeElement !== emptyMessage) {
        emptyMessage.value = this._config.empty_message || "Brak przesyłek";
      }

      if (showEmpty) {
        showEmpty.checked = this._config.show_empty_message !== false;
      }

      if (showPickupQr) {
        showPickupQr.checked = this._config.show_pickup_qr !== false;
      }
    }

    _personHtml(person, index) {
      return `
        <div class="person-card inpost-person-card">
          <div class="person-head">
            <b>Osoba ${index + 1}</b>
            <button
              class="icon-btn danger"
              data-remove-person="${index}"
              type="button"
              title="Usuń"
            >
              <ha-icon icon="mdi:delete-outline"></ha-icon>
            </button>
          </div>

          <div class="field">
            <div class="field-label">Nazwa</div>
            <input
              type="text"
              data-person-name="${index}"
              value="${this._e(person.name)}"
              placeholder="np. Osoba 1"
            >
          </div>

          <div class="field">
            <div class="field-label">Encja InPost (źródło danych)</div>
            <ha-entity-picker
              data-person-source="${index}"
            ></ha-entity-picker>
          </div>

          <div class="help person-help">
            Wybierz encję, która w atrybutach zawiera jednocześnie
            <code>do_odbioru</code> i <code>w_drodze</code>.
            W tej integracji jest to zwykle encja kończąca się
            na <code>_do_odbioru</code>.
          </div>
        </div>
      `;
    }

    _sourcePersonHtml(kind, label, person, index) {
      const lower = String(kind).toLowerCase();

      return `
        <div class="person-card ${lower}-person-card">
          <div class="person-head">
            <b>Osoba ${index + 1}</b>
            <button
              class="icon-btn danger"
              data-remove-${lower}-person="${index}"
              type="button"
              title="Usuń"
            >
              <ha-icon icon="mdi:delete-outline"></ha-icon>
            </button>
          </div>

          <div class="field">
            <div class="field-label">Nazwa</div>
            <input
              type="text"
              data-${lower}-person-name="${index}"
              value="${this._e(person.name)}"
              placeholder="np. Osoba 2"
            >
          </div>

          <div class="field">
            <div class="field-label">Encja ${this._e(label)} — W drodze</div>
            <ha-entity-picker
              data-${lower}-person-source="${index}"
            ></ha-entity-picker>
          </div>

          <div class="help person-help">
            Encja powinna zawierać w atrybutach
            <code>w_drodze[]</code> oraz <code>active_count</code>.
          </div>
        </div>
      `;
    }

    _statusHtml() {
      const statuses = this._knownAndDiscoveredStatuses();

      return statuses
        .map((status) => {
          const meta = STATUS_META[status];
          const label = meta?.label || humanizeStatus(status);
          const checked = this._isStatusVisible(status);

          return `
            <label class="status-check">
              <input
                type="checkbox"
                data-status="${this._e(status)}"
                ${checked ? "checked" : ""}
              >
              <ha-icon icon="${this._e(meta?.icon || "mdi:package-variant")}"></ha-icon>
              <span>
                <b>${this._e(label)}</b>
                <small>${this._e(status)}</small>
              </span>
            </label>
          `;
        })
        .join("");
    }

    _e(value) {
      return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
    }

    _render() {
      if (!this.shadowRoot || !this._hass) return;

      this._rendered = true;

      this.shadowRoot.innerHTML = `
        <style>
          .editor {
            display:flex;
            flex-direction:column;
            gap:18px;
            padding:4px 0 12px;
          }

          .section {
            border-top:1px solid var(--divider-color);
            padding-top:14px;
          }

          .section:first-child {
            border-top:0;
            padding-top:0;
          }

          .section-title-row {
            display:flex;
            align-items:center;
            justify-content:space-between;
            gap:10px;
            margin-bottom:10px;
          }

          .section-title {
            font-weight:700;
          }

          .help {
            font-size:12px;
            opacity:.65;
            line-height:1.35;
            margin:-3px 0 10px;
          }

          .person-help {
            margin:4px 0 0;
          }

          .person-help code {
            font-family:monospace;
            font-size:11px;
          }

          .person-list {
            display:flex;
            flex-direction:column;
            gap:10px;
          }

          .person-card {
            border:1px solid var(--divider-color);
            border-radius:10px;
            padding:10px;
            background:var(--card-background-color);
          }

          .person-head {
            display:flex;
            justify-content:space-between;
            align-items:center;
            gap:8px;
          }

          .field {
            margin:10px 0;
          }

          .field.compact {
            max-width:240px;
          }

          .field-label {
            font-size:12px;
            opacity:.72;
            margin-bottom:5px;
          }

          .inline {
            display:grid;
            grid-template-columns:repeat(3, minmax(0,1fr));
            gap:10px;
          }

          input[type="number"],
          input[type="text"] {
            width:100%;
            box-sizing:border-box;
            border:1px solid var(--divider-color);
            border-radius:8px;
            padding:10px;
            background:var(--card-background-color);
            color:var(--primary-text-color);
            font:inherit;
          }

          .button {
            border:1px solid var(--divider-color);
            background:var(--secondary-background-color);
            color:var(--primary-text-color);
            border-radius:8px;
            padding:8px 11px;
            cursor:pointer;
            font:inherit;
          }

          .icon-btn {
            width:34px;
            height:34px;
            display:grid;
            place-items:center;
            border:0;
            border-radius:50%;
            background:transparent;
            color:var(--primary-text-color);
            cursor:pointer;
          }

          .icon-btn:hover {
            background:var(--secondary-background-color);
          }

          .danger {
            color:var(--error-color, #db4437);
          }

          .colors {
            display:grid;
            grid-template-columns:repeat(3, minmax(0,1fr));
            gap:10px;
          }

          .color-field {
            border:1px solid var(--divider-color);
            border-radius:10px;
            padding:9px;
          }

          .color-field label {
            display:block;
            font-size:12px;
            margin-bottom:7px;
          }

          .color-field input[type="color"] {
            width:100%;
            height:38px;
            border:0;
            padding:0;
            background:transparent;
            cursor:pointer;
          }

          .status-grid {
            display:grid;
            grid-template-columns:repeat(2, minmax(0,1fr));
            gap:7px;
          }

          .status-check {
            display:flex;
            align-items:center;
            gap:7px;
            border:1px solid var(--divider-color);
            border-radius:9px;
            padding:7px;
            cursor:pointer;
            min-width:0;
          }

          .status-check ha-icon {
            --mdc-icon-size:17px;
            opacity:.72;
          }

          .status-check span {
            display:flex;
            flex-direction:column;
            min-width:0;
          }

          .status-check b {
            font-size:12px;
            line-height:1.2;
          }

          .status-check small {
            font-size:9px;
            opacity:.5;
            overflow-wrap:anywhere;
          }

          label.check {
            display:flex;
            align-items:center;
            gap:8px;
            margin-top:8px;
          }

          @media (max-width:520px) {
            .inline,
            .colors {
              grid-template-columns:1fr;
            }

            .status-grid {
              grid-template-columns:1fr;
            }
          }
        </style>

        <div class="editor">
          <section class="section">
            <div class="section-title-row">
              <div class="section-title">InPost – osoby</div>
              <button class="button" id="add-person" type="button">
                + Dodaj osobę
              </button>
            </div>

            <div class="help">
              Możesz dodać dowolną liczbę osób. Wiersz osoby pojawia się na karcie
              tylko wtedy, gdy ma paczkę do odbioru lub w drodze.
            </div>

            <div class="person-list">
              ${this._config.inpost_people
                .map((p, i) => this._personHtml(p, i))
                .join("")}
            </div>
          </section>

          <section class="section">
            <div class="section-title-row">
              <div class="section-title">DPD – osoby</div>
              <button class="button" id="add-dpd-person" type="button">
                + Dodaj osobę
              </button>
            </div>

            <div class="help">
              Dodaj konta DPD z integracji Shipment Tracking. Każda osoba może
              mieć własną encję „W drodze”.
            </div>

            <div class="person-list">
              ${
                this._config.dpd_people.length
                  ? this._config.dpd_people
                      .map((p, i) => this._sourcePersonHtml("dpd", "DPD", p, i))
                      .join("")
                  : `<div class="help">Nie dodano kont DPD.</div>`
              }
            </div>
          </section>

          <section class="section">
            <div class="section-title-row">
              <div class="section-title">DHL – osoby</div>
              <button class="button" id="add-dhl-person" type="button">
                + Dodaj osobę
              </button>
            </div>

            <div class="help">
              Dodaj konta DHL z integracji Shipment Tracking. Każda osoba może
              mieć własną encję „W drodze”.
            </div>

            <div class="person-list">
              ${
                this._config.dhl_people.length
                  ? this._config.dhl_people
                      .map((p, i) => this._sourcePersonHtml("dhl", "DHL", p, i))
                      .join("")
                  : `<div class="help">Nie dodano kont DHL.</div>`
              }
            </div>
          </section>

          <section class="section">
            <div class="section-title-row">
              <div class="section-title">Listy w skrzynce</div>
              <button class="button" id="add-mail-entity" type="button">
                + Dodaj encję
              </button>
            </div>

            <div class="help">
              Możesz wskazać jedną lub kilka encji z liczbą listów.
              Ich wartości są sumowane. Wiersz jest ukryty, gdy suma wynosi 0.
            </div>

            <div class="person-list">
              ${
                this._config.mail_entities.length
                  ? this._config.mail_entities
                      .map(
                        (entityId, index) => `
                          <div class="person-card">
                            <div class="person-head">
                              <b>Encja ${index + 1}</b>
                              <button
                                class="icon-btn danger"
                                data-remove-mail="${index}"
                                type="button"
                                title="Usuń"
                              >
                                <ha-icon icon="mdi:delete-outline"></ha-icon>
                              </button>
                            </div>

                            <div class="field">
                              <div class="field-label">Liczba listów</div>
                              <ha-entity-picker
                                data-mail-entity="${index}"
                              ></ha-entity-picker>
                            </div>
                          </div>
                        `
                      )
                      .join("")
                  : `<div class="help">Nie dodano żadnej encji.</div>`
              }
            </div>
          </section>

          <section class="section">
            <div class="section-title">Allegro</div>

            <div class="field">
              <div class="field-label">Sensor aktywnych zamówień / W realizacji</div>
              <ha-entity-picker id="allegro-progress"></ha-entity-picker>
            </div>
          </section>

          <section class="section">
            <div class="section-title-row">
              <div class="section-title">Statusy widoczne w kafelkach</div>
              <button class="button" id="reset-statuses" type="button">
                Domyślne
              </button>
            </div>

            <div class="help">
              Lista zawiera statusy znane karcie oraz statusy aktualnie znalezione
              w encji Allegro. Nowy nieznany status zostanie wykryty automatycznie.
              Zwroty, anulowane i dostarczone są domyślnie wyłączone.
            </div>

            <div class="status-grid">
              ${this._statusHtml()}
            </div>
          </section>

          <section class="section">
            <div class="section-title">Kolory kafelków</div>

            <div class="help">
              Priorytet: 1 — do odbioru, 2 — w drodze / w dostawie,
              3 — pozostałe statusy.
            </div>

            <div class="colors">
              <div class="color-field">
                <label>1. Do odbioru</label>
                <input id="pickup-color" type="color" value="${this._e(this._config.pickup_color)}">
              </div>

              <div class="color-field">
                <label>2. W drodze</label>
                <input id="transit-color" type="color" value="${this._e(this._config.transit_color)}">
              </div>

              <div class="color-field">
                <label>3. Pozostałe</label>
                <input id="other-color" type="color" value="${this._e(this._config.other_color)}">
              </div>
            </div>
          </section>

          <section class="section">
            <div class="section-title">Wygląd</div>

            <div class="inline">
              <div class="field">
                <div class="field-label">Kolumny przewoźników</div>
                <input
                  id="columns"
                  type="number"
                  min="1"
                  max="6"
                  step="1"
                  value="${asNumber(this._config.columns, 3)}"
                >
              </div>

              <div class="field">
                <div class="field-label">Tekst przy braku paczek</div>
                <input
                  id="empty-message"
                  type="text"
                  value="${this._e(this._config.empty_message)}"
                >
              </div>
            </div>

            <label class="check">
              <input
                id="show-empty"
                type="checkbox"
                ${this._config.show_empty_message !== false ? "checked" : ""}
              >
              Pokaż komunikat, gdy nie ma żadnych przesyłek
            </label>

            <label class="check">
              <input
                id="show-pickup-qr"
                type="checkbox"
                ${this._config.show_pickup_qr !== false ? "checked" : ""}
              >
              Pokaż kod QR dla paczek do odbioru
            </label>
          </section>

          <div style="opacity:.45;font-size:11px">
            parcel-card v${CARD_VERSION}
          </div>
        </div>
      `;

      this._bind();
    }

    _bind() {
      const allegro = this.shadowRoot.getElementById("allegro-progress");
      if (allegro) {
        allegro.hass = this._hass;
        allegro.value = this._config.allegro_progress_entity || "";
        allegro.includeDomains = ["sensor"];
        allegro.allowCustomEntity = true;
        allegro.addEventListener("value-changed", (event) => {
          this._update(
            "allegro_progress_entity",
            event.detail?.value || ""
          );
        });
      }

      this._config.inpost_people.forEach((person, index) => {
        const source = this.shadowRoot.querySelector(
          `[data-person-source="${index}"]`
        );

        if (!source) return;

        source.hass = this._hass;
        source.value = person.source_entity || "";
        source.includeDomains = ["sensor"];
        source.allowCustomEntity = true;

        source.addEventListener("value-changed", (event) => {
          this._updatePerson(
            index,
            "source_entity",
            event.detail?.value || ""
          );
        });
      });

      this.shadowRoot
        .querySelectorAll("[data-person-name]")
        .forEach((input) => {
          const index = Number(input.dataset.personName);
          input.addEventListener("change", () => {
            this._updatePerson(index, "name", input.value.trim() || `Osoba ${index + 1}`);
          });
        });


      this.shadowRoot
        .querySelectorAll("[data-remove-person]")
        .forEach((button) => {
          button.addEventListener("click", () => {
            this._removePerson(Number(button.dataset.removePerson));
          });
        });

      this.shadowRoot.getElementById("add-person")?.addEventListener("click", () => {
        this._addPerson();
      });

      for (const kind of ["dpd", "dhl"]) {
        const people = this._config[`${kind}_people`] || [];

        people.forEach((person, index) => {
          const source = this.shadowRoot.querySelector(
            `[data-${kind}-person-source="${index}"]`
          );

          if (source) {
            source.hass = this._hass;
            source.value = person.source_entity || "";
            source.includeDomains = ["sensor"];
            source.allowCustomEntity = true;

            source.addEventListener("value-changed", (event) => {
              this._updateSourcePerson(
                kind,
                index,
                "source_entity",
                event.detail?.value || ""
              );
            });
          }
        });

        this.shadowRoot
          .querySelectorAll(`[data-${kind}-person-name]`)
          .forEach((input) => {
            const index = Number(input.dataset[`${kind}PersonName`]);

            input.addEventListener("change", () => {
              this._updateSourcePerson(
                kind,
                index,
                "name",
                input.value.trim() || `Osoba ${index + 1}`
              );
            });
          });

        this.shadowRoot
          .querySelectorAll(`[data-remove-${kind}-person]`)
          .forEach((button) => {
            button.addEventListener("click", () => {
              const datasetKey =
                `remove${kind[0].toUpperCase()}${kind.slice(1)}Person`;

              this._removeSourcePerson(
                kind,
                Number(button.dataset[datasetKey])
              );
            });
          });

        this.shadowRoot
          .getElementById(`add-${kind}-person`)
          ?.addEventListener("click", () => {
            this._addSourcePerson(kind);
          });
      }

      this._config.mail_entities.forEach((entityId, index) => {
        const picker = this.shadowRoot.querySelector(
          `[data-mail-entity="${index}"]`
        );
        if (!picker) return;

        picker.hass = this._hass;
        picker.value = entityId || "";
        picker.includeDomains = ["sensor", "input_number"];
        picker.allowCustomEntity = true;

        picker.addEventListener("value-changed", (event) => {
          this._updateMailEntity(index, event.detail?.value || "");
        });
      });

      this.shadowRoot
        .querySelectorAll("[data-remove-mail]")
        .forEach((button) => {
          button.addEventListener("click", () => {
            this._removeMailEntity(Number(button.dataset.removeMail));
          });
        });

      this.shadowRoot
        .getElementById("add-mail-entity")
        ?.addEventListener("click", () => this._addMailEntity());
      this.shadowRoot
        .querySelectorAll("[data-status]")
        .forEach((checkbox) => {
          checkbox.addEventListener("change", () => {
            this._toggleStatus(checkbox.dataset.status, checkbox.checked);
          });
        });

      this.shadowRoot
        .getElementById("reset-statuses")
        ?.addEventListener("click", () => this._resetStatuses());

      for (const [id, key] of [
        ["pickup-color", "pickup_color"],
        ["transit-color", "transit_color"],
        ["other-color", "other_color"]
      ]) {
        this.shadowRoot.getElementById(id)?.addEventListener("change", (event) => {
          this._update(key, event.target.value);
        });
      }

      this.shadowRoot.getElementById("columns")?.addEventListener("change", (event) => {
        const value = Math.min(6, Math.max(1, asNumber(event.target.value, 3)));
        this._update("columns", value);
      });

      this.shadowRoot
        .getElementById("empty-message")
        ?.addEventListener("change", (event) => {
          this._update("empty_message", event.target.value || "Brak przesyłek");
        });

      this.shadowRoot
        .getElementById("show-empty")
        ?.addEventListener("change", (event) => {
          this._update("show_empty_message", !!event.target.checked);
        });

      this.shadowRoot
        .getElementById("show-pickup-qr")
        ?.addEventListener("change", (event) => {
          this._update("show_pickup_qr", !!event.target.checked);
        });
    }
  }

  if (!customElements.get("parcel-card")) {
    customElements.define("parcel-card", ParcelCard);
  }

  if (!customElements.get("parcel-card-editor")) {
    customElements.define("parcel-card-editor", ParcelCardEditor);
  }

  window.customCards = window.customCards || [];

  if (!window.customCards.some((card) => card.type === "parcel-card")) {
    window.customCards.push({
      type: "parcel-card",
      name: "Paczki – InPost + DPD + DHL + Allegro",
      description:
        "Zwięzła karta przesyłek InPost, DPD, DHL i Allegro z automatycznym scalaniem.",
      preview: true,
      documentationURL: ""
    });
  }

  console.info(
    `%c PARCEL-CARD %c v${CARD_VERSION} `,
    "color:white;background:#455a64;font-weight:700;padding:2px 6px;border-radius:3px 0 0 3px;",
    "color:#455a64;background:#eceff1;font-weight:700;padding:2px 6px;border-radius:0 3px 3px 0;"
  );
})();