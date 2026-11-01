"""Opt-in live Groq evaluation on synthetic data. Never prints secrets."""

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from core.engine import plan_isolated, execute, AppError


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=30)
    parser.add_argument("--delay", type=float, default=15)
    parser.add_argument("--output", default="eval/latest.json")
    args = parser.parse_args()
    if not os.getenv("GROQ_API_KEY") or not os.getenv("GROQ_MODEL"):
        parser.error("Set GROQ_API_KEY and GROQ_MODEL in your local environment first.")
    cases = json.loads((ROOT / "eval/cases.json").read_text())[: args.limit]
    results = []
    for case in cases:
        start = time.monotonic()
        error = None
        try:
            data = {"headers": case["headers"], "rows": case["rows"]}
            plan = plan_isolated(case["instruction"], data, case["replacement"])
            output = execute(data, plan)
            passed = not case["unsupported"] and output["rows"] == case["expected"]
        except AppError as exc:
            error = exc.code
            passed = case["unsupported"] and error in (
                "INVALID_OPERATION",
                "INVALID_TARGET",
                "INVALID_REQUEST",
            )
        results.append(
            {
                "id": case["id"],
                "passed": passed,
                "seconds": round(time.monotonic() - start, 2),
                "error_code": error,
            }
        )
        print(case["id"], "PASS" if passed else "FAIL", error or "")
        if error == "RATE_LIMITED":
            print("Stopped at provider quota; remaining cases are NOT RUN.")
            break
        if len(results) < len(cases):
            time.sleep(max(0, min(args.delay, 60)))
    report = {
        "model": os.environ["GROQ_MODEL"],
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "total_cases": len(cases),
        "executed": len(results),
        "passed": sum(r["passed"] for r in results),
        "results": results,
    }
    Path(args.output).write_text(json.dumps(report, indent=2) + "\n")
    return 0 if report["passed"] == len(cases) else 1


if __name__ == "__main__":
    raise SystemExit(main())
