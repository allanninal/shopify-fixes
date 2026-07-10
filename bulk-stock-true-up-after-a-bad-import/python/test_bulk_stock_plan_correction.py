from true_up_inventory import plan_correction, load_snapshot
import csv
import os
import tempfile


def test_no_correction_when_matching():
    assert plan_correction("SKU-1", 10, {"SKU-1": 10}, max_adjust=500) is None


def test_no_correction_when_missing_from_snapshot():
    assert plan_correction("SKU-1", 10, {}, max_adjust=500) is None


def test_correction_when_drift_positive():
    decision = plan_correction("SKU-1", 3, {"SKU-1": 40}, max_adjust=500)
    assert decision == {"sku": "SKU-1", "from": 3, "to": 40, "delta": 37}


def test_correction_when_drift_negative():
    decision = plan_correction("SKU-1", 90, {"SKU-1": 12}, max_adjust=500)
    assert decision == {"sku": "SKU-1", "from": 90, "to": 12, "delta": -78}


def test_no_correction_when_drift_exceeds_guard():
    # a swing bigger than max_adjust looks like a second bad file, not real damage
    assert plan_correction("SKU-1", 5, {"SKU-1": 5000}, max_adjust=500) is None


def test_correction_allowed_at_exact_guard_boundary():
    decision = plan_correction("SKU-1", 0, {"SKU-1": 500}, max_adjust=500)
    assert decision["delta"] == 500


def test_load_snapshot_reads_csv_by_sku():
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "snapshot.csv")
        with open(path, "w", newline="", encoding="utf-8") as fh:
            writer = csv.writer(fh)
            writer.writerow(["sku", "available"])
            writer.writerow(["SKU-1", "40"])
            writer.writerow(["SKU-2", "0"])
            writer.writerow(["", "99"])  # blank sku is skipped
        snapshot = load_snapshot(path)
    assert snapshot == {"SKU-1": 40, "SKU-2": 0}
