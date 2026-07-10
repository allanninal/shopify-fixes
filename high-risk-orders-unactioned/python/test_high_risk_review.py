from flag_high_risk import needs_review, is_high_risk


def order(**over):
    base = {
        "cancelledAt": None,
        "tags": [],
        "risk": {"recommendation": "INVESTIGATE", "assessments": [{"riskLevel": "HIGH"}]},
    }
    base.update(over)
    return base


def test_high_risk_when_assessment_is_high():
    assert is_high_risk(order()) is True


def test_high_risk_when_recommendation_is_cancel():
    o = order(risk={"recommendation": "CANCEL", "assessments": [{"riskLevel": "LOW"}]})
    assert is_high_risk(o) is True


def test_not_high_risk_when_all_low():
    o = order(risk={"recommendation": "ACCEPT", "assessments": [{"riskLevel": "LOW"}]})
    assert is_high_risk(o) is False


def test_needs_review_true_for_untagged_high_risk():
    assert needs_review(order(), "fraud-review") is True


def test_needs_review_false_when_already_tagged():
    assert needs_review(order(tags=["fraud-review"]), "fraud-review") is False


def test_needs_review_false_when_cancelled():
    assert needs_review(order(cancelledAt="2026-07-10T00:00:00Z"), "fraud-review") is False
