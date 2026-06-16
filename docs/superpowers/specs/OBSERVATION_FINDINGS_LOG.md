# Observation Layer Findings & Gap Analysis Log

Generated on: 2026-06-15T19:09:52.974Z

## 1. Observation Gap Analysis

| Site | State | Expected Control | Locator Check | Observation Check | Root Cause Analysis |
| :--- | :--- | :--- | :---: | :---: | :--- |
| Wikipedia | State B (Type Search Query) | Search Input | `found_in_dom` | `observed_visible` | Control observed successfully. |
| Wikipedia | State C (Article page) | Contents list | `found_in_dom` | `not_observed` | Wikipedia article TOC structured inside shadow/nested container, failing name matching. |
| Cambridge Dictionary | State B (Autocomplete Dropdown) | Autocomplete Popup Item | `not_in_dom` | `not_observed` | Dynamic autocomplete items lacked strict accessibility names, causing observation to omit them. |
| Amazon | State C (Results Page) | Next page link | `found_in_dom` | `not_observed` | Amazon pagination control elements are structured as styled spans or custom navigation shapes, failing the basic link matcher. |
| GitHub | State B (Navigate Repository) | Issues tab link | `not_in_dom` | `not_observed` | GitHub tabs use aria-selected or tabroles, which may mismatch simple name/role matchers depending on active sub-attribute filtering. |
| Reddit | State A (Homepage) | Search input | `not_in_dom` | `not_observed` | Reddit search input lacks standard aria-label or name "Search Reddit" in production shadow DOM nodes. |

## 2. Dynamic UI Audit

| Interaction | Refs Before | Refs During | Refs After | Transient Captured | Details |
| :--- | :---: | :---: | :---: | :---: | :--- |
| Wikipedia Search Autocomplete Popup | 593 | 629 | 593 | `true` | Captured popover suggestions successfully. |
| Cambridge Autocomplete Dropdown | 693 | 693 | 693 | `false` | No items found in refs. |

## 3. Planner Surface Reduction Audit

| Site | State | Observed DOM | allocated Refs | Actionable Refs | Working Set Refs | Reduction Rate |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: |
| Wikipedia | State A (Homepage) | 593 | 593 | 16 | 57 | 90.4% |
| Cambridge Dictionary | State A (Homepage) | 688 | 688 | 27 | 41 | 94.0% |
| Amazon | State A (Homepage) | 1176 | 1176 | 34 | 69 | 94.1% |
| GitHub | State A (Homepage) | 674 | 674 | 15 | 20 | 97.0% |

