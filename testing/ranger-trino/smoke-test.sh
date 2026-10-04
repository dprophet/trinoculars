#!/usr/bin/env bash
# Checks that Trino enforces the Ranger policies created by ranger/bootstrap.py.
# Run from this directory after `docker compose up -d`.
set -uo pipefail

cd "$(dirname "$0")"
pass=0
fail=0

trino_as() { # user sql
  docker compose exec -T trino trino --user "$1" --output-format CSV --execute "$2" 2>&1
}

expect_ok() { # description user sql [expected-substring]
  local out
  out=$(trino_as "$2" "$3")
  if [[ $? -eq 0 && ( -z "${4:-}" || "$out" == *"$4"* ) ]]; then
    echo "PASS  $1"; pass=$((pass + 1))
  else
    echo "FAIL  $1"; echo "      $out" | head -3; fail=$((fail + 1))
  fi
}

expect_denied() { # description user sql
  local out
  out=$(trino_as "$2" "$3")
  if [[ "$out" == *"Access Denied"* ]]; then
    echo "PASS  $1"; pass=$((pass + 1))
  else
    echo "FAIL  $1 (expected Access Denied)"; echo "      $out" | head -3; fail=$((fail + 1))
  fi
}

echo "Waiting for Trino to be healthy and to load Ranger policies..."
for _ in $(seq 1 60); do
  if trino_as alice "SELECT 1" | grep -q '"1"'; then break; fi
  sleep 5
done

expect_ok     "alice (analysts) can read tpch.tiny"             alice "SELECT count(*) FROM tpch.tiny.nation" '"25"'
expect_denied "carol (finance) cannot read tpch.tiny"           carol "SELECT count(*) FROM tpch.tiny.nation"
expect_denied "alice cannot read tpch.sf1 (outside her grant)"  alice "SELECT count(*) FROM tpch.sf1.nation"
expect_ok     "alice sees tpch in SHOW CATALOGS"                alice "SHOW CATALOGS" '"tpch"'
expect_ok     "bob (data-eng) can create a table in memory"     bob   "CREATE TABLE IF NOT EXISTS memory.default.smoke AS SELECT 1 AS x"
expect_ok     "bob can read it back"                            bob   "SELECT x FROM memory.default.smoke" '"1"'
expect_denied "alice cannot read bob's memory table"            alice "SELECT x FROM memory.default.smoke"
expect_denied "alice cannot create tables in memory"            alice "CREATE TABLE memory.default.nope AS SELECT 1 AS x"
expect_ok     "admin (trino-admins super group) reads anything" admin "SELECT count(*) FROM tpch.sf1.nation" '"25"'
expect_ok     "bob can drop his table"                          bob   "DROP TABLE memory.default.smoke"

echo
echo "$pass passed, $fail failed"
[[ $fail -eq 0 ]]
