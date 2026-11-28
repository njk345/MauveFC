"""Fixture-linked member and captain matchday flows with intercepted test data."""

import copy
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

from stats_view_browser import API, BASE, M, OLD, S, data, errors, ids, names, new_context

FUTURE = "77777777-7777-4777-8777-777777777799"
VENUE = "Test Field"
FUTURE_URL = BASE + "/team/?match=" + FUTURE
REPORT_URL = BASE + "/team/?match=" + M + "&view=report"


if __name__ == "__main__":
    final = data["matches"][0]
    final.update(seasonId=OLD, source="leagueapps", revision=3)
    future = copy.deepcopy(final)
    future.update(id=FUTURE, seasonId=S, opponent="Future United", venue=VENUE,
                  kickoff="2099-10-01T23:00:00Z", status="scheduled", round=3)
    future.pop("result")
    data["seasons"][0]["timeZone"] = "America/Los_Angeles"
    data["matches"].append(future)
    lineup = dict(formation="2-3-1", starters=ids[2:9], bench=[ids[9]])
    posts = [
        dict(id=f"official-{match_id}", matchId=match_id, kind="official", payload=lineup,
             authorName="Captain", createdAt="2026-10-01T21:00:00Z", canDelete=False)
        for match_id in [FUTURE, M]
    ]
    posts.append(dict(
        id="suggestion", matchId=M, kind="suggestion",
        payload={**lineup, "starters": [ids[10], *ids[3:9]]},
        authorName="Member", createdAt="2026-10-01T22:00:00Z", canDelete=False,
    ))
    artifacts = Path("/tmp/mauve-matchday-shots")
    artifacts.mkdir(exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch(
            executable_path="/usr/bin/chromium", headless=True, args=["--no-sandbox"]
        )
        for kind in [None, "player", "captain"]:
            context, page, state, respond = new_context(browser, kind, 390)
            replies, saved = [], []

            def route(route):
                req = route.request
                if req.method == "OPTIONS":
                    respond(route, None)
                    return
                path = req.url.split("?")[0].split("/")[-1]
                if path == "get_public_club":
                    snapshot = copy.deepcopy(data)
                    snapshot["players"] = snapshot["players"][:1]
                    snapshot["roster"] = [row for row in snapshot["roster"] if row["playerId"] == ids[0]]
                    for game in snapshot["matches"]:
                        if game.get("result"):
                            game["result"]["stats"] = [
                                row for row in game["result"]["stats"] if row["playerId"] == ids[0]
                            ]
                    payload = snapshot
                else:
                    assert kind in ["player", "captain"]
                    if path == "get_team_club":
                        payload = {**data, "lineups": [], "rsvps": replies}
                    elif path == "get_captain_club":
                        assert kind == "captain"
                        snapshot = copy.deepcopy(data)
                        match = snapshot["matches"][0]
                        match.update(needsReview=not saved, leagueScore=dict(home=6, away=3, basis="played"))
                        payload = snapshot
                    elif path == "get_lineup_posts":
                        payload = posts
                    elif path == "save_match_rsvp":
                        args = req.post_data_json
                        assert args == {"p_match_id": FUTURE, "p_response": "in"}
                        replies.append(dict(matchId=FUTURE, playerId=ids[1], response="in", needsConfirmation=False))
                        payload = None
                    else:
                        assert path == "save_match_result" and kind == "captain"
                        current = req.post_data_json
                        assert current["p_match_id"] == M and current["p_expected_revision"] == 3
                        assert current["p_payload"]["published"] and current["p_payload"]["attendance"] == "complete"
                        assert (current["p_payload"]["home"], current["p_payload"]["away"]) == (6, 3)
                        players = {row["playerId"]: row for row in current["p_payload"]["stats"]}
                        assert players[ids[0]]["goals"] == 1 and players[ids[1]]["assists"] == 4
                        assert players[ids[9]]["appeared"] and not players[ids[2]]["appeared"]
                        assert not players[ids[10]]["appeared"]
                        saved.append(current)
                        final.update(result=current["p_payload"], revision=4)
                        payload = None
                respond(route, payload)

            for name in [
                "get_public_club", "get_team_club", "get_captain_club",
                "get_lineup_posts", "save_match_rsvp", "save_match_result",
            ]:
                context.route(API + "/rest/v1/rpc/" + name, route)

            page.goto(FUTURE_URL, wait_until="networkidle")
            if not kind:
                expect(page.get_by_role("link", name="Team sign-in", exact=True)).to_have_attribute(
                    "href", "/login/?match=" + FUTURE
                )
                expect(page.get_by_role("heading", name="Matchday hub")).to_have_count(0)
                context.close()
                continue
            fixture = page.locator(".matchday-fixture")
            expect(fixture).to_contain_text(VENUE)
            expect(fixture).to_contain_text("4:00 PM PDT")
            expect(page.get_by_role("heading", name="The captain’s match plan.")).to_be_visible()
            expect(page.get_by_role("button", name="Result & player stats")).to_have_count(0)
            page.get_by_role("button", name="In", exact=True).click()
            expect(page.get_by_role("button", name="In", exact=True)).to_have_attribute("aria-pressed", "true")

            for width in [320, 390, 1440]:
                page.set_viewport_size({"width": width, "height": 1080})
                assert page.evaluate("document.documentElement.scrollWidth") <= width
                if kind == "player":
                    page.locator(".team-match-section").screenshot(path=str(artifacts / f"upcoming-{width}.png"))

            page.goto(REPORT_URL, wait_until="networkidle")
            expect(page.get_by_role("combobox", name="Match", exact=True)).to_have_value(M)
            expect(fixture).to_contain_text("Past United")
            expect(page.get_by_role("combobox", name="Season", exact=True)).to_have_value(OLD)
            if kind == "player":
                expect(page.get_by_role("button", name="Result & player stats")).to_have_count(0)
                expect(page.get_by_role("button", name="Publish result")).to_have_count(0)
                context.close()
                continue
            expect(page.get_by_text("LeagueApps score needs review")).to_be_visible()
            page.get_by_role("button", name="Availability & lineup").click()
            expect(page.get_by_role("heading", name="The captain’s match plan.")).to_be_visible()
            page.get_by_role("button", name="Result & player stats").click()
            expect(page).to_have_url(REPORT_URL)
            expect(page.get_by_text("LeagueApps reports 6–3")).to_be_visible()
            page.get_by_role("button", name="Use LeagueApps score").click()
            expect(page.get_by_role("spinbutton", name="Opponent official score")).to_have_value("3")
            page.get_by_role("button", name="Add player details").click()
            expect(page.get_by_role("checkbox", name=names[2] + " played", exact=True)).not_to_be_checked()
            page.get_by_role("button", name="Prefill with starters").click()
            expect(page.get_by_role("checkbox", name=names[2] + " played", exact=True)).to_be_checked()
            expect(page.get_by_role("checkbox", name=names[9] + " played", exact=True)).not_to_be_checked()
            page.get_by_role("checkbox", name=names[2] + " played", exact=True).uncheck()
            page.get_by_role("checkbox", name=names[9] + " played", exact=True).check()
            page.get_by_role("combobox", name="Attendance recording").select_option("complete")
            page.evaluate("window.dispatchEvent(new Event('focus'))")
            expect(page.get_by_role("checkbox", name=names[9] + " played", exact=True)).to_be_checked()
            assert not saved
            page.once("dialog", lambda dialog: dialog.dismiss())
            page.get_by_role("button", name="Availability & lineup").click()
            expect(page.get_by_role("heading", name="Who made it happen?")).to_be_visible()
            for width in [320, 390, 1440]:
                page.set_viewport_size({"width": width, "height": 1080})
                assert page.evaluate("document.documentElement.scrollWidth") <= width
                page.locator(".entry-step").screenshot(path=str(artifacts / f"report-{width}.png"))
            page.get_by_role("button", name="Preview result").click()
            assert not saved
            page.get_by_role("button", name="Publish result", exact=True).click()
            expect(page.get_by_role("heading", name="Another chapter, published.")).to_be_visible()
            expect(fixture).to_contain_text("6 – 3")
            assert len(saved) == 1
            context.close()
    assert not errors, errors
    print("PASS linked fixtures, RSVP and privacy, LeagueApps review, lineup attendance, and publishing at 320, 390, and 1440px.")
