# Observation Layer Audit & Coverage Report

Generated on: 2026-06-15T18:55:20.558Z

## Site: Wikipedia (Critical)

| State | Total Refs | Actionable Refs | Loss Rate | Duplicate Density | Actionability Coverage | Stability Var | Obs Time | Ref Gen Time | WS Time | Missing Controls |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| State A (Homepage) | 593 | 16 | 33.3% | 12.0% | 2.7% | 0.00 | 356ms | 12ms | 19ms | Language Dropdown |
| State B (Type Search Query) | 593 | 16 | 100.0% | 12.0% | 2.7% | 216.00 | 299ms | 6ms | 2ms | Search Input |
| State C (Article page) | 2346 | 53 | 100.0% | 41.9% | 2.3% | 0.00 | 851ms | 51ms | 10ms | Contents list |

## Site: Cambridge Dictionary (Critical)

| State | Total Refs | Actionable Refs | Loss Rate | Duplicate Density | Actionability Coverage | Stability Var | Obs Time | Ref Gen Time | WS Time | Missing Controls |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| State A (Homepage) | 693 | 31 | 0.0% | 77.8% | 4.5% | 0.00 | 362ms | 45ms | 4ms | None |
| State B (Autocomplete Dropdown) | 693 | 31 | 50.0% | 77.8% | 4.5% | 0.00 | 290ms | 6ms | 3ms | Autocomplete Popup Item |
| State C (Definition Page) | 879 | 56 | 0.0% | 63.3% | 6.4% | 0.00 | 381ms | 19ms | 5ms | None |

## Site: Amazon (Critical)

| State | Total Refs | Actionable Refs | Loss Rate | Duplicate Density | Actionability Coverage | Stability Var | Obs Time | Ref Gen Time | WS Time | Missing Controls |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| State A (Homepage) | 1174 | 32 | 0.0% | 71.8% | 2.7% | 0.00 | 470ms | 17ms | 4ms | None |
| State B (Type Laptop Query) | 1174 | 33 | 0.0% | 72.0% | 2.8% | 0.00 | 646ms | 11ms | 4ms | None |
| State C (Results Page) | 3760 | 39 | 100.0% | 73.7% | 1.0% | 0.00 | 1305ms | 64ms | 17ms | Next page link |

## Site: GitHub (Critical)

| State | Total Refs | Actionable Refs | Loss Rate | Duplicate Density | Actionability Coverage | Stability Var | Obs Time | Ref Gen Time | WS Time | Missing Controls |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| State A (Homepage) | 674 | 15 | 0.0% | 57.1% | 2.2% | 0.00 | 2416ms | 32ms | 2ms | None |
| State B (Navigate Repository) | 702 | 48 | 50.0% | 62.1% | 6.8% | 0.00 | 342ms | 11ms | 2ms | Issues tab link |
| ERROR | - | - | - | - | - | - | - | - | - | page.click: Timeout 30000ms exceeded.
Call log:
[2m  - waiting for locator('a[data-tab-item="issues-tab"]')[22m
 |

## Site: Reddit (Exploratory)

| State | Total Refs | Actionable Refs | Loss Rate | Duplicate Density | Actionability Coverage | Stability Var | Obs Time | Ref Gen Time | WS Time | Missing Controls |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| State A (Homepage) | 1454 | 25 | 100.0% | 88.9% | 1.7% | 0.00 | 588ms | 24ms | 3ms | Search input |
| State B (Subreddit page) | 6960 | 27 | 0.0% | 92.5% | 0.4% | 0.00 | 1684ms | 136ms | 11ms | None |
| State C (Post page) | 413 | 31 | 0.0% | 79.9% | 7.5% | 32214.64 | 638ms | 47ms | 2ms | None |

