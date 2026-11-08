"""Turns a binary decision into a screening result (decision support).

ForgeBlock is a screening tool, like a medical screening test: it does not
declare a signature genuine or forged. The binary decision from decision.py
is kept internally (for accuracy, FAR, FRR and EER), and the user sees one of:

    consistent    - consistent with the client's references
    inconclusive  - confidence too low to lean either way; examiner review needed
    inconsistent  - inconsistent with the references; refer for examination

The confidence score is the confidence in the binary decision (distance past the
thresholds in units of the client's own spread, through the normal curve,
see decision.py), so a result close to the thresholds has a
confidence near 0. Results below INCONCLUSIVE_BELOW (config, not shown in the
app) are Inconclusive.

With a calibrated module (v8.5, decision.py) the result comes from the
calibrated probability P(genuine) instead: Consistent when P >= the upper
band edge, Inconsistent when P <= the lower edge, Inconclusive in between
(a "band" in the module's calibration.json entry wins; otherwise
default band 0.35-0.80, env CALIBRATED_BAND="0.35,0.80"; the upper edge is
higher because accepting a forgery costs more than a review, Chow 1970), i.e. Chow's
reject option on a calibrated posterior. Only an examiner gives the final
finding.
"""
import os
from .decision import Decision

LABELS = {
    "consistent": "Consistent with references",
    "inconclusive": "Inconclusive, examiner review needed",
    "inconsistent": "Inconsistent, refer for examination",
}

DISCLAIMER = "ForgeBlock is a screening tool and does not replace a qualified document examiner."


def _band() -> tuple[float, float]:
    try:
        lo, hi = (float(v) for v in os.getenv("CALIBRATED_BAND", "0.35,0.80").split(","))
        if 0 <= lo <= 0.5 <= hi <= 1:
            return lo, hi
    except ValueError:
        pass
    return 0.35, 0.80


CALIBRATED_BAND = _band()


def screening_result(decision: Decision, inconclusive_below: float) -> str:
    if decision.p_genuine is not None:
        lo, hi = decision.band or CALIBRATED_BAND
        if decision.p_genuine >= hi:
            return "consistent"
        if decision.p_genuine <= lo:
            return "inconsistent"
        return "inconclusive"
    if decision.confidence < inconclusive_below:
        return "inconclusive"
    return "consistent" if decision.classification == "genuine" else "inconsistent"


def caption(result: str, confidence: float, mode: str = "verify") -> str:
    """Plain-language sentence shown under the screening result."""
    n = round(confidence)
    against = "the client's signatures on file" if mode == "verify" else "the other signature"
    if result == "consistent":
        return f"The system is {n}% confident this signature matches {against}."
    if result == "inconsistent":
        return f"The system is {n}% confident this signature does not match {against}."
    return (
        f"The result is too close to the decision thresholds to lean either way "
        f"(confidence {n}%). An examiner should review it."
    )
