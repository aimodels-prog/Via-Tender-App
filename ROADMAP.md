# CV Matching Tool - Implementation Roadmap

This roadmap captures all the requirements from the Developer Briefing Document (May 2026) as well as the advanced Product Manager expansions (Phase 5 & 6) to ensure absolutely nothing is missed.

## Phase 1: Core Data & Organization (Document Section 4.1, 5.1 & 5.2)
- [ ] **Expert 'Primary Position' Updates** 
  - Ensure the CV parser accurately extracts or assigns an initial `primary_position` conforming to the official taxonomy.
  - Make `primary_position` manually editable by the Tender Department in the UI.
- [ ] **CV Folder Structure & Selective Matching**
  - Group CVs in the UI into "Folders" organized by the Primary Position taxonomy.
  - Update the "Run Match" flow to allow selecting specific folders (or individual CVs) to restrict the matching pool, reducing compute costs.
- [ ] **Tender Timestamps**
  - Add a `last_matched_at` timestamp to Tenders when a matching process is launched.
  - Display this timestamp in the Tender list view (Format: DD/MM/YYYY HH:MM).

## Phase 2: Refined Matching Algorithm (Document Section 4.2 & 4.3)
- [ ] **Two-Stage Filter Engine**
  - Engine Stage 1: Filter the candidate pool strictly by Primary Position matching the required role title.
  - Engine Stage 2: Detailed criteria matching (education, experience, sector tech, keywords).
- [ ] **Scoring Calibration**
  - De-weight "years of experience" so otherwise qualified candidates aren't heavily penalized.
  - Resolve the "Hareesh" anomaly by ensuring score penalizes poor Primary Position alignment appropriately.

## Phase 3: Advanced Tender Classifiers & Multi-document (Document Section 3)
- [ ] **Tender Parser Classification**
  - Parse headers/covers to classify documents into `MM` (Muscat Municipality), `NAMA` (Nama Water Services), or `MOT` (Ministry of Transport).
- [ ] **Format-Specific Extraction logic**
  - Improve extraction for MM (Appendix 1 price table format).
  - Improve extraction for NAMA (Section 3.4.1 / 3.4.2 narrative).
  - Enhance MOT handling.
- [ ] **Multi-Document Support**
  - Support uploading multiple documents per tender (e.g., Primary + Scope/TOR).
  - Consolidate required roles extracted across multiple input files before matching.

## Phase 4: Document Generation & Integrations (Document Section 5.3 & 5.4)
- [ ] **CV Generation Completeness Fix**
  - Fix generation code where it drops off/truncates text for large outputs.
- [ ] **Headers and Footers in CV Generation**
  - Ensure standard headers and footers are injected properly when the final CV doc is created.
- [ ] **Google Drive Auto-Sync Edge Cases**
  - Verify sync robustness (already partially implemented). Add removal triggers if missing.

## Phase 5: PM Additions - Enhanced User Experience
- [ ] **Matching Explainability / Transparency**
  - Provide a "Why this match?" pill or tooltip in the results. Show exact breakdowns (Skill Match vs. Experience Match).
- [ ] **Taxonomy Management Settings**
  - Create a "Settings" page for Admins to add/edit/hide the official "Primary Position" roles rather than hard-coding them.
- [ ] **Analytics Dashboard**
  - Add an overarching view displaying average match rates, system health, CV pool size, and recent activity.

## Phase 6: PM Additions - Scale & Architecture
- [ ] **Persistent AI Feedback Loop**
  - Add "Thumbs up / Thumbs down" buttons on matched candidates.
  - Log user corrections (e.g. they dropped someone to rank 5) to inform the engine.
- [ ] **Bulk CV Export Options**
  - Provide a button to assemble all selected CVs into a single ZIP archive.
- [ ] **Robust Background Job Queue**
  - Solidify the async processing pipeline for heavy CV parsing and matching tasks so the UI never blocks.
