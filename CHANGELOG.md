# Changelog

All notable changes to HA Parcel Card are documented here.

## 1.8.4

- Fixed duplicate tracking links after merging Allegro with InPost, DPD or DHL.
- If Allegro already provides a direct link to the same carrier, Parcel Card now shows it only once.
- Generated carrier tracking links are still used when Allegro does not provide a direct carrier link.

## 1.8.3

- Anonymized README examples.
- Added generated tracking links for InPost, DPD and DHL.
- Preserved Allegro-provided tracking links alongside carrier tracking links.
- Separated Allegro tracking identifiers from carrier waybill numbers.
- Allegro Delivery `AD...` identifiers are not incorrectly sent to DPD/DHL trackers.
- Documented the limitation of merging Allegro Delivery `AD...` identifiers with a different DPD/DHL waybill.

# Changelog

All notable changes to HA Parcel Card are documented here.

## 1.8.2

- Improved DHL support based on `jrx-code/hassio-integration-shipment-tracking`.
- Added DHL + Allegro merging by carrier and non-empty tracking number.
- Extended tracking-number extraction from Allegro tracking URLs.
- Added merge diagnostics in the package popup.
- Improved DHL problem-status mapping.
- Empty, null and invalid shipment identifiers are never merged.

## 1.8.1

- Added extended DPD details to the popup.
- Added sender address.
- Added last-update timestamp.
- Added delivery GPS link.
- Added courier name and clickable phone number when available.
- Added DPD multi-piece shipment information.

## 1.8.0

- Added DPD sources.
- Added DHL sources.
- Added support for multiple people/accounts for DPD and DHL.
- Added person/account labels in package details.
- Added generic merging by carrier + tracking number.
- Added `PROBLEM` status.

## 1.7.4

- Added numbering for multiple InPost multiskrytka groups.

## 1.7.3

- Added prominent multiskrytka package badges.
- Preserved multiskrytka metadata after Allegro + InPost merge.

## 1.7.2

- Added expansion of one InPost multiskrytka group into physical parcels.
- Each child parcel can be independently matched with Allegro.

## 1.7.1

- Simplified popup source labels to generic source names such as `InPost | Allegro`.

## 1.7.0

- Simplified InPost configuration to one source entity per person.
- Reads both `do_odbioru[]` and `w_drodze[]` from the InPost `Do odbioru` sensor.

## Earlier versions

Earlier releases introduced carrier grouping, status filtering, popup navigation fixes,
local QR generation, mailbox counters and Allegro/InPost package merging.
