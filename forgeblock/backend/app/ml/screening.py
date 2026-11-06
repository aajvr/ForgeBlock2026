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
app) are Inconclusive. Only an examiner gives the final finding.
"""
from .decision import Decision

LABELS = {
    "consistent": "Consistent with references",
    "inconclusive": "Inconclusive, examiner review needed",
    "inconsistent": "Inconsistent, refer for examination",
}

DISCLAIMER = "ForgeBlock is a screening tool and does not replace a qualified document examiner."


def screening_result(decision: Decision, inconclusive_below: float) -> str:
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
