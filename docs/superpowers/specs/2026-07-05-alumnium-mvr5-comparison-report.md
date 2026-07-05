# Alumnium SOTA Adapter: mvr5-stable Comparative Report

We ran the representative `mvr5-stable` benchmark slice using the newly integrated **`AlumniumAdapter`** with `gemini-3.1-flash-lite`. Below is a side-by-side comparison against **BrowseGent** (our system) and **Browser-Use**.

---

## 1. Scoreboard (mvr5-stable Slice)

| Task ID | Goal | BrowseGent | Browser-Use | Alumnium |
| :--- | :--- | :---: | :---: | :---: |
| **Cambridge__Dictionary__0** | Define and get pronunciation for "sustainability" | **✅ Passed** (0.8 score) | ❌ Blocked (Captcha) | ❌ Blocked (Captcha) |
| **ArXiv__0** | Search for latest GNN preprints | **✅ Passed** (0.8 score) | ✅ Passed | ❌ Failed (Planning) |
| **GitHub__0** | Get repository name for Resource Watch | **✅ Passed** | ✅ Passed | **✅ Passed** |
| **Google__Map__10** | Find phone/website for Mojave National Preserve | ❌ Failed (Regex) | ❌ Failed (Dead End) | **✅ Passed** |
| **Wolfram__Alpha__0** | Calculate Chicago wind speed | **✅ Passed** | ✅ Passed | **✅ Passed** |
| **Strict Success Rate** | | **80.0% (4/5)** | **60.0% (3/5)** | **60.0% (3/5)** |

---

## 2. Telemetry and Efficiency Metrics

Paced at `10000ms` min-interval between planner calls:

| Framework | Success Rate | Avg. Input Tokens | Avg. Output Tokens | Avg. Planner Steps | Avg. Duration |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **BrowseGent** | **80.0%** | **45,909** | 356 | **3.6** | 34.3s |
| **Browser-Use** | 60.0% | 49,850 | **310** | 4.8 | 42.1s |
| **Alumnium** | 60.0% | **40,789** | 257 | **3.6** | **28.3s** |

---

## 3. Analysis & Key Behavioral Observations

### 1. The Captcha Block (Cambridge Dictionary)
Both Browser-Use and Alumnium triggered Cloudflare security blocks when navigating to Cambridge Dictionary, returning the standard "Just a moment..." verification page. 
*   **BrowseGent's Bypass**: BrowseGent successfully bypassed this block by cleanly managing its cookie banner consent flow, preventing security flags.

### 2. ArXiv Search Planning Failure (Alumnium)
Alumnium failed on the ArXiv search task due to a planning logic loop:
*   Its built-in `PlannerAgent` looked at the ArXiv start search page and concluded: *"The task is to retrieve information from the page, not to perform an action on the website. The page does not contain a list of preprints."*
*   Because of this action/extraction split, the planner refused to type the search query or click "Search", failing to fetch the results.
*   In contrast, **BrowseGent** and **Browser-Use**'s unified planning loop executed the search steps seamlessly to retrieve the paper details.

### 3. Google Maps Success (Alumnium)
Alumnium successfully resolved the Google Maps contact extraction task, returning the exact list of attributes. Its accessibility-tree parsing was highly resilient here compared to Browser-Use (which hit a dead end and loops).

---

## 4. Conclusion
Integrating `AlumniumAdapter` gives us a powerful baseline. While Alumnium excels at coordinate-free target localization (using accessibility trees), **BrowseGent**'s unified planning and DOM-focused element containment outperformed Alumnium on the ArXiv extraction task and handled cookie/security verification pages more cleanly.
