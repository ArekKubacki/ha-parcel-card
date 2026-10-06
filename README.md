# 📦 HA Parcel Card

Rozbudowana karta Lovelace dla **Home Assistant**, która łączy informacje o przesyłkach z kilku integracji w jednym, zwięzłym widoku.

Obsługiwane źródła:

- **InPost**
- **DPD**
- **DHL**
- **Allegro**
- opcjonalnie własne sensory z liczbą **listów w skrzynce**

Karta potrafi rozpoznać, że ta sama fizyczna przesyłka występuje jednocześnie w kilku integracjach i scalić ją w jeden wpis, np. `InPost | Allegro`, `DPD | Allegro` lub `DHL | Allegro`.

> **Ważne:** `ha-parcel-card` jest wyłącznie kartą frontendową. Sama nie loguje się do InPost, DPD, DHL ani Allegro. Dane muszą być już dostępne w Home Assistant przez odpowiednie custom componenty.

![HA Parcel Card – anonymized preview](https://raw.githubusercontent.com/ArekKubacki/ha-parcel-card/main/docs/preview.svg)

---

## ✨ Najważniejsze funkcje

- wspólna karta przesyłek z kilku integracji,
- obsługa wielu osób / kont,
- osobne przypisanie paczek do osób, np. `InPost: xxx`,
- automatyczne łączenie duplikatów z różnych źródeł,
- wspólna siatka przewoźników na dole karty,
- szczegółowy popup po kliknięciu przewoźnika,
- produkty i sprzedawca z Allegro,
- kod odbioru i QR dla InPost / Allegro,
- lokalne generowanie QR bez zewnętrznego API,
- Paczkomat, adres i termin odbioru,
- obsługa **multiskrytki InPost**,
- adres nadawcy DPD,
- GPS miejsca doręczenia DPD,
- nazwa i telefon kuriera DPD, jeśli API je zwróci,
- obsługa statusów DHL,
- obsługa paczek udostępnionych DHL,
- konfigurowalne statusy widoczne na karcie,
- konfigurowalne kolory kafelków,
- opcjonalny licznik listów w skrzynce,
- automatyczne ukrywanie pustych sekcji,
- obsługa nawigacji Home Assistant bez pozostawiania fragmentów popupu,
- układ zoptymalizowany pod telefon.

---

# 🔌 Wymagane / wspierane integracje

## Shipment Tracking — InPost, DPD, DHL

Dla **InPost, DPD i DHL** karta została przygotowana pod integrację:

### [jrx-code/hassio-integration-shipment-tracking](https://github.com/jrx-code/hassio-integration-shipment-tracking)

Repozytorium HACS:

```text
https://github.com/jrx-code/hassio-integration-shipment-tracking
```

Integracja ta obsługuje również inne firmy kurierskie, ale w tej chwili `ha-parcel-card` ma dedykowaną logikę dla:

| Przewoźnik | Obsługa | Encja źródłowa |
|---|---:|---|
| InPost | ✅ | sensor **Do odbioru** |
| DPD | ✅ | sensor **W drodze** |
| DHL | ✅ | sensor **W drodze** |
| FedEx | planowane | — |
| Pocztex | planowane | — |
| ORLEN Paczka | obecnie przez dane Allegro | — |
| Allegro One | obecnie przez dane Allegro | — |

## Allegro

Dane o zamówieniach Allegro karta pobiera z integracji:

### [Przemko92/home-assistant-allegro](https://github.com/Przemko92/home-assistant-allegro)

Repozytorium HACS:

```text
https://github.com/Przemko92/home-assistant-allegro
```

Karta korzysta z sensora typu:

```text
sensor.allegro_<konto>_in_progress
```

i jego atrybutu:

```yaml
details:
```

Dodatkowe projekty:

- Home Assistant: https://www.home-assistant.io/
- HACS: https://hacs.xyz/

---

# 📥 Instalacja

## HACS — custom repository

1. Otwórz **HACS**.
2. Przejdź do **Frontend**.
3. Otwórz menu w prawym górnym rogu.
4. Wybierz **Custom repositories**.
5. Dodaj:

```text
https://github.com/ArekKubacki/ha-parcel-card
```

6. Typ repozytorium: **Dashboard**.
7. Zainstaluj **HA Parcel Card**.
8. Odśwież frontend Home Assistant.

## Instalacja ręczna

Skopiuj:

```text
parcel-card.js
```

do:

```text
/config/www/community/parcel-card/parcel-card.js
```

Dodaj zasób Lovelace:

```text
/local/community/parcel-card/parcel-card.js
```

Przy ręcznych aktualizacjach warto zmieniać wersję w URL:

```text
/local/community/parcel-card/parcel-card.js?v=1.8.3
```

---

# ⚙️ Przykładowa konfiguracja YAML

```yaml
type: custom:parcel-card

inpost_people:
  - name: xxx
    source_entity: sensor.inpost_inpost_xxx_do_odbioru
  - name: yyy
    source_entity: sensor.inpost_inpost_yyy_do_odbioru

dpd_people:
  - name: xxx
    source_entity: sensor.dpd_xxx_w_drodze

dhl_people:
  - name: xxx
    source_entity: sensor.dhl_xxx_w_drodze

allegro_progress_entity: sensor.allegro_xxx_in_progress

mail_entities:
  - sensor.listy_w_skrzynce

columns: 3
pickup_color: "#E3F3E7"
transit_color: "#E7F1FA"
other_color: "#FFFFFF"
show_pickup_qr: true
show_empty_message: true
empty_message: "Brak przesyłek"
```

Nazwy encji są tylko przykładowe. Użyj encji ze swojej instancji Home Assistant.

---

# 🧾 Zmienne konfiguracyjne

## Główne opcje

| Zmienna | Typ | Domyślnie | Opis |
|---|---|---|---|
| `type` | string | wymagane | Musi być `custom:parcel-card` |
| `inpost_people` | lista | przykładowe konta | Lista osób / kont InPost |
| `dpd_people` | lista | `[]` | Lista osób / kont DPD |
| `dhl_people` | lista | `[]` | Lista osób / kont DHL |
| `allegro_progress_entity` | entity_id | przykład | Sensor Allegro `in_progress` |
| `mail_entities` | lista | `[]` | Sensory liczbowe reprezentujące listy w skrzynce |
| `columns` | integer | `3` | Maksymalna liczba kolumn kafelków, ograniczona do `1..6` |
| `pickup_color` | kolor CSS | `#E3F3E7` | Kolor, gdy jest paczka do odbioru |
| `transit_color` | kolor CSS | `#E7F1FA` | Kolor paczek w drodze / dostawie |
| `other_color` | kolor CSS | `#FFFFFF` | Kolor pozostałych statusów |
| `show_pickup_qr` | boolean | `true` | Pokazuje QR odbioru |
| `show_empty_message` | boolean | `true` | Pokazuje komunikat przy braku przesyłek |
| `empty_message` | string | `Brak przesyłek` | Tekst komunikatu pustej karty |
| `visible_statuses` | lista / null | `null` | Lista statusów, które mają być widoczne |

## Konfiguracja osoby / konta

Dla InPost, DPD i DHL format jest taki sam:

```yaml
- name: xxx
  source_entity: sensor.example
```

| Pole | Typ | Opis |
|---|---|---|
| `name` | string | Nazwa osoby / konta widoczna na karcie |
| `source_entity` | entity_id | Encja źródłowa odpowiedniej integracji |

Można dodać dowolną liczbę osób.

---

# 📮 Listy w skrzynce

`mail_entities` może zawierać dowolne sensory liczbowe:

```yaml
mail_entities:
  - sensor.listy_w_skrzynce
```

Jeżeli suma wynosi `0`, sekcja jest ukrywana. Jeżeli suma jest większa niż `0`, karta pokaże np.:

```text
Listy w skrzynce: 2 szt.
```

---

# 📦 InPost — format danych

Karta oczekuje sensora **Do odbioru** z integracji Shipment Tracking.

To może być nieintuicyjne, ponieważ właśnie ta encja zawiera pełne szczegóły zarówno dla paczek do odbioru, jak i w drodze.

Przykładowa encja:

```text
sensor.inpost_inpost_xxx_do_odbioru
```

Przykładowe atrybuty:

```yaml
do_odbioru_count: 1
w_drodze_count: 2

do_odbioru:
  - numer: "XXXXXXXXXXXXXXXXXXXXXXXX"
    nadawca: "Przykładowy nadawca"
    kod_odbioru: "111111"
    paczkomat: "XXX00X"
    adres: "Przykładowy adres Paczkomatu"
    termin_odbioru: "2026-10-02T08:43:00.000Z"
    qr: "P|+48XXXXXXXXX|111111"
    multiskrytka: null

w_drodze:
  - numer: "XXXXXXXXXXXXXXXXXXXXXXXX"
    nadawca: "Przykładowy nadawca"
    paczkomat: "XXX00X"
    status: "Potwierdzona"
```

Karta wykorzystuje:

| Atrybut | Zastosowanie |
|---|---|
| `do_odbioru_count` | liczba paczek do odbioru |
| `w_drodze_count` | liczba paczek w drodze |
| `do_odbioru[]` | szczegóły gotowych przesyłek |
| `w_drodze[]` | szczegóły przesyłek w drodze |
| `numer` | numer przesyłki |
| `nadawca` | nazwa nadawcy |
| `kod_odbioru` | kod odbioru |
| `paczkomat` | nazwa / kod Paczkomatu |
| `adres` | adres Paczkomatu |
| `termin_odbioru` | termin odbioru |
| `qr` | payload QR |
| `multiskrytka` | liczba paczek w multiskrytce |
| `paczki[]` | numery paczek w multiskrytce |
| `kody_fallback[]` | odpowiadające im kody odbioru |

---

# 🗄️ InPost — multiskrytka

Integracja może zwrócić jedną pozycję grupową, mimo że fizycznie w skrytce znajduje się kilka paczek:

```yaml
do_odbioru_count: 3

do_odbioru:
  - numer: "YYYYYYYYYYYYYYYYYYYYYYYY"
    kod_odbioru: "222222"
    multiskrytka: 3
    paczki:
      - "XXXXXXXXXXXXXXXXXXXXXXXX"
      - "YYYYYYYYYYYYYYYYYYYYYYYY"
      - "ZZZZZZZZZZZZZZZZZZZZZZZZ"
    kody_fallback:
      - "111111"
      - "222222"
      - "333333"
```

Karta rozbija taką grupę na osobne fizyczne paczki i oznacza je np.:

```text
Multiskrytka 1 · paczka 1/3
Multiskrytka 1 · paczka 2/3
Multiskrytka 1 · paczka 3/3
```

Przy kilku multiskrytkach numerowane są osobno.

---

# 🔳 InPost — kod odbioru i QR

Dla paczek gotowych do odbioru karta może pokazać kod odbioru i QR.

QR generowany jest **lokalnie w przeglądarce**. Karta nie wysyła kodu odbioru ani payloadu QR do zewnętrznych serwisów.

Wyłączenie QR:

```yaml
show_pickup_qr: false
```

---

# 🚚 DPD — format danych

Karta oczekuje sensora **W drodze** z Shipment Tracking.

Przykład:

```yaml
active_count: 1
delivered_count: 0

w_drodze:
  - numer: 1052152209910U
    nadawca: Sprzedawca
    status: Utworzona
    aktualizacja: "2026-10-02T08:36:37Z"
    adres_nadawcy: "ul. Xxxxx 00, 00-000 Xxxxx"
    gps_doreczenia:
      lat: "00.00000"
      lon: "00.00000"
    kurier: null
    telefon_kuriera: null
```

Obsługiwane pola DPD:

| Atrybut | Zastosowanie |
|---|---|
| `active_count` | liczba aktywnych paczek |
| `delivered_count` | liczba dostarczonych |
| `w_drodze[]` | lista aktywnych paczek |
| `numer` | numer przesyłki |
| `nadawca` | nadawca |
| `status` | status DPD |
| `aktualizacja` | czas ostatniej aktualizacji |
| `adres_nadawcy` | adres nadawcy |
| `gps_doreczenia.lat` | szerokość geograficzna |
| `gps_doreczenia.lon` | długość geograficzna |
| `kurier` | nazwa kuriera |
| `telefon_kuriera` | numer telefonu kuriera |
| `czesc_przesylki` | część przesyłki wielopaczkowej |
| `pozostale_paczki` | pozostałe paczki z grupy |

Jeżeli dostępny jest GPS, popup pokazuje link do mapy. Jeżeli DPD poda telefon kuriera, numer jest klikalny.

---

# 🚛 DHL — format danych

Karta oczekuje sensora **W drodze** z Shipment Tracking.

Aktualny sensor DHL udostępnia:

```yaml
active_count: 1
delivered_count: 0

w_drodze:
  - numer: "..."
    nadawca: "..."
    status: "..."
    aktualizacja: "..."
    udostepniona: false
```

Obsługiwane pola:

| Atrybut | Zastosowanie |
|---|---|
| `active_count` | liczba aktywnych przesyłek |
| `delivered_count` | liczba dostarczonych |
| `w_drodze[]` | lista aktywnych przesyłek |
| `numer` | numer przesyłki |
| `nadawca` | nadawca |
| `status` | status DHL |
| `aktualizacja` | czas ostatniej aktualizacji |
| `udostepniona` | czy paczka została udostępniona temu kontu |

---

# 🛒 Allegro — format danych

Karta odczytuje atrybut `details` z sensora `in_progress`:

```yaml
details:
  - Seller: example-shop
    Status: AVAILABLE_FOR_PICKUP
    Offers:
      - Przykładowy produkt
    tracing_url: >-
      https://inpost.pl/sledzenie-przesylek?number=XXXXXXXXXXXXXXXXXXXXXXXX
    delivery_name: Allegro Paczkomaty InPost
    pickup_code: 132 035
    receiver_phone_number: +48 XXX XXX XXX
    qr_code: P|+48XXXXXXXXX|111111
```

Pola używane przez kartę:

| Atrybut | Zastosowanie |
|---|---|
| `Seller` / `seller` | nazwa sprzedawcy |
| `Status` / `status` | status zamówienia |
| `Offers` / `offers` | lista produktów |
| `delivery_name` | nazwa przewoźnika |
| `tracing_url` / `tracking_url` | link śledzenia |
| `pickup_code` | kod odbioru |
| `qr_code` | payload QR |
| pola numeru przesyłki | wykorzystywane przy scalaniu |

Karta potrafi także wyciągać numer przesyłki z parametrów URL, m.in. `parcel`, `shipment`, `tracking`, `tracking-id`, `trackingId`, `shipment-id`, `shipmentId`, `piececode`, `pieceCode`, `waybill`, `numer`, `number`.

---

# 🔎 Linki do śledzenia

Karta tworzy klikalne linki do śledzenia także wtedy, gdy integracja przewoźnika nie zwraca gotowego URL.

Dla numeru pochodzącego bezpośrednio z integracji przewoźnika generowane są linki:

| Przewoźnik | Link |
|---|---|
| InPost | `https://inpost.pl/sledzenie-przesylek?number=...` |
| DPD | `https://tracktrace.dpd.com.pl/parcelDetails?p1=...` |
| DHL | `https://sprawdz.dhl.com.pl/laststatus.aspx?NR1=...` |

Jeżeli Allegro udostępnia własny `tracing_url`, karta zachowuje go jako osobny link. W popupie mogą więc pojawić się np. dwa odnośniki: **Śledź w Allegro** oraz **Śledź w DPD**.

> Link przewoźnika jest generowany wyłącznie z numeru pochodzącego z jego własnej integracji. Numer `AD...` z Allegro Delivery nie jest automatycznie wysyłany do trackera DPD/DHL, ponieważ może być identyfikatorem Allegro, a nie numerem listu przewozowego przewoźnika.

---

# 🔀 Allegro Delivery `AD...` a numer przewoźnika

Dla przesyłek Allegro Delivery partnerem logistycznym może być DPD lub DHL, ale Allegro może pokazywać własny numer zaczynający się od `AD...`, podczas gdy integracja DPD/DHL widzi inny numer listu przewozowego.

Przykład:

```text
Allegro: ADXXXXXXXXXXXXXXXX
DPD:     XXXXXXXXXXXXXU
```

Te dwa numery nie mają wspólnej wartości, więc karta nie może ich bezpiecznie scalić wyłącznie po numerze. Aktualne sensory używane przez kartę nie przekazują jawnego mapowania `AD... -> numer DPD/DHL`.

Z tego powodu automatyczne scalanie w takiej sytuacji jest celowo wyłączone. Zgadnięcie na podstawie samego nadawcy lub kolejności paczek mogłoby połączyć dwie różne przesyłki.

Najlepszym rozwiązaniem będzie w przyszłości wykorzystanie dodatkowego numeru referencyjnego, jeżeli zostanie wystawiony przez integrację Allegro albo Shipment Tracking.

---

# 🔗 Automatyczne scalanie przesyłek

Ta sama fizyczna paczka może istnieć jednocześnie w kilku integracjach. Karta próbuje pokazać ją tylko raz.

## InPost + Allegro

Kolejność dopasowania:

1. numer przesyłki,
2. kod odbioru,
3. pełny QR,
4. kod odbioru wyciągnięty z QR.

Po scaleniu jeden wpis może zawierać jednocześnie produkty i sprzedawcę z Allegro oraz Paczkomat, adres, termin, kod odbioru i QR z InPost.

## DPD + Allegro

Warunek:

```text
DPD + identyczny niepusty numer przesyłki
```

## DHL + Allegro

Warunek:

```text
DHL + identyczny niepusty numer przesyłki
```

## Wartości puste nigdy nie są scalane

Za poprawny identyfikator nie są uznawane:

```text
null
None
unknown
unavailable
N/A
-
pusta wartość
```

---

# 🏷️ Źródła a osoby

Karta rozdziela dwa pojęcia.

Źródło danych:

```text
InPost | Allegro
DPD | Allegro
DHL | Allegro
```

Osoba / konto:

```text
InPost: xxx
DPD: yyy
DHL: xxx
```

---

# 🚦 Statusy

| Status wewnętrzny | Nazwa na karcie |
|---|---|
| `AVAILABLE_FOR_PICKUP` | Do odbioru |
| `IN_TRANSIT` | W drodze |
| `IN_DELIVERY` | W dostawie |
| `IN_PREPARATION` | W realizacji |
| `PAID` | Opłacone |
| `PROBLEM` | Problem |
| `WAITING_FOR_PAYMENT` | Oczekuje na płatność |
| `UNPAID` | Nieopłacone |
| `PARTIALLY_RETURNED` | Częściowy zwrot |
| `RETURNED` | Zwrot |
| `DELIVERED` | Dostarczono |
| `ORDER_CANCELLED` | Anulowane |
| `CANCELLED` | Anulowane |

Domyślnie ukryte są zwroty, dostarczone i anulowane.

Przykład własnej listy:

```yaml
visible_statuses:
  - AVAILABLE_FOR_PICKUP
  - IN_TRANSIT
  - IN_DELIVERY
  - IN_PREPARATION
  - PROBLEM
```

---

# 🎨 Kolory kafelków

Domyślnie:

```yaml
pickup_color: "#E3F3E7"
transit_color: "#E7F1FA"
other_color: "#FFFFFF"
```

Priorytet:

1. do odbioru,
2. w drodze / dostawie,
3. pozostałe.

---

# 🚛 Kafelki przewoźników

Wszystkie kafelki przewoźników są umieszczane razem na dole karty.

Rozpoznawane są m.in.:

```text
ORLEN
DPD
DHL
One Kurier
Allegro One
InPost
GLS
UPS
Pocztex
FedEx
Inny
```

Licznik kafelka pokazuje liczbę **fizycznych paczek po scaleniu**, a nie sumę rekordów ze wszystkich integracji.

---

# 🔍 Popup przesyłki

W zależności od dostępnych danych popup może pokazać:

- źródła,
- przypisaną osobę,
- sprzedawcę / nadawcę,
- status,
- oryginalny status przewoźnika,
- numer przesyłki,
- sposób scalenia,
- kod odbioru,
- QR,
- Paczkomat,
- adres Paczkomatu,
- termin odbioru,
- produkty Allegro,
- link śledzenia,
- adres nadawcy DPD,
- czas aktualizacji DPD/DHL,
- link do mapy DPD,
- kuriera DPD,
- telefon kuriera,
- dane przesyłki wielopaczkowej DPD,
- flagę paczki udostępnionej DHL,
- numer multiskrytki InPost.

---

# 🧠 Dlaczego dla InPost wybieramy sensor „Do odbioru”?

W Shipment Tracking sensor **Do odbioru** zawiera atrybuty `do_odbioru` oraz `w_drodze`, czyli pełne szczegóły obu grup. Oddzielny sensor **W drodze** jest przede wszystkim licznikiem.

Dlatego:

- InPost → wybierz **Do odbioru**,
- DPD → wybierz **W drodze**,
- DHL → wybierz **W drodze**.

---

# 🧪 Diagnostyka

Po aktualizacji możesz wymusić przeładowanie zasobu:

```text
/local/community/parcel-card/parcel-card.js?v=1.8.3
```

Jeżeli InPost nie pokazuje szczegółów, sprawdź czy wybrana encja posiada `do_odbioru` i `w_drodze`.

Jeżeli DPD/DHL nie pokazuje szczegółów, sprawdź atrybut `w_drodze`.

Jeżeli Allegro jest puste, sprawdź atrybut `details` sensora `in_progress`.

---

# 🔐 Prywatność

Karta działa po stronie frontendu Home Assistant i odczytuje wyłącznie dane już dostępne w encjach HA.

Sama karta nie loguje się do InPost, DPD, DHL ani Allegro. Za autoryzację odpowiadają custom componenty.

QR generowany jest lokalnie.

---

# 🛠️ Development

Główny plik:

```text
parcel-card.js
```

Kontrola składni:

```bash
node --check parcel-card.js
```

---

# 🗺️ Planowane

- FedEx z Shipment Tracking,
- Pocztex,
- natywne źródło ORLEN Paczka,
- natywne źródło Allegro One,
- dodatkowe dane przewoźników,
- więcej ikon źródeł,
- lepsza diagnostyka scalania,
- automatyczne release GitHub / HACS.

---

# ❤️ Powiązane projekty

## Shipment Tracking

https://github.com/jrx-code/hassio-integration-shipment-tracking

## Home Assistant Allegro

https://github.com/Przemko92/home-assistant-allegro

## HACS

https://hacs.xyz/

## Home Assistant

https://www.home-assistant.io/

---

# ⚠️ Disclaimer

Projekt nie jest oficjalnie powiązany z InPost, DPD, DHL, Allegro ani Home Assistant.

Nazwy i znaki towarowe należą do ich właścicieli.

`ha-parcel-card` jedynie prezentuje dane udostępnione przez encje Home Assistant.

---

# 📄 Aktualna wersja

```text
1.8.3
```