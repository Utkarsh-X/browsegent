# Final Architectural & Observation Validation Findings Report

Generated on: 2026-06-15T19:58:25.734Z

## 1. Dynamic Interactive Surface Audit (Cycle 3)

| Interactive Surface | In Playwright DOM | Raw Crawl Nodes | Ref Generated Count | Detected Key Targets | Details |
| :--- | :---: | :---: | :---: | :--- | :--- |
| Wikipedia Search Autocomplete Suggestions | `true` | 629 | 629 | a [Ref: v2ref_133]: "Computer scienceStudy of computation"<br>div [Ref: v2ref_134]: "Computer scienceStudy of computation"<br>h3 [Ref: v2ref_135]: "Computer science" | Dynamic search suggestions successfully observed. |
| Cambridge Dictionary Search Autocomplete Dropdown | `false` | 693 | 693 | None | Dynamic autocomplete popup omitted from observations. |
| Amazon Department Dropdown Select | `true` | 1167 | 1167 | select [Ref: v2ref_1356]: "All Departments Arts & Crafts Automotive Baby Beauty & Personal Care Books Boys' Fashion Computers Deals Digital Music Electronics Girls' Fashion Health & Household Home & Kitchen Industrial & Scientific Kindle Store Luggage Men's Fashion Movies & TV Music, CDs & Vinyl Pet Supplies Prime Video Software Sports & Outdoors Tools & Home Improvement Toys & Games Video Games Women's Fashion"<br>option [Ref: v2ref_1357]: "All Departments"<br>option [Ref: v2ref_1358]: "Arts & Crafts"<br>option [Ref: v2ref_1359]: "Automotive"<br>option [Ref: v2ref_1360]: "Baby" | Department select dropdown target successfully observed. |
| GitHub Branch Switcher Panel | `false` | 702 | 702 | None | Branch switcher items missing or occluded. |

## 2. End-to-End Control Lineage Audit (Cycle 4)

| Target Control | Observed | Ref Generated | Ref ID | Actionable | Actionable Status | Working Set | Selection / Drop Reason |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| Wikipedia Search Input | `true` | `true` | `v2ref_2940` | `true` | `ready` | `true` | visible_ready |
| Cambridge Dictionary Search Input | `true` | `true` | `v2ref_3548` | `true` | `ready` | `true` | visible_ready |
| Amazon Search Input | `true` | `true` | `v2ref_4245` | `true` | `ready` | `true` | visible_ready |
| GitHub Issues Tab Link | `true` | `true` | `v2ref_5115` | `false` | `blocked` | `false` | Dropped during Working Set compression |

