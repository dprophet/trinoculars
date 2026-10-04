"""One-shot Ranger bootstrap for the Trino test rig.

Creates test users/groups and the policies the rig relies on, in the `dev_trino` service that
the Ranger image creates on first start. Idempotent: anything that already exists is left alone.

Policies:
  * Baseline, required by Trino for anyone to run a query (Trino docs, "Required policies"):
      - every user may execute queries           (queryid *          -> execute,     {USER})
      - every user may impersonate themselves    (trinouser {USER}   -> impersonate, {USER})
      - every user may kill their own queries    (system.runtime.kill_query -> execute, {USER})
  * Samples used by smoke-test.sh:
      - analysts read tpch.tiny                  (select, show)
      - data-eng owns memory.default             (select insert create drop delete alter show)
"""

import os
import re
import sys
import time

import requests

URL = os.environ.get("RANGER_URL", "http://ranger:6080")
SERVICE = os.environ.get("RANGER_SERVICE", "dev_trino")
AUTH = ("admin", os.environ.get("RANGER_ADMIN_PASSWORD", "rangerR0cks!"))
JSON = {"Accept": "application/json", "Content-Type": "application/json"}

GROUPS = ["analysts", "data-eng", "finance", "trino-admins"]
USERS = {"alice": ["analysts"], "bob": ["data-eng"], "carol": ["finance"]}
TEST_USER_PASSWORD = "Passw0rd123"  # Ranger UI login for the test users; Trino does not use it


def api(method, path, **kwargs):
    return requests.request(method, f"{URL}{path}", auth=AUTH, headers=JSON, timeout=30, **kwargs)


def wait_for_service():
    for _ in range(60):
        try:
            if api("GET", f"/service/public/v2/api/service/name/{SERVICE}").status_code == 200:
                return
        except requests.ConnectionError:
            pass
        time.sleep(5)
    sys.exit(f"Ranger service {SERVICE!r} did not appear at {URL}")


def group_id(name):
    r = api("GET", "/service/xusers/groups", params={"name": name})
    r.raise_for_status()
    for g in r.json().get("vXGroups", []):
        if g["name"] == name:
            return g["id"]
    return None


def ensure_group(name):
    gid = group_id(name)
    if gid is None:
        api("POST", "/service/xusers/groups", json={"name": name, "description": name}).raise_for_status()
        gid = group_id(name)
        print(f"group created: {name}")
    return gid


def user_exists(name):
    r = api("GET", "/service/xusers/users", params={"name": name})
    r.raise_for_status()
    return any(u["name"] == name for u in r.json().get("vXUsers", []))


def ensure_user(name, group_ids):
    if user_exists(name):
        return
    api(
        "POST",
        "/service/xusers/secure/users",
        json={
            "name": name,
            "firstName": name,
            "password": TEST_USER_PASSWORD,
            "status": 1,
            "isVisible": 1,
            "userRoleList": ["ROLE_USER"],
            "groupIdList": group_ids,
        },
    ).raise_for_status()
    print(f"user created: {name}")


def res(**levels):
    return {k: {"values": v, "isExcludes": False, "isRecursive": False} for k, v in levels.items()}


def item(accesses, users=(), groups=()):
    return {
        "accesses": [{"type": a, "isAllowed": True} for a in accesses],
        "users": list(users),
        "groups": list(groups),
        "delegateAdmin": False,
    }


POLICIES = [
    ("all users - execute queries", res(queryid=["*"]), [item(["execute"], users=["{USER}"])]),
    ("all users - impersonate self", res(trinouser=["{USER}"]), [item(["impersonate"], users=["{USER}"])]),
    (
        "all users - kill own queries",
        res(catalog=["system"], schema=["runtime"], procedure=["kill_query"]),
        [item(["execute"], users=["{USER}"])],
    ),
    (
        "analysts read tpch.tiny",
        res(catalog=["tpch"], schema=["tiny"], table=["*"], column=["*"]),
        [item(["select", "show"], groups=["analysts"])],
    ),
    (
        "data-eng owns memory.default",
        res(catalog=["memory"], schema=["default"], table=["*"], column=["*"]),
        [item(["select", "insert", "create", "drop", "delete", "alter", "show"], groups=["data-eng"])],
    ),
]


def ensure_policy(name, resources, items):
    path = f"/service/public/v2/api/service/{SERVICE}/policy/{requests.utils.quote(name)}"
    if api("GET", path).status_code == 200:
        return
    body = {
        "service": SERVICE,
        "name": name,
        "policyType": 0,
        "isEnabled": True,
        "isAuditEnabled": False,
        "resources": resources,
        "policyItems": items,
    }
    r = api("POST", "/service/public/v2/api/policy", json=body)
    if r.status_code < 300:
        print(f"policy created: {name}")
        return
    # Ranger allows one policy per exact resource set, and it pre-creates default "all - ..."
    # policies (e.g. "all - queryid" on queryid=*). On that conflict, add our grant to the
    # existing policy instead.
    match = re.search(r"policy-name=\[([^\]]+)\]", r.text)
    if r.status_code != 400 or not match:
        sys.exit(f"creating policy {name!r} failed: HTTP {r.status_code} {r.text[:300]}")
    existing_name = match.group(1)
    existing = api("GET", f"/service/public/v2/api/service/{SERVICE}/policy/{requests.utils.quote(existing_name)}")
    existing.raise_for_status()
    policy = existing.json()
    current = policy.get("policyItems") or []
    added = [it for it in items if not any(same_item(it, c) for c in current)]
    if not added:
        return
    policy["policyItems"] = current + added
    api("PUT", f"/service/public/v2/api/policy/{policy['id']}", json=policy).raise_for_status()
    print(f"policy extended: {existing_name!r} (for {name!r})")


def same_item(a, b):
    accesses = lambda i: {x["type"] for x in i.get("accesses") or [] if x.get("isAllowed")}
    return (
        set(a.get("users") or []) == set(b.get("users") or [])
        and set(a.get("groups") or []) == set(b.get("groups") or [])
        and accesses(a) <= accesses(b)
    )


def main():
    wait_for_service()
    ids = {g: ensure_group(g) for g in GROUPS}
    for user, groups in USERS.items():
        ensure_user(user, [ids[g] for g in groups])
    for name, resources, items in POLICIES:
        ensure_policy(name, resources, items)
    print(f"bootstrap complete: service {SERVICE}")


if __name__ == "__main__":
    main()
