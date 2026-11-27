"""Player position breakdown against intercepted, synthetic Supabase data."""

import copy
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

from stats_view_browser import API, BASE, C, M, OLD, data, errors, ids, new_context


def fixture(index, **fields):
    return {**copy.deepcopy(data["matches"][0]), "id": f"position-fixture-{index}", **fields}


if __name__ == "__main__":
    original, forfeit = data["matches"]
    old = fixture(
        1, seasonId=OLD, playoffRound="finals",
        result={
            **original["result"], "home": 2, "away": 2, "decision": "penalties",
            "penaltyOutcome": "L", "scorers": "complete", "assists": "unrecorded",
            "stats": [],
        },
    )
    upcoming = fixture(2, status="scheduled", result=None)
    data["matches"].extend([old, upcoming])
    roles = [
        dict(matchId=M, position="Central midfield", assignment="starter"),
        dict(matchId=forfeit["id"], position="Central midfield", assignment="substitute"),
        dict(matchId=old["id"], position="Central midfield", assignment="substitute"),
        dict(matchId=upcoming["id"], position="Left wing", assignment="starter"),
    ]
    player_url = BASE + "/players/profile/?id=" + ids[0]
    screenshots = Path("/tmp/mauve-position-breakdown")
    screenshots.mkdir(exist_ok=True)

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            executable_path="/usr/bin/chromium", headless=True, args=["--no-sandbox"]
        )
        for kind in [None, "outsider", "player", "captain"]:
            context, page, state, respond = new_context(browser, kind)
            state["role_requests"] = 0
            state["fail_roles"] = kind == "captain"

            def route_roles(route):
                if route.request.method == "OPTIONS":
                    respond(route, None)
                    return
                assert kind in ["player", "captain"]
                args = route.request.post_data_json
                assert args["p_club_id"] == C
                state["role_requests"] += 1
                if state["fail_roles"]:
                    respond(route, {"message": "Could not read roles"}, 503)
                    return
                respond(route, roles if args["p_player_id"] == ids[0] else [])

            context.route(API + "/rest/v1/rpc/get_player_lineup_roles", route_roles)

            # Some fixtures have no result and use the public snapshot's normal
            # omitted-result shape. The shared mock assumes a result key.
            def public(route):
                snapshot = copy.deepcopy(data)
                snapshot["players"] = snapshot["players"][:1]
                snapshot["roster"] = [row for row in snapshot["roster"] if row["playerId"] == ids[0]]
                for match in snapshot["matches"]:
                    if match.get("result"):
                        match["result"]["stats"] = [
                            row for row in match["result"]["stats"] if row["playerId"] == ids[0]
                        ]
                    else:
                        match.pop("result", None)
                respond(route, snapshot if route.request.method != "OPTIONS" else None)

            context.route(API + "/rest/v1/rpc/get_public_club", public)
            page.goto(player_url, wait_until="networkidle")
            panel = page.get_by_role("region", name="Position breakdown")
            if kind not in ["player", "captain"]:
                expect(panel).to_have_count(0)
                assert state["role_requests"] == 0
                context.close()
                continue
            if kind == "captain":
                expect(panel.get_by_role("alert")).to_contain_text("could not be loaded")
                state["fail_roles"] = False
                panel.get_by_role("button", name="Retry position stats").click()

            expect(panel.get_by_text("4 assignments", exact=True)).to_be_visible()
            midfield = panel.get_by_role("button", name="Central midfield, 1 start, 2 position subs")
            expect(midfield).to_have_attribute("aria-pressed", "true")
            detail = panel.locator(".position-detail")
            expect(detail).to_contain_text("2 published results")
            expect(detail).to_contain_text("+1.5 team goal difference per match")
            expect(detail.locator(".position-contributions strong")).to_have_text(["1", "1"])

            for width in [1440, 390, 320]:
                page.set_viewport_size({"width": width, "height": 1100})
                panel.scroll_into_view_if_needed()
                assert page.evaluate("document.documentElement.scrollWidth") <= width
                if kind == "player":
                    panel.screenshot(path=str(screenshots / f"positions-{width}.png"))

            wing = panel.get_by_role("button", name="Left wing, 1 start, 0 position subs")
            wing.focus()
            wing.press("Enter")
            expect(wing).to_have_attribute("aria-pressed", "true")
            expect(detail).to_contain_text("No published results from played matches")
            panel.get_by_role("combobox", name="Position stats season").select_option(OLD)
            expect(panel.get_by_text("1 assignment", exact=True)).to_be_visible()
            expect(detail).to_contain_text("1 loss")
            expect(detail.locator(".position-contributions strong")).to_have_text(["0", "—"])
            page.goto(BASE + "/players/profile/?id=" + ids[1], wait_until="networkidle")
            expect(panel).to_contain_text("No position assignments in published official lineups yet.")
            context.close()

    assert not errors, errors
    print("PASS position chart, results, season filter, retry, and member-only visibility at 320, 390, and 1440px.")
