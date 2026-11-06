# Notes for Chapters 3 and 4

Points where the chapters disagree with each other or with what the system needs, and what the code does. Worth aligning the text before the final defense.

## 1. Dynamic decision rule (3.3.1/3.3.5 vs 3.4.2)

- Sections 3.3.1 and 3.3.5 (pseudocode and eq. 9): cosine similarity and Euclidean distance; genuine only if **both** pass, with τE = √(2(1 − τc)).
- Section 3.4.2: cosine, Euclidean **and Manhattan**, with **majority voting**.

**Code follows 3.3.5** (two metrics, both must pass). Update 3.4.2, or tell us to switch.

## 2. Dynamic features (Algorithm 2 vs 3.4.2)

- Algorithm 2 (3.3.5): 9 features `[x, y, dx, dy, v, a, θ, κ, pen]`, truncated or zero-padded to length L.
- Section 3.4.2: 7 features `[x, y, dx, dy, dt, pen, cumulative arc length]`, resampled to 128 steps.

The reference encoder (`networks.py`, `training/train_dynamic.py`) uses the 9 features of Algorithm 2, resampled to 128 steps. **The model ForgeBlock now runs is the team's SVC2004 notebook model, which uses a different design; see section 11.** Describe that one in Chapter 3.

## 3. Minimum samples for adaptive thresholds

The dynamic pseudocode uses a personal threshold when N ≥ 2; Sections 3.4.1 and 3.4.2 say at least five. **Code uses five** (configurable with `MIN_ADAPTIVE_SAMPLES`).

## 4. Static adaptive thresholds

The chapters describe adaptive thresholds for the static module but only give the formula for the dynamic one. The code applies the same idea per metric: τc = clip(mean − 1.5·sd) of the member's pairwise cosine similarities; τE and τM = clip(mean + 1.5·sd) of their pairwise distances. Clip bounds are in `backend/weights/static_config.json`.

## 5. Static confidence score

Eq. (6) averages "threshold-normalized contributions" without defining them. The code uses each metric's margin to its threshold, normalized to [0, 1] in the direction of the verdict (the same idea as the dynamic eq. 10), averaged and scaled to 0–100. Describe it as a **normalized confidence indicator**, not a calibrated probability (as 3.3.1 already suggests).

## 6. Database schema (Figure 3.2.1)

An **ACTIVITY_LOG** table was added because the Activity Feed (FR-07) must show login and enrollment events, which the five original tables cannot hold. VERIFICATION_LOG also has `mode` (compare or verify), `document_ref` (for the admin search in 4.2.3), and `threshold_source` (default or adaptive). Consider updating the figure.

## 7. Ledger wording

As 4.3.4 recommends, the code implements linked blocks, previous-block hashes and a validation process, so "hash-linked ledger" is accurate. It is not a distributed blockchain network; avoid saying Supabase itself is a blockchain.

## 8. Pseudocode file name

Algorithm 1 (3.3.4) loads `embedding signet.keras`; the app loads the same model as `backend/weights/static_model.keras`. The technology section (4.3.4) lists PyTorch; the static model is actually TensorFlow/Keras, so mention both.

## 9. Reporting static results honestly

Run `training/evaluate_static.py` only on CEDAR writers that were not used for training or threshold calibration, and report which writers those were. High accuracy on training writers is the usual reason "the numbers look good but real testing doesn't".

## 9. Confidence score scale (changed 2026-10-26)

The first version normalized the forged side of the confidence by (τc + 1) for cosine and (2 − τE) for Euclidean, while the genuine side used (1 − τc) and τE. Because real cosine similarities stay between about 0.8 and 1.0, forged results then almost never scored above 10%, so with the screening framing every forged result fell into "Inconclusive". The code now uses the same scale on both sides:

- genuine: (σ − τc)/(1 − τc), (τE − e)/τE, (τM − m)/τM
- forged:  (τc − σ)/(1 − τc), (e − τE)/τE, (m − τM)/τM

each clipped to [0, 1], averaged and ×100. Dynamic eq. (10) uses the same change for its forged branch. Update eq. (6)/(10) in Chapter 3 to match.

## 10. Screening framing

The system shows a screening result instead of a verdict: Consistent (genuine with confidence ≥ the policy cut-off), Inconsistent (forged with confidence ≥ cut-off) and Inconclusive (confidence below the cut-off; 15% under the Balanced policy, 25% Strict, 8% Lenient). The binary genuine/forged decision is still stored and is what accuracy, precision, recall, F1, FAR, FRR and EER are computed from. Only the examiner gives the final finding, which is sealed in the ledger next to the screening.

## 11. Final dynamic model (added 2026-10-27)

ForgeBlock runs the E2 model from the team's SVC2004 notebook. Where it differs from Chapter 3:

- **Features (15 per step):** x, y, dx, dy, speed, acceleration, pen up/down, path-angle sin and cos, curvature (10 base), pen azimuth sin and cos and altitude (3 orientation), pressure and its rate of change (2 pressure). Chapter 3 lists 7 (3.4.2) or 9 (Algorithm 2).
- **Preprocessing:** centred and scaled by the bounding box (aspect ratio kept), timestamps in seconds, light smoothing, resampled to **256 steps uniform in time**, pen-up gaps kept as pen-up; each feature standardized with training-set statistics. Chapter 3 says 128 steps.
- **Network:** Conv1D(64) + pool, Conv1D(128) + pool, **1-layer** BiLSTM (128 per direction), attention pooling, FC to 64, L2 normalization. Chapter 3 says a 2-layer BiLSTM.
- **Training:** contrastive loss on Euclidean distance (margin 1.0), balanced genuine-genuine / genuine-skilled-forgery pairs regenerated every epoch, 5-fold user-disjoint cross-validation on SVC2004 Task 2, early stopping on validation EER. The deployed checkpoint is the fold with the lowest validation EER.
- **Results (cross-validated, 5 references per user):** EER 10.7% ± 3.8%, F1 0.86, ROC-AUC 0.95. Without pressure and pen angles (E3) EER is 27.9%; with pressure only (E5) 13.7%.
- **Decision rule:** unchanged from Chapter 3 (mean cosine and mean Euclidean over the references, both must pass, personal threshold from ≥ 5 references). The default threshold is the notebook's validation EER threshold on mean Euclidean distance d = 0.638, converted with τc = 1 − d²/2 = 0.797; personal thresholds are clipped to [0.754, 0.95], the lower bound being the single-pair EER threshold.
- **Input:** Apple Pencil only. The browser's pen azimuth is turned by 90° to match SVC2004 (measured from 12 o'clock); this was inferred from the training statistics (mean SVC2004 azimuth about 129°, a right-handed writer's pen pointing to about 4 o'clock), not from the dataset documentation. Pressure 0–1 is scaled to 0–1023.

## 12. Access control and ethical use (added 2026-10-27, v4)

Section 3.8 "System Access Control and Ethical Use" is now implemented as written; see the README table "Access control and ethical use". Points to reflect in the chapters:

- **Second opinion.** Because examiners cannot see each other's cases, a Forged finding now gets its second opinion from the research team (admin), not from another examiner.
- **RLS wording (3.2.1, 3.8).** Row Level Security is on for every table and blocks direct access through Supabase's API; the per-account rule ("each account can access only the records it is authorized to view") is enforced by the backend. Suggested wording: "Row-level security blocks direct database access, and the backend allows each account to access only the records it is authorized to view."
- **Storage (3.2.1, 3.8).** Signature images and stroke files are stored on the ForgeBlock server's private storage folder (`backend/storage`), not in a Supabase Storage bucket. Either change the wording to "private server storage that cannot be accessed through public links", or move files to a private Supabase bucket before data gathering.
- **Names (3.2.1).** The client label is optional and defaults to the client code; the form asks for a code or made-up name, never a real name.
- **Retention (3.8).** The default retention is 365 days from registration. Set **Policy and retention > Data retention** so data is deleted six months after final thesis approval, or delete it manually then.

## 13. Development pen mode (added 2026-10-27, v5)

`DEV_PEN_DEVICES=true` lets a pen without tilt (Wacom One CTL-472) be used with the dynamic model for development only; see README "Wacom One CTL-472". It is off by default and must stay off for the study, which uses the iPad and Apple Pencil (Ch. 1.7, 3.7.1, consent form). Nothing in Chapters 1–3 needs to change unless the study itself switches devices; in that case the model should be the notebook's pressure-only experiment (E5, EER 13.7%) and the chapters and consent form would need revising.

## 14. v7 changes the chapters must follow (added 2026-11-03)

- **Compare removed.** Remove "compare two signatures" from the functions in Chapter 1 (objectives/scope) and Chapter 3 (system features, use case, DFD). Every check is a screening against a client's references.
- **Cases and review queue merged.** An Inconclusive or Inconsistent screening opens a case automatically. The examiner decides it: Genuine or Forged, with notes. There is no Inconclusive finding and no second opinion (this replaces §12 "Second opinion"). Update the use case / activity diagram and any text that mentions a review queue or second examiner.
- **Reports renamed Records**, model performance renamed **Evaluation** (admin only), Model and System status merged into **System**.
- **Model heatmap removed** from the result page (occlusion sensitivity). Remove it from the result description in Chapter 3 if it is listed. The difference overlay and stroke replay stay.
- **Repeat signatures.** An exactly identical sample screened again for the same client shows the earlier decision; it does not change the model's result or thresholds. A Genuine decision can be added as a new reference by the examiner (max 20).
- **Sign-in.** Email + password, plus Microsoft and Google through Supabase Auth, invite-only (no self-registration still holds for 3.8).
- **Study mode.** Research-use terms and labels apply when `STUDY_MODE=true`, which must be on for the evaluation sessions so 3.8 still holds as written.

## 15. v8 changes the chapters must follow (added 2026-11-03)

- **Confidence score is now writer-dependent (replaces §9; Ch3 eq. 6 and 10 must change). Revised 2026-11-04 (v8.2): z-score form.** For each metric, z = (s − τ)/σ for similarities (cosine) and z = (τ − d)/σ for distances (Euclidean, Manhattan), where σ is the client's own spread: the standard deviation of their reference-vs-reference scores (target-dependent z-normalization). z is taken on the side of the decision (a metric on the other side contributes 0) and mapped with the normal curve, c = 2Φ(z) − 1, so 0 sd past the threshold = 0%, 1 sd ≈ 68%, 1.5 sd ≈ 87%, 2 sd ≈ 95%. Confidence = 100 × mean over the metrics, capped at 99% (a screening is never certain). Because personal thresholds are τ = μ − 1.5σ, a signature as close as the client's typical one scores about 87%. If the threshold is further from the client's mean than 1.5σ (default threshold with < 5 references, or a clipped personal threshold), σ is taken as |μ − τ|/1.5 so the same reading holds; with fewer than 2 references σ = (distance from τ to a perfect match)/3; σ is never below 5% of that distance. Why the change: the v7 scale (divide by the largest possible margin) gave ~30% even for a reference screened against itself, and the first v8 scale (divide by the distance to the client's mean, cap at 100) saturated: about half of genuine samples and nearly all forgeries showed 100%. On the demo data the z-score form gives genuine screenings mostly 75–98% with real variance. Wording for Ch3: "The confidence score expresses how many of the client's own standard deviations the questioned signature lies past the decision threshold, converted to a 0–100 scale with the standard normal distribution; it is a measure of the decision margin, not a calibrated probability." Basis: target-dependent score normalization / z-norm (Fierrez-Aguilar et al., 2005; Jain, Nandakumar & Ross, 2005, score normalization in multibiometric systems), writer-dependent thresholds on SigNet embeddings (Hafemann et al., 2017), target-dependent normalization in signature/speaker verification (Gonzalez-Rodriguez et al., 2002). If a calibrated probability is wanted later, fit a logistic (Platt, 1999) on the evaluation scores.
- **Exact match notice.** A questioned signature that is identical to a reference on file (cosine ≥ 0.99999) is flagged on the result page, because re-screening a reference proves nothing.
- **Inconclusive cut-off.** Strict / Balanced / Lenient presets removed. One cut-off, `INCONCLUSIVE_BELOW` (default 20), set by the research team and not shown in the app. Chapter 3 should say it is chosen from the evaluation with an error–reject curve (reject option: Chow, 1970; selective classification: Geifman & El-Yaniv, 2017; Hendrickx et al., 2024 survey; inconclusive opinions in document examination: ASTM E1658). `training/evaluate_static.py` prints the error–reject table and suggests the smallest cut-off that keeps the error on accepted screenings ≤ 5% with ≤ 25% Inconclusive.
- **Evaluation page removed.** Model evaluation (FAR, FRR, EER, ROC-AUC, confusion matrix) is done offline in the notebooks and `training/` scripts on the test set, per 3.7.4; remove the in-app "model performance / evaluation" function from Ch1 scope and Ch3 features if listed.
- **Client groups (Ch3 §3.8 and system features).** Clients are organized in groups (e.g. Lawyers, OSS, CCJE). Each group has exactly one assigned examiner and an examiner belongs to one group only, so examiners never see another group's clients, screenings or cases. Suggested 3.8 sentence: "Examiners can view only the clients, screenings and cases of the client group assigned to them; each group is assigned to one examiner."
- **Client accounts and client view.** Registering a client with an email creates the client's account automatically (temporary password). Clients see their assigned examiner and can open each screening in a limited view: screening result, confidence score, the examiner's decision, receipt and ledger proof, without metric scores, thresholds or handwriting analysis.
- **Records and Cases** show which examiner handles each screening/case (name and code) for the administrator.
